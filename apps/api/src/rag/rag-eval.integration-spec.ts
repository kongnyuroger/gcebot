import { DocType, Level } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { SessionService } from '../session/session.service';
import { VectorSearchService } from './services/vector-search.service';
import { VectorStoreService } from './services/vector-store.service';
import { EmbeddingService } from './services/embedding.service';
import { PromptAssemblerService } from './services/prompt-assembler.service';
import { LlmService } from './services/llm.service';
import { ResponseFormatterService } from './services/response-formatter.service';
import { ResponseCacheService } from './services/response-cache.service';
import { QaService } from './services/qa.service';

const MAX_WHATSAPP_MESSAGE_LENGTH = 4096;

interface EvalCase {
  subject: string;
  level: Level;
  docType: DocType;
  year: number;
  topic: string;
  content: string;
  question: string;
  llmAnswer: string;
}

// One eval case per subject, each backed by a single real seeded chunk. The
// LLM is mocked (there's nothing to "evaluate" about OpenAI's own output
// here), but every canned answer embeds the exact [Source: ...] citation a
// well-behaved model would produce per Rule 4 of the assembled system prompt,
// so the assertion on citation presence is actually meaningful.
const EVAL_CASES: EvalCase[] = [
  {
    subject: 'Biology',
    level: Level.O_LEVEL,
    docType: DocType.TEXTBOOK,
    year: 2022,
    topic: 'Photosynthesis',
    content:
      'Photosynthesis is the process by which green plants convert light energy into chemical energy stored in glucose, using carbon dioxide and water and releasing oxygen as a byproduct.',
    question: 'What is photosynthesis?',
    llmAnswer:
      'Photosynthesis converts light energy into glucose, releasing oxygen. [Source: Textbook, 2022]',
  },
  {
    subject: 'Chemistry',
    level: Level.O_LEVEL,
    docType: DocType.PAST_PAPER,
    year: 2023,
    topic: 'Chemical Equations',
    content:
      'Balancing a chemical equation means ensuring the number of atoms of each element is equal on both sides, e.g. 4Fe + 3O2 -> 2Fe2O3.',
    question: 'How do you balance the equation for iron reacting with oxygen?',
    llmAnswer:
      '4Fe + 3O2 -> 2Fe2O3 is balanced with equal atom counts on both sides. [Source: Past Paper, 2023]',
  },
  {
    subject: 'Mathematics',
    level: Level.O_LEVEL,
    docType: DocType.TEXTBOOK,
    year: 2021,
    topic: 'Linear Equations',
    content:
      'To solve 2x + 5 = 15, subtract 5 from both sides to get 2x = 10, then divide both sides by 2 to find x = 5.',
    question: 'How do I solve 2x + 5 = 15?',
    llmAnswer: 'Subtract 5 then divide by 2: x = 5. [Source: Textbook, 2021]',
  },
  {
    subject: 'Physics',
    level: Level.A_LEVEL,
    docType: DocType.TEXTBOOK,
    year: 2022,
    topic: "Newton's Laws",
    content:
      "Newton's third law states that for every action there is an equal and opposite reaction between two interacting bodies.",
    question: "What does Newton's third law state?",
    // Deliberately long enough to force ResponseFormatterService to split
    // into multiple (N/M)-prefixed WhatsApp parts, exercising the same
    // splitting path a real long tutoring answer would hit.
    llmAnswer:
      'Every action has an equal and opposite reaction between two interacting bodies. '.repeat(
        60,
      ) + '[Source: Textbook, 2022]',
  },
  {
    subject: 'Economics',
    level: Level.A_LEVEL,
    docType: DocType.PAST_PAPER,
    year: 2023,
    topic: 'International Trade',
    content:
      "The trade balance is the difference between the value of a country's exports and imports over a given period.",
    question: 'What is the trade balance?',
    llmAnswer:
      'The trade balance is exports minus imports over a period. [Source: Past Paper, 2023]',
  },
];

describe('RAG evaluation (integration)', () => {
  const phone = 'test-rag-eval-237600000091';

  let prisma: PrismaService;
  let usersService: UsersService;
  let generate: jest.Mock;
  let qaService: QaService;
  const documentIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    // A single fixed embedding for both seeding and querying keeps this
    // deterministic and free of real OpenAI calls - correctness here comes
    // from the SQL subject/level filter, not from actual vector distances
    // (identical vectors always score similarity 1.0, safely above the 0.3
    // threshold). Same approach as ingestion-pipeline.integration-spec.ts.
    const generateEmbeddings = jest.fn(async (texts: string[]) =>
      texts.map(() => new Array(1536).fill(0.01)),
    );
    const embeddingService = { generateEmbeddings } as unknown as EmbeddingService;
    const vectorStore = new VectorStoreService(prisma);

    for (const evalCase of EVAL_CASES) {
      const doc = await prisma.document.create({
        data: {
          filename: `eval-${evalCase.subject}.pdf`,
          subject: evalCase.subject,
          level: evalCase.level,
          docType: evalCase.docType,
          year: evalCase.year,
          ingestionStatus: 'COMPLETE',
        },
      });
      documentIds.push(doc.id);

      const [embedding] = await embeddingService.generateEmbeddings([evalCase.content]);
      await vectorStore.storeChunks([
        {
          content: evalCase.content,
          tokenCount: 50,
          metadata: {
            documentId: doc.id,
            subject: evalCase.subject,
            level: evalCase.level,
            docType: evalCase.docType,
            year: evalCase.year,
            topic: evalCase.topic,
            chunkIndex: 0,
          },
          embedding,
        },
      ]);
    }

    usersService = new UsersService(prisma);
    await usersService.upsertUser(phone);

    // Session and cache are irrelevant to what this file evaluates (retrieval
    // + prompt assembly + formatting), and both already have their own
    // dedicated coverage (session.integration-spec.ts, and the live
    // verification done for ResponseCacheService) - stubbed here rather than
    // standing up real Redis just to have QaService's constructor satisfied.
    const sessionService = {
      getSession: jest.fn().mockResolvedValue(null),
      updateSessionField: jest.fn(),
    } as unknown as SessionService;
    const responseCache = {
      getCached: jest.fn().mockResolvedValue(null),
      setCache: jest.fn(),
    } as unknown as ResponseCacheService;

    generate = jest.fn();
    const llmService = { generate } as unknown as LlmService;

    const vectorSearchService = new VectorSearchService(prisma, embeddingService);
    const promptAssembler = new PromptAssemblerService();
    const responseFormatter = new ResponseFormatterService();

    qaService = new QaService(
      usersService,
      sessionService,
      vectorSearchService,
      promptAssembler,
      llmService,
      responseFormatter,
      responseCache,
      prisma,
    );
  });

  afterEach(() => {
    generate.mockClear();
  });

  afterAll(async () => {
    await prisma.interaction.deleteMany({ where: { userId: phone } });
    await prisma.user.deleteMany({ where: { phone_number: phone } });
    for (const documentId of documentIds) {
      await prisma.embeddingChunk.deleteMany({ where: { documentId } });
      await prisma.document.deleteMany({ where: { id: documentId } });
    }
    await prisma.$disconnect();
  });

  it.each(EVAL_CASES)(
    '$subject: retrieves real content, cites it, and formats a valid WhatsApp response',
    async (evalCase) => {
      await usersService.updateLevel(phone, evalCase.level);
      generate.mockResolvedValueOnce(evalCase.llmAnswer);

      const parts = await qaService.answerQuestion(phone, evalCase.question, evalCase.subject);

      // Non-empty response
      expect(parts.length).toBeGreaterThan(0);
      for (const part of parts) {
        expect(part.length).toBeGreaterThan(0);
      }

      // Real retrieval actually happened: the assembled prompt handed to the
      // (mocked) LLM must contain the seeded chunk's own content.
      const [systemPrompt, userMessage] = generate.mock.calls[0];
      expect(`${systemPrompt} ${userMessage}`).toContain(evalCase.content);

      // Citation present in the final response
      expect(parts.join(' ')).toContain('[Source:');

      // Valid WhatsApp part splitting
      for (const part of parts) {
        expect(part.length).toBeLessThanOrEqual(MAX_WHATSAPP_MESSAGE_LENGTH);
      }
      if (parts.length > 1) {
        parts.forEach((part, index) => {
          expect(part.startsWith(`(${index + 1}/${parts.length})`)).toBe(true);
        });
      }
    },
  );
});
