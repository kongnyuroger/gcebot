import { Injectable, NotFoundException } from '@nestjs/common';
import { InteractionType, SubscriptionTier } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';

export interface QuotaCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
}

const FREE_DAILY_QUESTION_LIMIT = 10;
// West Africa Time - Cameroon does not observe DST, so this offset is constant
// year-round (unlike e.g. Europe/Paris, which would need real timezone data).
const CAMEROON_UTC_OFFSET_HOURS = 1;

@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async checkQuota(phone: string): Promise<QuotaCheckResult> {
    const user = await this.prisma.user.findUnique({ where: { phone_number: phone } });
    if (!user) {
      throw new NotFoundException(`User ${phone} not found`);
    }

    if (user.tier !== SubscriptionTier.FREE) {
      return { allowed: true, used: 0, limit: Infinity };
    }

    const used = await this.prisma.interaction.count({
      where: {
        userId: phone,
        type: InteractionType.QA,
        createdAt: { gte: this.startOfCameroonDay() },
      },
    });

    return { allowed: used < FREE_DAILY_QUESTION_LIMIT, used, limit: FREE_DAILY_QUESTION_LIMIT };
  }

  private startOfCameroonDay(now: Date = new Date()): Date {
    const offsetMs = CAMEROON_UTC_OFFSET_HOURS * 60 * 60 * 1000;
    // Shift `now` forward by the Cameroon offset so UTC getters read as if
    // already in Cameroon's local time, take midnight of that shifted day,
    // then shift back to get the real UTC instant that midnight corresponds to.
    const shifted = new Date(now.getTime() + offsetMs);
    const cameroonMidnightUtcMs = Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    );
    return new Date(cameroonMidnightUtcMs - offsetMs);
  }
}
