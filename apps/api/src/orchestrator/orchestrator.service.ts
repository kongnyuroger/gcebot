import { Injectable, Logger } from '@nestjs/common';
import { Language } from '../../generated/prisma';
import { ParsedMessage } from '../whatsapp/services/message-parser.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { UsersService } from '../users/users.service';
import { SessionService } from '../session/session.service';
import { I18nService } from '../i18n/i18n.service';
import { ResponseFormatterService } from '../rag/services/response-formatter.service';
import { LlmService, LLMMessage } from '../rag/services/llm.service';
import { SystemPromptBuilderService } from './system-prompt-builder.service';
import { ToolExecutorService } from './tool-executor.service';
import { ORCHESTRATOR_TOOLS, ToolName } from './tools/tool-definitions';

// Safety cap on one turn's tool-calling round trips - real conversations
// resolve in 1-2 rounds (a tool call, then a final reply); this only exists
// to stop a pathological loop (the model repeatedly calling tools without
// ever producing a final answer) from running forever.
const MAX_TOOL_ROUNDS = 5;

// Mirrors QaService's own history cap - one consistent window size for how
// much back-and-forth either flow keeps in Redis.
const MAX_STORED_HISTORY_MESSAGES = 10;

// The free-form entry point for everything the old per-mode handlers used to
// split across QA_MODE/PRACTICE_FILTER/etc. Router wiring (which incoming
// messages actually reach this) is a later step of this branch - this
// service is fully functional on its own once called.
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionService: SessionService,
    private readonly llmService: LlmService,
    private readonly systemPromptBuilder: SystemPromptBuilderService,
    private readonly toolExecutor: ToolExecutorService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly responseFormatter: ResponseFormatterService,
    private readonly i18n: I18nService,
  ) {}

  async handleMessage(message: ParsedMessage): Promise<void> {
    const phone = message.from;
    const text = message.text?.trim();

    if (!text) {
      this.logger.warn(`Non-text message from ${phone}; orchestrator only handles free text`);
      return;
    }

    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;

    await this.whatsappSendService.markAsRead(message.messageId);
    await this.whatsappSendService.sendText(phone, this.i18n.t('qa.thinking', lang));

    let replyText: string;
    try {
      replyText = await this.runToolCallingLoop(phone, text, lang);
    } catch (error) {
      this.logger.error(
        `Orchestrator loop failed for ${phone}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      replyText = this.i18n.t('errors.tryAgain', lang);
    }

    for (const part of this.responseFormatter.formatForWhatsApp(replyText)) {
      await this.whatsappSendService.sendText(phone, part);
    }

    await this.persistHistory(phone, text, replyText);
  }

  private async runToolCallingLoop(phone: string, text: string, lang: Language): Promise<string> {
    const systemPrompt = await this.systemPromptBuilder.build(phone);
    const session = await this.sessionService.getSession(phone);
    const history = session?.conversationHistory ?? [];

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((entry): LLMMessage => ({ role: entry.role, content: entry.content })),
      { role: 'user', content: text },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.llmService.generateWithTools(messages, ORCHESTRATOR_TOOLS, {
        complexity: 'complex',
      });

      messages.push(response.message);

      if (response.toolCalls.length === 0) {
        // generateWithTools guarantees content is non-null whenever there
        // are no tool calls - the `?? ''` only satisfies the string|null type.
        return response.message.content ?? '';
      }

      for (const call of response.toolCalls) {
        const result = await this.toolExecutor.execute(
          call.name as ToolName,
          this.parseArguments(call.arguments),
          phone,
        );
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    this.logger.warn(`Orchestrator hit the ${MAX_TOOL_ROUNDS}-round tool-call cap for ${phone}`);
    return this.i18n.t('errors.tryAgain', lang);
  }

  // A malformed tool_call.arguments string is an external-input boundary
  // (the model's own output, not something this codebase controls) - fall
  // back to an empty object rather than letting a JSON.parse failure crash
  // the whole turn. ToolExecutorService already treats missing/invalid
  // fields as a normal validation failure and returns a clean {error}.
  private parseArguments(raw: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private async persistHistory(phone: string, question: string, answer: string): Promise<void> {
    const session = await this.sessionService.getSession(phone);
    const updatedHistory = [
      ...(session?.conversationHistory ?? []),
      { role: 'user' as const, content: question },
      { role: 'assistant' as const, content: answer },
    ].slice(-MAX_STORED_HISTORY_MESSAGES);

    await this.sessionService.updateSessionField(phone, 'conversationHistory', updatedHistory);
  }
}
