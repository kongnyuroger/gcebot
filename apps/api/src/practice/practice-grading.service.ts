import { Injectable, Logger } from '@nestjs/common';
import { InteractionType, Language } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { I18nService } from '../i18n/i18n.service';
import { LlmService } from '../rag/services/llm.service';
import { QuestionType } from './past-question.service';
import { TopicScoreService } from './topic-score.service';
import {
  parseOptions,
  normalizeStudentAnswer,
  extractCorrectAnswerLetter,
  extractSchemeExplanation,
  extractQuestionNumber,
} from './mcq-grading.util';

export interface GradeAnswerInput {
  phone: string;
  questionText: string;
  markingSchemeChunkId?: string;
  questionType: QuestionType;
  subject: string;
  topic: string;
  answerText: string;
  language: Language;
}

export interface GradeAnswerResult {
  // null = grading genuinely couldn't happen (no marking scheme found, or no
  // correct letter could be extracted from it) - distinct from `false`
  // (graded, and wrong).
  correct: boolean | null;
  // Ready-to-send feedback text, un-chunked - callers split it for their own
  // delivery channel (WhatsApp's 4096-char limit, an orchestrator tool
  // result, etc.) rather than this service assuming one.
  feedback: string;
}

// Extracted out of PracticeModeHandler (previously handleMcqAnswer/
// handleEssayAnswer/extractEstimatedCorrectness, done inline in the WhatsApp
// handler) into its own service - both the existing WhatsApp flow and the
// upcoming orchestrator's grade_answer tool need the exact same grade+persist
// behavior, and duplicating it risked the two drifting apart. The handler
// still owns everything WhatsApp-specific (formatting/chunking/sending the
// returned feedback, post-answer navigation); this service owns only the
// grading decision and its persistence (Interaction log + topic score).
const ESTIMATED_MARK_PATTERN = /estimated mark:?\s*(\d+)\s*(?:\/|out of)\s*(\d+)/i;
const PASSING_MARK_RATIO = 0.5;

function buildWrongAnswerPrompt(
  subject: string,
  question: string,
  scheme: string,
  studentAnswer: string,
  correctLetter: string,
): string {
  return (
    `Act as a GCE examiner marking a multiple-choice ${subject} question. ` +
    `Question: ${question}\nMarking scheme: ${scheme}\nStudent's answer: ${studentAnswer}\n` +
    `Correct answer: ${correctLetter}\n` +
    `Explain the concept and why ${correctLetter} is correct. Keep it to 1-3 sentences.`
  );
}

function buildEssayFeedbackPrompt(
  subject: string,
  question: string,
  scheme: string,
  studentAnswer: string,
): string {
  return (
    `Act as a GCE examiner marking this ${subject} answer.\n` +
    `Question: ${question}\n` +
    `Marking scheme: ${scheme}\n` +
    `Student's answer: ${studentAnswer}\n` +
    'Provide feedback as:\n' +
    '✅ Points you got right: [list]\n' +
    '⚠️ Points you missed: [list]\n' +
    '📊 Estimated mark: [X out of Y]\n' +
    '💡 One tip to improve: [tip]'
  );
}

@Injectable()
export class PracticeGradingService {
  private readonly logger = new Logger(PracticeGradingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly i18n: I18nService,
    private readonly topicScoreService: TopicScoreService,
  ) {}

  async gradeAnswer(input: GradeAnswerInput): Promise<GradeAnswerResult> {
    if (input.questionType === 'MCQ') {
      return this.gradeMcq(input);
    }
    return this.gradeEssay(input);
  }

  private async gradeMcq(input: GradeAnswerInput): Promise<GradeAnswerResult> {
    const { phone, questionText, markingSchemeChunkId, subject, topic, answerText, language } =
      input;

    const options = parseOptions(questionText);
    const studentLetter = normalizeStudentAnswer(answerText, options);

    const schemeChunk = markingSchemeChunkId
      ? await this.prisma.embeddingChunk.findUnique({ where: { id: markingSchemeChunkId } })
      : null;
    const correctLetter = schemeChunk
      ? extractCorrectAnswerLetter(
          schemeChunk.content,
          extractQuestionNumber(questionText) ?? undefined,
        )
      : null;

    if (!correctLetter) {
      this.logger.warn(
        `Could not determine the correct MCQ answer for ${phone} (markingSchemeChunkId=${markingSchemeChunkId})`,
      );
      await this.logInteraction(input, null);
      return { correct: null, feedback: this.i18n.t('practice.mcqGradingUnavailable', language) };
    }

    const isCorrect = studentLetter !== null && studentLetter === correctLetter;
    const schemeExplanation = extractSchemeExplanation(schemeChunk!.content);

    const feedback = isCorrect
      ? this.i18n.t('practice.mcqCorrect', language, { explanation: schemeExplanation })
      : this.i18n.t('practice.mcqWrong', language, {
          correctLetter,
          // Wrong answers get a real LLM explanation of the concept, not just
          // the raw scheme text - this is the actual teaching moment.
          explanation: await this.llmService.generate(
            buildWrongAnswerPrompt(
              subject,
              questionText,
              schemeChunk!.content,
              answerText,
              correctLetter,
            ),
            'Explain why my answer was wrong.',
            { complexity: 'simple' },
          ),
        });

    await this.logInteraction(input, isCorrect);
    await this.topicScoreService.recordResult(phone, subject, topic, isCorrect);

    return { correct: isCorrect, feedback };
  }

  private async gradeEssay(input: GradeAnswerInput): Promise<GradeAnswerResult> {
    const { phone, questionText, markingSchemeChunkId, subject, topic, answerText, language } =
      input;

    const schemeChunk = markingSchemeChunkId
      ? await this.prisma.embeddingChunk.findUnique({ where: { id: markingSchemeChunkId } })
      : null;

    if (!schemeChunk) {
      this.logger.warn(
        `No marking scheme found for ${phone}'s structured question (markingSchemeChunkId=${markingSchemeChunkId})`,
      );
      await this.logInteraction(input, null);
      return { correct: null, feedback: this.i18n.t('practice.essayGradingUnavailable', language) };
    }

    const feedback = await this.llmService.generate(
      buildEssayFeedbackPrompt(subject, questionText, schemeChunk.content, answerText),
      'Provide feedback on my answer.',
      { complexity: 'complex' },
    );

    const estimatedCorrect = this.extractEstimatedCorrectness(feedback);

    await this.logInteraction(input, estimatedCorrect);
    if (estimatedCorrect !== null) {
      await this.topicScoreService.recordResult(phone, subject, topic, estimatedCorrect);
    }

    return { correct: estimatedCorrect, feedback };
  }

  private extractEstimatedCorrectness(feedback: string): boolean | null {
    const match = feedback.match(ESTIMATED_MARK_PATTERN);
    if (!match) {
      return null;
    }

    const scored = Number(match[1]);
    const total = Number(match[2]);
    if (!Number.isFinite(scored) || !Number.isFinite(total) || total === 0) {
      return null;
    }

    return scored / total >= PASSING_MARK_RATIO;
  }

  private async logInteraction(input: GradeAnswerInput, correct: boolean | null): Promise<void> {
    await this.prisma.interaction.create({
      data: {
        userId: input.phone,
        type: InteractionType.PRACTICE,
        subject: input.subject,
        topic: input.topic,
        questionText: input.questionText,
        userAnswer: input.answerText,
        correct,
      },
    });
  }
}
