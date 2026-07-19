import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
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
import { MockModule } from '../mock/mock.module';
import { MOCK_EXAM_TIMER_QUEUE_NAME } from '../mock/queues/mock-exam-timer.queue';
import { MockExamTimerProcessor } from '../mock/processors/mock-exam-timer.processor';
import { OnboardingHandler } from '../handlers/onboarding.handler';
import { MainMenuHandler } from '../handlers/main-menu.handler';
import { QaModeHandler } from '../handlers/qa-mode.handler';
import { PracticeModeHandler } from '../handlers/practice-mode.handler';
import { MockExamHandler } from '../handlers/mock-exam.handler';
import { ProgressHandler } from '../handlers/progress.handler';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 30 }]),
    SessionModule,
    UsersModule,
    I18nModule,
    RagModule,
    QuotaModule,
    PracticeModule,
    MockModule,
    // See mock.module.ts's comment: registered here too so
    // MockExamTimerProcessor (which needs WhatsappSendService, only
    // available in this module) can consume the same named queue.
    BullModule.registerQueue({ name: MOCK_EXAM_TIMER_QUEUE_NAME }),
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
    MockExamHandler,
    MockExamTimerProcessor,
    ProgressHandler,
  ],
  exports: [WhatsappSendService],
})
export class WhatsappModule {}
