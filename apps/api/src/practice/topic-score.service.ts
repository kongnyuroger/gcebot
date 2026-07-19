import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';

interface TopicCounts {
  correct: number;
  total: number;
}

type TopicScores = Record<string, Record<string, TopicCounts>>;

@Injectable()
export class TopicScoreService {
  constructor(private readonly prisma: PrismaService) {}

  // A denormalized running counter on User.topicScores - separate from the
  // durable Interaction event log (which TopicWeaknessService reads instead
  // for its weighted topic picker), giving an O(1) lookup for one exact
  // {subject, topic} pair without aggregating interaction history each time.
  async recordResult(
    phone: string,
    subject: string,
    topic: string,
    correct: boolean | null,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { phone_number: phone },
      select: { topicScores: true },
    });
    const scores = this.parseScores(user?.topicScores);

    const subjectScores = scores[subject] ?? {};
    const current = subjectScores[topic] ?? { correct: 0, total: 0 };

    // An ungraded attempt (correct: null) still happened, but carries no
    // right/wrong signal - counted in neither the numerator nor denominator.
    if (correct !== null) {
      current.total += 1;
      if (correct) {
        current.correct += 1;
      }
    }

    subjectScores[topic] = current;
    scores[subject] = subjectScores;

    await this.prisma.user.update({
      where: { phone_number: phone },
      data: { topicScores: scores as unknown as Prisma.InputJsonValue },
    });
  }

  // Returns a 0-100 percentage; 0 if there's no graded history yet for this
  // exact subject+topic pair.
  async getTopicAccuracy(phone: string, subject: string, topic: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { phone_number: phone },
      select: { topicScores: true },
    });
    const scores = this.parseScores(user?.topicScores);
    const counts = scores[subject]?.[topic];

    if (!counts || counts.total === 0) {
      return 0;
    }

    return Math.round((counts.correct / counts.total) * 100);
  }

  private parseScores(raw: unknown): TopicScores {
    if (!raw || typeof raw !== 'object') {
      return {};
    }
    return raw as TopicScores;
  }
}
