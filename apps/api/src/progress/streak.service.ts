import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '../../generated/prisma';

// Africa/Douala is UTC+1 year-round (no DST) - "today" for streak purposes is
// the calendar day in Cameroon time, not the server's UTC day, so a student
// active at 23:30 UTC (00:30 in Cameroon) is already on their next day.
const CAMEROON_OFFSET_MS = 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function cameroonDayIndex(date: Date): number {
  return Math.floor((date.getTime() + CAMEROON_OFFSET_MS) / MS_PER_DAY);
}

@Injectable()
export class StreakService {
  private readonly logger = new Logger(StreakService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Called on every meaningful student interaction (a question answered, a
  // practice attempt, a submitted mock exam - wired into those handlers in a
  // later step of this branch). Idempotent within the same Cameroon calendar
  // day, so repeated calls in one day don't inflate the streak.
  async recordActivity(phone: string): Promise<User> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { phone_number: phone } });
    const now = new Date();
    const today = cameroonDayIndex(now);
    const lastActiveDay = user.lastActiveDate ? cameroonDayIndex(user.lastActiveDate) : null;

    if (lastActiveDay !== null && today <= lastActiveDay) {
      // Already recorded today - or lastActiveDate is somehow in the future
      // (clock skew), which is treated the same defensive way: no change.
      return user;
    }

    const streakDays =
      lastActiveDay !== null && today - lastActiveDay === 1 ? user.streakDays + 1 : 1;

    this.logger.log(`Streak updated for ${phone}: ${user.streakDays} -> ${streakDays}`);

    return this.prisma.user.update({
      where: { phone_number: phone },
      data: { lastActiveDate: now, streakDays },
    });
  }
}
