import { Injectable, Logger } from '@nestjs/common';
import { ConversationState } from '@gcebot/shared';
import { DocType, Language, Level } from '../../generated/prisma';
import { ParsedMessage } from '../whatsapp/services/message-parser.service';
import { WhatsappSendService, WhatsAppListRow } from '../whatsapp/services/whatsapp-send.service';
import { SessionService } from '../session/session.service';
import { StateTransitionService } from '../session/state-transition.service';
import { UsersService } from '../users/users.service';
import { I18nService } from '../i18n/i18n.service';
import { PrismaService } from '../prisma/prisma.service';
import { PastQuestionService, PastQuestion, QuestionType } from '../practice/past-question.service';
import { chunk, MAX_LIST_ROWS_PER_MESSAGE } from './subjects.constants';

const MAX_SUBJECT_BUTTONS = 3;

export const TOPIC_ALL = 'ALL_TOPICS';
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

// Strips the leading "Question N." / "Paper N." boundary markers off a raw
// chunk before display, since delivery already renders that as its own
// "Question [N]" header - keeping it in the body would be redundant.
const QUESTION_PREFIX_PATTERN = /^\s*(?:question\s*\d+|\d+[.)])\s*\.?\s*(?:paper\s*\d+\.?\s*)?/i;

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

    const topic = selectedTopic === TOPIC_ALL ? undefined : selectedTopic;
    await this.sessionService.updateSessionField(phone, 'practice', {
      ...session?.practice,
      topic,
    });
    await this.stateTransitionService.transition(phone, ConversationState.PRACTICE_YEAR);

    await this.sendYearRangePrompt(phone, lang);
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
    await this.sessionService.updateSessionField(phone, 'practice', {
      ...practice,
      seenIds: [...(practice.seenIds ?? []), question.chunkId],
    });

    await this.stateTransitionService.transition(phone, ConversationState.ANSWER_EVALUATION);
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
}
