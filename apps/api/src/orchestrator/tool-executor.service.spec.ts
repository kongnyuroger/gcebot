import { ConversationState, SessionContext } from '@gcebot/shared';
import { QaService } from '../rag/services/qa.service';
import { PastQuestionService } from '../practice/past-question.service';
import { PracticeGradingService } from '../practice/practice-grading.service';
import { MockPaperService } from '../mock/mock-paper.service';
import { UsersService } from '../users/users.service';
import { SessionService } from '../session/session.service';
import { StateTransitionService } from '../session/state-transition.service';
import { ProgressStatsService } from '../progress/progress-stats.service';
import { QuotaService } from '../quota/quota.service';
import { TOOL_NAMES } from './tools/tool-definitions';
import { ToolExecutorService } from './tool-executor.service';

describe('ToolExecutorService', () => {
  let executor: ToolExecutorService;

  let answerQuestion: jest.Mock;
  let getQuestion: jest.Mock;
  let gradeAnswer: jest.Mock;
  let assemblePaper: jest.Mock;
  let getUserProfile: jest.Mock;
  let updateLevel: jest.Mock;
  let updateSubjects: jest.Mock;
  let updateLanguage: jest.Mock;
  let getSession: jest.Mock;
  let updateSessionField: jest.Mock;
  let transition: jest.Mock;
  let getTopicStats: jest.Mock;
  let checkQuota: jest.Mock;

  const phone = '237670000011';

  function buildUser(overrides: Record<string, unknown> = {}) {
    return {
      phone_number: phone,
      level: 'O_LEVEL',
      language: 'EN',
      tier: 'FREE',
      subjects: ['Mathematics'],
      streakDays: 3,
      ...overrides,
    };
  }

  beforeEach(() => {
    answerQuestion = jest.fn().mockResolvedValue(['Part one.', 'Part two.']);
    getQuestion = jest.fn().mockResolvedValue({
      chunkId: 'chunk-1',
      questionText: 'Question 1. Solve for x: 2x + 5 = 15\nA. x=5\nB. x=10\nC. x=3\nD. x=7',
      year: 2023,
      questionNumber: '1',
      type: 'MCQ',
      markingSchemeChunkId: 'scheme-1',
      topic: 'Algebra',
    });
    gradeAnswer = jest.fn().mockResolvedValue({ correct: true, feedback: '✅ Correct!' });
    assemblePaper = jest.fn().mockResolvedValue({
      examId: 'exam-1',
      questions: [{ chunkId: 'chunk-1' }],
      totalMarks: 10,
      durationMinutes: 90,
      paperType: 'MCQ Paper 1',
    });
    getUserProfile = jest.fn().mockResolvedValue(buildUser());
    updateLevel = jest.fn();
    updateSubjects = jest.fn();
    updateLanguage = jest.fn();
    getSession = jest.fn().mockResolvedValue(null);
    updateSessionField = jest.fn();
    transition = jest.fn();
    getTopicStats = jest.fn().mockResolvedValue([]);
    checkQuota = jest.fn().mockResolvedValue({ allowed: true, used: 0, limit: 10 });

    executor = new ToolExecutorService(
      { answerQuestion } as unknown as QaService,
      { getQuestion } as unknown as PastQuestionService,
      { gradeAnswer } as unknown as PracticeGradingService,
      { assemblePaper } as unknown as MockPaperService,
      {
        getUserProfile,
        updateLevel,
        updateSubjects,
        updateLanguage,
      } as unknown as UsersService,
      { getSession, updateSessionField } as unknown as SessionService,
      { transition } as unknown as StateTransitionService,
      { getTopicStats } as unknown as ProgressStatsService,
      { checkQuota } as unknown as QuotaService,
    );
  });

  describe('answer_question', () => {
    it('joins the QA answer parts into one string', async () => {
      const result = await executor.execute(
        TOOL_NAMES.ANSWER_QUESTION,
        { question: 'What is osmosis?', subject: 'Biology' },
        phone,
      );

      expect(answerQuestion).toHaveBeenCalledWith(phone, 'What is osmosis?', 'Biology');
      expect(result).toEqual({ answer: 'Part one.\n\nPart two.' });
    });

    it('errors when no question is given', async () => {
      const result = await executor.execute(TOOL_NAMES.ANSWER_QUESTION, {}, phone);

      expect(result).toEqual({ error: expect.any(String) });
      expect(answerQuestion).not.toHaveBeenCalled();
    });

    it('declines gracefully once the FREE-tier daily quota is exceeded, without calling QaService', async () => {
      checkQuota.mockResolvedValue({ allowed: false, used: 10, limit: 10 });

      const result = await executor.execute(
        TOOL_NAMES.ANSWER_QUESTION,
        { question: 'What is osmosis?' },
        phone,
      );

      expect(answerQuestion).not.toHaveBeenCalled();
      expect(result).toMatchObject({ allowed: false, quotaExceeded: true, used: 10, limit: 10 });
    });
  });

  describe('get_practice_question', () => {
    it('fetches a question, excluding already-seen ids, and persists it as active', async () => {
      getSession.mockResolvedValue({
        state: 'MAIN_MENU',
        practice: { seenIds: ['chunk-0'] },
      } as SessionContext);

      const result = await executor.execute(
        TOOL_NAMES.GET_PRACTICE_QUESTION,
        { subject: 'Mathematics', year: 2023 },
        phone,
      );

      expect(getQuestion).toHaveBeenCalledWith(
        {
          subject: 'Mathematics',
          level: 'O_LEVEL',
          topic: undefined,
          yearRange: '2023-2023',
          type: undefined,
        },
        ['chunk-0'],
      );
      expect(updateSessionField).toHaveBeenCalledWith(
        phone,
        'currentQuestionText',
        expect.any(String),
      );
      expect(updateSessionField).toHaveBeenCalledWith(
        phone,
        'practice',
        expect.objectContaining({ subject: 'Mathematics', seenIds: ['chunk-0', 'chunk-1'] }),
      );
      expect(result).toMatchObject({ type: 'MCQ', year: 2023 });
    });

    it('errors when no subject is given', async () => {
      const result = await executor.execute(TOOL_NAMES.GET_PRACTICE_QUESTION, {}, phone);

      expect(result).toEqual({ error: expect.any(String) });
      expect(getQuestion).not.toHaveBeenCalled();
    });

    it('errors when no question matches the filters', async () => {
      getQuestion.mockResolvedValue(null);

      const result = await executor.execute(
        TOOL_NAMES.GET_PRACTICE_QUESTION,
        { subject: 'Physics' },
        phone,
      );

      expect(result).toEqual({ error: expect.any(String) });
    });
  });

  describe('grade_answer', () => {
    it('grades against the active session question', async () => {
      getSession.mockResolvedValue({
        state: 'MAIN_MENU',
        currentQuestionText: 'Question 1...',
        markingSchemeChunkId: 'scheme-1',
        questionType: 'MCQ',
        currentQuestionTopic: 'Algebra',
        practice: { subject: 'Mathematics' },
      } as SessionContext);

      const result = await executor.execute(TOOL_NAMES.GRADE_ANSWER, { studentAnswer: 'A' }, phone);

      expect(gradeAnswer).toHaveBeenCalledWith({
        phone,
        questionText: 'Question 1...',
        markingSchemeChunkId: 'scheme-1',
        questionType: 'MCQ',
        subject: 'Mathematics',
        topic: 'Algebra',
        answerText: 'A',
        language: 'EN',
      });
      expect(result).toEqual({ correct: true, feedback: '✅ Correct!' });
    });

    it('errors when there is no active question in session', async () => {
      getSession.mockResolvedValue({ state: 'MAIN_MENU' } as SessionContext);

      const result = await executor.execute(TOOL_NAMES.GRADE_ANSWER, { studentAnswer: 'A' }, phone);

      expect(result).toEqual({ error: expect.any(String) });
      expect(gradeAnswer).not.toHaveBeenCalled();
    });
  });

  describe('start_mock_exam', () => {
    it('gates on tier without ever declining the tool call itself', async () => {
      getUserProfile.mockResolvedValue(buildUser({ tier: 'FREE' }));

      const result = await executor.execute(
        TOOL_NAMES.START_MOCK_EXAM,
        { subject: 'Chemistry' },
        phone,
      );

      expect(assemblePaper).not.toHaveBeenCalled();
      expect(result).toMatchObject({ started: false, requiresUpgrade: true });
    });

    it('assembles the paper and persists mock exam session state for PREMIUM users', async () => {
      getUserProfile.mockResolvedValue(buildUser({ tier: 'PREMIUM' }));

      const result = await executor.execute(
        TOOL_NAMES.START_MOCK_EXAM,
        { subject: 'Chemistry' },
        phone,
      );

      expect(transition).toHaveBeenCalledWith(phone, ConversationState.MOCK_EXAM_SETUP);
      expect(updateSessionField).toHaveBeenCalledWith(phone, 'examId', 'exam-1');
      expect(updateSessionField).toHaveBeenCalledWith(
        phone,
        'mockExam',
        expect.objectContaining({ subject: 'Chemistry', currentIndex: 0, answers: [] }),
      );
      expect(result).toMatchObject({ started: true, subject: 'Chemistry', questionCount: 1 });
    });

    it('returns an error instead of throwing when no past-paper content exists', async () => {
      getUserProfile.mockResolvedValue(buildUser({ tier: 'PREMIUM' }));
      assemblePaper.mockRejectedValue(new Error('No past questions available'));

      const result = await executor.execute(
        TOOL_NAMES.START_MOCK_EXAM,
        { subject: 'Chemistry' },
        phone,
      );

      expect(result).toEqual({ started: false, error: expect.any(String) });
    });
  });

  describe('show_progress', () => {
    it('reports no activity when there are no graded interactions', async () => {
      getTopicStats.mockResolvedValue([]);

      const result = await executor.execute(TOOL_NAMES.SHOW_PROGRESS, {}, phone);

      expect(result).toEqual({ hasActivity: false });
    });

    it('summarizes accuracy, streak, and weakest topics', async () => {
      getTopicStats.mockResolvedValue([
        { subject: 'Mathematics', topic: 'Algebra', correct: 8, total: 10, accuracy: 0.8 },
        { subject: 'Biology', topic: 'Osmosis', correct: 1, total: 5, accuracy: 0.2 },
      ]);

      const result = await executor.execute(TOOL_NAMES.SHOW_PROGRESS, {}, phone);

      expect(result).toMatchObject({
        hasActivity: true,
        overallAccuracyPercent: 60,
        totalQuestionsAnswered: 15,
        streakDays: 3,
        weakestTopics: [{ subject: 'Biology', topic: 'Osmosis', accuracyPercent: 20 }],
      });
    });
  });

  describe('update_profile', () => {
    it('updates only the fields provided', async () => {
      const result = await executor.execute(
        TOOL_NAMES.UPDATE_PROFILE,
        { subjects: ['Biology', 'Chemistry'] },
        phone,
      );

      expect(updateSubjects).toHaveBeenCalledWith(phone, ['Biology', 'Chemistry']);
      expect(updateLevel).not.toHaveBeenCalled();
      expect(updateLanguage).not.toHaveBeenCalled();
      expect(result).toEqual({ updated: ['subjects'] });
    });

    it('errors when no valid field is provided', async () => {
      const result = await executor.execute(TOOL_NAMES.UPDATE_PROFILE, {}, phone);

      expect(result).toEqual({ error: expect.any(String) });
    });
  });

  describe('start_subscription', () => {
    it('returns an honest not-available response', async () => {
      const result = await executor.execute(
        TOOL_NAMES.START_SUBSCRIPTION,
        { tier: 'PREMIUM' },
        phone,
      );

      expect(result).toMatchObject({ available: false });
    });
  });

  describe('error handling', () => {
    it('catches a thrown error and returns a safe message instead of propagating', async () => {
      answerQuestion.mockRejectedValue(new Error('vector db unreachable'));

      const result = await executor.execute(
        TOOL_NAMES.ANSWER_QUESTION,
        { question: 'What is a cell?' },
        phone,
      );

      expect(result).toEqual({ error: expect.any(String) });
    });
  });
});
