import { PrismaService } from '../prisma/prisma.service';
import { ProgressStatsService } from './progress-stats.service';

describe('ProgressStatsService', () => {
  let findMany: jest.Mock;
  let service: ProgressStatsService;

  const phone = '237670000011';

  beforeEach(() => {
    findMany = jest.fn();
    service = new ProgressStatsService({
      interaction: { findMany },
    } as unknown as PrismaService);
  });

  it('excludes ungraded interactions from the query', async () => {
    findMany.mockResolvedValue([]);

    await service.getTopicStats(phone);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: phone, correct: { not: null } },
      }),
    );
  });

  it('aggregates correct/total/accuracy per subject+topic, sorted', async () => {
    findMany.mockResolvedValue([
      { subject: 'Mathematics', topic: 'Algebra', correct: true },
      { subject: 'Mathematics', topic: 'Algebra', correct: false },
      { subject: 'Biology', topic: 'Osmosis', correct: true },
    ]);

    const stats = await service.getTopicStats(phone);

    expect(stats).toEqual([
      { subject: 'Biology', topic: 'Osmosis', correct: 1, total: 1, accuracy: 1 },
      { subject: 'Mathematics', topic: 'Algebra', correct: 1, total: 2, accuracy: 0.5 },
    ]);
  });

  it('returns an empty array when there is no graded activity', async () => {
    findMany.mockResolvedValue([]);

    const stats = await service.getTopicStats(phone);

    expect(stats).toEqual([]);
  });
});
