import { Injectable } from '@nestjs/common';
import { InteractionType } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';

export interface TopicAccuracy {
  topic: string;
  correct: number;
  total: number;
  accuracy: number;
}

const WEAK_ACCURACY_THRESHOLD = 0.6;
// Weak topics are 3x as likely to be picked as strong ones, not the ONLY
// possible outcome - a student's stronger topics still come up sometimes.
const WEAK_TOPIC_WEIGHT = 3;
const STRONG_TOPIC_WEIGHT = 1;

@Injectable()
export class TopicWeaknessService {
  constructor(private readonly prisma: PrismaService) {}

  // Ungraded attempts (correct: null - e.g. no marking scheme was found) carry
  // no accuracy signal, so they're excluded from both the numerator and
  // denominator entirely rather than counted as either right or wrong.
  async getWeakTopics(phone: string, subject: string): Promise<TopicAccuracy[]> {
    const interactions = await this.prisma.interaction.findMany({
      where: {
        userId: phone,
        type: InteractionType.PRACTICE,
        subject,
        correct: { not: null },
      },
      select: { topic: true, correct: true },
    });

    const byTopic = new Map<string, { correct: number; total: number }>();
    for (const interaction of interactions) {
      const entry = byTopic.get(interaction.topic) ?? { correct: 0, total: 0 };
      entry.total += 1;
      if (interaction.correct) {
        entry.correct += 1;
      }
      byTopic.set(interaction.topic, entry);
    }

    const accuracies: TopicAccuracy[] = Array.from(byTopic.entries()).map(
      ([topic, { correct, total }]) => ({ topic, correct, total, accuracy: correct / total }),
    );

    return accuracies.sort((a, b) => a.accuracy - b.accuracy);
  }

  // Random, but weighted so weaker topics (<60% accuracy) come up more often.
  // Returns null if there's no performance history at all to weight by.
  pickWeightedRandomTopic(topics: TopicAccuracy[]): string | null {
    if (topics.length === 0) {
      return null;
    }

    const weighted = topics.flatMap((topic) =>
      Array<string>(
        topic.accuracy < WEAK_ACCURACY_THRESHOLD ? WEAK_TOPIC_WEIGHT : STRONG_TOPIC_WEIGHT,
      ).fill(topic.topic),
    );

    return weighted[Math.floor(Math.random() * weighted.length)];
  }
}
