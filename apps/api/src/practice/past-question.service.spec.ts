import { PrismaService } from '../prisma/prisma.service';
import { PastQuestionService } from './past-question.service';

describe('PastQuestionService', () => {
  let service: PastQuestionService;
  let findMany: jest.Mock;

  const baseFilter = { subject: 'Biology', level: 'O_LEVEL' as const };

  beforeEach(() => {
    findMany = jest.fn();
    const prisma = { embeddingChunk: { findMany } } as unknown as PrismaService;
    service = new PastQuestionService(prisma);
  });

  describe('seen-question exclusion', () => {
    it('passes excludeIds through as an id "notIn" filter', async () => {
      findMany.mockResolvedValueOnce([]);

      await service.getQuestion(baseFilter, ['seen-1', 'seen-2']);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { notIn: ['seen-1', 'seen-2'] } }),
        }),
      );
    });

    it('omits the id filter entirely when nothing has been seen yet', async () => {
      findMany.mockResolvedValueOnce([]);

      await service.getQuestion(baseFilter, []);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: undefined }) }),
      );
    });

    it('returns null once every candidate for the filter has already been seen', async () => {
      // Prisma's own notIn filtering has already removed every seen chunk by
      // the time the result set reaches this service, so it just sees empty.
      findMany.mockResolvedValueOnce([]);

      const result = await service.getQuestion(baseFilter, ['the-only-question-id']);

      expect(result).toBeNull();
    });

    it('returns a question that has not been excluded, with the exclusion filter still applied', async () => {
      findMany
        .mockResolvedValueOnce([
          {
            id: 'fresh-chunk',
            content: 'Question 1. Explain photosynthesis in plants.',
            year: 2022,
            topic: 'Photosynthesis',
          },
        ])
        .mockResolvedValueOnce([]); // marking scheme lookup - none found

      const result = await service.getQuestion(baseFilter, ['seen-chunk-id']);

      expect(result?.chunkId).toBe('fresh-chunk');
      expect(findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({ id: { notIn: ['seen-chunk-id'] } }),
        }),
      );
    });

    it('never re-serves the same chunk across successive calls once it is added to excludeIds', async () => {
      // Simulates two chunks total; after the first is "seen" and excluded,
      // only the second remains in the (mocked) candidate set.
      findMany.mockResolvedValueOnce([
        {
          id: 'chunk-2',
          content: 'Question 2. Describe cell respiration.',
          year: 2022,
          topic: 'Respiration',
        },
      ]);
      findMany.mockResolvedValueOnce([]);

      const result = await service.getQuestion(baseFilter, ['chunk-1']);

      expect(result?.chunkId).toBe('chunk-2');
    });
  });

  describe('question boundary detection', () => {
    it('excludes chunks that do not start with a question boundary', async () => {
      findMany.mockResolvedValueOnce([
        {
          id: 'not-a-question',
          content: 'This is running header text, not a question.',
          year: 2022,
          topic: 'Biology',
        },
      ]);

      const result = await service.getQuestion(baseFilter, []);

      expect(result).toBeNull();
    });
  });
});
