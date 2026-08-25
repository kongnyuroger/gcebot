import { SubscriptionTier } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { SessionService } from '../../session/session.service';
import { VectorSearchService, SearchResult } from './vector-search.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { LlmService } from './llm.service';
import { ResponseFormatterService } from './response-formatter.service';
import { ResponseCacheService } from './response-cache.service';
import { QaService } from './qa.service';

describe('QaService', () => {
  let service: QaService;
  let getUserProfile: jest.Mock;
  let getSession: jest.Mock;
  let updateSessionField: jest.Mock;
  let search: jest.Mock;
  let assemblePrompt: jest.Mock;
  let generate: jest.Mock;
  let formatForWhatsApp: jest.Mock;
  let getCached: jest.Mock;
  let setCache: jest.Mock;
  let interactionCreate: jest.Mock;

  const phone = '237670000002';
  const ANSWER_TEXT = 'The answer. [Source: Textbook, 2021]';
  const oneResult: SearchResult[] = [
    {
      chunkId: 'chunk-1',
      content: 'Some retrieved content',
      subject: 'Biology',
      level: 'O_LEVEL',
      topic: 'Cell Biology',
      year: 2021,
      docType: 'TEXTBOOK',
      similarity: 0.9,
    },
  ];

  function buildUser(overrides: Partial<{ tier: SubscriptionTier; subjects: string[] }> = {}) {
    return {
      phone_number: phone,
      level: 'O_LEVEL',
      subjects: overrides.subjects ?? ['Biology'],
      language: 'EN',
      tier: overrides.tier ?? SubscriptionTier.FREE,
    };
  }

  beforeEach(() => {
    getUserProfile = jest.fn().mockResolvedValue(buildUser());
    getSession = jest
      .fn()
      .mockResolvedValue({ state: 'AWAITING_QUESTION', conversationHistory: [] });
    updateSessionField = jest.fn();
    search = jest.fn().mockResolvedValue(oneResult);
    assemblePrompt = jest.fn().mockReturnValue({ systemPrompt: 'SYSTEM', userMessage: 'USER' });
    generate = jest.fn().mockResolvedValue(ANSWER_TEXT);
    formatForWhatsApp = jest.fn().mockImplementation((text: string) => [text]);
    getCached = jest.fn().mockResolvedValue(null);
    setCache = jest.fn();
    interactionCreate = jest.fn();

    service = new QaService(
      { getUserProfile } as unknown as UsersService,
      { getSession, updateSessionField } as unknown as SessionService,
      { search } as unknown as VectorSearchService,
      { assemblePrompt } as unknown as PromptAssemblerService,
      { generate } as unknown as LlmService,
      { formatForWhatsApp } as unknown as ResponseFormatterService,
      { getCached, setCache } as unknown as ResponseCacheService,
      { interaction: { create: interactionCreate } } as unknown as PrismaService,
    );
  });

  describe('diagram question detection', () => {
    it.each([
      'Can you draw the structure of a cell?',
      'Please sketch a diagram of the heart',
      'Label the parts of a flower',
      'Illustrate how photosynthesis works',
      'What is the structure of an atom?',
    ])('flags "%s" as a diagram question and augments the system prompt', async (question) => {
      await service.answerQuestion(phone, question);

      expect(assemblePrompt).toHaveBeenCalledWith(question, oneResult, expect.any(Object), {
        isDiagramQuestion: true,
      });
    });

    it('does not flag an ordinary question as a diagram question', async () => {
      await service.answerQuestion(phone, 'What is photosynthesis?');

      expect(assemblePrompt).toHaveBeenCalledWith(
        'What is photosynthesis?',
        oneResult,
        expect.any(Object),
        { isDiagramQuestion: false },
      );
    });

    it('appends the Premium tip for a Premium user asking a diagram question', async () => {
      getUserProfile.mockResolvedValue(buildUser({ tier: SubscriptionTier.PREMIUM }));

      const parts = await service.answerQuestion(phone, 'Draw the structure of the heart');

      expect(parts).toEqual([
        ANSWER_TEXT,
        '💡 Tip: diagram image support is coming soon for Premium users.',
      ]);
    });

    it('does not append the Premium tip for a FREE user asking a diagram question', async () => {
      const parts = await service.answerQuestion(phone, 'Draw the structure of the heart');

      expect(parts).toEqual([ANSWER_TEXT]);
    });

    it('does not append the Premium tip for a Premium user asking a non-diagram question', async () => {
      getUserProfile.mockResolvedValue(buildUser({ tier: SubscriptionTier.PREMIUM }));

      const parts = await service.answerQuestion(phone, 'What is photosynthesis?');

      expect(parts).toEqual([ANSWER_TEXT]);
    });
  });

  describe('follow-up conversation context', () => {
    const history = [
      { role: 'user' as const, content: 'How do I solve linear equations?' },
      { role: 'assistant' as const, content: 'Isolate x on one side.' },
    ];

    beforeEach(() => {
      getSession.mockResolvedValue({ state: 'AWAITING_QUESTION', conversationHistory: history });
    });

    it.each(['why?', 'explain more', 'elaborate', 'give me an example', 'how so?'])(
      'augments the vector search query for the follow-up "%s" with the prior question',
      async (followUp) => {
        await service.answerQuestion(phone, followUp);

        expect(search).toHaveBeenCalledWith(
          'How do I solve linear equations? ' + followUp,
          expect.any(Object),
        );
      },
    );

    it('passes the raw follow-up text (not the augmented query) to the LLM as the user message', async () => {
      await service.answerQuestion(phone, 'why?');

      expect(assemblePrompt).toHaveBeenCalledWith(
        'why?',
        oneResult,
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('does not check or write the response cache for a follow-up question', async () => {
      await service.answerQuestion(phone, 'why?');

      expect(getCached).not.toHaveBeenCalled();
      expect(setCache).not.toHaveBeenCalled();
    });

    it('does check and write the response cache for a normal (non-follow-up) question', async () => {
      await service.answerQuestion(phone, 'What is 2 + 2?');

      expect(getCached).toHaveBeenCalled();
      expect(setCache).toHaveBeenCalled();
    });

    it('uses the question as-is (unaugmented) for vector search when it is not a follow-up', async () => {
      await service.answerQuestion(phone, 'What is 2 + 2?');

      expect(search).toHaveBeenCalledWith('What is 2 + 2?', expect.any(Object));
    });

    it('still passes the full conversation history to the LLM for a follow-up', async () => {
      await service.answerQuestion(phone, 'why?');

      expect(generate).toHaveBeenCalledWith(
        'SYSTEM',
        'USER',
        expect.objectContaining({ conversationHistory: history }),
      );
    });
  });

  describe('updateHistory option', () => {
    it('writes conversationHistory by default (normal, non-cached path)', async () => {
      await service.answerQuestion(phone, 'What is 2 + 2?');

      expect(updateSessionField).toHaveBeenCalledWith(
        phone,
        'conversationHistory',
        expect.any(Array),
      );
    });

    it('skips the conversationHistory write when updateHistory is false (normal path)', async () => {
      await service.answerQuestion(phone, 'What is 2 + 2?', undefined, { updateHistory: false });

      expect(updateSessionField).not.toHaveBeenCalled();
    });

    it('skips the conversationHistory write when updateHistory is false (cache-hit path)', async () => {
      getCached.mockResolvedValue(['A cached answer.']);

      await service.answerQuestion(phone, 'What is 2 + 2?', undefined, { updateHistory: false });

      expect(updateSessionField).not.toHaveBeenCalled();
    });
  });
});
