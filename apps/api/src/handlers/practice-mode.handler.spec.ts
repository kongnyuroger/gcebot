import { SessionContext } from '@gcebot/shared';
import { UsersService } from '../users/users.service';
import { SessionService } from '../session/session.service';
import { StateTransitionService } from '../session/state-transition.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { I18nService } from '../i18n/i18n.service';
import { PrismaService } from '../prisma/prisma.service';
import { PastQuestionService } from '../practice/past-question.service';
import { LlmService } from '../rag/services/llm.service';
import { ResponseFormatterService } from '../rag/services/response-formatter.service';
import { TopicWeaknessService } from '../practice/topic-weakness.service';
import { TopicScoreService } from '../practice/topic-score.service';
import { MainMenuHandler } from './main-menu.handler';
import { PracticeModeHandler } from './practice-mode.handler';

describe('PracticeModeHandler - MCQ grading', () => {
  let handler: PracticeModeHandler;
  let getUserProfile: jest.Mock;
  let getSession: jest.Mock;
  let updateSessionField: jest.Mock;
  let sendText: jest.Mock;
  let findUniqueChunk: jest.Mock;
  let interactionCreate: jest.Mock;
  let generate: jest.Mock;
  let recordResult: jest.Mock;

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
    updateSessionField = jest.fn();
    sendText = jest.fn();
    findUniqueChunk = jest.fn().mockResolvedValue({
      id: 'scheme-1',
      content: 'Question 1. Paper 1. Correct answer: A. Subtract 5, then divide by 2.',
    });
    interactionCreate = jest.fn();
    generate = jest.fn().mockResolvedValue('Explanation of why A is correct.');
    recordResult = jest.fn();

    handler = new PracticeModeHandler(
      { getUserProfile } as unknown as UsersService,
      { getSession, updateSessionField } as unknown as SessionService,
      { transition: jest.fn() } as unknown as StateTransitionService,
      { sendText, sendButtons: jest.fn(), sendList: jest.fn() } as unknown as WhatsappSendService,
      new I18nService(),
      {
        embeddingChunk: { findUnique: findUniqueChunk },
        interaction: { create: interactionCreate },
      } as unknown as PrismaService,
      {} as unknown as PastQuestionService,
      { generate } as unknown as LlmService,
      new ResponseFormatterService(),
      {} as unknown as TopicWeaknessService,
      { recordResult } as unknown as TopicScoreService,
      { sendMenu: jest.fn() } as unknown as MainMenuHandler,
    );
  });

  it('grades a correct bare-letter MCQ answer', async () => {
    await handler.handleAnswer(buildAnswerMessage('m1', 'A'));

    expect(sendText).toHaveBeenCalledWith(phone, expect.stringMatching(/^✅ Correct!/));
    expect(interactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ correct: true, userAnswer: 'A' }),
      }),
    );
    expect(recordResult).toHaveBeenCalledWith(phone, 'Mathematics', 'Algebra', true);
    // Correct answers don't need an LLM call - the scheme text is enough.
    expect(generate).not.toHaveBeenCalled();
  });

  it('grades a correct full-text MCQ answer by matching it against the option text', async () => {
    await handler.handleAnswer(buildAnswerMessage('m2', 'x=5'));

    expect(sendText).toHaveBeenCalledWith(phone, expect.stringMatching(/^✅ Correct!/));
    expect(interactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ correct: true }) }),
    );
  });

  it('grades a wrong MCQ answer using a real LLM explanation', async () => {
    await handler.handleAnswer(buildAnswerMessage('m3', 'B'));

    expect(generate).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(
      phone,
      '❌ Not quite. The correct answer is A. Explanation of why A is correct.',
    );
    expect(interactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ correct: false, userAnswer: 'B' }),
      }),
    );
    expect(recordResult).toHaveBeenCalledWith(phone, 'Mathematics', 'Algebra', false);
  });

  it('treats an unrecognized free-text answer as wrong, not a crash', async () => {
    await handler.handleAnswer(buildAnswerMessage('m4', 'I have no idea'));

    expect(interactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ correct: false }) }),
    );
  });

  it('falls back gracefully when no marking scheme can be found, without grading', async () => {
    findUniqueChunk.mockResolvedValue(null);

    await handler.handleAnswer(buildAnswerMessage('m5', 'A'));

    expect(sendText).toHaveBeenCalledWith(
      phone,
      "I couldn't automatically grade this question, but I've recorded your answer.",
    );
    expect(interactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ correct: null }) }),
    );
    expect(recordResult).not.toHaveBeenCalled();
  });

  it('does nothing when there is no active question in session', async () => {
    getSession.mockResolvedValue({ state: 'ANSWER_EVALUATION' });

    await handler.handleAnswer(buildAnswerMessage('m6', 'A'));

    expect(interactionCreate).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });
});
