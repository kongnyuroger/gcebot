import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PracticeModule } from '../practice/practice.module';
import { MockPaperService } from './mock-paper.service';
import { MockTimerService } from './mock-timer.service';
import { MOCK_EXAM_TIMER_QUEUE_NAME } from './queues/mock-exam-timer.queue';

@Module({
  imports: [
    PracticeModule,
    // Registered here (for MockTimerService's producer side) AND again in
    // WhatsappModule (for MockExamTimerProcessor's consumer side, which needs
    // WhatsappSendService and can't live here without a circular import back
    // to WhatsappModule) - Nest+Bull share the same underlying queue across
    // any module that registers the same queue name against the one global
    // Bull connection (configured once via forRootAsync in RagModule).
    BullModule.registerQueue({ name: MOCK_EXAM_TIMER_QUEUE_NAME }),
  ],
  providers: [MockPaperService, MockTimerService],
  exports: [MockPaperService, MockTimerService],
})
export class MockModule {}
