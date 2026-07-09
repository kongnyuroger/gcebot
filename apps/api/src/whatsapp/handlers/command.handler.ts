import { Injectable, Logger } from '@nestjs/common';
import { ParsedMessage } from '../services/message-parser.service';

@Injectable()
export class CommandHandler {
  private readonly logger = new Logger(CommandHandler.name);

  handle(message: ParsedMessage, commandName: string): void {
    this.logger.log(`COMMAND from ${message.from}: /${commandName}`);
  }
}
