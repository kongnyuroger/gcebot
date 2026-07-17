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
import { MainMenuHandler } from './main-menu.handler';

const MAX_SUBJECT_BUTTONS = 3;

export const FOLLOW_UP_ASK_ANOTHER = 'qa_ask_another';
export const FOLLOW_UP_CHANGE_SUBJECT = 'qa_change_subject';
export const FOLLOW_UP_MAIN_MENU = 'qa_main_menu';

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

    await this.whatsappSendService.markAsRead(message.messageId);
    await this.whatsappSendService.sendText(phone, this.i18n.t('qa.thinking', lang));

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
}
