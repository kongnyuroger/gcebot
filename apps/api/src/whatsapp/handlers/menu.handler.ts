import { Injectable, Logger } from '@nestjs/common';
import { ParsedMessage } from '../services/message-parser.service';

@Injectable()
export class MenuHandler {
  private readonly logger = new Logger(MenuHandler.name);

  handle(message: ParsedMessage): void {
    const selectionId = message.buttonId ?? message.listId;
    const selectionTitle = message.buttonText ?? message.listTitle;
    this.logger.log(`MENU_SELECTION from ${message.from}: ${selectionId} (${selectionTitle})`);
  }
}
