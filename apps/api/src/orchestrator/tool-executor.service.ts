import { Injectable, Logger } from '@nestjs/common';
import { ConversationState } from '@gcebot/shared';
import { Level, Language, SubscriptionTier } from '../../generated/prisma';
import { QaService } from '../rag/services/qa.service';
import { PastQuestionService, QuestionType } from '../practice/past-question.service';
import { PracticeGradingService } from '../practice/practice-grading.service';
import { MockPaperService } from '../mock/mock-paper.service';
import { UsersService } from '../users/users.service';
import { SessionService } from '../session/session.service';
import { StateTransitionService } from '../session/state-transition.service';
import { ProgressStatsService, WEAK_ACCURACY_THRESHOLD } from '../progress/progress-stats.service';
import { QuotaService } from '../quota/quota.service';
import { TOOL_NAMES, ToolName } from './tools/tool-definitions';

const PREMIUM_TIERS: SubscriptionTier[] = [SubscriptionTier.PREMIUM, SubscriptionTier.FAMILY];
const WEAKEST_TOPIC_COUNT = 3;

// Bridges the model's tool calls to real services and returns a plain,
// JSON-serializable result the orchestrator loop (step 6) hands back to the
// LLM as the tool's role:"tool" content. Reads/writes session state directly
// (rather than returning "patch" instructions for a caller to apply) to
// match how every other handler in this codebase already works - see
// PracticeModeHandler/MockExamHandler for the same pattern.
//
// Every branch is defensive about missing args/session state and returns
// `{ error: ... }` instead of throwing - a malformed tool call or a stale
// session must never surface a raw exception into the tool-calling loop.
@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  constructor(
    private readonly qaService: QaService,
    private readonly pastQuestionService: PastQuestionService,
    private readonly practiceGradingService: PracticeGradingService,
    private readonly mockPaperService: MockPaperService,
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly stateTransitionService: StateTransitionService,
    private readonly progressStatsService: ProgressStatsService,
    private readonly quotaService: QuotaService,
  ) {}

  async execute(toolName: ToolName, args: Record<string, unknown>, phone: string): Promise<object> {
    try {
      switch (toolName) {
        case TOOL_NAMES.ANSWER_QUESTION:
          return await this.answerQuestion(phone, args);
        case TOOL_NAMES.GET_PRACTICE_QUESTION:
          return await this.getPracticeQuestion(phone, args);
        case TOOL_NAMES.GRADE_ANSWER:
          return await this.gradeAnswer(phone, args);
        case TOOL_NAMES.START_MOCK_EXAM:
          return await this.startMockExam(phone, args);
        case TOOL_NAMES.SHOW_PROGRESS:
          return await this.showProgress(phone);
        case TOOL_NAMES.UPDATE_PROFILE:
          return await this.updateProfile(phone, args);
        case TOOL_NAMES.START_SUBSCRIPTION:
          return this.startSubscription();
        default:
          return { error: `Unknown tool: ${String(toolName)}` };
      }
    } catch (error) {
      this.logger.error(
        `Tool execution failed (tool=${toolName}, phone=${phone}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { error: 'Something went wrong handling that request. Try again in a moment.' };
    }
  }

  private async answerQuestion(phone: string, args: Record<string, unknown>): Promise<object> {
    const question = typeof args.question === 'string' ? args.question.trim() : '';
    if (!question) {
      return { error: 'No question was provided.' };
    }
    const subject = typeof args.subject === 'string' ? args.subject : undefined;

    // Mirrors QaModeHandler.handleQuestion's server-side gate - FREE tier's
    // daily question limit must be enforced here too, not just left to the
    // model's own judgment from whatever the system prompt says its quota
    // is (same "always call through, let the tool decide" reasoning as
    // start_mock_exam's tier gate above).
    const quota = await this.quotaService.checkQuota(phone);
    if (!quota.allowed) {
      return {
        allowed: false,
        quotaExceeded: true,
        used: quota.used,
        limit: quota.limit,
        message:
          'The student has used all their free questions for today - relay this warmly as an ' +
          'upgrade opportunity (Basic tier gives unlimited questions), never as a failure.',
      };
    }

    // The orchestrator (OrchestratorService.persistHistory) owns
    // conversationHistory for this turn - QaService must not also write its
    // own {question, rawAnswer} pair, or history ends up with two
    // conflicting versions of the same exchange (the RAG answer verbatim,
    // and the orchestrator's own possibly-paraphrased final reply).
    const parts = await this.qaService.answerQuestion(phone, question, subject, {
      updateHistory: false,
    });
    return { answer: parts.join('\n\n') };
  }

  private async getPracticeQuestion(phone: string, args: Record<string, unknown>): Promise<object> {
    const subject = typeof args.subject === 'string' ? args.subject : undefined;
    if (!subject) {
      return { error: 'A subject is required to fetch a practice question.' };
    }

    const user = await this.usersService.getUserProfile(phone);
    if (!user) {
      return { error: 'Could not find the student profile.' };
    }

    const session = await this.sessionService.getSession(phone);
    const seenIds = session?.practice?.seenIds ?? [];

    const topic = typeof args.topic === 'string' ? args.topic : undefined;
    const type = args.type === 'MCQ' || args.type === 'STRUCTURED' ? args.type : undefined;
    const year = typeof args.year === 'number' ? args.year : undefined;
    const yearRange = year !== undefined ? `${year}-${year}` : undefined;

    const question = await this.pastQuestionService.getQuestion(
      { subject, level: user.level, topic, yearRange, type },
      seenIds,
    );

    if (!question) {
      return {
        error: `No unseen ${subject} practice questions are available right now for those filters.`,
      };
    }

    // Persisted as the active question so grade_answer (a later, separate
    // tool call - possibly in the student's next WhatsApp message) can read
    // it back, exactly like the existing WhatsApp practice flow's
    // ANSWER_EVALUATION state.
    await this.sessionService.updateSessionField(phone, 'currentQuestionId', question.chunkId);
    await this.sessionService.updateSessionField(
      phone,
      'currentQuestionText',
      question.questionText,
    );
    await this.sessionService.updateSessionField(
      phone,
      'markingSchemeChunkId',
      question.markingSchemeChunkId,
    );
    await this.sessionService.updateSessionField(phone, 'questionType', question.type);
    await this.sessionService.updateSessionField(
      phone,
      'currentQuestionTopic',
      question.topic ?? topic,
    );
    await this.sessionService.updateSessionField(phone, 'practice', {
      ...session?.practice,
      subject,
      topic: question.topic ?? topic,
      seenIds: [...seenIds, question.chunkId],
    });

    return {
      questionText: question.questionText,
      year: question.year,
      questionNumber: question.questionNumber,
      type: question.type,
    };
  }

  private async gradeAnswer(phone: string, args: Record<string, unknown>): Promise<object> {
    const studentAnswer = typeof args.studentAnswer === 'string' ? args.studentAnswer.trim() : '';
    if (!studentAnswer) {
      return { error: 'No answer was provided to grade.' };
    }

    const [user, session] = await Promise.all([
      this.usersService.getUserProfile(phone),
      this.sessionService.getSession(phone),
    ]);

    if (!session?.currentQuestionText || !session.questionType) {
      return { error: 'There is no active practice question to grade right now.' };
    }

    const result = await this.practiceGradingService.gradeAnswer({
      phone,
      questionText: session.currentQuestionText,
      markingSchemeChunkId: session.markingSchemeChunkId,
      questionType: session.questionType as QuestionType,
      subject: session.practice?.subject ?? 'Unknown',
      topic: session.currentQuestionTopic ?? session.practice?.topic ?? 'General',
      answerText: studentAnswer,
      language: user?.language ?? Language.EN,
    });

    return { correct: result.correct, feedback: result.feedback };
  }

  private async startMockExam(phone: string, args: Record<string, unknown>): Promise<object> {
    const subject = typeof args.subject === 'string' ? args.subject : undefined;
    if (!subject) {
      return { error: 'A subject is required to start a mock exam.' };
    }

    const user = await this.usersService.getUserProfile(phone);
    if (!user) {
      return { error: 'Could not find the student profile.' };
    }

    if (!PREMIUM_TIERS.includes(user.tier)) {
      return {
        started: false,
        requiresUpgrade: true,
        message:
          'Mock exams are a Premium/Family feature - relay this warmly as an upgrade path, not a failure.',
      };
    }

    let paper;
    try {
      paper = await this.mockPaperService.assemblePaper(phone, subject, user.level as Level);
    } catch {
      return {
        started: false,
        error: `No past-paper content is available yet to build a ${subject} mock exam.`,
      };
    }

    // Mirrors MockExamHandler.assembleAndPromptReady's session shape exactly,
    // so the existing MOCK_EXAM_SETUP flow (Start/Cancel buttons, timers,
    // grading, report) can take over once the router hands control back to
    // it (step 7). NOTE (flagged for step 7, not resolved here): that
    // handler recognizes Start/Cancel only via WhatsApp button-tap ids
    // (MOCK_START_EXAM/MOCK_CANCEL_EXAM), not free text - how the
    // orchestrator's own reply prompts for that tap is a router/handoff
    // decision, not a tool-executor one.
    await this.stateTransitionService.transition(phone, ConversationState.MOCK_EXAM_SETUP);
    await this.sessionService.updateSessionField(phone, 'examId', paper.examId);
    await this.sessionService.updateSessionField(phone, 'mockExam', {
      subject,
      paperType: paper.paperType,
      durationMinutes: paper.durationMinutes,
      questions: paper.questions,
      currentIndex: 0,
      answers: [],
    });

    return {
      started: true,
      subject,
      paperType: paper.paperType,
      durationMinutes: paper.durationMinutes,
      questionCount: paper.questions.length,
      totalMarks: paper.totalMarks,
    };
  }

  private async showProgress(phone: string): Promise<object> {
    const user = await this.usersService.getUserProfile(phone);
    if (!user) {
      return { error: 'Could not find the student profile.' };
    }

    const stats = await this.progressStatsService.getTopicStats(phone);
    if (stats.length === 0) {
      return { hasActivity: false };
    }

    const totalCorrect = stats.reduce((sum, stat) => sum + stat.correct, 0);
    const totalQuestions = stats.reduce((sum, stat) => sum + stat.total, 0);

    const weakestTopics = [...stats]
      .filter((stat) => stat.accuracy < WEAK_ACCURACY_THRESHOLD)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, WEAKEST_TOPIC_COUNT)
      .map((stat) => ({
        subject: stat.subject,
        topic: stat.topic,
        accuracyPercent: Math.round(stat.accuracy * 100),
      }));

    return {
      hasActivity: true,
      overallAccuracyPercent: Math.round((totalCorrect / totalQuestions) * 100),
      totalQuestionsAnswered: totalQuestions,
      streakDays: user.streakDays,
      topics: stats.map((stat) => ({
        subject: stat.subject,
        topic: stat.topic,
        correct: stat.correct,
        total: stat.total,
        accuracyPercent: Math.round(stat.accuracy * 100),
      })),
      weakestTopics,
    };
  }

  private async updateProfile(phone: string, args: Record<string, unknown>): Promise<object> {
    const updated: string[] = [];

    if (args.level === 'O_LEVEL' || args.level === 'A_LEVEL') {
      await this.usersService.updateLevel(phone, args.level as Level);
      updated.push('level');
    }

    if (Array.isArray(args.subjects) && args.subjects.every((s) => typeof s === 'string')) {
      await this.usersService.updateSubjects(phone, args.subjects as string[]);
      updated.push('subjects');
    }

    if (args.language === 'EN' || args.language === 'FR') {
      await this.usersService.updateLanguage(phone, args.language as Language);
      updated.push('language');
    }

    if (updated.length === 0) {
      return { error: 'No valid profile fields were provided to update.' };
    }

    return { updated };
  }

  private startSubscription(): object {
    return {
      available: false,
      message:
        "Subscriptions aren't wired up yet - payments haven't been implemented. Tell the " +
        "student it's coming soon; never imply the upgrade went through.",
    };
  }
}
