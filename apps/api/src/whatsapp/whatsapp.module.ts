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
import { ProgressModule } from '../progress/progress.module';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { MOCK_EXAM_TIMER_QUEUE_NAME } from '../mock/queues/mock-exam-timer.queue';
import { MockExamTimerProcessor } from '../mock/processors/mock-exam-timer.processor';
import { OnboardingHandler } from '../handlers/onboarding.handler';
import { MainMenuHandler } from '../handlers/main-menu.handler';
import { QaModeHandler } from '../handlers/qa-mode.handler';
import { PracticeModeHandler } from '../handlers/practice-mode.handler';
import { MockExamHandler } from '../handlers/mock-exam.handler';
import { ProgressHandler } from '../handlers/progress.handler';
import { WeeklyReportService } from '../progress/weekly-report.service';
import { MilestoneService } from '../progress/milestone.service';
import { AdminModule } from '../admin/admin.module';
import { BROADCAST_QUEUE_NAME } from '../admin/queues/broadcast.queue';
import { BroadcastProcessor } from '../admin/processors/broadcast.processor';
import { OrchestratorService } from '../orchestrator/orchestrator.service';

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
    ProgressModule,
    // For ToolExecutorService/SystemPromptBuilderService, used by
    // OrchestratorService below - same safe one-way import as AdminModule
    // just below (OrchestratorModule depends on nothing that imports
    // WhatsappModule back).
    OrchestratorModule,
    // For BroadcastService, used by BroadcastProcessor below - a safe
    // one-way import (AdminModule depends on nothing that imports
    // WhatsappModule), unlike the reverse direction MockExamTimerProcessor/
    // WeeklyReportService/MilestoneService all need instead.
    AdminModule,
    // See mock.module.ts's comment: registered here too so
    // MockExamTimerProcessor (which needs WhatsappSendService, only
    // available in this module) can consume the same named queue.
    BullModule.registerQueue({ name: MOCK_EXAM_TIMER_QUEUE_NAME }),
    BullModule.registerQueue({ name: BROADCAST_QUEUE_NAME }),
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
    // Registered here rather than in ProgressModule - it needs
    // WhatsappSendService, only available in this module (same reasoning as
    // MockExamTimerProcessor above; importing WhatsappModule into
    // ProgressModule would be circular, since WhatsappModule already imports
    // ProgressModule for StreakService).
    WeeklyReportService,
    // Same WhatsappSendService reasoning as WeeklyReportService above.
    MilestoneService,
    BroadcastProcessor,
    // Same WhatsappSendService reasoning as ProgressHandler above. Not yet
    // called by anything (router wiring is a later step of this branch) -
    // registered here so it's a real, DI-resolvable service ready to wire in.
    OrchestratorService,
  ],
  exports: [WhatsappSendService],
})
export class WhatsappModule {}
