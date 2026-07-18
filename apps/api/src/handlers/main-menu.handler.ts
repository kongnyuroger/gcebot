import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConversationState } from '@gcebot/shared';
import { Language } from '../../generated/prisma';
import { ParsedMessage } from '../whatsapp/services/message-parser.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { StateTransitionService } from '../session/state-transition.service';
import { UsersService } from '../users/users.service';
import { I18nService } from '../i18n/i18n.service';
import { QaModeHandler } from './qa-mode.handler';
import { PracticeModeHandler } from './practice-mode.handler';

export const MENU_ROW_ASK_QUESTION = 'ask_question';
export const MENU_ROW_PRACTICE = 'practice';
export const MENU_ROW_MOCK_EXAM = 'mock_exam';
export const MENU_ROW_PROGRESS = 'progress';

@Injectable()
export class MainMenuHandler {
  private readonly logger = new Logger(MainMenuHandler.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly stateTransitionService: StateTransitionService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly i18n: I18nService,
    // QaModeHandler also depends on MainMenuHandler (for the "Main menu"
    // follow-up button after answering a question) - forwardRef breaks the
    // resulting circular DI edge.
    @Inject(forwardRef(() => QaModeHandler))
    private readonly qaModeHandler: QaModeHandler,
    private readonly practiceModeHandler: PracticeModeHandler,
  ) {}

  // Deliberately has no session/state side effects of its own - callers decide
  // whether showing the menu should also move/reset the conversation state
  // (e.g. OnboardingHandler already transitions to MAIN_MENU before calling this;
  // a global "/menu" command instead resets state directly, bypassing the
  // transition validator, since it must work from ANY state).
  async sendMenu(phone: string): Promise<void> {
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    await this.whatsappSendService.sendList(
      phone,
      this.i18n.t('menu.title', lang),
      this.i18n.t('menu.buttonText', lang),
      [
        {
          title: this.i18n.t('common.mainMenu', lang),
          rows: [
            { id: MENU_ROW_ASK_QUESTION, title: this.i18n.t('menu.askQuestion', lang) },
            { id: MENU_ROW_PRACTICE, title: this.i18n.t('menu.practice', lang) },
            { id: MENU_ROW_MOCK_EXAM, title: this.i18n.t('menu.mockExam', lang) },
            { id: MENU_ROW_PROGRESS, title: this.i18n.t('menu.progress', lang) },
          ],
        },
      ],
    );
  }

  async handleSelection(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    switch (message.listId) {
      case MENU_ROW_ASK_QUESTION:
        // QaModeHandler owns its own entry into QA_MODE (it resets the whole
        // session, since it must also be reachable from the global /ask
        // command from any state) - no separate transition() call needed here.
        return this.qaModeHandler.enterQaMode(phone);

      case MENU_ROW_PRACTICE:
        // PracticeModeHandler owns its own entry into PRACTICE_FILTER (it
        // resets the whole session, since it must also be reachable from the
        // global /practice command from any state) - no separate transition()
        // call needed here, matching the QA_MODE entry pattern above.
        return this.practiceModeHandler.enterPracticeMode(phone);

      case MENU_ROW_MOCK_EXAM:
        await this.stateTransitionService.transition(phone, ConversationState.MOCK_EXAM_SETUP);
        return this.sendComingSoon(phone, lang);

      case MENU_ROW_PROGRESS:
        // No /progress command exists yet in this branch - same placeholder.
        return this.sendComingSoon(phone, lang);

      default:
        this.logger.warn(`Unrecognized main menu selection "${message.listId}" from ${phone}`);
        return this.sendMenu(phone);
    }
  }

  private async sendComingSoon(phone: string, lang: Language): Promise<void> {
    await this.whatsappSendService.sendText(phone, this.i18n.t('menu.comingSoon', lang));
  }
}
