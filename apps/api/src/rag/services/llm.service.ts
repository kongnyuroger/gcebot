import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export type LLMComplexity = 'simple' | 'complex';

export interface LLMConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  complexity: LLMComplexity;
  maxTokens?: number;
  conversationHistory?: LLMConversationMessage[];
}

// Re-exported rather than having callers import the `openai` package directly
// - keeps the SDK dependency contained to this one service file, same reason
// LLMConversationMessage exists instead of every caller building raw OpenAI
// message objects. Unlike LLMConversationMessage, this isn't a simplified
// abstraction: tool-calling's message/tool shapes (assistant messages with
// tool_calls, role:"tool" results tied to a tool_call_id) are inherently
// OpenAI-specific, so generateWithTools() takes/returns them as-is rather
// than inventing a parallel type system with no actual abstraction benefit.
export type LLMMessage = OpenAI.Chat.ChatCompletionMessageParam;
export type LLMTool = OpenAI.Chat.ChatCompletionTool;

export interface LLMToolCall {
  id: string;
  name: string;
  // Raw JSON string, as OpenAI sends it - parsing (and handling malformed
  // JSON) is the caller's concern, since only the caller knows the expected
  // shape for a given tool.
  arguments: string;
}

export interface LLMToolResponse {
  // The raw assistant message from OpenAI, unmodified - callers must push
  // this back verbatim into the next round's `messages` array before adding
  // the tool results. Re-deriving an equivalent message from toolCalls below
  // would risk a shape mismatch with what OpenAI actually sent.
  message: OpenAI.Chat.ChatCompletionMessage;
  // Convenience extraction of message.tool_calls, filtered to function calls
  // (the only tool type this project uses) with name/arguments pulled out
  // for the caller to dispatch without re-parsing OpenAI's response shape.
  toolCalls: LLMToolCall[];
}

// Adapted to OpenAI (see the switch-to-openai decision) rather than the
// originally-specified Anthropic models - no Anthropic key exists in this
// project. gpt-4o-mini/gpt-4o mirror the haiku/sonnet simple/complex split.
const MODEL_BY_COMPLEXITY: Record<LLMComplexity, string> = {
  simple: 'gpt-4o-mini',
  complex: 'gpt-4o',
};

const DEFAULT_MAX_TOKENS: Record<LLMComplexity, number> = {
  simple: 1024,
  complex: 2048,
};

const MAX_HISTORY_EXCHANGES = 5; // "exchange" = one user + one assistant message
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: OpenAI;

  constructor(private readonly configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.getOrThrow<string>('OPENAI_API_KEY'),
      // The SDK already retries with exponential backoff on 429/5xx/timeouts,
      // which covers OpenAI's equivalents of rate_limit_error/overloaded_error.
      maxRetries: MAX_RETRIES,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }

  async generate(systemPrompt: string, userMessage: string, options: LLMOptions): Promise<string> {
    const model = MODEL_BY_COMPLEXITY[options.complexity];
    const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS[options.complexity];
    const history = (options.conversationHistory ?? []).slice(-MAX_HISTORY_EXCHANGES * 2);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((entry): OpenAI.Chat.ChatCompletionMessageParam => ({
        role: entry.role,
        content: entry.content,
      })),
      { role: 'user', content: userMessage },
    ];

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages,
        max_completion_tokens: maxTokens,
      });

      if (response.usage) {
        this.logger.log(
          `LLM call (${model}, complexity=${options.complexity}): ` +
            `prompt=${response.usage.prompt_tokens} completion=${response.usage.completion_tokens} ` +
            `total=${response.usage.total_tokens} tokens`,
        );
      }

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('LLM returned an empty response');
      }

      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`LLM generation failed (${model}): ${message}`);
      throw error;
    }
  }

  // Distinct from generate() rather than an added parameter on it: the
  // orchestrator owns its own message array across multiple tool-calling
  // rounds (system prompt + history + user turn + assistant tool_calls +
  // tool results, growing round to round), which doesn't fit generate()'s
  // simpler systemPrompt+userMessage+history shape. generate() itself is
  // left untouched - every existing caller (QA, hints, grading, reports)
  // keeps working exactly as before.
  async generateWithTools(
    messages: LLMMessage[],
    tools: LLMTool[],
    options: LLMOptions,
  ): Promise<LLMToolResponse> {
    const model = MODEL_BY_COMPLEXITY[options.complexity];
    const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS[options.complexity];

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        max_completion_tokens: maxTokens,
      });

      if (response.usage) {
        this.logger.log(
          `LLM tool-call round (${model}): ` +
            `prompt=${response.usage.prompt_tokens} completion=${response.usage.completion_tokens} ` +
            `total=${response.usage.total_tokens} tokens`,
        );
      }

      const message = response.choices[0]?.message;
      if (!message) {
        throw new Error('LLM returned no message');
      }

      const toolCalls: LLMToolCall[] = (message.tool_calls ?? [])
        .filter((call) => call.type === 'function')
        .map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        }));

      // A message with tool_calls legitimately has null content (OpenAI's
      // protocol) - only a response with neither is actually empty/useless.
      if (!message.content && toolCalls.length === 0) {
        throw new Error('LLM returned an empty response with no tool calls');
      }

      return { message, toolCalls };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`LLM tool-call generation failed (${model}): ${message}`);
      throw error;
    }
  }
}
