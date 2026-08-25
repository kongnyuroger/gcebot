import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface TopicStat {
  subject: string;
  topic: string;
  correct: number;
  total: number;
  accuracy: number;
}

// Shared definition of "weak" across ProgressHandler's WhatsApp summary and
// the orchestrator's show_progress tool - one threshold, not two that could drift.
export const WEAK_ACCURACY_THRESHOLD = 0.6;

// Extracted out of ProgressHandler (previously a private method there) so
// the upcoming orchestrator's show_progress tool can reuse the exact same
// aggregation instead of re-deriving it - same reasoning as
// PracticeGradingService's extraction out of PracticeModeHandler.
@Injectable()
export class ProgressStatsService {
  constructor(private readonly prisma: PrismaService) {}

  // One row per (subject, topic) with correct/total/accuracy - only
  // Interactions with a known correct/incorrect verdict count (mirrors
  // TopicWeaknessService's own `correct: { not: null }` exclusion of
  // ungraded attempts, e.g. essays with no marking scheme found).
  async getTopicStats(phone: string): Promise<TopicStat[]> {
    const interactions = await this.prisma.interaction.findMany({
      where: { userId: phone, correct: { not: null } },
      select: { subject: true, topic: true, correct: true },
    });

    const byKey = new Map<
      string,
      { subject: string; topic: string; correct: number; total: number }
    >();

    for (const interaction of interactions) {
      const key = `${interaction.subject} ${interaction.topic}`;
      const entry = byKey.get(key) ?? {
        subject: interaction.subject,
        topic: interaction.topic,
        correct: 0,
        total: 0,
      };
      entry.total += 1;
      if (interaction.correct) {
        entry.correct += 1;
      }
      byKey.set(key, entry);
    }

    return Array.from(byKey.values())
      .map((entry) => ({ ...entry, accuracy: entry.correct / entry.total }))
      .sort((a, b) => a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic));
  }
}
