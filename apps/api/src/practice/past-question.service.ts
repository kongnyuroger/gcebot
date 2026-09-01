import { Injectable } from '@nestjs/common';
import { DocType, Level } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { extractAnswerKeyLetter } from './mcq-grading.util';

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
  paperNumber: number | null;
}

// Matches a chunk that starts a new question: either "Question 3" or a bare
// numbered pattern like "3." / "3)" at the very start of the content.
const QUESTION_START_PATTERN = /^\s*(?:question\s*(\d+)|(\d+)[.)])/i;

// Finds where the NEXT question begins, anywhere in a chunk - short MCQs are
// dense enough that ChunkingService's 500-800 token target routinely packs
// 2-3 of them into one chunk. Without trimming to this boundary, "one"
// served question would actually be several concatenated ones (confirmed
// live: a chunk containing "...D Last in last out approach. 19. Which of
// the following..." served as a single practice question).
//
// PDF extraction for these documents does not preserve line breaks between
// questions - everything runs on as one line, so (unlike QUESTION_START_PATTERN,
// which only ever needs to match at position 0) this can't anchor on a
// preceding newline. Instead it requires the number to be preceded by
// terminal punctuation + a space (the end of the previous question's last
// option, e.g. "...Caches. 10. The fastest...") and followed by a space -
// this is what actually distinguishes a new question's number from a bare
// digit inside option text, since every observed option is letter-prefixed
// (A/B/C/D), never a bare number.
const NEXT_QUESTION_PATTERN = /[.?!]\s+(?=(?:question\s*\d+\b|\d+[.)])\s)/gi;

// A question is treated as MCQ if it has at least 2 lettered options
// (A./A)/B./B)/etc.) - anything else is Structured/Essay. Matches an option
// either on its own line (newline-preceded, for content that DOES preserve
// line breaks) or, like NEXT_QUESTION_PATTERN above, preceded by a
// colon/period/question-mark + a space (for the flat single-line extraction
// this ingested content actually has, and where the letter is often not
// even followed by punctuation - "A MDR. B IR. C PC. D MAR." has no
// newlines and no ".)" after the letters at all). \b...\b around the letter
// is required, not optional: without it, a lone capital letter preceded by
// ". " matches the start of an ordinary word too (". Decoded" would
// otherwise register "D" as an option). This only needs to catch 2 of the
// (up to) 4 options to classify correctly - some formatting styles run the
// first option straight off the question stem with no punctuation at all
// ("...network A reliability."), which this deliberately does NOT try to
// catch (a bare preceding space is far too common in ordinary English to
// use as a boundary) - but B/C/D are reliably punctuation-preceded either
// way, which alone clears MIN_MCQ_OPTIONS. Verified against real ingested
// content across every formatting style actually seen.
const MCQ_OPTION_PATTERN = /(?:^|\n|[:.?]\s)\s*\b[A-D]\b[.)]?\s+\S/gim;
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
      select: { id: true, content: true, year: true, topic: true, paperNumber: true },
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
      selected.chunk.paperNumber,
      selected.questionNumber,
    );

    return {
      chunkId: selected.chunk.id,
      questionText: selected.questionText,
      year: selected.chunk.year ?? undefined,
      paper: selected.chunk.paperNumber
        ? `Paper ${selected.chunk.paperNumber}`
        : this.extractPaper(selected.chunk.content),
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
    const questionText = this.extractFirstQuestion(chunk.content);
    return { chunk, questionNumber, questionText, type: this.detectQuestionType(questionText) };
  }

  // Trims a chunk down to just its first question, cutting at the next
  // question-start boundary found anywhere in the content (see
  // NEXT_QUESTION_PATTERN) - or returns the whole (trimmed) chunk unchanged
  // if it only contains one question to begin with.
  private extractFirstQuestion(content: string): string {
    NEXT_QUESTION_PATTERN.lastIndex = 0;
    const match = NEXT_QUESTION_PATTERN.exec(content);
    // The match itself is just "<terminal punctuation><whitespace>" (the
    // next question's number is a lookahead, not consumed) - cut right after
    // it, so the punctuation stays with the first question and the next
    // question's number is excluded.
    return (match ? content.slice(0, match.index + match[0].length) : content).trim();
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
    paperNumber: number | null,
    questionNumber: string,
  ): Promise<string | undefined> {
    const candidates = await this.prisma.embeddingChunk.findMany({
      where: {
        subject,
        ...(year !== null ? { year } : {}),
        ...(paperNumber !== null ? { paperNumber } : {}),
        document: { docType: DocType.MARKING_SCHEME },
      },
      select: { id: true, content: true },
    });

    const match = candidates.find((candidate) => {
      const m = candidate.content.match(QUESTION_START_PATTERN);
      if (m !== null && (m[1] ?? m[2]) === questionNumber) {
        return true;
      }
      // Some marking schemes are one compact "1. B 11. D 21. A ..." answer-key
      // table per document rather than one scheme chunk per question, so the
      // chunk never itself starts with this specific question's number - see
      // extractAnswerKeyLetter's own comment for why (confirmed live).
      return extractAnswerKeyLetter(candidate.content, questionNumber) !== null;
    });

    return match?.id;
  }
}
