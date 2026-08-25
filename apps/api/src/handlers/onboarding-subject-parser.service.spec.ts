import { Language, Level } from '../../generated/prisma';
import { LlmService } from '../rag/services/llm.service';
import { OnboardingSubjectParserService } from './onboarding-subject-parser.service';

describe('OnboardingSubjectParserService', () => {
  let generateWithTools: jest.Mock;
  let service: OnboardingSubjectParserService;

  function toolCallResponse(subjects: unknown) {
    return {
      message: { role: 'assistant' as const, content: null },
      toolCalls: [{ id: 'call_1', name: 'set_subjects', arguments: JSON.stringify({ subjects }) }],
    };
  }

  function plainTextResponse(content: string) {
    return { message: { role: 'assistant' as const, content }, toolCalls: [] };
  }

  beforeEach(() => {
    generateWithTools = jest.fn();
    service = new OnboardingSubjectParserService({ generateWithTools } as unknown as LlmService);
  });

  it('maps casual phrasing to valid canonical subject names', async () => {
    generateWithTools.mockResolvedValue(toolCallResponse(['Biology', 'Chemistry']));

    const result = await service.parseFreeform(
      'doing bio and chem',
      Level.O_LEVEL,
      Language.EN,
      [],
    );

    expect(result).toEqual({ matched: true, subjects: ['Biology', 'Chemistry'] });
  });

  it('filters out any hallucinated name not in the valid list', async () => {
    generateWithTools.mockResolvedValue(toolCallResponse(['Biology', 'Astrology']));

    const result = await service.parseFreeform('bio and astrology', Level.O_LEVEL, Language.EN, []);

    expect(result).toEqual({ matched: true, subjects: ['Biology'] });
  });

  it('reports no match when every returned name is invalid', async () => {
    generateWithTools.mockResolvedValue(toolCallResponse(['Astrology']));

    const result = await service.parseFreeform('astrology please', Level.O_LEVEL, Language.EN, []);

    expect(result).toEqual({ matched: false, clarification: null });
  });

  it("returns the model's own clarifying question when it declines to call the tool", async () => {
    generateWithTools.mockResolvedValue(
      plainTextResponse('Could you tell me which subjects you are taking?'),
    );

    const result = await service.parseFreeform(
      'what are my options',
      Level.O_LEVEL,
      Language.EN,
      [],
    );

    expect(result).toEqual({
      matched: false,
      clarification: 'Could you tell me which subjects you are taking?',
    });
  });

  it('passes the already-selected subjects and target language into the system prompt', async () => {
    generateWithTools.mockResolvedValue(toolCallResponse(['Biology']));

    await service.parseFreeform('just biology', Level.O_LEVEL, Language.FR, ['Chemistry']);

    const [messages] = generateWithTools.mock.calls[0];
    expect(messages[0].content).toContain('Chemistry');
    expect(messages[0].content).toContain('French');
  });

  it('only ever passes O-Level subjects for an O-Level student', async () => {
    generateWithTools.mockResolvedValue(toolCallResponse(['Biology']));

    await service.parseFreeform('biology', Level.O_LEVEL, Language.EN, []);

    const [messages] = generateWithTools.mock.calls[0];
    expect(messages[0].content).not.toContain('Additional Mathematics');
  });
});
