import { NotFoundException } from '@nestjs/common';
import { Level } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { PastQuestionService, PastQuestion } from '../practice/past-question.service';
import { MockPaperService } from './mock-paper.service';

describe('MockPaperService', () => {
  let service: MockPaperService;
  let embeddingChunkFindMany: jest.Mock;
  let mockExamCreate: jest.Mock;
  let mockExamDelete: jest.Mock;
  let getQuestion: jest.Mock;

  const phone = '237670000011';

  function question(overrides: Partial<PastQuestion> = {}): PastQuestion {
    return {
      chunkId: `chunk-${Math.random()}`,
      questionText: 'Question 1. What is 2+2?\nA. 3\nB. 4\nC. 5\nD. 6',
      type: 'MCQ',
      paper: 'Paper 1',
      topic: 'Algebra',
      ...overrides,
    };
  }

  beforeEach(() => {
    embeddingChunkFindMany = jest.fn().mockResolvedValue([]);
    mockExamCreate = jest.fn().mockResolvedValue({ id: 'exam-1' });
    mockExamDelete = jest.fn();
    getQuestion = jest.fn();

    service = new MockPaperService(
      {
        embeddingChunk: { findMany: embeddingChunkFindMany },
        mockExam: { create: mockExamCreate, delete: mockExamDelete },
      } as unknown as PrismaService,
      { getQuestion } as unknown as PastQuestionService,
    );
  });

  describe('assemblePaper', () => {
    it('throws NotFoundException when no past questions are available', async () => {
      getQuestion.mockResolvedValue(null);

      await expect(service.assemblePaper(phone, 'Chemistry', Level.O_LEVEL)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockExamCreate).not.toHaveBeenCalled();
    });

    it('assembles all available questions until getQuestion runs dry, excluding seen ids', async () => {
      // assemblePaper reuses (mutates) the same excludeIds array reference
      // across calls, so jest.fn()'s recorded mock.calls would all show the
      // final mutated array if read after the fact - snapshotting a copy at
      // call time is the only way to see what each call actually received.
      const excludeIdsPerCall: string[][] = [];
      getQuestion.mockImplementation((_filter: unknown, excludeIds: string[]) => {
        excludeIdsPerCall.push([...excludeIds]);
        if (excludeIdsPerCall.length === 1) return Promise.resolve(question({ chunkId: 'q1' }));
        if (excludeIdsPerCall.length === 2) return Promise.resolve(question({ chunkId: 'q2' }));
        return Promise.resolve(null);
      });

      const paper = await service.assemblePaper(phone, 'Mathematics', Level.O_LEVEL);

      expect(paper.questions).toHaveLength(2);
      expect(excludeIdsPerCall).toEqual([[], ['q1'], ['q1', 'q2']]);
    });

    it('creates the MockExam DB row and returns its id as examId', async () => {
      getQuestion.mockResolvedValueOnce(question()).mockResolvedValueOnce(null);
      mockExamCreate.mockResolvedValue({ id: 'exam-42' });

      const paper = await service.assemblePaper(phone, 'Mathematics', Level.O_LEVEL);

      expect(mockExamCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: phone,
            subject: 'Mathematics',
            level: Level.O_LEVEL,
          }),
        }),
      );
      expect(paper.examId).toBe('exam-42');
    });

    it('preserves each computed mark on its own question and sums them into totalMarks', async () => {
      getQuestion
        .mockResolvedValueOnce(
          question({ chunkId: 'q1', type: 'MCQ', questionText: 'Question 1. 2+2?\nA.3\nB.4' }),
        )
        .mockResolvedValueOnce(
          question({
            chunkId: 'q2',
            type: 'STRUCTURED',
            questionText: 'Question 2. Explain photosynthesis. [15 marks]',
            paper: 'Paper 2',
          }),
        )
        .mockResolvedValueOnce(null);

      const paper = await service.assemblePaper(phone, 'Biology', Level.O_LEVEL);

      // MCQ with no explicit [N marks] tag falls back to the 1-mark default.
      expect(paper.questions[0].marks).toBe(1);
      // Structured question with an explicit tag uses the parsed value.
      expect(paper.questions[1].marks).toBe(15);
      expect(paper.totalMarks).toBe(16);
    });

    it('falls back to the 10-mark structured default when no [N marks] tag is present', async () => {
      getQuestion
        .mockResolvedValueOnce(
          question({
            chunkId: 'q1',
            type: 'STRUCTURED',
            questionText: 'Question 1. Explain photosynthesis.',
            paper: 'Paper 2',
          }),
        )
        .mockResolvedValueOnce(null);

      const paper = await service.assemblePaper(phone, 'Biology', Level.O_LEVEL);

      expect(paper.questions[0].marks).toBe(10);
    });

    it('majority-votes the paper number across questions to determine paper type/duration', async () => {
      getQuestion
        .mockResolvedValueOnce(question({ chunkId: 'q1', paper: 'Paper 2' }))
        .mockResolvedValueOnce(question({ chunkId: 'q2', paper: 'Paper 2' }))
        .mockResolvedValueOnce(question({ chunkId: 'q3', paper: 'Paper 1' }))
        .mockResolvedValueOnce(null);

      const paper = await service.assemblePaper(phone, 'Mathematics', Level.O_LEVEL);

      expect(paper.paperType).toBe('Structured Paper 2');
      expect(paper.durationMinutes).toBe(120);
    });

    it('falls back to MCQ-vs-structured majority when no paper label is present anywhere', async () => {
      getQuestion
        .mockResolvedValueOnce(question({ chunkId: 'q1', type: 'MCQ', paper: undefined }))
        .mockResolvedValueOnce(question({ chunkId: 'q2', type: 'MCQ', paper: undefined }))
        .mockResolvedValueOnce(null);

      const paper = await service.assemblePaper(phone, 'Mathematics', Level.O_LEVEL);

      expect(paper.paperType).toBe('MCQ Paper 1');
      expect(paper.durationMinutes).toBe(90);
    });

    it('picks the year with the most past-paper chunks, tie-broken by most recent', async () => {
      embeddingChunkFindMany.mockResolvedValue([
        { year: 2021 },
        { year: 2021 },
        { year: 2022 },
        { year: 2022 },
      ]);
      getQuestion.mockResolvedValueOnce(question()).mockResolvedValueOnce(null);

      await service.assemblePaper(phone, 'Mathematics', Level.O_LEVEL);

      expect(getQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ yearRange: '2022-2022' }),
        expect.anything(),
      );
    });
  });

  describe('discardExam', () => {
    it('deletes the MockExam row by id', async () => {
      await service.discardExam('exam-1');

      expect(mockExamDelete).toHaveBeenCalledWith({ where: { id: 'exam-1' } });
    });
  });
});
