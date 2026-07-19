import { PrismaService } from '../prisma/prisma.service';
import { TopicWeaknessService, TopicAccuracy } from './topic-weakness.service';

describe('TopicWeaknessService', () => {
  let service: TopicWeaknessService;
  let findMany: jest.Mock;

  const phone = '237670000010';

  beforeEach(() => {
    findMany = jest.fn();
    const prisma = { interaction: { findMany } } as unknown as PrismaService;
    service = new TopicWeaknessService(prisma);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getWeakTopics', () => {
    it('computes per-topic accuracy and sorts weakest first', async () => {
      findMany.mockResolvedValue([
        { topic: 'Algebra', correct: true },
        { topic: 'Algebra', correct: false },
        { topic: 'Geometry', correct: true },
        { topic: 'Geometry', correct: true },
      ]);

      const result = await service.getWeakTopics(phone, 'Mathematics');

      expect(result).toEqual([
        { topic: 'Algebra', correct: 1, total: 2, accuracy: 0.5 },
        { topic: 'Geometry', correct: 2, total: 2, accuracy: 1 },
      ]);
    });

    it('excludes ungraded (correct: null) interactions from the query entirely', async () => {
      findMany.mockResolvedValue([]);

      await service.getWeakTopics(phone, 'Mathematics');

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ correct: { not: null } }),
        }),
      );
    });

    it('returns an empty array when there is no graded history yet', async () => {
      findMany.mockResolvedValue([]);

      const result = await service.getWeakTopics(phone, 'Mathematics');

      expect(result).toEqual([]);
    });
  });

  describe('pickWeightedRandomTopic', () => {
    const topics: TopicAccuracy[] = [
      { topic: 'Weak', correct: 2, total: 10, accuracy: 0.2 },
      { topic: 'Strong', correct: 9, total: 10, accuracy: 0.9 },
    ];

    it('returns null when there is no performance history to weight by', () => {
      expect(service.pickWeightedRandomTopic([])).toBeNull();
    });

    it('weights weak topics (<60% accuracy) 3x over strong ones', () => {
      // Weighted pool is [Weak, Weak, Weak, Strong] (weights 3 and 1) - the
      // first 3/4 of the pool is Weak, the last 1/4 is Strong.
      jest.spyOn(Math, 'random').mockReturnValue(0);
      expect(service.pickWeightedRandomTopic(topics)).toBe('Weak');

      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      expect(service.pickWeightedRandomTopic(topics)).toBe('Weak');

      jest.spyOn(Math, 'random').mockReturnValue(0.99);
      expect(service.pickWeightedRandomTopic(topics)).toBe('Strong');
    });

    it('can still pick a strong topic - it is weighted, not excluded', () => {
      const onlyStrong: TopicAccuracy[] = [
        { topic: 'OnlyStrong', correct: 10, total: 10, accuracy: 1 },
      ];
      jest.spyOn(Math, 'random').mockReturnValue(0);
      expect(service.pickWeightedRandomTopic(onlyStrong)).toBe('OnlyStrong');
    });
  });
});
