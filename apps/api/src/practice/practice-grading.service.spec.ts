import { Language } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { I18nService } from '../i18n/i18n.service';
import { LlmService } from '../rag/services/llm.service';
import { TopicScoreService } from './topic-score.service';
import { GradeAnswerInput, PracticeGradingService } from './practice-grading.service';

describe('PracticeGradingService', () => {
  let service: PracticeGradingService;
  let findUniqueChunk: jest.Mock;
  let interactionCreate: jest.Mock;
  let generate: jest.Mock;
  let recordResult: jest.Mock;

  const phone = '237670000011';

  const mcqQuestionText =
    'Question 1. Paper 1. Solve for x: 2x + 5 = 15\nA. x=5\nB. x=10\nC. x=3\nD. x=7';

  function mcqInput(overrides: Partial<GradeAnswerInput> = {}): GradeAnswerInput {
    return {
      phone,
      questionText: mcqQuestionText,
      markingSchemeChunkId: 'scheme-1',
      questionType: 'MCQ',
      subject: 'Mathematics',
      topic: 'Algebra',
      answerText: 'A',
      language: Language.EN,
      ...overrides,
    };
  }

  beforeEach(() => {
    findUniqueChunk = jest.fn().mockResolvedValue({
      id: 'scheme-1',
      content: 'Question 1. Paper 1. Correct answer: A. Subtract 5, then divide by 2.',
    });
    interactionCreate = jest.fn();
    generate = jest.fn().mockResolvedValue('Explanation of why A is correct.');
    recordResult = jest.fn();

    service = new PracticeGradingService(
      {
        embeddingChunk: { findUnique: findUniqueChunk },
        interaction: { create: interactionCreate },
      } as unknown as PrismaService,
      { generate } as unknown as LlmService,
      new I18nService(),
      { recordResult } as unknown as TopicScoreService,
    );
  });

  describe('MCQ grading', () => {
    it('grades a correct bare-letter answer', async () => {
      const result = await service.gradeAnswer(mcqInput({ answerText: 'A' }));

      expect(result.correct).toBe(true);
      expect(result.feedback).toMatch(/^✅ Correct!/);
      expect(interactionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ correct: true, userAnswer: 'A' }),
        }),
      );
      expect(recordResult).toHaveBeenCalledWith(phone, 'Mathematics', 'Algebra', true);
      // Correct answers don't need an LLM call - the scheme text is enough.
      expect(generate).not.toHaveBeenCalled();
    });

    it('grades a correct full-text answer by matching it against the option text', async () => {
      const result = await service.gradeAnswer(mcqInput({ answerText: 'x=5' }));

      expect(result.correct).toBe(true);
      expect(result.feedback).toMatch(/^✅ Correct!/);
    });

    it('grades a wrong answer using a real LLM explanation', async () => {
      const result = await service.gradeAnswer(mcqInput({ answerText: 'B' }));

      expect(generate).toHaveBeenCalledTimes(1);
      expect(result.correct).toBe(false);
      expect(result.feedback).toBe(
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
      const result = await service.gradeAnswer(mcqInput({ answerText: 'I have no idea' }));

      expect(result.correct).toBe(false);
      expect(interactionCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ correct: false }) }),
      );
    });

    it('falls back gracefully when no marking scheme can be found, without grading', async () => {
      findUniqueChunk.mockResolvedValue(null);

      const result = await service.gradeAnswer(mcqInput({ answerText: 'A' }));

      expect(result.correct).toBeNull();
      expect(result.feedback).toBe(
        "I couldn't automatically grade this question, but I've recorded your answer.",
      );
      expect(interactionCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ correct: null }) }),
      );
      expect(recordResult).not.toHaveBeenCalled();
    });
  });

  describe('essay/structured grading', () => {
    function essayInput(overrides: Partial<GradeAnswerInput> = {}): GradeAnswerInput {
      return {
        phone,
        questionText: 'Question 2. Explain the process of osmosis in plant cells.',
        markingSchemeChunkId: 'scheme-2',
        questionType: 'STRUCTURED',
        subject: 'Biology',
        topic: 'Osmosis',
        answerText: 'Water moves from high to low concentration across a membrane.',
        language: Language.EN,
        ...overrides,
      };
    }

    beforeEach(() => {
      findUniqueChunk.mockResolvedValue({
        id: 'scheme-2',
        content:
          'Award marks for: definition of osmosis, mention of selectively permeable membrane.',
      });
    });

    it('parses an "X out of Y" mark above the passing ratio as correct', async () => {
      generate.mockResolvedValue(
        '✅ Points you got right: definition\n⚠️ Points you missed: membrane detail\n' +
          '📊 Estimated mark: 8 out of 10\n💡 One tip to improve: mention selective permeability',
      );

      const result = await service.gradeAnswer(essayInput());

      expect(result.correct).toBe(true);
      expect(result.feedback).toContain('8 out of 10');
      expect(recordResult).toHaveBeenCalledWith(phone, 'Biology', 'Osmosis', true);
    });

    it('parses a low "X/Y" mark below the passing ratio as incorrect', async () => {
      generate.mockResolvedValue('📊 Estimated mark: 2/10');

      const result = await service.gradeAnswer(essayInput());

      expect(result.correct).toBe(false);
      expect(recordResult).toHaveBeenCalledWith(phone, 'Biology', 'Osmosis', false);
    });

    it('records correct=null and skips the topic score when the mark cannot be parsed', async () => {
      generate.mockResolvedValue('Great effort! Keep practicing.');

      const result = await service.gradeAnswer(essayInput());

      expect(result.correct).toBeNull();
      expect(recordResult).not.toHaveBeenCalled();
      expect(interactionCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ correct: null }) }),
      );
    });

    it('falls back gracefully when no marking scheme can be found, without calling the LLM', async () => {
      findUniqueChunk.mockResolvedValue(null);

      const result = await service.gradeAnswer(essayInput());

      expect(result.correct).toBeNull();
      expect(result.feedback).toBe(
        "I couldn't find a marking scheme for this question, but I've recorded your answer.",
      );
      expect(generate).not.toHaveBeenCalled();
      expect(recordResult).not.toHaveBeenCalled();
    });
  });
});
