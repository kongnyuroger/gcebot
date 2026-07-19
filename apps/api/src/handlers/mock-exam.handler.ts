import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConversationState } from '@gcebot/shared';
import { Language, SubscriptionTier } from '../../generated/prisma';
import { ParsedMessage } from '../whatsapp/services/message-parser.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { SessionService } from '../session/session.service';
import { StateTransitionService } from '../session/state-transition.service';
import { UsersService } from '../users/users.service';
import { I18nService } from '../i18n/i18n.service';
import { MainMenuHandler } from './main-menu.handler';

const MAX_SUBJECT_BUTTONS = 3;

export const MOCK_START_EXAM = 'mock_start_exam';
export const MOCK_CANCEL_EXAM = 'mock_cancel_exam';

// Placeholder shown at the Ready?/Start/Cancel prompt until Step 2's paper
// assembly determines the real duration for the assembled paper.
const PLACEHOLDER_DURATION_MINUTES = 90;

const PREMIUM_TIERS: SubscriptionTier[] = [SubscriptionTier.PREMIUM, SubscriptionTier.FAMILY];

@Injectable()
export class MockExamHandler {
  private readonly logger = new Logger(MockExamHandler.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly stateTransitionService: StateTransitionService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly i18n: I18nService,
    // MainMenuHandler already depends on MockExamHandler (to enter
    // MOCK_EXAM_SETUP from the main menu tap) - forwardRef breaks the
    // resulting circular DI edge, same pattern as QA/Practice mode.
    @Inject(forwardRef(() => MainMenuHandler))
    private readonly mainMenuHandler: MainMenuHandler,
  ) {}

  // Reachable both from a MAIN_MENU button tap and the global /mock command
  // (wired in a later step) - resets the session directly into
  // MOCK_EXAM_SETUP, the same escape-hatch pattern as the other modes.
  async enterMockExam(phone: string): Promise<void> {
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    if (!user) {
      this.logger.warn(`enterMockExam: no user profile found for ${phone}`);
      return;
    }

    if (!PREMIUM_TIERS.includes(user.tier)) {
      await this.whatsappSendService.sendText(phone, this.i18n.t('mock.premiumRequired', lang));
      return;
    }

    await this.sessionService.setSession(phone, {
      state: ConversationState.MOCK_EXAM_SETUP,
      mockExam: {},
    });

    if (user.subjects.length === 0) {
      await this.whatsappSendService.sendText(
        phone,
        this.i18n.t('mock.noSubjectsRegistered', lang),
      );
      return;
    }

    if (user.subjects.length === 1) {
      await this.sessionService.updateSessionField(phone, 'mockExam', {
        subject: user.subjects[0],
      });
      await this.sendReadyPrompt(phone, user.subjects[0], lang);
      return;
    }

    await this.sendSubjectPrompt(phone, user.subjects, lang);
  }

  async handleSetupSelection(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const selectedId = message.buttonId ?? message.listId;
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;
    const session = await this.sessionService.getSession(phone);

    if (selectedId === MOCK_START_EXAM) {
      // Real paper assembly + timer + delivery land in later steps of this
      // branch - for now this just confirms the flow correctly reaches the
      // start of MOCK_EXAM_ACTIVE.
      await this.stateTransitionService.transition(phone, ConversationState.MOCK_EXAM_ACTIVE);
      await this.whatsappSendService.sendText(phone, this.i18n.t('mock.startingSoon', lang));
      return;
    }

    if (selectedId === MOCK_CANCEL_EXAM) {
      await this.stateTransitionService.transition(phone, ConversationState.MAIN_MENU);
      await this.sessionService.updateSessionField(phone, 'mockExam', undefined);
      await this.whatsappSendService.sendText(phone, this.i18n.t('mock.cancelled', lang));
      return this.mainMenuHandler.sendMenu(phone);
    }

    if (selectedId && user?.subjects.includes(selectedId)) {
      await this.sessionService.updateSessionField(phone, 'mockExam', {
        ...session?.mockExam,
        subject: selectedId,
      });
      await this.sendReadyPrompt(phone, selectedId, lang);
      return;
    }

    this.logger.warn(`Unrecognized mock exam setup selection "${selectedId}" from ${phone}`);
    if (session?.mockExam?.subject) {
      await this.sendReadyPrompt(phone, session.mockExam.subject, lang);
      return;
    }
    await this.sendSubjectPrompt(phone, user?.subjects ?? [], lang);
  }

  private async sendSubjectPrompt(
    phone: string,
    subjects: string[],
    lang: Language,
  ): Promise<void> {
    const promptText = this.i18n.t('mock.selectSubject', lang);

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
      this.i18n.t('mock.selectSubjectListButton', lang),
      [
        {
          title: this.i18n.t('mock.selectSubjectSectionTitle', lang),
          rows: subjects.map((subject) => ({ id: subject, title: subject })),
        },
      ],
    );
  }

  private async sendReadyPrompt(phone: string, subject: string, lang: Language): Promise<void> {
    await this.whatsappSendService.sendButtons(
      phone,
      this.i18n.t('mock.readyPrompt', lang, {
        subject,
        duration: String(PLACEHOLDER_DURATION_MINUTES),
      }),
      [
        { id: MOCK_START_EXAM, title: this.i18n.t('mock.startExam', lang) },
        { id: MOCK_CANCEL_EXAM, title: this.i18n.t('mock.cancelExam', lang) },
      ],
    );
  }
}
