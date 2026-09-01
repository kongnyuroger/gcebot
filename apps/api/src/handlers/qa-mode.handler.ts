import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConversationState } from '@gcebot/shared';
import { Language } from '../../generated/prisma';
import { ParsedMessage } from '../whatsapp/services/message-parser.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { SessionService } from '../session/session.service';
import { StateTransitionService } from '../session/state-transition.service';
import { UsersService } from '../users/users.service';
import { I18nService } from '../i18n/i18n.service';
import { QaService } from '../rag/services/qa.service';
import { LlmService } from '../rag/services/llm.service';
import { QuotaService } from '../quota/quota.service';
import { StreakService } from '../progress/streak.service';
import { MilestoneService } from '../progress/milestone.service';
import { MainMenuHandler } from './main-menu.handler';

const MAX_SUBJECT_BUTTONS = 3;

export const FOLLOW_UP_ASK_ANOTHER = 'qa_ask_another';
export const FOLLOW_UP_CHANGE_SUBJECT = 'qa_change_subject';
export const FOLLOW_UP_MAIN_MENU = 'qa_main_menu';

function buildHintSystemPrompt(question: string): string {
  return (
    `The student is working on this question: ${question}. Give a helpful hint ` +
    'that guides them toward the answer WITHOUT revealing it fully. Keep it to 1-2 sentences.'
  );
}

@Injectable()
export class QaModeHandler {
  private readonly logger = new Logger(QaModeHandler.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly stateTransitionService: StateTransitionService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly i18n: I18nService,
    private readonly qaService: QaService,
    private readonly llmService: LlmService,
    private readonly quotaService: QuotaService,
    private readonly streakService: StreakService,
    private readonly milestoneService: MilestoneService,
    // MainMenuHandler already depends on QaModeHandler (to enter QA_MODE from
    // the main menu tap) - forwardRef breaks the resulting circular DI edge,
    // since this handler also needs MainMenuHandler.sendMenu() for the
    // "Main menu" follow-up button.
    @Inject(forwardRef(() => MainMenuHandler))
    private readonly mainMenuHandler: MainMenuHandler,
  ) {}

  // Reachable both from a MAIN_MENU button tap (a valid graph edge) and from
  // the global /ask command, which - like /menu and /settings - must work
  // from any state. Rather than branch on the caller, this always resets the
  // session straight into QA_MODE directly (bypassing StateTransitionService),
  // the same escape-hatch pattern CommandHandler already uses.
  async enterQaMode(phone: string): Promise<void> {
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    await this.sessionService.setSession(phone, {
      state: ConversationState.QA_MODE,
      subject: undefined,
      conversationHistory: [],
      currentQuestionText: undefined,
    });

    if (!user) {
      this.logger.warn(`enterQaMode: no user profile found for ${phone}`);
      return;
    }

    if (user.subjects.length === 0) {
      await this.whatsappSendService.sendText(phone, this.i18n.t('qa.noSubjectsRegistered', lang));
      return;
    }

    await this.sendSubjectPrompt(phone, user.subjects, lang);
  }

  async handleSubjectSelection(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const selectedSubject = message.buttonId ?? message.listId;
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    if (!selectedSubject || !user?.subjects.includes(selectedSubject)) {
      this.logger.warn(`Unrecognized subject selection "${selectedSubject}" from ${phone}`);
      return this.sendSubjectPrompt(phone, user?.subjects ?? [], lang);
    }

    await this.sessionService.updateSessionField(phone, 'subject', selectedSubject);
    await this.stateTransitionService.transition(phone, ConversationState.AWAITING_QUESTION);

    await this.whatsappSendService.sendText(
      phone,
      this.i18n.t('qa.askAnything', lang, { subject: selectedSubject }),
    );
  }

  async handleQuestion(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const questionText = message.text?.trim();
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    if (!questionText) {
      this.logger.warn(`Non-text message from ${phone} while AWAITING_QUESTION; ignoring`);
      return;
    }

    const quota = await this.quotaService.checkQuota(phone);
    if (!quota.allowed) {
      this.logger.warn(`QA quota exceeded for ${phone}: used=${quota.used}/${quota.limit}`);
      await this.whatsappSendService.sendText(phone, this.i18n.t('qa.quotaExceeded', lang));
      return;
    }

    await this.recordActivity(phone);

    await this.whatsappSendService.markAsRead(message.messageId, true);

    const session = await this.sessionService.getSession(phone);
    await this.sessionService.updateSessionField(phone, 'currentQuestionText', questionText);

    const parts = await this.qaService.answerQuestion(phone, questionText, session?.subject);

    for (const part of parts) {
      await this.whatsappSendService.sendText(phone, part);
    }

    await this.sendFollowUpButtons(phone, lang);
  }

  async handleFollowUpSelection(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    switch (message.buttonId) {
      case FOLLOW_UP_ASK_ANOTHER:
        return this.whatsappSendService.sendText(phone, this.i18n.t('qa.askAnotherPrompt', lang));

      case FOLLOW_UP_CHANGE_SUBJECT:
        await this.stateTransitionService.transition(phone, ConversationState.QA_MODE);
        await this.clearQaContext(phone);
        return this.sendSubjectPrompt(phone, user?.subjects ?? [], lang);

      case FOLLOW_UP_MAIN_MENU:
        await this.stateTransitionService.transition(phone, ConversationState.MAIN_MENU);
        await this.clearQaContext(phone);
        return this.mainMenuHandler.sendMenu(phone);

      default:
        this.logger.warn(`Unrecognized follow-up selection "${message.buttonId}" from ${phone}`);
        return this.sendFollowUpButtons(phone, lang);
    }
  }

  async handleHint(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    const session = await this.sessionService.getSession(phone);
    const currentQuestion = session?.currentQuestionText;

    if (!currentQuestion) {
      await this.whatsappSendService.sendText(phone, this.i18n.t('qa.noActiveQuestion', lang));
      return;
    }

    // A hint is a short, cheap request on its own (no retrieved context, no
    // conversation history needed) - gpt-4o-mini is plenty for 1-2 sentences.
    const hint = await this.llmService.generate(
      buildHintSystemPrompt(currentQuestion),
      currentQuestion,
      { complexity: 'simple' },
    );

    await this.whatsappSendService.sendText(phone, hint);
  }

  private async clearQaContext(phone: string): Promise<void> {
    await this.sessionService.updateSessionField(phone, 'subject', undefined);
    await this.sessionService.updateSessionField(phone, 'conversationHistory', []);
    await this.sessionService.updateSessionField(phone, 'currentQuestionText', undefined);
  }

  private async sendFollowUpButtons(phone: string, lang: Language): Promise<void> {
    await this.whatsappSendService.sendButtons(phone, this.i18n.t('qa.followUpPrompt', lang), [
      { id: FOLLOW_UP_ASK_ANOTHER, title: this.i18n.t('qa.askAnother', lang) },
      { id: FOLLOW_UP_CHANGE_SUBJECT, title: this.i18n.t('qa.changeSubject', lang) },
      { id: FOLLOW_UP_MAIN_MENU, title: this.i18n.t('common.mainMenu', lang) },
    ]);
  }

  private async sendSubjectPrompt(
    phone: string,
    subjects: string[],
    lang: Language,
  ): Promise<void> {
    const promptText = this.i18n.t('qa.selectSubject', lang);

    if (subjects.length <= MAX_SUBJECT_BUTTONS) {
      await this.whatsappSendService.sendButtons(
        phone,
        promptText,
        subjects.map((subject) => ({ id: subject, title: subject })),
      );
      return;
    }

    await this.whatsappSendService.sendList(
      phone,
      promptText,
      this.i18n.t('qa.selectSubjectListButton', lang),
      [
        {
          title: this.i18n.t('qa.selectSubjectSectionTitle', lang),
          rows: subjects.map((subject) => ({ id: subject, title: subject })),
        },
      ],
    );
  }

  // Best-effort: a streak/milestone failure shouldn't block the student from
  // getting their actual answer.
  private async recordActivity(phone: string): Promise<void> {
    try {
      const updatedUser = await this.streakService.recordActivity(phone);
      await this.milestoneService.checkMilestone(updatedUser);
    } catch (error) {
      this.logger.error(
        `recordActivity failed for ${phone}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
