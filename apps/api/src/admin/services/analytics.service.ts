import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentStatus, SubscriptionTier } from '../../../generated/prisma';

export interface DailyCount {
  date: string;
  count: number;
}

export interface SubjectCount {
  subject: string;
  count: number;
}

export interface TopicCount {
  topic: string;
  count: number;
}

export interface AnalyticsResult {
  dau: number[];
  totalMessages: number;
  newUsers: number;
  activeUsers: number;
  revenue: number;
  messagesPerDay: DailyCount[];
  questionsPerSubject: SubjectCount[];
  conversionFunnel: { registered: number; activated: number; paying: number };
  topTopics: TopicCount[];
}

const TOP_TOPICS_LIMIT = 10;

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // Every metric is scoped to [from, to], including newUsers/activeUsers, so
  // the whole payload reflects one consistent window rather than mixing
  // "this range" with "all time".
  //
  // KNOWN LIMITATION: only PracticeModeHandler and MilestoneService currently
  // persist Interaction rows - QA-mode questions and individual mock-exam
  // questions are never logged as Interactions (see qa-mode.handler.ts /
  // mock-grading.service.ts). Every metric derived from the Interaction table
  // below (dau, messagesPerDay, totalMessages, questionsPerSubject,
  // topTopics) therefore undercounts real usage until that gap is closed in
  // a later branch - it's the best available real signal today, not a
  // synthetic one invented for this dashboard.
  async getAnalytics(from: Date, to: Date): Promise<AnalyticsResult> {
    const [
      messagesPerDay,
      dauPerDay,
      totalMessages,
      newUsers,
      activeUsers,
      revenue,
      questionsPerSubject,
      topTopics,
      conversionFunnel,
    ] = await Promise.all([
      this.getDailySeries(from, to, false),
      this.getDailySeries(from, to, true),
      this.prisma.interaction.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.prisma.user.count({ where: { createdAt: { gte: from, lte: to } } }),
      this.getActiveUsers(from, to),
      this.getRevenue(from, to),
      this.getQuestionsPerSubject(from, to),
      this.getTopTopics(from, to),
      this.getConversionFunnel(from, to),
    ]);

    return {
      dau: dauPerDay.map((d) => d.count),
      totalMessages,
      newUsers,
      activeUsers,
      revenue,
      messagesPerDay,
      questionsPerSubject,
      conversionFunnel,
      topTopics,
    };
  }

  // distinctUsers=false -> total interaction count per day (messagesPerDay);
  // distinctUsers=true -> distinct active user count per day (dau). Days
  // with zero interactions are filled in as 0 rather than omitted, so the
  // series always spans the full requested range for charting.
  private async getDailySeries(
    from: Date,
    to: Date,
    distinctUsers: boolean,
  ): Promise<DailyCount[]> {
    const rows = distinctUsers
      ? await this.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
          SELECT date_trunc('day', "createdAt") as day, COUNT(DISTINCT "userId")::bigint as count
          FROM interactions
          WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
          GROUP BY day
          ORDER BY day ASC
        `
      : await this.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
          SELECT date_trunc('day', "createdAt") as day, COUNT(*)::bigint as count
          FROM interactions
          WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
          GROUP BY day
          ORDER BY day ASC
        `;

    const countsByDay = new Map<string, number>();
    for (const row of rows) {
      countsByDay.set(row.day.toISOString().slice(0, 10), Number(row.count));
    }

    return this.fillDayRange(from, to, countsByDay);
  }

  private fillDayRange(from: Date, to: Date, countsByDay: Map<string, number>): DailyCount[] {
    const days: DailyCount[] = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      days.push({ date: key, count: countsByDay.get(key) ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return days;
  }

  private async getActiveUsers(from: Date, to: Date): Promise<number> {
    const [{ count }] = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT "userId")::bigint as count
      FROM interactions
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
    `;
    return Number(count);
  }

  // PendingPayment (not Subscription) is the source of truth for actual
  // money collected - Subscription only records the resulting entitlement
  // window and has no amount/currency fields at all.
  private async getRevenue(from: Date, to: Date): Promise<number> {
    const result = await this.prisma.pendingPayment.aggregate({
      where: { status: PaymentStatus.SUCCESSFUL, createdAt: { gte: from, lte: to } },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  private async getQuestionsPerSubject(from: Date, to: Date): Promise<SubjectCount[]> {
    const grouped = await this.prisma.interaction.groupBy({
      by: ['subject'],
      where: { createdAt: { gte: from, lte: to } },
      _count: { _all: true },
      orderBy: { _count: { subject: 'desc' } },
    });

    return grouped.map((g) => ({ subject: g.subject, count: g._count._all }));
  }

  private async getTopTopics(from: Date, to: Date): Promise<TopicCount[]> {
    const grouped = await this.prisma.interaction.groupBy({
      by: ['topic'],
      where: { createdAt: { gte: from, lte: to } },
      _count: { _all: true },
      orderBy: { _count: { topic: 'desc' } },
      take: TOP_TOPICS_LIMIT,
    });

    return grouped.map((g) => ({ topic: g.topic, count: g._count._all }));
  }

  // Scoped to the same [from, to] cohort as newUsers - "of the people who
  // registered in this window, how many activated/converted", not an
  // all-time funnel.
  private async getConversionFunnel(
    from: Date,
    to: Date,
  ): Promise<{ registered: number; activated: number; paying: number }> {
    const [registered, activated, paying] = await Promise.all([
      this.prisma.user.count({ where: { createdAt: { gte: from, lte: to } } }),
      // Onboarding creates the User row with subjects: [] immediately, only
      // populating it once SUBJECT_SELECTION's "Confirm" step commits real
      // subjects - an empty array is a reliable "never finished onboarding" signal.
      this.prisma.user.count({
        where: { createdAt: { gte: from, lte: to }, subjects: { isEmpty: false } },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: from, lte: to }, tier: { not: SubscriptionTier.FREE } },
      }),
    ]);

    return { registered, activated, paying };
  }
}
