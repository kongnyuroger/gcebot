import { Injectable, Logger } from '@nestjs/common';
import { ParsedMessage } from '../services/message-parser.service';

@Injectable()
export class FreeTextHandler {
  private readonly logger = new Logger(FreeTextHandler.name);

  handle(message: ParsedMessage): void {
    this.logger.log(`FREE_TEXT from ${message.from}: ${message.text ?? '<no text>'}`);
  }
}
