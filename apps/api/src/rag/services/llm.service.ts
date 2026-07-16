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
}
