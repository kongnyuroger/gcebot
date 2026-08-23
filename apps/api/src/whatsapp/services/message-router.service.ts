import { Injectable, Logger } from '@nestjs/common';
import { ConversationState } from '@gcebot/shared';
import { CommandHandler } from '../handlers/command.handler';
import { MenuHandler } from '../handlers/menu.handler';
import { FreeTextHandler } from '../handlers/free-text.handler';
import { ParsedMessage } from './message-parser.service';
import { UsersService } from '../../users/users.service';
import { SessionService } from '../../session/session.service';
import { OnboardingHandler } from '../../handlers/onboarding.handler';
import { MainMenuHandler } from '../../handlers/main-menu.handler';
import { QaModeHandler } from '../../handlers/qa-mode.handler';
import { PracticeModeHandler } from '../../handlers/practice-mode.handler';
import { MockExamHandler } from '../../handlers/mock-exam.handler';

export enum MessageIntent {
  COMMAND = 'COMMAND',
  MENU_SELECTION = 'MENU_SELECTION',
  FREE_TEXT = 'FREE_TEXT',
}

const MENU_COMMAND = '/menu';

@Injectable()
export class MessageRouterService {
  private readonly logger = new Logger(MessageRouterService.name);

  constructor(
    private readonly commandHandler: CommandHandler,
    private readonly menuHandler: MenuHandler,
    private readonly freeTextHandler: FreeTextHandler,
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly onboardingHandler: OnboardingHandler,
    private readonly mainMenuHandler: MainMenuHandler,
    private readonly qaModeHandler: QaModeHandler,
    private readonly practiceModeHandler: PracticeModeHandler,
    private readonly mockExamHandler: MockExamHandler,
  ) {}

  async route(message: ParsedMessage): Promise<void> {
    const phone = message.from;

    if (await this.usersService.isNewUser(phone)) {
      this.logger.log(`${phone}: new user -> onboarding`);
      return this.onboardingHandler.handleNewUser(message);
    }

    // Global escape hatch: works from ANY state, so it bypasses the transition
    // validator entirely (same reasoning as /settings in CommandHandler).
    if (message.type === 'text' && message.text?.trim().toLowerCase() === MENU_COMMAND) {
      this.logger.log(`${phone}: /menu -> MAIN_MENU`);
      await this.sessionService.updateSessionField(phone, 'state', ConversationState.MAIN_MENU);
      return this.mainMenuHandler.sendMenu(phone);
    }

    const intent = this.determineIntent(message);

    if (intent === MessageIntent.COMMAND) {
      const commandName = message.text!.slice(1).trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      this.logger.log(`${phone}: COMMAND /${commandName}`);
      return this.commandHandler.handle(message, commandName);
    }

    if (intent === MessageIntent.MENU_SELECTION) {
      const selection = message.buttonId ?? message.listId ?? '(unknown)';
      const session = await this.sessionService.getSession(phone);
      this.logger.log(`${phone}: MENU_SELECTION "${selection}" in state ${session?.state}`);
      return this.routeMenuSelection(message);
    }

    // FREE_TEXT while AWAITING_QUESTION/ANSWER_EVALUATION is the actual
    // question/answer text, not a catch-all "I didn't understand that" case.
    const session = await this.sessionService.getSession(phone);
    this.logger.log(`${phone}: FREE_TEXT in state ${session?.state}`);
    if (session?.state === ConversationState.SUBJECT_SELECTION) {
      return this.onboardingHandler.handleSubjectTextReply(message);
    }
    if (session?.state === ConversationState.AWAITING_QUESTION) {
      return this.qaModeHandler.handleQuestion(message);
    }
    if (session?.state === ConversationState.ANSWER_EVALUATION) {
      return this.practiceModeHandler.handleAnswer(message);
    }
    if (session?.state === ConversationState.MOCK_EXAM_ACTIVE) {
      return this.mockExamHandler.handleAnswer(message);
    }

    return this.freeTextHandler.handle(message);
  }

  private async routeMenuSelection(message: ParsedMessage): Promise<void> {
    const session = await this.sessionService.getSession(message.from);

    switch (session?.state) {
      case ConversationState.LEVEL_SELECTION:
        return this.onboardingHandler.handleLevelSelection(message);
      case ConversationState.SUBJECT_SELECTION:
        return this.onboardingHandler.handleSubjectSelection(message);
      case ConversationState.MAIN_MENU:
        return this.mainMenuHandler.handleSelection(message);
      case ConversationState.QA_MODE:
        return this.qaModeHandler.handleSubjectSelection(message);
      case ConversationState.AWAITING_QUESTION:
        return this.qaModeHandler.handleFollowUpSelection(message);
      case ConversationState.PRACTICE_FILTER:
        return this.practiceModeHandler.handleSubjectSelection(message);
      case ConversationState.PRACTICE_TOPIC:
        return this.practiceModeHandler.handleTopicSelection(message);
      case ConversationState.PRACTICE_YEAR:
        return this.practiceModeHandler.handleYearSelection(message);
      case ConversationState.PRACTICE_TYPE:
        return this.practiceModeHandler.handleTypeSelection(message);
      case ConversationState.ANSWER_EVALUATION:
        return this.practiceModeHandler.handlePostAnswerSelection(message);
      case ConversationState.MOCK_EXAM_SETUP:
        return this.mockExamHandler.handleSetupSelection(message);
      default:
        return this.menuHandler.handle(message);
    }
  }

  private determineIntent(message: ParsedMessage): MessageIntent {
    if (message.type === 'text' && message.text?.startsWith('/')) {
      return MessageIntent.COMMAND;
    }

    if (message.type === 'button_reply' || message.type === 'list_reply') {
      return MessageIntent.MENU_SELECTION;
    }

    return MessageIntent.FREE_TEXT;
  }
}
