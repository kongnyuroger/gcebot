import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PracticeModule } from '../practice/practice.module';
import { SessionModule } from '../session/session.module';
import { RagModule } from '../rag/rag.module';
import { I18nModule } from '../i18n/i18n.module';
import { MockPaperService } from './mock-paper.service';
import { MockTimerService } from './mock-timer.service';
import { MockGradingService } from './mock-grading.service';
import { MockReportService } from './mock-report.service';
import { MOCK_EXAM_TIMER_QUEUE_NAME } from './queues/mock-exam-timer.queue';

@Module({
  imports: [
    PracticeModule,
    SessionModule,
    RagModule, // for LlmService, used by MockGradingService/MockReportService
    I18nModule, // for I18nService, used by MockReportService
    // Registered here (for MockTimerService's producer side) AND again in
    // WhatsappModule (for MockExamTimerProcessor's consumer side, which needs
    // WhatsappSendService and can't live here without a circular import back
    // to WhatsappModule) - Nest+Bull share the same underlying queue across
    // any module that registers the same queue name against the one global
    // Bull connection (configured once via forRootAsync in RagModule).
    BullModule.registerQueue({ name: MOCK_EXAM_TIMER_QUEUE_NAME }),
  ],
  providers: [MockPaperService, MockTimerService, MockGradingService, MockReportService],
  exports: [MockPaperService, MockTimerService, MockGradingService, MockReportService],
})
export class MockModule {}
