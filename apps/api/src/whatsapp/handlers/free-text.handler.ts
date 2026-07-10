import { Injectable, Logger } from '@nestjs/common';
import { Language } from '../../../generated/prisma';
import { ParsedMessage } from '../services/message-parser.service';
import { WhatsappSendService } from '../services/whatsapp-send.service';
import { UsersService } from '../../users/users.service';
import { I18nService } from '../../i18n/i18n.service';

@Injectable()
export class FreeTextHandler {
  private readonly logger = new Logger(FreeTextHandler.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly i18n: I18nService,
  ) {}

  // No QA/practice engine exists yet in this branch, so any free text (outside
  // an active flow) just gets the same default fallback as an unknown command.
  async handle(message: ParsedMessage): Promise<void> {
    this.logger.log(`FREE_TEXT from ${message.from}: ${message.text ?? '<no text>'}`);

    const user = await this.usersService.getUserProfile(message.from);
    const lang = user?.language ?? Language.EN;
    await this.whatsappSendService.sendText(
      message.from,
      this.i18n.t('errors.unknownCommand', lang),
    );
  }
}
