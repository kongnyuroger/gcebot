import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';

// LlmService instantiates its own OpenAI client internally (not injected),
// so the SDK module itself is mocked - the constructor mock below returns an
// object whose chat.completions.create is a jest.fn() the tests drive.
const create = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ chat: { completions: { create } } })),
}));

describe('LlmService - generateWithTools', () => {
  let service: LlmService;

  beforeEach(() => {
    create.mockReset();
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('test-key'),
    } as unknown as ConfigService;
    service = new LlmService(configService);
  });

  const tools = [
    {
      type: 'function' as const,
      function: {
        name: 'get_practice_question',
        description: 'Serve a real past question',
        parameters: { type: 'object', properties: { subject: { type: 'string' } } },
      },
    },
  ];

  it('extracts tool_calls and returns the raw assistant message unmodified', async () => {
    const rawMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_practice_question', arguments: '{"subject":"Biology"}' },
        },
      ],
    };
    create.mockResolvedValue({
      choices: [{ message: rawMessage }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const result = await service.generateWithTools(
      [{ role: 'user', content: 'give me a biology question' }],
      tools,
      { complexity: 'complex' },
    );

    expect(result.message).toBe(rawMessage);
    expect(result.toolCalls).toEqual([
      { id: 'call_1', name: 'get_practice_question', arguments: '{"subject":"Biology"}' },
    ]);
  });

  it('returns an empty toolCalls array for a plain conversational reply with no tool call', async () => {
    create.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: "Don't worry, you've got this! 💪" } }],
    });

    const result = await service.generateWithTools(
      [{ role: 'user', content: "I'm nervous about my exam" }],
      tools,
      { complexity: 'complex' },
    );

    expect(result.toolCalls).toEqual([]);
    expect(result.message.content).toBe("Don't worry, you've got this! 💪");
  });

  it('throws when the response has neither content nor tool calls', async () => {
    create.mockResolvedValue({ choices: [{ message: { role: 'assistant', content: null } }] });

    await expect(
      service.generateWithTools([{ role: 'user', content: 'hi' }], tools, {
        complexity: 'complex',
      }),
    ).rejects.toThrow('LLM returned an empty response with no tool calls');
  });

  it('passes tools and tool_choice: "auto" through to the OpenAI client', async () => {
    create.mockResolvedValue({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });

    await service.generateWithTools([{ role: 'user', content: 'hi' }], tools, {
      complexity: 'complex',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o', tools, tool_choice: 'auto' }),
    );
  });

  it('selects gpt-4o-mini for simple complexity, matching generate()', async () => {
    create.mockResolvedValue({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });

    await service.generateWithTools([{ role: 'user', content: 'hi' }], tools, {
      complexity: 'simple',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o-mini' }));
  });

  it('filters out non-function tool call types rather than passing them through unparsed', async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'custom', custom: { name: 'not_a_function' } },
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'show_progress', arguments: '{}' },
              },
            ],
          },
        },
      ],
    });

    const result = await service.generateWithTools(
      [{ role: 'user', content: "how's my progress" }],
      tools,
      { complexity: 'complex' },
    );

    expect(result.toolCalls).toEqual([{ id: 'call_2', name: 'show_progress', arguments: '{}' }]);
  });
});
