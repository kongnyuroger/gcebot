import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { WhatsappController } from './whatsapp.controller';
import { MessageParserService } from './services/message-parser.service';
import { MessageRouterService } from './services/message-router.service';
import { CommandHandler } from './handlers/command.handler';
import { MenuHandler } from './handlers/menu.handler';
import { FreeTextHandler } from './handlers/free-text.handler';
import { WhatsappSendService } from './services/whatsapp-send.service';
import { WhatsappRateLimitGuard } from './guards/rate-limit.guard';

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 30 }])],
  controllers: [WhatsappController],
  providers: [
    MessageParserService,
    MessageRouterService,
    CommandHandler,
    MenuHandler,
    FreeTextHandler,
    WhatsappSendService,
    WhatsappRateLimitGuard,
  ],
  exports: [WhatsappSendService],
})
export class WhatsappModule {}
