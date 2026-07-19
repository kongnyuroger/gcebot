import { Injectable } from '@nestjs/common';
import { DocType, Level } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';

export type QuestionType = 'MCQ' | 'STRUCTURED';

export interface PracticeFilter {
  subject: string;
  level: Level;
  topic?: string;
  // e.g. "2020-2025" - matches session.practice.yearRange verbatim; undefined
  // means any year.
  yearRange?: string;
  type?: QuestionType;
}

export interface PastQuestion {
  chunkId: string;
  questionText: string;
  year?: number;
  paper?: string;
  questionNumber?: string;
  type: QuestionType;
  markingSchemeChunkId?: string;
  topic?: string;
}

interface CandidateChunk {
  id: string;
  content: string;
  year: number | null;
  topic: string | null;
}

// Matches a chunk that starts a new question: either "Question 3" or a bare
// numbered pattern like "3." / "3)" at the very start of the content.
const QUESTION_START_PATTERN = /^\s*(?:question\s*(\d+)|(\d+)[.)])/i;

// A question is treated as MCQ if it has at least 2 lettered options
// (A./A)/B./B)/etc.) on their own line - anything else is Structured/Essay.
const MCQ_OPTION_PATTERN = /(?:^|\n)\s*[A-D][.)]\s+\S/gm;
const MIN_MCQ_OPTIONS = 2;

const PAPER_PATTERN = /paper\s*(\d+)/i;

@Injectable()
export class PastQuestionService {
  constructor(private readonly prisma: PrismaService) {}

  async getQuestion(filter: PracticeFilter, excludeIds: string[]): Promise<PastQuestion | null> {
    const yearFilter = this.buildYearFilter(filter.yearRange);

    const candidates = await this.prisma.embeddingChunk.findMany({
      where: {
        subject: filter.subject,
        level: filter.level,
        ...(filter.topic ? { topic: filter.topic } : {}),
        ...(yearFilter ? { year: yearFilter } : {}),
        id: excludeIds.length > 0 ? { notIn: excludeIds } : undefined,
        document: { docType: DocType.PAST_PAPER },
      },
      select: { id: true, content: true, year: true, topic: true },
    });

    const questions = candidates
      .map((chunk) => this.toQuestionCandidate(chunk))
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      .filter((candidate) => !filter.type || candidate.type === filter.type);

    if (questions.length === 0) {
      return null;
    }

    const selected = questions[Math.floor(Math.random() * questions.length)];

    const markingSchemeChunkId = await this.findMarkingSchemeChunkId(
      filter.subject,
      selected.chunk.year,
      selected.questionNumber,
    );

    return {
      chunkId: selected.chunk.id,
      questionText: selected.chunk.content,
      year: selected.chunk.year ?? undefined,
      paper: this.extractPaper(selected.chunk.content),
      questionNumber: selected.questionNumber,
      type: selected.type,
      markingSchemeChunkId,
      topic: selected.chunk.topic ?? undefined,
    };
  }

  private toQuestionCandidate(chunk: CandidateChunk) {
    const match = chunk.content.match(QUESTION_START_PATTERN);
    if (!match) {
      return null;
    }

    const questionNumber = match[1] ?? match[2];
    return { chunk, questionNumber, type: this.detectQuestionType(chunk.content) };
  }

  private detectQuestionType(content: string): QuestionType {
    const optionMatches = content.match(MCQ_OPTION_PATTERN) ?? [];
    return optionMatches.length >= MIN_MCQ_OPTIONS ? 'MCQ' : 'STRUCTURED';
  }

  private extractPaper(content: string): string | undefined {
    const match = content.match(PAPER_PATTERN);
    return match ? `Paper ${match[1]}` : undefined;
  }

  private buildYearFilter(yearRange?: string): { gte?: number; lte?: number } | undefined {
    if (!yearRange) {
      return undefined;
    }

    const [start, end] = yearRange.split('-').map(Number);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      return undefined;
    }

    return { gte: start, lte: end };
  }

  private async findMarkingSchemeChunkId(
    subject: string,
    year: number | null,
    questionNumber: string,
  ): Promise<string | undefined> {
    const candidates = await this.prisma.embeddingChunk.findMany({
      where: {
        subject,
        ...(year !== null ? { year } : {}),
        document: { docType: DocType.MARKING_SCHEME },
      },
      select: { id: true, content: true },
    });

    const match = candidates.find((candidate) => {
      const m = candidate.content.match(QUESTION_START_PATTERN);
      return m !== null && (m[1] ?? m[2]) === questionNumber;
    });

    return match?.id;
  }
}
