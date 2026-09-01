import { ConversationState } from '@gcebot/shared';
import { CommandHandler } from '../handlers/command.handler';
import { MenuHandler } from '../handlers/menu.handler';
import { UsersService } from '../../users/users.service';
import { SessionService } from '../../session/session.service';
import { OnboardingHandler } from '../../handlers/onboarding.handler';
import { MainMenuHandler } from '../../handlers/main-menu.handler';
import { QaModeHandler } from '../../handlers/qa-mode.handler';
import { PracticeModeHandler } from '../../handlers/practice-mode.handler';
import { MockExamHandler } from '../../handlers/mock-exam.handler';
import { OrchestratorService } from '../../orchestrator/orchestrator.service';
import { MessageRouterService } from './message-router.service';

// This router previously had zero test coverage (confirmed during the
// agent-orchestrator rebuild's audit). Rather than retroactively covering
// every existing branch, these tests focus on the one deliberate behavior
// change this branch makes (FREE_TEXT in MAIN_MENU -> orchestrator) plus
// guard rails confirming every other path - commands, button/list taps, and
// the other free-text states - still dispatches exactly as before.
describe('MessageRouterService', () => {
  let router: MessageRouterService;
  let isNewUser: jest.Mock;
  let getSession: jest.Mock;
  let updateSessionField: jest.Mock;
  let handleNewUser: jest.Mock;
  let sendMenu: jest.Mock;
  let handleSelection: jest.Mock;
  let handleCommand: jest.Mock;
  let handleMenu: jest.Mock;
  let handleQaQuestion: jest.Mock;
  let handlePracticeAnswer: jest.Mock;
  let handleMockAnswer: jest.Mock;
  let handleOrchestratorMessage: jest.Mock;

  const phone = '237670000011';

  function buildMessage(overrides: Record<string, unknown> = {}) {
    return {
      from: phone,
      messageId: 'm1',
      timestamp: 1720000000,
      type: 'text' as const,
      text: 'hello there',
      ...overrides,
    };
  }

  beforeEach(() => {
    isNewUser = jest.fn().mockResolvedValue(false);
    getSession = jest.fn().mockResolvedValue({ state: ConversationState.MAIN_MENU });
    updateSessionField = jest.fn();
    handleNewUser = jest.fn();
    sendMenu = jest.fn();
    handleSelection = jest.fn();
    handleCommand = jest.fn();
    handleMenu = jest.fn();
    handleQaQuestion = jest.fn();
    handlePracticeAnswer = jest.fn();
    handleMockAnswer = jest.fn();
    handleOrchestratorMessage = jest.fn();

    router = new MessageRouterService(
      { handle: handleCommand } as unknown as CommandHandler,
      { handle: handleMenu } as unknown as MenuHandler,
      { isNewUser } as unknown as UsersService,
      { getSession, updateSessionField } as unknown as SessionService,
      { handleNewUser } as unknown as OnboardingHandler,
      { sendMenu, handleSelection } as unknown as MainMenuHandler,
      { handleQuestion: handleQaQuestion } as unknown as QaModeHandler,
      { handleAnswer: handlePracticeAnswer } as unknown as PracticeModeHandler,
      { handleAnswer: handleMockAnswer } as unknown as MockExamHandler,
      { handleMessage: handleOrchestratorMessage } as unknown as OrchestratorService,
    );
  });

  it('sends a new user to onboarding before anything else', async () => {
    isNewUser.mockResolvedValue(true);

    await router.route(buildMessage());

    expect(handleNewUser).toHaveBeenCalled();
    expect(handleOrchestratorMessage).not.toHaveBeenCalled();
  });

  it('routes FREE_TEXT in MAIN_MENU to the orchestrator', async () => {
    getSession.mockResolvedValue({ state: ConversationState.MAIN_MENU });

    await router.route(buildMessage({ text: 'can I practice biology please' }));

    expect(handleOrchestratorMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'can I practice biology please' }),
    );
  });

  it('still routes FREE_TEXT in AWAITING_QUESTION to QaModeHandler, unchanged', async () => {
    getSession.mockResolvedValue({ state: ConversationState.AWAITING_QUESTION });

    await router.route(buildMessage());

    expect(handleQaQuestion).toHaveBeenCalled();
    expect(handleOrchestratorMessage).not.toHaveBeenCalled();
  });

  it('still routes FREE_TEXT in ANSWER_EVALUATION to PracticeModeHandler, unchanged', async () => {
    getSession.mockResolvedValue({ state: ConversationState.ANSWER_EVALUATION });

    await router.route(buildMessage());

    expect(handlePracticeAnswer).toHaveBeenCalled();
    expect(handleOrchestratorMessage).not.toHaveBeenCalled();
  });

  it('still routes FREE_TEXT in MOCK_EXAM_ACTIVE to MockExamHandler, unchanged', async () => {
    getSession.mockResolvedValue({ state: ConversationState.MOCK_EXAM_ACTIVE });

    await router.route(buildMessage());

    expect(handleMockAnswer).toHaveBeenCalled();
    expect(handleOrchestratorMessage).not.toHaveBeenCalled();
  });

  it('routes FREE_TEXT in any other state to the orchestrator instead of a dead-end fallback', async () => {
    getSession.mockResolvedValue({ state: ConversationState.MOCK_EXAM_SETUP });

    await router.route(buildMessage());

    expect(handleOrchestratorMessage).toHaveBeenCalled();
  });

  it('routes FREE_TEXT to the orchestrator when the session has expired (null), not a dead-end fallback', async () => {
    getSession.mockResolvedValue(null);

    await router.route(buildMessage());

    expect(handleOrchestratorMessage).toHaveBeenCalled();
  });

  it('still routes slash commands to CommandHandler, unchanged', async () => {
    await router.route(buildMessage({ text: '/settings' }));

    expect(handleCommand).toHaveBeenCalledWith(expect.anything(), 'settings');
    expect(handleOrchestratorMessage).not.toHaveBeenCalled();
  });

  it('still routes a MAIN_MENU button tap to MainMenuHandler, unchanged', async () => {
    getSession.mockResolvedValue({ state: ConversationState.MAIN_MENU });

    await router.route(
      buildMessage({ type: 'button_reply', text: undefined, buttonId: 'practice' }),
    );

    expect(handleSelection).toHaveBeenCalled();
    expect(handleOrchestratorMessage).not.toHaveBeenCalled();
  });
});
