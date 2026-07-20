import { Injectable, Logger } from '@nestjs/common';
import { InteractionType, PaymentMethod, SubscriptionTier, User } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { I18nService } from '../i18n/i18n.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';

const MILESTONE_DAYS = [7, 30, 60, 100];
const BONUS_PREMIUM_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class MilestoneService {
  private readonly logger = new Logger(MilestoneService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
    private readonly whatsappSendService: WhatsappSendService,
  ) {}

  // Called right after StreakService.recordActivity() updates a user's streak
  // (wired into the interaction handlers in a later step of this branch).
  // streakDays only ever increases by 1 per Cameroon day (or resets to 1), so
  // it passes through each exact milestone value at most once on its way up -
  // no separate "already celebrated" bookkeeping is needed.
  async checkMilestone(user: User): Promise<void> {
    if (!MILESTONE_DAYS.includes(user.streakDays)) {
      return;
    }

    this.logger.log(`${user.phone_number} hit a ${user.streakDays}-day streak milestone`);

    await this.whatsappSendService.sendText(
      user.phone_number,
      this.i18n.t('progress.milestoneCelebration', user.language, {
        days: String(user.streakDays),
      }),
    );

    await this.grantBonusPremium(user);

    await this.prisma.interaction.create({
      data: {
        userId: user.phone_number,
        type: InteractionType.MILESTONE,
        subject: 'Streak',
        topic: `${user.streakDays}-day streak`,
        questionText: '',
        userAnswer: '',
        correct: null,
      },
    });
  }

  private async grantBonusPremium(user: User): Promise<void> {
    const now = new Date();
    const existing = await this.prisma.subscription.findUnique({
      where: { userId: user.phone_number },
    });

    if (existing && existing.endDate > now) {
      // Still-active subscription (paid or an earlier bonus) - extend it in
      // place, keeping its existing tier rather than potentially downgrading
      // e.g. a paid FAMILY subscriber to a PREMIUM bonus window.
      await this.prisma.subscription.update({
        where: { userId: user.phone_number },
        data: { endDate: new Date(existing.endDate.getTime() + BONUS_PREMIUM_DAYS * MS_PER_DAY) },
      });
      return;
    }

    const bonusSubscription = {
      tier: SubscriptionTier.PREMIUM,
      startDate: now,
      endDate: new Date(now.getTime() + BONUS_PREMIUM_DAYS * MS_PER_DAY),
      paymentMethod: PaymentMethod.MILESTONE_BONUS,
      paymentReference: `milestone-streak-${user.streakDays}`,
    };

    if (existing) {
      // No active subscription right now (expired) - reset it to a fresh
      // bonus window rather than leaving the lapsed one in place.
      await this.prisma.subscription.update({
        where: { userId: user.phone_number },
        data: bonusSubscription,
      });
    } else {
      await this.prisma.subscription.create({
        data: { userId: user.phone_number, ...bonusSubscription },
      });
    }

    // Don't downgrade a user who is somehow already on the higher FAMILY tier
    // without a tracked Subscription row (e.g. a manually-granted account).
    if (user.tier !== SubscriptionTier.FAMILY) {
      await this.prisma.user.update({
        where: { phone_number: user.phone_number },
        data: { tier: SubscriptionTier.PREMIUM },
      });
    }
  }
}
