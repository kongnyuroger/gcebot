import { PrismaService } from '../prisma/prisma.service';
import { I18nService } from '../i18n/i18n.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { User } from '../../generated/prisma';
import { MilestoneService } from './milestone.service';

describe('MilestoneService', () => {
  let service: MilestoneService;
  let sendText: jest.Mock;
  let findUniqueSubscription: jest.Mock;
  let subscriptionCreate: jest.Mock;
  let subscriptionUpdate: jest.Mock;
  let userUpdate: jest.Mock;
  let interactionCreate: jest.Mock;

  const phone = '237670000011';

  function user(streakDays: number, overrides: Record<string, unknown> = {}): User {
    return {
      phone_number: phone,
      streakDays,
      language: 'EN',
      tier: 'FREE',
      ...overrides,
    } as User;
  }

  beforeEach(() => {
    sendText = jest.fn();
    findUniqueSubscription = jest.fn().mockResolvedValue(null);
    subscriptionCreate = jest.fn();
    subscriptionUpdate = jest.fn();
    userUpdate = jest.fn();
    interactionCreate = jest.fn();

    service = new MilestoneService(
      {
        subscription: {
          findUnique: findUniqueSubscription,
          create: subscriptionCreate,
          update: subscriptionUpdate,
        },
        user: { update: userUpdate },
        interaction: { create: interactionCreate },
      } as unknown as PrismaService,
      new I18nService(),
      { sendText } as unknown as WhatsappSendService,
    );
  });

  describe('milestone detection', () => {
    it.each([1, 2, 6, 8, 15, 29, 31, 59, 61, 99, 101])(
      'does nothing on a non-milestone streak day (%i)',
      async (streakDays) => {
        await service.checkMilestone(user(streakDays));

        expect(sendText).not.toHaveBeenCalled();
        expect(interactionCreate).not.toHaveBeenCalled();
      },
    );

    it.each([7, 30, 60, 100])('celebrates exactly on milestone day %i', async (streakDays) => {
      await service.checkMilestone(user(streakDays));

      expect(sendText).toHaveBeenCalledWith(
        phone,
        expect.stringContaining(`${streakDays}-day streak`),
      );
      expect(interactionCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'MILESTONE' }) }),
      );
    });
  });

  describe('bonus premium grant', () => {
    it('creates a fresh 7-day PREMIUM subscription when none exists', async () => {
      findUniqueSubscription.mockResolvedValue(null);

      await service.checkMilestone(user(7));

      expect(subscriptionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: phone,
            tier: 'PREMIUM',
            paymentMethod: 'MILESTONE_BONUS',
          }),
        }),
      );
      expect(userUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { tier: 'PREMIUM' } }),
      );
    });

    it('extends an existing active subscription by 7 days, preserving its tier', async () => {
      const originalEndDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      findUniqueSubscription.mockResolvedValue({
        userId: phone,
        tier: 'FAMILY',
        endDate: originalEndDate,
        paymentMethod: 'MTN_MOMO',
      });

      await service.checkMilestone(user(7, { tier: 'FAMILY' }));

      expect(subscriptionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { endDate: new Date(originalEndDate.getTime() + 7 * 24 * 60 * 60 * 1000) },
        }),
      );
      expect(subscriptionCreate).not.toHaveBeenCalled();
      // Extending an already-active subscription doesn't touch tier at all.
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('resets an expired subscription to a fresh bonus window rather than extending it', async () => {
      const expiredEndDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      findUniqueSubscription.mockResolvedValue({
        userId: phone,
        tier: 'PREMIUM',
        endDate: expiredEndDate,
        paymentMethod: 'ORANGE_MONEY',
      });

      await service.checkMilestone(user(30));

      expect(subscriptionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentMethod: 'MILESTONE_BONUS' }),
        }),
      );
      expect(subscriptionCreate).not.toHaveBeenCalled();
    });

    it('does not downgrade a FAMILY-tier user to PREMIUM when granting a fresh bonus', async () => {
      findUniqueSubscription.mockResolvedValue(null);

      await service.checkMilestone(user(7, { tier: 'FAMILY' }));

      expect(subscriptionCreate).toHaveBeenCalled();
      expect(userUpdate).not.toHaveBeenCalled();
    });
  });
});
