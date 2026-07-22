import { PrismaService } from '../../prisma/prisma.service';
import { PaymentStatus, SubscriptionTier } from '../../../generated/prisma';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let queryRaw: jest.Mock;
  let interactionCount: jest.Mock;
  let userCount: jest.Mock;
  let pendingPaymentAggregate: jest.Mock;
  let interactionGroupBy: jest.Mock;

  const from = new Date('2026-07-01T00:00:00.000Z');
  const to = new Date('2026-07-03T23:59:59.999Z');

  beforeEach(() => {
    queryRaw = jest.fn();
    interactionCount = jest.fn().mockResolvedValue(42);
    userCount = jest.fn().mockResolvedValue(0);
    pendingPaymentAggregate = jest.fn().mockResolvedValue({ _sum: { amount: null } });
    interactionGroupBy = jest.fn().mockResolvedValue([]);

    service = new AnalyticsService({
      $queryRaw: queryRaw,
      interaction: { count: interactionCount, groupBy: interactionGroupBy },
      user: { count: userCount },
      pendingPayment: { aggregate: pendingPaymentAggregate },
    } as unknown as PrismaService);
  });

  describe('getAnalytics', () => {
    it('fills every day in the range with 0 when a day has no rows, rather than omitting it', async () => {
      // getDailySeries(messagesPerDay) then getDailySeries(dau) then
      // getActiveUsers each fire their own $queryRaw call, in that order,
      // since Promise.all evaluates array entries synchronously up front.
      queryRaw
        .mockResolvedValueOnce([{ day: new Date('2026-07-02T00:00:00.000Z'), count: BigInt(5) }])
        .mockResolvedValueOnce([{ day: new Date('2026-07-02T00:00:00.000Z'), count: BigInt(3) }])
        .mockResolvedValueOnce([{ count: BigInt(3) }]);

      const result = await service.getAnalytics(from, to);

      expect(result.messagesPerDay).toEqual([
        { date: '2026-07-01', count: 0 },
        { date: '2026-07-02', count: 5 },
        { date: '2026-07-03', count: 0 },
      ]);
      expect(result.dau).toEqual([0, 3, 0]);
      expect(result.activeUsers).toBe(3);
      expect(result.totalMessages).toBe(42);
    });

    it('reports zero revenue rather than null when there are no successful payments in range', async () => {
      queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);
      pendingPaymentAggregate.mockResolvedValue({ _sum: { amount: null } });

      const result = await service.getAnalytics(from, to);

      expect(result.revenue).toBe(0);
      expect(pendingPaymentAggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: PaymentStatus.SUCCESSFUL }),
        }),
      );
    });

    it('sums real revenue when successful payments exist', async () => {
      queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);
      pendingPaymentAggregate.mockResolvedValue({ _sum: { amount: 15000 } });

      const result = await service.getAnalytics(from, to);

      expect(result.revenue).toBe(15000);
    });

    it('maps groupBy results into plain subject/topic count arrays', async () => {
      queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);
      interactionGroupBy
        .mockResolvedValueOnce([
          { subject: 'Biology', _count: { _all: 12 } },
          { subject: 'Chemistry', _count: { _all: 7 } },
        ])
        .mockResolvedValueOnce([{ topic: 'Cell Division', _count: { _all: 9 } }]);

      const result = await service.getAnalytics(from, to);

      expect(result.questionsPerSubject).toEqual([
        { subject: 'Biology', count: 12 },
        { subject: 'Chemistry', count: 7 },
      ]);
      expect(result.topTopics).toEqual([{ topic: 'Cell Division', count: 9 }]);
    });

    it('scopes the conversion funnel to the same [from, to] cohort as newUsers, not all-time', async () => {
      queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);
      userCount
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(5);

      const result = await service.getAnalytics(from, to);

      expect(result.newUsers).toBe(50);
      expect(result.conversionFunnel).toEqual({ registered: 50, activated: 20, paying: 5 });
      // Every user.count call (newUsers + the funnel's 3 counts) must be
      // scoped to the same range, not an all-time query.
      for (const call of userCount.mock.calls) {
        expect(call[0]).toMatchObject({
          where: expect.objectContaining({ createdAt: { gte: from, lte: to } }),
        });
      }
      expect(userCount.mock.calls[3][0]).toMatchObject({
        where: expect.objectContaining({ tier: { not: SubscriptionTier.FREE } }),
      });
    });
  });
});
