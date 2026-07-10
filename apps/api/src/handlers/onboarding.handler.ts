import { Injectable, Logger } from '@nestjs/common';
import { ConversationState } from '@gcebot/shared';
import { Language, Level } from '../../generated/prisma';
import { ParsedMessage } from '../whatsapp/services/message-parser.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { SessionService } from '../session/session.service';
import { StateTransitionService } from '../session/state-transition.service';
import { UsersService } from '../users/users.service';
import { I18nService } from '../i18n/i18n.service';
import { chunk, MAX_LIST_ROWS_PER_MESSAGE, SUBJECTS_BY_LEVEL } from './subjects.constants';
import { MainMenuHandler } from './main-menu.handler';

const CONFIRM_SUBJECTS_BUTTON_ID = 'confirm_subjects';
const REDO_SUBJECTS_BUTTON_ID = 'redo_subjects';

@Injectable()
export class OnboardingHandler {
  private readonly logger = new Logger(OnboardingHandler.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly stateTransitionService: StateTransitionService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly i18n: I18nService,
    private readonly mainMenuHandler: MainMenuHandler,
  ) {}

  async handleNewUser(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    this.logger.log(`Starting onboarding for new user ${phone}`);

    const user = await this.usersService.upsertUser(phone);

    // No prior session exists for a brand-new user, so there is nothing for
    // StateTransitionService to validate FROM yet - bootstrap it directly.
    await this.sessionService.setSession(phone, { state: ConversationState.ONBOARDING });

    const name = message.contactName ?? 'there';
    await this.whatsappSendService.sendText(
      phone,
      this.i18n.t('welcome.greeting', user.language, { name }),
    );

    await this.sendLevelSelection(phone, user.language);

    await this.stateTransitionService.transition(phone, ConversationState.LEVEL_SELECTION);
  }

  async handleLevelSelection(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const buttonId = message.buttonId;

    if (buttonId !== Level.O_LEVEL && buttonId !== Level.A_LEVEL) {
      this.logger.warn(`Unexpected level selection buttonId "${buttonId}" from ${phone}`);
      const user = await this.usersService.getUserProfile(phone);
      return this.sendLevelSelection(phone, user?.language ?? Language.EN);
    }

    const user = await this.usersService.updateLevel(phone, buttonId);
    await this.sessionService.updateSessionField(phone, 'pendingSubjects', []);

    await this.sendSubjectList(phone, buttonId, user.language);

    await this.stateTransitionService.transition(phone, ConversationState.SUBJECT_SELECTION);
  }

  async handleSubjectSelection(message: ParsedMessage): Promise<void> {
    if (message.type === 'list_reply') {
      return this.handleSubjectTap(message);
    }

    if (message.type === 'button_reply' && message.buttonId === REDO_SUBJECTS_BUTTON_ID) {
      return this.handleSubjectsRedo(message);
    }

    if (message.type === 'button_reply' && message.buttonId === CONFIRM_SUBJECTS_BUTTON_ID) {
      return this.handleSubjectsConfirmed(message);
    }

    this.logger.warn(
      `Unhandled subject-selection interaction from ${message.from}: type=${message.type} buttonId=${message.buttonId}`,
    );
  }

  private async sendLevelSelection(phone: string, lang: Language): Promise<void> {
    await this.whatsappSendService.sendButtons(phone, this.i18n.t('onboarding.selectLevel', lang), [
      { id: Level.O_LEVEL, title: this.i18n.t('onboarding.levelOLevel', lang) },
      { id: Level.A_LEVEL, title: this.i18n.t('onboarding.levelALevel', lang) },
    ]);
  }

  private async sendSubjectList(phone: string, level: Level, lang: Language): Promise<void> {
    const subjects = SUBJECTS_BY_LEVEL[level];
    const chunks = chunk(subjects, MAX_LIST_ROWS_PER_MESSAGE);

    for (let i = 0; i < chunks.length; i++) {
      const partSuffix = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : '';
      await this.whatsappSendService.sendList(
        phone,
        this.i18n.t('onboarding.selectSubjects', lang) + partSuffix,
        this.i18n.t('onboarding.subjectsListTitle', lang),
        [
          {
            title: this.i18n.t('onboarding.subjectsSectionTitle', lang),
            rows: chunks[i].map((subject) => ({ id: subject.id, title: subject.name })),
          },
        ],
      );
    }
  }

  private async sendSubjectConfirmation(phone: string, lang: Language): Promise<void> {
    await this.whatsappSendService.sendButtons(
      phone,
      this.i18n.t('onboarding.confirmSubjects', lang),
      [
        { id: CONFIRM_SUBJECTS_BUTTON_ID, title: this.i18n.t('onboarding.confirmButton', lang) },
        { id: REDO_SUBJECTS_BUTTON_ID, title: this.i18n.t('onboarding.redoButton', lang) },
      ],
    );
  }

  private async handleSubjectTap(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const subjectName = message.listTitle;

    if (!subjectName) {
      this.logger.warn(`Subject list_reply from ${phone} had no listTitle`);
      return;
    }

    const session = await this.sessionService.getSession(phone);
    const pendingSubjects = session?.pendingSubjects ?? [];

    if (!pendingSubjects.includes(subjectName)) {
      pendingSubjects.push(subjectName);
    }

    await this.sessionService.updateSessionField(phone, 'pendingSubjects', pendingSubjects);

    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    await this.whatsappSendService.sendText(
      phone,
      this.i18n.t('onboarding.subjectsSoFar', lang, { subjects: pendingSubjects.join(', ') }),
    );
    await this.sendSubjectConfirmation(phone, lang);
  }

  private async handleSubjectsRedo(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    await this.sessionService.updateSessionField(phone, 'pendingSubjects', []);

    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;
    const level = user?.level ?? Level.O_LEVEL;

    await this.sendSubjectList(phone, level, lang);
  }

  private async handleSubjectsConfirmed(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const session = await this.sessionService.getSession(phone);
    const subjects = session?.pendingSubjects ?? [];

    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    if (subjects.length === 0) {
      this.logger.warn(`${phone} pressed Confirm with no subjects selected`);
      return this.sendSubjectList(phone, user?.level ?? Level.O_LEVEL, lang);
    }

    await this.usersService.updateSubjects(phone, subjects);
    await this.stateTransitionService.transition(phone, ConversationState.MAIN_MENU);

    await this.whatsappSendService.sendText(phone, this.i18n.t('onboarding.subjectsSaved', lang));
    await this.mainMenuHandler.sendMenu(phone);
  }
}
