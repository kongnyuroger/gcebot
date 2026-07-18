import { NotFoundException } from '@nestjs/common';
import { InteractionType, SubscriptionTier } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from './quota.service';

describe('QuotaService', () => {
  let service: QuotaService;
  let findUnique: jest.Mock;
  let count: jest.Mock;

  const phone = '237670000001';

  beforeEach(() => {
    findUnique = jest.fn();
    count = jest.fn();

    const prisma = {
      user: { findUnique },
      interaction: { count },
    } as unknown as PrismaService;

    service = new QuotaService(prisma);
  });

  function mockUser(tier: SubscriptionTier) {
    findUnique.mockResolvedValue({ phone_number: phone, tier });
  }

  it('throws NotFoundException when the user does not exist', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.checkQuota(phone)).rejects.toThrow(NotFoundException);
  });

  it('allows a FREE user at 9 questions used today', async () => {
    mockUser(SubscriptionTier.FREE);
    count.mockResolvedValue(9);

    const result = await service.checkQuota(phone);

    expect(result).toEqual({ allowed: true, used: 9, limit: 10 });
  });

  it('blocks a FREE user at exactly 10 questions used today', async () => {
    mockUser(SubscriptionTier.FREE);
    count.mockResolvedValue(10);

    const result = await service.checkQuota(phone);

    expect(result).toEqual({ allowed: false, used: 10, limit: 10 });
  });

  it('blocks a FREE user at 11 questions used today', async () => {
    mockUser(SubscriptionTier.FREE);
    count.mockResolvedValue(11);

    const result = await service.checkQuota(phone);

    expect(result).toEqual({ allowed: false, used: 11, limit: 10 });
  });

  it.each([SubscriptionTier.BASIC, SubscriptionTier.PREMIUM, SubscriptionTier.FAMILY])(
    'always allows a %s tier user regardless of usage, without even counting interactions',
    async (tier) => {
      mockUser(tier);

      const result = await service.checkQuota(phone);

      expect(result.allowed).toBe(true);
      expect(count).not.toHaveBeenCalled();
    },
  );

  it('counts only QA interactions from the start of today onward', async () => {
    mockUser(SubscriptionTier.FREE);
    count.mockResolvedValue(0);

    await service.checkQuota(phone);

    expect(count).toHaveBeenCalledWith({
      where: {
        userId: phone,
        type: InteractionType.QA,
        createdAt: { gte: expect.any(Date) },
      },
    });
  });
});
