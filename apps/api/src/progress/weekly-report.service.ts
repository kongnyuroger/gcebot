import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Language, SubscriptionTier, User } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { I18nService } from '../i18n/i18n.service';
import { LlmService } from '../rag/services/llm.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { chunk } from '../handlers/subjects.constants';

interface SubjectAccuracy {
  subject: string;
  correct: number;
  total: number;
}

interface TopicAccuracy {
  subject: string;
  topic: string;
  correct: number;
  total: number;
}

interface UserWeeklyStats {
  questionsThisWeek: number;
  bestSubject: { subject: string; accuracy: number } | null;
  weakestTopic: { subject: string; topic: string; accuracy: number } | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEK_WINDOW_MS = 7 * MS_PER_DAY;
const BATCH_SIZE = 50;
// WhatsApp Cloud API rate limits business-initiated sends - a small delay
// between each message keeps a large weekly run well under them.
const SEND_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildWeeklyTipPrompt(subject: string, topic: string, accuracyPercent: number): string {
  return (
    `A student scored ${accuracyPercent}% this week on ${subject} questions about ${topic}. ` +
    'Give them one specific, actionable study tip for that topic. Keep it to 1-2 sentences, encouraging in tone.'
  );
}

@Injectable()
export class WeeklyReportService {
  private readonly logger = new Logger(WeeklyReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
    private readonly llmService: LlmService,
    private readonly whatsappSendService: WhatsappSendService,
  ) {}

  // Every Sunday 08:00 Cameroon time.
  //
  // NOTE: this sends a business-initiated (not user-triggered) WhatsApp
  // message, which requires an approved message template outside the 24h
  // customer-service window. Register a "weekly_report" template in Meta
  // Business Manager before enabling this in production - the plain-text
  // sendText() call below will otherwise be rejected by the Graph API.
  @Cron('0 8 * * 0', { timeZone: 'Africa/Douala' })
  async runWeeklyReport(): Promise<void> {
    const users = await this.getEligibleUsers();

    if (users.length === 0) {
      this.logger.log('Weekly report: no eligible users this run');
      return;
    }

    const statsByPhone = await this.aggregateWeeklyStats(users.map((user) => user.phone_number));
    const batches = chunk(users, BATCH_SIZE);

    this.logger.log(
      `Weekly report: sending to ${users.length} eligible users in ${batches.length} batch(es)`,
    );

    for (const [index, batch] of batches.entries()) {
      for (const user of batch) {
        try {
          await this.sendReport(user, statsByPhone.get(user.phone_number));
        } catch (error) {
          this.logger.error(
            `Weekly report: failed to send to ${user.phone_number}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        await sleep(SEND_DELAY_MS);
      }
      this.logger.log(`Weekly report: batch ${index + 1}/${batches.length} complete`);
    }
  }

  // Paying subscribers get a weekly report regardless of activity (a
  // re-engagement touchpoint); FREE-tier users only get one if they were
  // actually active in the last 7 days, so it isn't spam to a dormant signup.
  private async getEligibleUsers(): Promise<User[]> {
    const sevenDaysAgo = new Date(Date.now() - WEEK_WINDOW_MS);
    return this.prisma.user.findMany({
      where: {
        OR: [{ tier: { not: SubscriptionTier.FREE } }, { lastActiveDate: { gte: sevenDaysAgo } }],
      },
    });
  }

  private async aggregateWeeklyStats(phones: string[]): Promise<Map<string, UserWeeklyStats>> {
    const weekStart = new Date(Date.now() - WEEK_WINDOW_MS);
    const interactions = await this.prisma.interaction.findMany({
      where: { userId: { in: phones }, createdAt: { gte: weekStart }, correct: { not: null } },
      select: { userId: true, subject: true, topic: true, correct: true },
    });

    const questionsByUser = new Map<string, number>();
    const subjectsByUser = new Map<string, Map<string, SubjectAccuracy>>();
    const topicsByUser = new Map<string, Map<string, TopicAccuracy>>();

    for (const interaction of interactions) {
      questionsByUser.set(interaction.userId, (questionsByUser.get(interaction.userId) ?? 0) + 1);

      const subjectMap =
        subjectsByUser.get(interaction.userId) ?? new Map<string, SubjectAccuracy>();
      const subjectEntry = subjectMap.get(interaction.subject) ?? {
        subject: interaction.subject,
        correct: 0,
        total: 0,
      };
      subjectEntry.total += 1;
      if (interaction.correct) subjectEntry.correct += 1;
      subjectMap.set(interaction.subject, subjectEntry);
      subjectsByUser.set(interaction.userId, subjectMap);

      const topicMap = topicsByUser.get(interaction.userId) ?? new Map<string, TopicAccuracy>();
      const topicKey = `${interaction.subject}::${interaction.topic}`;
      const topicEntry = topicMap.get(topicKey) ?? {
        subject: interaction.subject,
        topic: interaction.topic,
        correct: 0,
        total: 0,
      };
      topicEntry.total += 1;
      if (interaction.correct) topicEntry.correct += 1;
      topicMap.set(topicKey, topicEntry);
      topicsByUser.set(interaction.userId, topicMap);
    }

    const result = new Map<string, UserWeeklyStats>();
    for (const phone of phones) {
      const subjects = Array.from(subjectsByUser.get(phone)?.values() ?? []);
      const topics = Array.from(topicsByUser.get(phone)?.values() ?? []);

      const bestSubject = subjects.reduce<SubjectAccuracy | null>(
        (best, current) =>
          !best || current.correct / current.total > best.correct / best.total ? current : best,
        null,
      );
      const weakestTopic = topics.reduce<TopicAccuracy | null>(
        (worst, current) =>
          !worst || current.correct / current.total < worst.correct / worst.total ? current : worst,
        null,
      );

      result.set(phone, {
        questionsThisWeek: questionsByUser.get(phone) ?? 0,
        bestSubject: bestSubject
          ? { subject: bestSubject.subject, accuracy: bestSubject.correct / bestSubject.total }
          : null,
        weakestTopic: weakestTopic
          ? {
              subject: weakestTopic.subject,
              topic: weakestTopic.topic,
              accuracy: weakestTopic.correct / weakestTopic.total,
            }
          : null,
      });
    }

    return result;
  }

  private async sendReport(user: User, stats: UserWeeklyStats | undefined): Promise<void> {
    const lang = user.language;
    const bestSubjectLine = stats?.bestSubject
      ? `${stats.bestSubject.subject} (${Math.round(stats.bestSubject.accuracy * 100)}%)`
      : this.i18n.t('progress.weeklyNoData', lang);
    const focusAreaLine = stats?.weakestTopic
      ? stats.weakestTopic.topic
      : this.i18n.t('progress.weeklyNoData', lang);

    const tip = await this.getStudyTip(stats?.weakestTopic ?? null, lang);

    const text = this.i18n.t('progress.weeklyReport', lang, {
      questions: String(stats?.questionsThisWeek ?? 0),
      bestSubject: bestSubjectLine,
      focusArea: focusAreaLine,
      streak: String(user.streakDays),
      tip,
    });

    await this.whatsappSendService.sendText(user.phone_number, text);
  }

  // No weakest topic means no graded activity this week at all - a real tip
  // would have nothing to be "about", so this falls back to a canned
  // re-engagement nudge instead of calling the LLM with no real subject.
  private async getStudyTip(
    weakestTopic: { subject: string; topic: string; accuracy: number } | null,
    lang: Language,
  ): Promise<string> {
    if (!weakestTopic) {
      return this.i18n.t('progress.weeklyTipNoActivity', lang);
    }

    try {
      return await this.llmService.generate(
        buildWeeklyTipPrompt(
          weakestTopic.subject,
          weakestTopic.topic,
          Math.round(weakestTopic.accuracy * 100),
        ),
        'Give me a study tip.',
        { complexity: 'simple' },
      );
    } catch (error) {
      this.logger.error(
        `getStudyTip: LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.i18n.t('progress.weeklyTipFallback', lang);
    }
  }
}
