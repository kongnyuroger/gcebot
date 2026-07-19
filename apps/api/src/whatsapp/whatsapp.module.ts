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
import { SessionModule } from '../session/session.module';
import { UsersModule } from '../users/users.module';
import { I18nModule } from '../i18n/i18n.module';
import { RagModule } from '../rag/rag.module';
import { QuotaModule } from '../quota/quota.module';
import { PracticeModule } from '../practice/practice.module';
import { OnboardingHandler } from '../handlers/onboarding.handler';
import { MainMenuHandler } from '../handlers/main-menu.handler';
import { QaModeHandler } from '../handlers/qa-mode.handler';
import { PracticeModeHandler } from '../handlers/practice-mode.handler';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 30 }]),
    SessionModule,
    UsersModule,
    I18nModule,
    RagModule,
    QuotaModule,
    PracticeModule,
  ],
  controllers: [WhatsappController],
  providers: [
    MessageParserService,
    MessageRouterService,
    CommandHandler,
    MenuHandler,
    FreeTextHandler,
    WhatsappSendService,
    WhatsappRateLimitGuard,
    OnboardingHandler,
    MainMenuHandler,
    QaModeHandler,
    PracticeModeHandler,
  ],
  exports: [WhatsappSendService],
})
export class WhatsappModule {}
