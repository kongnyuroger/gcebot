import { Injectable, Logger } from '@nestjs/common';
import { Language } from '../../../generated/prisma';
import { ParsedMessage } from '../services/message-parser.service';
import { WhatsappSendService } from '../services/whatsapp-send.service';
import { UsersService } from '../../users/users.service';
import { I18nService } from '../../i18n/i18n.service';

@Injectable()
export class MenuHandler {
  private readonly logger = new Logger(MenuHandler.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly i18n: I18nService,
  ) {}

  // Catch-all for a button/list reply in a state with no specific handler yet
  // (e.g. QA_MODE, PRACTICE_*, MOCK_EXAM_* - engines not built in this branch).
  async handle(message: ParsedMessage): Promise<void> {
    const selectionId = message.buttonId ?? message.listId;
    const selectionTitle = message.buttonText ?? message.listTitle;
    this.logger.log(
      `Unhandled MENU_SELECTION from ${message.from}: ${selectionId} (${selectionTitle})`,
    );

    const user = await this.usersService.getUserProfile(message.from);
    const lang = user?.language ?? Language.EN;
    await this.whatsappSendService.sendText(
      message.from,
      this.i18n.t('errors.unknownCommand', lang),
    );
  }
}
