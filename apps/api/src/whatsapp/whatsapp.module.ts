import { Module } from '@nestjs/common';
import { WhatsappController } from './whatsapp.controller';
import { MessageParserService } from './services/message-parser.service';
import { MessageRouterService } from './services/message-router.service';
import { CommandHandler } from './handlers/command.handler';
import { MenuHandler } from './handlers/menu.handler';
import { FreeTextHandler } from './handlers/free-text.handler';
import { WhatsappSendService } from './services/whatsapp-send.service';

@Module({
  controllers: [WhatsappController],
  providers: [
    MessageParserService,
    MessageRouterService,
    CommandHandler,
    MenuHandler,
    FreeTextHandler,
    WhatsappSendService,
  ],
  exports: [WhatsappSendService],
})
export class WhatsappModule {}
