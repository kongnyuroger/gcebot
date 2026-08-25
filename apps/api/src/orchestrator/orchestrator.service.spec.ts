import { UsersService } from '../users/users.service';
import { SessionService } from '../session/session.service';
import { I18nService } from '../i18n/i18n.service';
import { ResponseFormatterService } from '../rag/services/response-formatter.service';
import { LlmService } from '../rag/services/llm.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { SystemPromptBuilderService } from './system-prompt-builder.service';
import { ToolExecutorService } from './tool-executor.service';
import { TOOL_NAMES } from './tools/tool-definitions';
import { OrchestratorService } from './orchestrator.service';

describe('OrchestratorService', () => {
  let service: OrchestratorService;
  let getUserProfile: jest.Mock;
  let getSession: jest.Mock;
  let updateSessionField: jest.Mock;
  let generateWithTools: jest.Mock;
  let build: jest.Mock;
  let execute: jest.Mock;
  let sendText: jest.Mock;
  let markAsRead: jest.Mock;

  const phone = '237670000011';

  function buildMessage(text: string) {
    return { from: phone, messageId: 'm1', timestamp: 1720000000, type: 'text' as const, text };
  }

  function assistantMessage(content: string | null, toolCalls?: unknown[]) {
    return { role: 'assistant' as const, content, tool_calls: toolCalls };
  }

  beforeEach(() => {
    getUserProfile = jest.fn().mockResolvedValue({ language: 'EN' });
    getSession = jest.fn().mockResolvedValue(null);
    updateSessionField = jest.fn();
    build = jest.fn().mockResolvedValue('SYSTEM PROMPT');
    execute = jest.fn().mockResolvedValue({ answer: 'A tool result.' });
    sendText = jest.fn();
    markAsRead = jest.fn();
    generateWithTools = jest.fn();

    service = new OrchestratorService(
      { getUserProfile } as unknown as UsersService,
      { getSession, updateSessionField } as unknown as SessionService,
      { generateWithTools } as unknown as LlmService,
      { build } as unknown as SystemPromptBuilderService,
      { execute } as unknown as ToolExecutorService,
      { sendText, markAsRead } as unknown as WhatsappSendService,
      new ResponseFormatterService(),
      new I18nService(),
    );
  });

  it('ignores a non-text message without calling the LLM', async () => {
    await service.handleMessage({
      from: phone,
      messageId: 'm1',
      timestamp: 1720000000,
      type: 'button_reply',
      buttonId: 'x',
    });

    expect(generateWithTools).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it('sends a thinking ack, then the final reply, when the model answers with no tool calls', async () => {
    generateWithTools.mockResolvedValue({
      message: assistantMessage('Osmosis is the movement of water...'),
      toolCalls: [],
    });

    await service.handleMessage(buildMessage('What is osmosis?'));

    expect(markAsRead).toHaveBeenCalledWith('m1');
    expect(sendText).toHaveBeenNthCalledWith(1, phone, expect.stringMatching(/thinking/i));
    expect(sendText).toHaveBeenLastCalledWith(phone, 'Osmosis is the movement of water...');
    expect(execute).not.toHaveBeenCalled();
  });

  it('persists the user question and final reply into conversation history', async () => {
    generateWithTools.mockResolvedValue({
      message: assistantMessage('Final answer.'),
      toolCalls: [],
    });

    await service.handleMessage(buildMessage('Explain photosynthesis'));

    expect(updateSessionField).toHaveBeenCalledWith(phone, 'conversationHistory', [
      { role: 'user', content: 'Explain photosynthesis' },
      { role: 'assistant', content: 'Final answer.' },
    ]);
  });

  it('runs a tool call, feeds the result back, and returns the follow-up final reply', async () => {
    generateWithTools
      .mockResolvedValueOnce({
        message: assistantMessage(null, [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'answer_question', arguments: '{"question":"What is a variable?"}' },
          },
        ]),
        toolCalls: [
          {
            id: 'call_1',
            name: TOOL_NAMES.ANSWER_QUESTION,
            arguments: '{"question":"What is a variable?"}',
          },
        ],
      })
      .mockResolvedValueOnce({
        message: assistantMessage('A variable stores a value.'),
        toolCalls: [],
      });

    await service.handleMessage(buildMessage('What is a variable?'));

    expect(execute).toHaveBeenCalledWith(
      TOOL_NAMES.ANSWER_QUESTION,
      { question: 'What is a variable?' },
      phone,
    );
    expect(generateWithTools).toHaveBeenCalledTimes(2);

    const secondCallMessages = generateWithTools.mock.calls[1][0];
    expect(secondCallMessages).toContainEqual(
      expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call_1',
        content: JSON.stringify({ answer: 'A tool result.' }),
      }),
    );
    expect(sendText).toHaveBeenLastCalledWith(phone, 'A variable stores a value.');
  });

  it("sends the thinking ack and any fallback text in the student's own language (French)", async () => {
    getUserProfile.mockResolvedValue({ language: 'FR' });
    generateWithTools.mockRejectedValue(new Error('OpenAI is down'));

    await service.handleMessage(buildMessage('bonjour'));

    expect(sendText).toHaveBeenNthCalledWith(1, phone, expect.stringMatching(/réfléchis/i));
    expect(sendText).toHaveBeenLastCalledWith(phone, expect.stringMatching(/erreur/i));
  });

  it('relays a quota/tier upsell tool result through to the next round unmodified, not as an error', async () => {
    const upsellResult = { allowed: false, quotaExceeded: true, used: 10, limit: 10 };
    execute.mockResolvedValue(upsellResult);

    generateWithTools
      .mockResolvedValueOnce({
        message: assistantMessage(null, [{ id: 'call_1', type: 'function', function: {} }]),
        toolCalls: [
          { id: 'call_1', name: TOOL_NAMES.ANSWER_QUESTION, arguments: '{"question":"x"}' },
        ],
      })
      .mockResolvedValueOnce({
        message: assistantMessage("You've used today's free questions - want to upgrade?"),
        toolCalls: [],
      });

    await service.handleMessage(buildMessage('another question'));

    const secondCallMessages = generateWithTools.mock.calls[1][0];
    expect(secondCallMessages).toContainEqual(
      expect.objectContaining({ role: 'tool', content: JSON.stringify(upsellResult) }),
    );
    expect(sendText).toHaveBeenLastCalledWith(
      phone,
      "You've used today's free questions - want to upgrade?",
    );
  });

  it('relays a tool-level {error} result through to the next round unmodified, not a crash', async () => {
    const errorResult = { error: 'No unseen questions available right now.' };
    execute.mockResolvedValue(errorResult);

    generateWithTools
      .mockResolvedValueOnce({
        message: assistantMessage(null, [{ id: 'call_1', type: 'function', function: {} }]),
        toolCalls: [
          {
            id: 'call_1',
            name: TOOL_NAMES.GET_PRACTICE_QUESTION,
            arguments: '{"subject":"Biology"}',
          },
        ],
      })
      .mockResolvedValueOnce({
        message: assistantMessage("I couldn't find a new question - try a different topic?"),
        toolCalls: [],
      });

    await service.handleMessage(buildMessage('give me a practice question'));

    const secondCallMessages = generateWithTools.mock.calls[1][0];
    expect(secondCallMessages).toContainEqual(
      expect.objectContaining({ role: 'tool', content: JSON.stringify(errorResult) }),
    );
    expect(sendText).toHaveBeenLastCalledWith(
      phone,
      "I couldn't find a new question - try a different topic?",
    );
  });

  it('falls back to malformed-argument-safe {} rather than throwing on bad JSON', async () => {
    generateWithTools
      .mockResolvedValueOnce({
        message: assistantMessage(null),
        toolCalls: [{ id: 'call_1', name: TOOL_NAMES.SHOW_PROGRESS, arguments: 'not json' }],
      })
      .mockResolvedValueOnce({ message: assistantMessage('Done.'), toolCalls: [] });

    await service.handleMessage(buildMessage('how am I doing'));

    expect(execute).toHaveBeenCalledWith(TOOL_NAMES.SHOW_PROGRESS, {}, phone);
  });

  it('gives up gracefully after the tool-call round cap instead of looping forever', async () => {
    generateWithTools.mockResolvedValue({
      message: assistantMessage(null),
      toolCalls: [{ id: 'call_x', name: TOOL_NAMES.SHOW_PROGRESS, arguments: '{}' }],
    });

    await service.handleMessage(buildMessage('keep going'));

    expect(generateWithTools).toHaveBeenCalledTimes(5);
    expect(sendText).toHaveBeenLastCalledWith(phone, expect.any(String));
  });

  it('replies gracefully and does not throw when the LLM call itself fails', async () => {
    generateWithTools.mockRejectedValue(new Error('OpenAI is down'));

    await expect(service.handleMessage(buildMessage('hello'))).resolves.toBeUndefined();

    expect(sendText).toHaveBeenLastCalledWith(phone, expect.any(String));
  });
});
