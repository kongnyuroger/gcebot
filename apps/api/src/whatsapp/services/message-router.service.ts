import { Injectable } from '@nestjs/common';
import { CommandHandler } from '../handlers/command.handler';
import { MenuHandler } from '../handlers/menu.handler';
import { FreeTextHandler } from '../handlers/free-text.handler';
import { ParsedMessage } from './message-parser.service';

export enum MessageIntent {
  COMMAND = 'COMMAND',
  MENU_SELECTION = 'MENU_SELECTION',
  FREE_TEXT = 'FREE_TEXT',
}

@Injectable()
export class MessageRouterService {
  constructor(
    private readonly commandHandler: CommandHandler,
    private readonly menuHandler: MenuHandler,
    private readonly freeTextHandler: FreeTextHandler,
  ) {}

  async route(message: ParsedMessage): Promise<void> {
    const intent = this.determineIntent(message);

    switch (intent) {
      case MessageIntent.COMMAND: {
        const commandName = message.text!.slice(1).trim().split(/\s+/)[0]?.toLowerCase() ?? '';
        return this.commandHandler.handle(message, commandName);
      }
      case MessageIntent.MENU_SELECTION:
        return this.menuHandler.handle(message);
      case MessageIntent.FREE_TEXT:
        return this.freeTextHandler.handle(message);
    }
  }

  private determineIntent(message: ParsedMessage): MessageIntent {
    if (message.type === 'text' && message.text?.startsWith('/')) {
      return MessageIntent.COMMAND;
    }

    if (message.type === 'button_reply' || message.type === 'list_reply') {
      return MessageIntent.MENU_SELECTION;
    }

    return MessageIntent.FREE_TEXT;
  }
}
