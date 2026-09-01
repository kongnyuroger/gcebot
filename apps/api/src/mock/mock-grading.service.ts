import { Injectable, Logger } from '@nestjs/common';
import { MockExamQuestion } from '@gcebot/shared';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
import { LlmService } from '../rag/services/llm.service';
import {
  parseOptions,
  normalizeStudentAnswer,
  extractCorrectAnswerLetter,
} from '../practice/mcq-grading.util';

export interface TopicBreakdownEntry {
  scored: number;
  possible: number;
}

export interface GradedExamResult {
  examId: string;
  score: number;
  maxScore: number;
  topicBreakdown: Record<string, TopicBreakdownEntry>;
}

const DEFAULT_TOPIC = 'General';

// Matches the "X out of Y" / "X/Y" mark the essay-grading prompt is
// instructed to answer with exclusively, so parsing doesn't have to contend
// with any surrounding prose.
const ESSAY_MARK_PATTERN = /(\d+)\s*(?:\/|out of)\s*(\d+)/i;

function buildEssayGradingPrompt(
  subject: string,
  question: string,
  scheme: string,
  studentAnswer: string,
  maxMarks: number,
): string {
  return (
    `Act as a GCE examiner marking this ${subject} answer out of ${maxMarks} marks.\n` +
    `Question: ${question}\n` +
    `Marking scheme: ${scheme}\n` +
    `Student's answer: ${studentAnswer}\n` +
    `Respond with ONLY the mark in the exact format "X out of ${maxMarks}" - no other text.`
  );
}

@Injectable()
export class MockGradingService {
  private readonly logger = new Logger(MockGradingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly llmService: LlmService,
  ) {}

  // Deliberately (phone, examId) rather than the task's literal gradeExam(examId):
  // the per-question answers/questions only exist in session, keyed by phone -
  // the MockExam DB row itself has no per-question storage.
  async gradeExam(phone: string, examId: string): Promise<GradedExamResult | null> {
    const session = await this.sessionService.getSession(phone);
    const mockExam = session?.mockExam;

    if (!mockExam?.questions?.length) {
      this.logger.warn(`gradeExam: no questions in session for ${phone} (examId=${examId})`);
      return null;
    }

    const questions = mockExam.questions;
    const answers = mockExam.answers ?? [];
    const subject = mockExam.subject ?? 'Unknown';

    const topicBreakdown: Record<string, TopicBreakdownEntry> = {};
    let score = 0;
    let maxScore = 0;

    for (let index = 0; index < questions.length; index++) {
      const question = questions[index];
      const answer = answers[index] ?? null;
      const topic = question.topic ?? DEFAULT_TOPIC;

      const entry = topicBreakdown[topic] ?? { scored: 0, possible: 0 };
      entry.possible += question.marks;

      const earned =
        answer === null
          ? 0
          : question.type === 'MCQ'
            ? await this.gradeMcq(question, answer)
            : await this.gradeEssay(subject, question, answer);

      entry.scored += earned;
      topicBreakdown[topic] = entry;
      score += earned;
      maxScore += question.marks;
    }

    await this.prisma.mockExam.update({
      where: { id: examId },
      data: {
        submittedAt: new Date(),
        score,
        maxScore,
        topicBreakdown: topicBreakdown as unknown as Prisma.InputJsonValue,
      },
    });

    return { examId, score, maxScore, topicBreakdown };
  }

  private async gradeMcq(question: MockExamQuestion, answer: string): Promise<number> {
    const schemeChunk = question.markingSchemeChunkId
      ? await this.prisma.embeddingChunk.findUnique({
          where: { id: question.markingSchemeChunkId },
        })
      : null;
    const correctLetter = schemeChunk
      ? extractCorrectAnswerLetter(schemeChunk.content, question.questionNumber)
      : null;

    if (!correctLetter) {
      this.logger.warn(
        `gradeMcq: no marking scheme correct answer found for chunk ${question.chunkId}`,
      );
      return 0;
    }

    const options = parseOptions(question.questionText);
    const studentLetter = normalizeStudentAnswer(answer, options);
    return studentLetter !== null && studentLetter === correctLetter ? question.marks : 0;
  }

  private async gradeEssay(
    subject: string,
    question: MockExamQuestion,
    answer: string,
  ): Promise<number> {
    const schemeChunk = question.markingSchemeChunkId
      ? await this.prisma.embeddingChunk.findUnique({
          where: { id: question.markingSchemeChunkId },
        })
      : null;

    if (!schemeChunk) {
      this.logger.warn(`gradeEssay: no marking scheme found for chunk ${question.chunkId}`);
      return 0;
    }

    try {
      const response = await this.llmService.generate(
        buildEssayGradingPrompt(
          subject,
          question.questionText,
          schemeChunk.content,
          answer,
          question.marks,
        ),
        'Mark this answer.',
        { complexity: 'complex' },
      );

      const match = response.match(ESSAY_MARK_PATTERN);
      if (!match) {
        this.logger.warn(`gradeEssay: could not parse a mark from LLM response "${response}"`);
        return 0;
      }

      const scored = Number(match[1]);
      return Number.isFinite(scored) ? Math.min(Math.max(scored, 0), question.marks) : 0;
    } catch (error) {
      this.logger.error(
        `gradeEssay: LLM grading failed for chunk ${question.chunkId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    }
  }
}
