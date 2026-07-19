import { MockExamQuestion, SessionContext } from '@gcebot/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
import { LlmService } from '../rag/services/llm.service';
import { MockGradingService } from './mock-grading.service';

describe('MockGradingService', () => {
  let service: MockGradingService;
  let getSession: jest.Mock;
  let findUniqueChunk: jest.Mock;
  let mockExamUpdate: jest.Mock;
  let generate: jest.Mock;

  const phone = '237670000011';
  const examId = 'exam-1';

  function mcqQuestion(overrides: Partial<MockExamQuestion> = {}): MockExamQuestion {
    return {
      chunkId: 'q-mcq',
      questionText: 'Question 1. What is 2+2?\nA. 3\nB. 4\nC. 5\nD. 6',
      type: 'MCQ',
      markingSchemeChunkId: 'scheme-mcq',
      topic: 'Algebra',
      marks: 1,
      ...overrides,
    };
  }

  function essayQuestion(overrides: Partial<MockExamQuestion> = {}): MockExamQuestion {
    return {
      chunkId: 'q-essay',
      questionText: 'Question 2. Explain photosynthesis. [10 marks]',
      type: 'STRUCTURED',
      markingSchemeChunkId: 'scheme-essay',
      topic: 'Biology',
      marks: 10,
      ...overrides,
    };
  }

  function session(overrides: Partial<SessionContext> = {}): SessionContext {
    return {
      state: 'MOCK_EXAM_ACTIVE' as SessionContext['state'],
      mockExam: { subject: 'Combined Science', questions: [], answers: [] },
      ...overrides,
    };
  }

  beforeEach(() => {
    getSession = jest.fn();
    findUniqueChunk = jest.fn();
    mockExamUpdate = jest.fn();
    generate = jest.fn();

    service = new MockGradingService(
      {
        embeddingChunk: { findUnique: findUniqueChunk },
        mockExam: { update: mockExamUpdate },
      } as unknown as PrismaService,
      { getSession } as unknown as SessionService,
      { generate } as unknown as LlmService,
    );
  });

  it('returns null and skips the DB update when session has no questions', async () => {
    getSession.mockResolvedValue(session({ mockExam: {} }));

    const result = await service.gradeExam(phone, examId);

    expect(result).toBeNull();
    expect(mockExamUpdate).not.toHaveBeenCalled();
  });

  it('awards full marks for a correct MCQ answer', async () => {
    getSession.mockResolvedValue(
      session({ mockExam: { questions: [mcqQuestion()], answers: ['B'] } }),
    );
    findUniqueChunk.mockResolvedValue({ content: 'Correct answer: B' });

    const result = await service.gradeExam(phone, examId);

    expect(result?.score).toBe(1);
    expect(result?.maxScore).toBe(1);
    expect(result?.topicBreakdown['Algebra']).toEqual({ scored: 1, possible: 1 });
    expect(generate).not.toHaveBeenCalled();
  });

  it('awards zero marks for a wrong MCQ answer', async () => {
    getSession.mockResolvedValue(
      session({ mockExam: { questions: [mcqQuestion()], answers: ['A'] } }),
    );
    findUniqueChunk.mockResolvedValue({ content: 'Correct answer: B' });

    const result = await service.gradeExam(phone, examId);

    expect(result?.score).toBe(0);
    expect(result?.topicBreakdown['Algebra']).toEqual({ scored: 0, possible: 1 });
  });

  it('awards zero marks for an MCQ when no marking scheme correct answer can be found', async () => {
    getSession.mockResolvedValue(
      session({ mockExam: { questions: [mcqQuestion()], answers: ['B'] } }),
    );
    findUniqueChunk.mockResolvedValue({ content: 'No clear answer stated here.' });

    const result = await service.gradeExam(phone, examId);

    expect(result?.score).toBe(0);
  });

  it('grades an essay answer via the LLM, parsing "X out of Y" and clamping to the max', async () => {
    getSession.mockResolvedValue(
      session({
        mockExam: {
          questions: [essayQuestion()],
          answers: ['Photosynthesis converts light energy into chemical energy using chlorophyll.'],
        },
      }),
    );
    findUniqueChunk.mockResolvedValue({ content: 'Award marks for mentioning chlorophyll.' });
    generate.mockResolvedValue('8 out of 10');

    const result = await service.gradeExam(phone, examId);

    expect(result?.score).toBe(8);
    expect(result?.topicBreakdown['Biology']).toEqual({ scored: 8, possible: 10 });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('clamps an LLM-returned mark above the question max down to the max', async () => {
    getSession.mockResolvedValue(
      session({ mockExam: { questions: [essayQuestion()], answers: ['A full answer.'] } }),
    );
    findUniqueChunk.mockResolvedValue({ content: 'Scheme text.' });
    generate.mockResolvedValue('15 out of 10');

    const result = await service.gradeExam(phone, examId);

    expect(result?.score).toBe(10);
  });

  it('awards zero marks for an essay when the LLM response cannot be parsed', async () => {
    getSession.mockResolvedValue(
      session({ mockExam: { questions: [essayQuestion()], answers: ['An answer.'] } }),
    );
    findUniqueChunk.mockResolvedValue({ content: 'Scheme text.' });
    generate.mockResolvedValue('This answer demonstrates good understanding overall.');

    const result = await service.gradeExam(phone, examId);

    expect(result?.score).toBe(0);
  });

  it('awards zero marks for an essay when no marking scheme is found, without calling the LLM', async () => {
    getSession.mockResolvedValue(
      session({ mockExam: { questions: [essayQuestion()], answers: ['An answer.'] } }),
    );
    findUniqueChunk.mockResolvedValue(null);

    const result = await service.gradeExam(phone, examId);

    expect(result?.score).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  });

  it('awards zero marks for an essay when the LLM call throws, without crashing the whole exam', async () => {
    getSession.mockResolvedValue(
      session({ mockExam: { questions: [essayQuestion()], answers: ['An answer.'] } }),
    );
    findUniqueChunk.mockResolvedValue({ content: 'Scheme text.' });
    generate.mockRejectedValue(new Error('OpenAI is down'));

    const result = await service.gradeExam(phone, examId);

    expect(result?.score).toBe(0);
    expect(result?.maxScore).toBe(10);
  });

  it('awards zero marks for a skipped (null answer) question, still counting its possible marks', async () => {
    getSession.mockResolvedValue(
      session({ mockExam: { questions: [essayQuestion()], answers: [null] } }),
    );

    const result = await service.gradeExam(phone, examId);

    expect(result?.score).toBe(0);
    expect(result?.maxScore).toBe(10);
    expect(findUniqueChunk).not.toHaveBeenCalled();
  });

  it('sums scores/marks and groups topic breakdown correctly across mixed question types', async () => {
    getSession.mockResolvedValue(
      session({
        mockExam: {
          questions: [
            mcqQuestion({ chunkId: 'q1', topic: 'Algebra', marks: 1 }),
            mcqQuestion({
              chunkId: 'q2',
              topic: 'Algebra',
              marks: 1,
              markingSchemeChunkId: 'scheme-2',
            }),
            essayQuestion({ chunkId: 'q3', topic: 'Biology', marks: 10 }),
          ],
          answers: ['B', 'A', 'A strong essay answer.'],
        },
      }),
    );
    findUniqueChunk.mockImplementation(({ where: { id } }: { where: { id: string } }) => {
      if (id === 'scheme-mcq') return Promise.resolve({ content: 'Correct answer: B' });
      if (id === 'scheme-2') return Promise.resolve({ content: 'Correct answer: A' });
      return Promise.resolve({ content: 'Essay scheme.' });
    });
    generate.mockResolvedValue('7 out of 10');

    const result = await service.gradeExam(phone, examId);

    expect(result?.topicBreakdown['Algebra']).toEqual({ scored: 2, possible: 2 });
    expect(result?.topicBreakdown['Biology']).toEqual({ scored: 7, possible: 10 });
    expect(result?.score).toBe(9);
    expect(result?.maxScore).toBe(12);
  });

  it('persists submittedAt, score, maxScore, and topicBreakdown to the MockExam row', async () => {
    getSession.mockResolvedValue(
      session({ mockExam: { questions: [mcqQuestion()], answers: ['B'] } }),
    );
    findUniqueChunk.mockResolvedValue({ content: 'Correct answer: B' });

    await service.gradeExam(phone, examId);

    expect(mockExamUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: examId },
        data: expect.objectContaining({
          submittedAt: expect.any(Date),
          score: 1,
          maxScore: 1,
          topicBreakdown: { Algebra: { scored: 1, possible: 1 } },
        }),
      }),
    );
  });

  it('defaults a question with no topic to "General"', async () => {
    getSession.mockResolvedValue(
      session({
        mockExam: { questions: [mcqQuestion({ topic: undefined })], answers: ['B'] },
      }),
    );
    findUniqueChunk.mockResolvedValue({ content: 'Correct answer: B' });

    const result = await service.gradeExam(phone, examId);

    expect(result?.topicBreakdown['General']).toEqual({ scored: 1, possible: 1 });
  });
});
