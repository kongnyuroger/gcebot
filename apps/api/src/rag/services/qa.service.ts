import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SessionContext } from '@gcebot/shared';
import { InteractionType } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { SessionService } from '../../session/session.service';
import { VectorSearchService } from './vector-search.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { LlmService } from './llm.service';
import { ResponseFormatterService } from './response-formatter.service';

const NO_RESULTS_MESSAGE =
  "I couldn't find relevant study material for that question. Try being more specific or ask about a different topic.";

// Sessions store the same 5-exchange window LlmService uses when generating,
// so there's never a reason to keep more than this in Redis either.
const MAX_STORED_HISTORY_MESSAGES = 10;

// Simple keyword fallback for when no explicit subject override or session
// context is available - a coarse best-effort, not a real classifier.
const SUBJECT_KEYWORDS: Record<string, string[]> = {
  Biology: [
    'photosynthesis',
    'cell',
    'organism',
    'plant',
    'animal',
    'ecosystem',
    'gene',
    'dna',
    'evolution',
    'biology',
  ],
  Chemistry: [
    'chemical',
    'equation',
    'reaction',
    'element',
    'compound',
    'acid',
    'base',
    'molecule',
    'chemistry',
    'balance the',
  ],
  Mathematics: [
    'solve',
    'equation',
    'calculate',
    'algebra',
    'geometry',
    'triangle',
    'fraction',
    'mathematics',
    'maths',
  ],
  Physics: [
    'force',
    'newton',
    'motion',
    'energy',
    'velocity',
    'gravity',
    'physics',
    'electricity',
    'wave',
  ],
  Economics: [
    'trade',
    'economy',
    'market',
    'supply',
    'demand',
    'gdp',
    'inflation',
    'economics',
    'trade balance',
  ],
};

@Injectable()
export class QaService {
  private readonly logger = new Logger(QaService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly vectorSearchService: VectorSearchService,
    private readonly promptAssembler: PromptAssemblerService,
    private readonly llmService: LlmService,
    private readonly responseFormatter: ResponseFormatterService,
    private readonly prisma: PrismaService,
  ) {}

  async answerQuestion(
    phone: string,
    question: string,
    subjectOverride?: string,
  ): Promise<string[]> {
    const user = await this.usersService.getUserProfile(phone);
    if (!user) {
      throw new NotFoundException(`User ${phone} not found`);
    }

    const session = await this.sessionService.getSession(phone);
    const subject = this.determineSubject(subjectOverride, session, question, user.subjects);

    const results = await this.vectorSearchService.search(question, {
      subject,
      level: user.level,
    });

    if (results.length === 0) {
      this.logger.log(`No vector search results for ${phone} (subject=${subject})`);
      return [NO_RESULTS_MESSAGE];
    }

    const { systemPrompt, userMessage } = this.promptAssembler.assemblePrompt(question, results, {
      level: user.level,
      subject: subject ?? user.subjects[0] ?? '',
      language: user.language,
    });

    const answer = await this.llmService.generate(systemPrompt, userMessage, {
      complexity: 'complex',
      conversationHistory: session?.conversationHistory ?? [],
    });

    const formattedParts = this.responseFormatter.formatForWhatsApp(answer);

    await this.logInteraction(phone, subject, results[0]?.topic, question, answer);
    await this.updateConversationHistory(phone, session, question, answer);

    return formattedParts;
  }

  private determineSubject(
    subjectOverride: string | undefined,
    session: SessionContext | null,
    question: string,
    userSubjects: string[],
  ): string | undefined {
    if (subjectOverride) {
      return subjectOverride;
    }
    if (session?.subject) {
      return session.subject;
    }

    const inferred = this.inferSubjectFromKeywords(question);
    if (inferred) {
      return inferred;
    }

    return userSubjects[0];
  }

  private inferSubjectFromKeywords(question: string): string | undefined {
    const lowerQuestion = question.toLowerCase();
    let bestSubject: string | undefined;
    let bestScore = 0;

    for (const [subject, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
      const score = keywords.filter((keyword) => lowerQuestion.includes(keyword)).length;
      if (score > bestScore) {
        bestScore = score;
        bestSubject = subject;
      }
    }

    return bestSubject;
  }

  private async logInteraction(
    phone: string,
    subject: string | undefined,
    topic: string | undefined,
    question: string,
    answer: string,
  ): Promise<void> {
    await this.prisma.interaction.create({
      data: {
        userId: phone,
        type: InteractionType.QA,
        subject: subject ?? 'Unknown',
        topic: topic ?? 'General',
        questionText: question,
        // No student-submitted answer exists for a QA interaction (that's a
        // PRACTICE/MOCK_EXAM concept) - the column is NOT NULL, so it holds
        // the bot's own answer instead of being left blank.
        userAnswer: answer,
        correct: null,
      },
    });
  }

  private async updateConversationHistory(
    phone: string,
    session: SessionContext | null,
    question: string,
    answer: string,
  ): Promise<void> {
    if (!session) {
      // QA should only be reachable from an active session (QA_MODE); nothing
      // meaningful to update if one doesn't exist.
      return;
    }

    const updatedHistory = [
      ...(session.conversationHistory ?? []),
      { role: 'user' as const, content: question },
      { role: 'assistant' as const, content: answer },
    ].slice(-MAX_STORED_HISTORY_MESSAGES);

    await this.sessionService.updateSessionField(phone, 'conversationHistory', updatedHistory);
  }
}
