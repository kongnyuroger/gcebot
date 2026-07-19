import { Injectable, NotFoundException } from '@nestjs/common';
import { DocType, Level } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { PastQuestionService, PastQuestion } from '../practice/past-question.service';

export interface MockPaper {
  // Not in the task's literal interface, but callers need it to create the
  // session record and later grade/report against the right MockExam row -
  // there's no way around returning it alongside the rest.
  examId: string;
  questions: PastQuestion[];
  totalMarks: number;
  durationMinutes: number;
  paperType: string;
}

interface PaperTypeInfo {
  label: string;
  durationMinutes: number;
}

// Standard GCE paper durations, keyed by the paper number parsed from
// question content (PastQuestionService.extractPaper -> "Paper N").
const PAPER_TYPES_BY_NUMBER: Record<string, PaperTypeInfo> = {
  '1': { label: 'MCQ Paper 1', durationMinutes: 90 },
  '2': { label: 'Structured Paper 2', durationMinutes: 120 },
  '3': { label: 'Essay Paper 3', durationMinutes: 150 },
};

const MARKS_PATTERN = /\[(\d+)\s*marks?\]/i;
const DEFAULT_MCQ_MARKS = 1;
const DEFAULT_STRUCTURED_MARKS = 10;

// Safety cap on how many questions one assembled paper can contain - real
// papers are nowhere near this size; it just bounds the exclude-and-refetch
// loop below against pathological data.
const MAX_QUESTIONS_PER_PAPER = 50;

@Injectable()
export class MockPaperService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pastQuestionService: PastQuestionService,
  ) {}

  async assemblePaper(phone: string, subject: string, level: Level): Promise<MockPaper> {
    const year = await this.pickYear(subject, level);
    const yearRange = year !== null ? `${year}-${year}` : undefined;

    const questions: PastQuestion[] = [];
    const excludeIds: string[] = [];

    while (questions.length < MAX_QUESTIONS_PER_PAPER) {
      const question = await this.pastQuestionService.getQuestion(
        { subject, level, yearRange },
        excludeIds,
      );
      if (!question) {
        break;
      }
      questions.push(question);
      excludeIds.push(question.chunkId);
    }

    if (questions.length === 0) {
      throw new NotFoundException(
        `No past questions available to assemble a mock exam for ${subject} (${level})`,
      );
    }

    const { label: paperType, durationMinutes } = this.determinePaperType(questions);
    const totalMarks = questions.reduce((sum, question) => sum + this.extractMarks(question), 0);

    const exam = await this.prisma.mockExam.create({
      data: { userId: phone, subject, level, startedAt: new Date() },
    });

    return { examId: exam.id, questions, totalMarks, durationMinutes, paperType };
  }

  // Called when a student cancels at the Ready?/Start/Cancel prompt, so an
  // abandoned-before-it-started exam doesn't pollute exam history/reporting.
  async discardExam(examId: string): Promise<void> {
    await this.prisma.mockExam.delete({ where: { id: examId } });
  }

  // Picks the year with the most available past-paper content for this
  // subject+level (tie-broken by most recent), so the assembled paper reads
  // as "one coherent year's paper" rather than a random cross-year mix.
  private async pickYear(subject: string, level: Level): Promise<number | null> {
    const rows = await this.prisma.embeddingChunk.findMany({
      where: { subject, level, year: { not: null }, document: { docType: DocType.PAST_PAPER } },
      select: { year: true },
    });

    if (rows.length === 0) {
      return null;
    }

    const counts = new Map<number, number>();
    for (const row of rows) {
      if (row.year !== null) {
        counts.set(row.year, (counts.get(row.year) ?? 0) + 1);
      }
    }

    const [bestYear] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    return bestYear[0];
  }

  // Majority-votes the "Paper N" label detected across the assembled
  // questions; falls back to inferring MCQ-vs-Structured from the majority
  // detected question type when no paper label is present anywhere (there's
  // no signal in that case to distinguish Structured from Essay specifically).
  private determinePaperType(questions: PastQuestion[]): PaperTypeInfo {
    const paperNumberCounts = new Map<string, number>();
    for (const question of questions) {
      const match = question.paper?.match(/(\d+)/);
      if (match) {
        paperNumberCounts.set(match[1], (paperNumberCounts.get(match[1]) ?? 0) + 1);
      }
    }

    if (paperNumberCounts.size > 0) {
      const [topNumber] = [...paperNumberCounts.entries()].sort((a, b) => b[1] - a[1]);
      const paperType = PAPER_TYPES_BY_NUMBER[topNumber[0]];
      if (paperType) {
        return paperType;
      }
    }

    const mcqCount = questions.filter((question) => question.type === 'MCQ').length;
    return mcqCount >= questions.length / 2
      ? PAPER_TYPES_BY_NUMBER['1']
      : PAPER_TYPES_BY_NUMBER['2'];
  }

  private extractMarks(question: PastQuestion): number {
    const match = question.questionText.match(MARKS_PATTERN);
    if (match) {
      return Number(match[1]);
    }
    return question.type === 'MCQ' ? DEFAULT_MCQ_MARKS : DEFAULT_STRUCTURED_MARKS;
  }
}
