import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConversationState, SessionContext } from '@gcebot/shared';
import { DocType, InteractionType, Language, Level } from '../../generated/prisma';
import { ParsedMessage } from '../whatsapp/services/message-parser.service';
import { WhatsappSendService, WhatsAppListRow } from '../whatsapp/services/whatsapp-send.service';
import { SessionService } from '../session/session.service';
import { StateTransitionService } from '../session/state-transition.service';
import { UsersService } from '../users/users.service';
import { I18nService } from '../i18n/i18n.service';
import { PrismaService } from '../prisma/prisma.service';
import { PastQuestionService, PastQuestion, QuestionType } from '../practice/past-question.service';
import { TopicWeaknessService } from '../practice/topic-weakness.service';
import { TopicScoreService } from '../practice/topic-score.service';
import {
  QUESTION_PREFIX_PATTERN,
  parseOptions,
  normalizeStudentAnswer,
  extractCorrectAnswerLetter,
  extractSchemeExplanation,
} from '../practice/mcq-grading.util';
import { LlmService } from '../rag/services/llm.service';
import { ResponseFormatterService } from '../rag/services/response-formatter.service';
import { StreakService } from '../progress/streak.service';
import { MilestoneService } from '../progress/milestone.service';
import { MainMenuHandler } from './main-menu.handler';
import { chunk, MAX_LIST_ROWS_PER_MESSAGE } from './subjects.constants';

const MAX_SUBJECT_BUTTONS = 3;

export const TOPIC_ALL = 'ALL_TOPICS';
export const TOPIC_SURPRISE_ME = 'SURPRISE_ME';
export const POST_ANSWER_NEXT = 'practice_next_question';
export const POST_ANSWER_RETRY_TOPIC = 'practice_retry_topic';
export const POST_ANSWER_CHANGE_SUBJECT = 'practice_change_subject';
export const POST_ANSWER_MAIN_MENU = 'practice_main_menu';
export const YEAR_RANGE_2020_2025 = '2020-2025';
export const YEAR_RANGE_2015_2020 = '2015-2020';
export const YEAR_RANGE_2010_2015 = '2010-2015';
export const YEAR_ANY = 'ANY_YEAR';
const VALID_YEAR_RANGES = [
  YEAR_RANGE_2020_2025,
  YEAR_RANGE_2015_2020,
  YEAR_RANGE_2010_2015,
  YEAR_ANY,
];
export const TYPE_MCQ = 'MCQ';
export const TYPE_STRUCTURED = 'STRUCTURED';
export const TYPE_ANY = 'ANY_TYPE';
const VALID_TYPES = [TYPE_MCQ, TYPE_STRUCTURED, TYPE_ANY];

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

// Parses the "📊 Estimated mark: X out of Y" (or "X/Y") line the LLM was
// instructed to produce, to derive a pass/fail boolean for Interaction.correct.
const ESTIMATED_MARK_PATTERN = /estimated mark:?\s*(\d+)\s*(?:\/|out of)\s*(\d+)/i;
const PASSING_MARK_RATIO = 0.5;

@Injectable()
export class PracticeModeHandler {
  private readonly logger = new Logger(PracticeModeHandler.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly stateTransitionService: StateTransitionService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly i18n: I18nService,
    private readonly prisma: PrismaService,
    private readonly pastQuestionService: PastQuestionService,
    private readonly llmService: LlmService,
    private readonly responseFormatter: ResponseFormatterService,
    private readonly topicWeaknessService: TopicWeaknessService,
    private readonly topicScoreService: TopicScoreService,
    private readonly streakService: StreakService,
    private readonly milestoneService: MilestoneService,
    // MainMenuHandler already depends on PracticeModeHandler (to enter
    // PRACTICE_FILTER from the main menu tap) - forwardRef breaks the
    // resulting circular DI edge, since this handler also needs
    // MainMenuHandler.sendMenu() for the "Main Menu" post-answer option.
    @Inject(forwardRef(() => MainMenuHandler))
    private readonly mainMenuHandler: MainMenuHandler,
  ) {}

  // Reachable both from a MAIN_MENU button tap and the global /practice
  // command (wired in a later step) - resets the session directly into
  // PRACTICE_FILTER, the same escape-hatch pattern as QaModeHandler.enterQaMode.
  async enterPracticeMode(phone: string): Promise<void> {
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    await this.sessionService.setSession(phone, {
      state: ConversationState.PRACTICE_FILTER,
      practice: { seenIds: [] },
      currentQuestionId: undefined,
      currentQuestionText: undefined,
      currentQuestionTopic: undefined,
      questionType: undefined,
      markingSchemeChunkId: undefined,
    });

    if (!user) {
      this.logger.warn(`enterPracticeMode: no user profile found for ${phone}`);
      return;
    }

    if (user.subjects.length === 0) {
      await this.whatsappSendService.sendText(
        phone,
        this.i18n.t('practice.noSubjectsRegistered', lang),
      );
      return;
    }

    await this.sendSubjectPrompt(phone, user.subjects, lang);
  }

  async handleSubjectSelection(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const selectedSubject = message.buttonId ?? message.listId;
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    if (!selectedSubject || !user?.subjects.includes(selectedSubject)) {
      this.logger.warn(
        `Unrecognized practice subject selection "${selectedSubject}" from ${phone}`,
      );
      return this.sendSubjectPrompt(phone, user?.subjects ?? [], lang);
    }

    await this.sessionService.updateSessionField(phone, 'practice', {
      seenIds: [],
      subject: selectedSubject,
    });
    await this.stateTransitionService.transition(phone, ConversationState.PRACTICE_TOPIC);

    const topics = await this.listTopics(selectedSubject, user.level);
    if (topics.length === 0) {
      // No ingested past-paper content for this subject yet. Not a dead end -
      // still show the topic prompt (with just "All Topics") so the flow
      // continues; Step 2's retrieval will simply find no questions later.
      await this.whatsappSendService.sendText(
        phone,
        this.i18n.t('practice.noTopicsAvailable', lang, { subject: selectedSubject }),
      );
    }

    await this.sendTopicPrompt(phone, topics, lang);
  }

  async handleTopicSelection(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const selectedTopic = message.listId;
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;
    const session = await this.sessionService.getSession(phone);

    if (!selectedTopic) {
      this.logger.warn(`Practice topic selection from ${phone} had no listId`);
      const topics = session?.practice?.subject
        ? await this.listTopics(session.practice.subject, user?.level ?? Level.O_LEVEL)
        : [];
      return this.sendTopicPrompt(phone, topics, lang);
    }

    let topic: string | undefined;
    if (selectedTopic === TOPIC_ALL) {
      topic = undefined;
    } else if (selectedTopic === TOPIC_SURPRISE_ME) {
      topic = await this.pickWeaknessWeightedTopic(
        phone,
        session?.practice?.subject ?? '',
        user?.level ?? Level.O_LEVEL,
      );
    } else {
      topic = selectedTopic;
    }

    await this.sessionService.updateSessionField(phone, 'practice', {
      ...session?.practice,
      topic,
    });
    await this.stateTransitionService.transition(phone, ConversationState.PRACTICE_YEAR);

    await this.sendYearRangePrompt(phone, lang);
  }

  // "Surprise Me" - weighted toward the student's weaker topics (<60%
  // accuracy), but not exclusively; falls back to a plain random topic when
  // there's no PRACTICE performance history yet for this subject.
  private async pickWeaknessWeightedTopic(
    phone: string,
    subject: string,
    level: Level,
  ): Promise<string | undefined> {
    const weakTopics = await this.topicWeaknessService.getWeakTopics(phone, subject);
    const weightedPick = this.topicWeaknessService.pickWeightedRandomTopic(weakTopics);
    if (weightedPick) {
      return weightedPick;
    }

    const allTopics = await this.listTopics(subject, level);
    if (allTopics.length === 0) {
      return undefined;
    }
    return allTopics[Math.floor(Math.random() * allTopics.length)];
  }

  async handleYearSelection(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const selectedYearRange = message.listId;
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;
    const session = await this.sessionService.getSession(phone);

    if (!selectedYearRange || !VALID_YEAR_RANGES.includes(selectedYearRange)) {
      this.logger.warn(`Unrecognized year range selection "${selectedYearRange}" from ${phone}`);
      return this.sendYearRangePrompt(phone, lang);
    }

    const yearRange = selectedYearRange === YEAR_ANY ? undefined : selectedYearRange;
    await this.sessionService.updateSessionField(phone, 'practice', {
      ...session?.practice,
      yearRange,
    });
    await this.stateTransitionService.transition(phone, ConversationState.PRACTICE_TYPE);

    await this.sendTypePrompt(phone, lang);
  }

  async handleTypeSelection(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const selectedType = message.buttonId;
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;
    const session = await this.sessionService.getSession(phone);

    if (!selectedType || !VALID_TYPES.includes(selectedType)) {
      this.logger.warn(`Unrecognized practice type selection "${selectedType}" from ${phone}`);
      return this.sendTypePrompt(phone, lang);
    }

    const type = selectedType === TYPE_ANY ? undefined : selectedType;
    await this.sessionService.updateSessionField(phone, 'practice', {
      ...session?.practice,
      type,
    });
    await this.stateTransitionService.transition(phone, ConversationState.QUESTION_DELIVERY);

    await this.deliverQuestion(phone);
  }

  // Public: also reused by the "Next Question" follow-up button once
  // post-answer navigation lands (later step in this branch).
  async deliverQuestion(phone: string): Promise<void> {
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;
    const session = await this.sessionService.getSession(phone);
    const practice = session?.practice;

    if (!user || !practice?.subject) {
      this.logger.warn(`deliverQuestion: missing user or practice.subject for ${phone}`);
      return;
    }

    const question = await this.pastQuestionService.getQuestion(
      {
        subject: practice.subject,
        level: user.level,
        topic: practice.topic,
        yearRange: practice.yearRange,
        type: practice.type as QuestionType | undefined,
      },
      practice.seenIds ?? [],
    );

    if (!question) {
      await this.whatsappSendService.sendText(phone, this.i18n.t('practice.noMoreQuestions', lang));
      return;
    }

    await this.whatsappSendService.sendText(phone, this.formatQuestion(question, practice.subject));

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
    await this.sessionService.updateSessionField(phone, 'currentQuestionTopic', question.topic);
    await this.sessionService.updateSessionField(phone, 'practice', {
      ...practice,
      seenIds: [...(practice.seenIds ?? []), question.chunkId],
    });

    await this.stateTransitionService.transition(phone, ConversationState.ANSWER_EVALUATION);
  }

  // Free text while ANSWER_EVALUATION - dispatches to MCQ auto-grading or
  // essay/structured feedback based on the delivered question's actual type.
  async handleAnswer(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const answerText = message.text?.trim();
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;
    const session = await this.sessionService.getSession(phone);

    if (!answerText) {
      this.logger.warn(`Non-text message from ${phone} while ANSWER_EVALUATION; ignoring`);
      return;
    }

    if (!session?.currentQuestionText || !session.questionType) {
      this.logger.warn(`handleAnswer: no active question in session for ${phone}`);
      return;
    }

    await this.recordActivity(phone);

    if (session.questionType === TYPE_MCQ) {
      return this.handleMcqAnswer(phone, answerText, session, lang);
    }

    return this.handleEssayAnswer(phone, answerText, session, lang);
  }

  // Button/list reply while ANSWER_EVALUATION, after grading feedback has
  // already been sent - the post-answer navigation choice.
  async handlePostAnswerSelection(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    switch (message.listId) {
      case POST_ANSWER_NEXT:
        return this.handleNextQuestion(phone);

      case POST_ANSWER_RETRY_TOPIC:
        return this.handleRetryTopic(phone);

      case POST_ANSWER_CHANGE_SUBJECT:
        // enterPracticeMode already resets the whole session into
        // PRACTICE_FILTER (it's the same escape-hatch every mode entry uses),
        // so it doubles as "start over with a different subject" here.
        return this.enterPracticeMode(phone);

      case POST_ANSWER_MAIN_MENU:
        await this.stateTransitionService.transition(phone, ConversationState.MAIN_MENU);
        await this.clearPracticeContext(phone);
        return this.mainMenuHandler.sendMenu(phone);

      default:
        this.logger.warn(`Unrecognized post-answer selection "${message.listId}" from ${phone}`);
        return this.sendPostAnswerNav(phone, lang);
    }
  }

  private async handleNextQuestion(phone: string): Promise<void> {
    // deliverQuestion always transitions QUESTION_DELIVERY -> ANSWER_EVALUATION
    // at the end, so it must be re-entered via QUESTION_DELIVERY here rather
    // than called directly from the current ANSWER_EVALUATION state (which
    // has no self-loop edge in the graph).
    await this.stateTransitionService.transition(phone, ConversationState.QUESTION_DELIVERY);
    await this.deliverQuestion(phone);
  }

  private async handleRetryTopic(phone: string): Promise<void> {
    const session = await this.sessionService.getSession(phone);
    if (session?.currentQuestionTopic) {
      await this.sessionService.updateSessionField(phone, 'practice', {
        ...session.practice,
        topic: session.currentQuestionTopic,
      });
    }
    await this.handleNextQuestion(phone);
  }

  private async clearPracticeContext(phone: string): Promise<void> {
    await this.sessionService.updateSessionField(phone, 'practice', undefined);
    await this.sessionService.updateSessionField(phone, 'currentQuestionId', undefined);
    await this.sessionService.updateSessionField(phone, 'currentQuestionText', undefined);
    await this.sessionService.updateSessionField(phone, 'currentQuestionTopic', undefined);
    await this.sessionService.updateSessionField(phone, 'questionType', undefined);
    await this.sessionService.updateSessionField(phone, 'markingSchemeChunkId', undefined);
  }

  private async sendPostAnswerNav(phone: string, lang: Language): Promise<void> {
    await this.whatsappSendService.sendList(
      phone,
      this.i18n.t('practice.postAnswerPrompt', lang),
      this.i18n.t('practice.postAnswerListButton', lang),
      [
        {
          title: this.i18n.t('practice.postAnswerSectionTitle', lang),
          rows: [
            { id: POST_ANSWER_NEXT, title: this.i18n.t('practice.nextQuestion', lang) },
            { id: POST_ANSWER_RETRY_TOPIC, title: this.i18n.t('practice.retryTopic', lang) },
            { id: POST_ANSWER_CHANGE_SUBJECT, title: this.i18n.t('practice.changeSubject', lang) },
            { id: POST_ANSWER_MAIN_MENU, title: this.i18n.t('common.mainMenu', lang) },
          ],
        },
      ],
    );
  }

  private async handleEssayAnswer(
    phone: string,
    answerText: string,
    session: SessionContext,
    lang: Language,
  ): Promise<void> {
    const questionText = session.currentQuestionText!;
    const subject = session.practice?.subject ?? 'Unknown';
    const topic = session.practice?.topic ?? 'General';

    const schemeChunk = session.markingSchemeChunkId
      ? await this.prisma.embeddingChunk.findUnique({ where: { id: session.markingSchemeChunkId } })
      : null;

    if (!schemeChunk) {
      this.logger.warn(
        `No marking scheme found for ${phone}'s structured question (markingSchemeChunkId=${session.markingSchemeChunkId})`,
      );
      await this.whatsappSendService.sendText(
        phone,
        this.i18n.t('practice.essayGradingUnavailable', lang),
      );
      await this.prisma.interaction.create({
        data: {
          userId: phone,
          type: InteractionType.PRACTICE,
          subject,
          topic,
          questionText,
          userAnswer: answerText,
          correct: null,
        },
      });
      await this.sendPostAnswerNav(phone, lang);
      return;
    }

    const feedback = await this.llmService.generate(
      buildEssayFeedbackPrompt(subject, questionText, schemeChunk.content, answerText),
      'Provide feedback on my answer.',
      { complexity: 'complex' },
    );

    for (const part of this.responseFormatter.formatForWhatsApp(feedback)) {
      await this.whatsappSendService.sendText(phone, part);
    }

    const estimatedCorrect = this.extractEstimatedCorrectness(feedback);

    await this.prisma.interaction.create({
      data: {
        userId: phone,
        type: InteractionType.PRACTICE,
        subject,
        topic,
        questionText,
        userAnswer: answerText,
        correct: estimatedCorrect,
      },
    });

    if (estimatedCorrect !== null) {
      await this.topicScoreService.recordResult(phone, subject, topic, estimatedCorrect);
    }

    await this.sendPostAnswerNav(phone, lang);
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

  private async handleMcqAnswer(
    phone: string,
    answerText: string,
    session: SessionContext,
    lang: Language,
  ): Promise<void> {
    const questionText = session.currentQuestionText!;
    const options = parseOptions(questionText);
    const studentLetter = normalizeStudentAnswer(answerText, options);

    const schemeChunk = session.markingSchemeChunkId
      ? await this.prisma.embeddingChunk.findUnique({ where: { id: session.markingSchemeChunkId } })
      : null;
    const correctLetter = schemeChunk ? extractCorrectAnswerLetter(schemeChunk.content) : null;

    const subject = session.practice?.subject ?? 'Unknown';
    const topic = session.practice?.topic ?? 'General';

    if (!correctLetter) {
      this.logger.warn(
        `Could not determine the correct MCQ answer for ${phone} (markingSchemeChunkId=${session.markingSchemeChunkId})`,
      );
      await this.whatsappSendService.sendText(
        phone,
        this.i18n.t('practice.mcqGradingUnavailable', lang),
      );
      await this.prisma.interaction.create({
        data: {
          userId: phone,
          type: InteractionType.PRACTICE,
          subject,
          topic,
          questionText,
          userAnswer: answerText,
          correct: null,
        },
      });
      await this.sendPostAnswerNav(phone, lang);
      return;
    }

    const isCorrect = studentLetter !== null && studentLetter === correctLetter;
    const schemeExplanation = extractSchemeExplanation(schemeChunk!.content);

    const feedback = isCorrect
      ? this.i18n.t('practice.mcqCorrect', lang, { explanation: schemeExplanation })
      : this.i18n.t('practice.mcqWrong', lang, {
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

    await this.whatsappSendService.sendText(phone, feedback);

    await this.prisma.interaction.create({
      data: {
        userId: phone,
        type: InteractionType.PRACTICE,
        subject,
        topic,
        questionText,
        userAnswer: answerText,
        correct: isCorrect,
      },
    });
    await this.topicScoreService.recordResult(phone, subject, topic, isCorrect);

    await this.sendPostAnswerNav(phone, lang);
  }

  private formatQuestion(question: PastQuestion, subject: string): string {
    const yearLabel = question.year ?? '';
    const numberLabel = question.questionNumber ?? '?';
    const body = question.questionText.replace(QUESTION_PREFIX_PATTERN, '').trim();

    return `📝 ${yearLabel} ${subject} — Question ${numberLabel}\n\n${body}\n\nType your answer, or /hint for a clue.`;
  }

  private async listTopics(subject: string, level: Level): Promise<string[]> {
    const rows = await this.prisma.embeddingChunk.findMany({
      where: {
        subject,
        level,
        topic: { not: null },
        document: { docType: DocType.PAST_PAPER },
      },
      distinct: ['topic'],
      select: { topic: true },
      orderBy: { topic: 'asc' },
    });

    return rows.map((row) => row.topic).filter((topic): topic is string => topic !== null);
  }

  private async sendSubjectPrompt(
    phone: string,
    subjects: string[],
    lang: Language,
  ): Promise<void> {
    const promptText = this.i18n.t('practice.selectSubject', lang);

    if (subjects.length <= MAX_SUBJECT_BUTTONS) {
      await this.whatsappSendService.sendButtons(
        phone,
        promptText,
        subjects.map((subject) => ({ id: subject, title: subject })),
      );
      return;
    }

    await this.whatsappSendService.sendList(
      phone,
      promptText,
      this.i18n.t('practice.selectSubjectListButton', lang),
      [
        {
          title: this.i18n.t('practice.selectSubjectSectionTitle', lang),
          rows: subjects.map((subject) => ({ id: subject, title: subject })),
        },
      ],
    );
  }

  private async sendTopicPrompt(phone: string, topics: string[], lang: Language): Promise<void> {
    const rows: WhatsAppListRow[] = [
      { id: TOPIC_ALL, title: this.i18n.t('practice.allTopics', lang) },
      { id: TOPIC_SURPRISE_ME, title: this.i18n.t('practice.surpriseMe', lang) },
      ...topics.map((topic) => ({ id: topic, title: topic })),
    ];
    const pages = chunk(rows, MAX_LIST_ROWS_PER_MESSAGE);

    for (let i = 0; i < pages.length; i++) {
      const partSuffix = pages.length > 1 ? ` (${i + 1}/${pages.length})` : '';
      await this.whatsappSendService.sendList(
        phone,
        this.i18n.t('practice.selectTopic', lang) + partSuffix,
        this.i18n.t('practice.selectTopicListButton', lang),
        [{ title: this.i18n.t('practice.selectTopicSectionTitle', lang), rows: pages[i] }],
      );
    }
  }

  private async sendYearRangePrompt(phone: string, lang: Language): Promise<void> {
    await this.whatsappSendService.sendList(
      phone,
      this.i18n.t('practice.selectYearRange', lang),
      this.i18n.t('practice.selectYearRangeListButton', lang),
      [
        {
          title: this.i18n.t('practice.selectYearRangeSectionTitle', lang),
          rows: [
            { id: YEAR_RANGE_2020_2025, title: this.i18n.t('practice.yearRange2020to2025', lang) },
            { id: YEAR_RANGE_2015_2020, title: this.i18n.t('practice.yearRange2015to2020', lang) },
            { id: YEAR_RANGE_2010_2015, title: this.i18n.t('practice.yearRange2010to2015', lang) },
            { id: YEAR_ANY, title: this.i18n.t('practice.anyYear', lang) },
          ],
        },
      ],
    );
  }

  private async sendTypePrompt(phone: string, lang: Language): Promise<void> {
    await this.whatsappSendService.sendButtons(phone, this.i18n.t('practice.selectType', lang), [
      { id: TYPE_MCQ, title: this.i18n.t('practice.typeMcq', lang) },
      { id: TYPE_STRUCTURED, title: this.i18n.t('practice.typeStructured', lang) },
      { id: TYPE_ANY, title: this.i18n.t('practice.anyType', lang) },
    ]);
  }

  // Best-effort: a streak/milestone failure shouldn't block grading feedback.
  private async recordActivity(phone: string): Promise<void> {
    try {
      const updatedUser = await this.streakService.recordActivity(phone);
      await this.milestoneService.checkMilestone(updatedUser);
    } catch (error) {
      this.logger.error(
        `recordActivity failed for ${phone}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
