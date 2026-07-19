import { Injectable, Logger } from '@nestjs/common';
import { Language } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { I18nService } from '../i18n/i18n.service';
import { LlmService } from '../rag/services/llm.service';
import { ResponseFormatterService } from '../rag/services/response-formatter.service';

interface TopicBreakdownEntry {
  scored: number;
  possible: number;
}

// The informal GCE "credit" threshold, mirroring PracticeModeHandler's own
// PASSING_MARK_RATIO - a single consistent pass/fail bar across the app.
const PASS_RATIO = 0.5;
const MS_PER_MINUTE = 60_000;

function buildStudyTipPrompt(
  subject: string,
  weakestTopic: string | null,
  percent: number,
): string {
  const focus = weakestTopic
    ? `their weakest topic, ${weakestTopic},`
    : 'the topics they got wrong';
  return (
    `A student just scored ${percent}% on a ${subject} mock exam. Give them one specific, ` +
    `actionable study tip focused on ${focus}. Keep it to 1-2 sentences, encouraging in tone.`
  );
}

@Injectable()
export class MockReportService {
  private readonly logger = new Logger(MockReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
    private readonly llmService: LlmService,
    private readonly responseFormatter: ResponseFormatterService,
  ) {}

  async generateReport(examId: string): Promise<string[]> {
    const mockExam = await this.prisma.mockExam.findUnique({ where: { id: examId } });

    if (!mockExam) {
      this.logger.warn(`generateReport: no MockExam found for ${examId}`);
      return [this.i18n.t('mock.reportUnavailable', Language.EN)];
    }

    const user = await this.prisma.user.findUnique({ where: { phone_number: mockExam.userId } });
    const lang = user?.language ?? Language.EN;

    if (mockExam.score === null || mockExam.maxScore === null) {
      this.logger.warn(`generateReport: exam ${examId} has not been graded; sending fallback`);
      return [this.i18n.t('mock.reportUngraded', lang)];
    }

    const { score, maxScore } = mockExam;
    const percent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    const verdict =
      percent / 100 >= PASS_RATIO
        ? this.i18n.t('mock.reportPass', lang)
        : this.i18n.t('mock.reportKeepPracticing', lang);

    const topicBreakdown =
      (mockExam.topicBreakdown as unknown as Record<string, TopicBreakdownEntry> | null) ?? {};
    const topicEntries = Object.entries(topicBreakdown);

    const topicLines =
      topicEntries.length > 0
        ? topicEntries
            .map(([topic, { scored, possible }]) =>
              this.i18n.t('mock.reportTopicLine', lang, {
                topic,
                scored: String(scored),
                possible: String(possible),
                percent: String(possible > 0 ? Math.round((scored / possible) * 100) : 0),
              }),
            )
            .join('\n')
        : this.i18n.t('mock.reportNoTopicData', lang);

    const weakestTopic = this.findWeakestTopic(topicEntries);
    const weakestArea = weakestTopic ?? this.i18n.t('mock.reportNoWeakestArea', lang);

    const minutesTaken = mockExam.submittedAt
      ? Math.round((mockExam.submittedAt.getTime() - mockExam.startedAt.getTime()) / MS_PER_MINUTE)
      : 0;

    const studyTip = await this.generateStudyTip(mockExam.subject, weakestTopic, percent, lang);

    const reportText = this.i18n.t('mock.reportHeader', lang, {
      subject: mockExam.subject,
      score: String(score),
      maxScore: String(maxScore),
      percent: String(percent),
      verdict,
      minutes: String(minutesTaken),
      topicLines,
      weakestArea,
      studyTip,
    });

    return this.responseFormatter.formatForWhatsApp(reportText);
  }

  // Ties (e.g. two topics both at 0%) resolve to whichever appears first in
  // topicBreakdown's own key order, which mirrors question delivery order -
  // an arbitrary but stable and deterministic tie-break.
  private findWeakestTopic(entries: [string, TopicBreakdownEntry][]): string | null {
    let weakest: { topic: string; ratio: number } | null = null;

    for (const [topic, { scored, possible }] of entries) {
      if (possible === 0) {
        continue;
      }
      const ratio = scored / possible;
      if (!weakest || ratio < weakest.ratio) {
        weakest = { topic, ratio };
      }
    }

    return weakest?.topic ?? null;
  }

  private async generateStudyTip(
    subject: string,
    weakestTopic: string | null,
    percent: number,
    lang: Language,
  ): Promise<string> {
    try {
      return await this.llmService.generate(
        buildStudyTipPrompt(subject, weakestTopic, percent),
        'Give me a study tip.',
        { complexity: 'simple' },
      );
    } catch (error) {
      this.logger.error(
        `generateStudyTip: LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.i18n.t('mock.reportStudyTipFallback', lang);
    }
  }
}
