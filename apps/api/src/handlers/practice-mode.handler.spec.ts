import { SessionContext } from '@gcebot/shared';
import { UsersService } from '../users/users.service';
import { SessionService } from '../session/session.service';
import { StateTransitionService } from '../session/state-transition.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { I18nService } from '../i18n/i18n.service';
import { PrismaService } from '../prisma/prisma.service';
import { PastQuestionService } from '../practice/past-question.service';
import { PracticeGradingService } from '../practice/practice-grading.service';
import { ResponseFormatterService } from '../rag/services/response-formatter.service';
import { TopicWeaknessService } from '../practice/topic-weakness.service';
import { StreakService } from '../progress/streak.service';
import { MilestoneService } from '../progress/milestone.service';
import { MainMenuHandler } from './main-menu.handler';
import { PracticeModeHandler } from './practice-mode.handler';

// Grading itself (MCQ/essay correctness, LLM explanations, marking-scheme
// lookup, Interaction/topic-score persistence) is now owned entirely by
// PracticeGradingService and tested there - see practice-grading.service.spec.ts.
// These tests cover only what the handler still owns: recognizing an active
// question, delegating to the grading service with the right input, sending
// back whatever feedback it returns, and post-answer navigation.
describe('PracticeModeHandler - answer delegation', () => {
  let handler: PracticeModeHandler;
  let getUserProfile: jest.Mock;
  let getSession: jest.Mock;
  let sendText: jest.Mock;
  let sendList: jest.Mock;
  let gradeAnswer: jest.Mock;
  let recordActivity: jest.Mock;

  const phone = '237670000011';

  function buildAnswerMessage(messageId: string, text: string) {
    return { from: phone, messageId, timestamp: 1720000000, type: 'text' as const, text };
  }

  const mcqQuestionText =
    'Question 1. Paper 1. Solve for x: 2x + 5 = 15\nA. x=5\nB. x=10\nC. x=3\nD. x=7';

  function buildSession(overrides: Partial<SessionContext> = {}): SessionContext {
    return {
      state: 'ANSWER_EVALUATION' as SessionContext['state'],
      practice: { seenIds: [], subject: 'Mathematics', topic: 'Algebra' },
      currentQuestionId: 'q1',
      currentQuestionText: mcqQuestionText,
      markingSchemeChunkId: 'scheme-1',
      questionType: 'MCQ',
      ...overrides,
    };
  }

  beforeEach(() => {
    getUserProfile = jest
      .fn()
      .mockResolvedValue({ language: 'EN', level: 'O_LEVEL', tier: 'FREE' });
    getSession = jest.fn().mockResolvedValue(buildSession());
    sendText = jest.fn();
    sendList = jest.fn();
    gradeAnswer = jest
      .fn()
      .mockResolvedValue({ correct: true, feedback: '✅ Correct! Nice work.' });
    recordActivity = jest.fn();

    handler = new PracticeModeHandler(
      { getUserProfile } as unknown as UsersService,
      { getSession, updateSessionField: jest.fn() } as unknown as SessionService,
      { transition: jest.fn() } as unknown as StateTransitionService,
      { sendText, sendButtons: jest.fn(), sendList } as unknown as WhatsappSendService,
      new I18nService(),
      {} as unknown as PrismaService,
      {} as unknown as PastQuestionService,
      { gradeAnswer } as unknown as PracticeGradingService,
      new ResponseFormatterService(),
      {} as unknown as TopicWeaknessService,
      { recordActivity } as unknown as StreakService,
      { checkMilestone: jest.fn() } as unknown as MilestoneService,
      { sendMenu: jest.fn() } as unknown as MainMenuHandler,
    );
  });

  it('delegates to PracticeGradingService with the active question and session context', async () => {
    await handler.handleAnswer(buildAnswerMessage('m1', 'A'));

    expect(gradeAnswer).toHaveBeenCalledWith({
      phone,
      questionText: mcqQuestionText,
      markingSchemeChunkId: 'scheme-1',
      questionType: 'MCQ',
      subject: 'Mathematics',
      topic: 'Algebra',
      answerText: 'A',
      language: 'EN',
    });
  });

  it('sends the returned feedback and the post-answer navigation list', async () => {
    await handler.handleAnswer(buildAnswerMessage('m2', 'A'));

    expect(sendText).toHaveBeenCalledWith(phone, '✅ Correct! Nice work.');
    expect(sendList).toHaveBeenCalled();
  });

  it('records streak/milestone activity before grading', async () => {
    await handler.handleAnswer(buildAnswerMessage('m3', 'A'));

    expect(recordActivity).toHaveBeenCalledWith(phone);
  });

  it('does nothing when there is no active question in session', async () => {
    getSession.mockResolvedValue({ state: 'ANSWER_EVALUATION' });

    await handler.handleAnswer(buildAnswerMessage('m4', 'A'));

    expect(gradeAnswer).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it('ignores a non-text message while ANSWER_EVALUATION', async () => {
    await handler.handleAnswer({
      from: phone,
      messageId: 'm5',
      timestamp: 1720000000,
      type: 'button_reply',
      buttonId: 'x',
    });

    expect(gradeAnswer).not.toHaveBeenCalled();
  });
});
