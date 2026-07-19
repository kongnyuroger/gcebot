import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { Language } from '../../../generated/prisma';
import { UsersService } from '../../users/users.service';
import { I18nService } from '../../i18n/i18n.service';
import { WhatsappSendService } from '../../whatsapp/services/whatsapp-send.service';
import { MockExamHandler } from '../../handlers/mock-exam.handler';
import {
  MOCK_EXAM_TIMER_QUEUE_NAME,
  MockExamTimerJobPayload,
  JOB_TYPE_30_MIN_WARNING,
  JOB_TYPE_10_MIN_WARNING,
  JOB_TYPE_AUTO_SUBMIT,
} from '../queues/mock-exam-timer.queue';

@Processor(MOCK_EXAM_TIMER_QUEUE_NAME)
export class MockExamTimerProcessor {
  private readonly logger = new Logger(MockExamTimerProcessor.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly i18n: I18nService,
    private readonly whatsappSendService: WhatsappSendService,
    private readonly mockExamHandler: MockExamHandler,
  ) {}

  @Process(JOB_TYPE_30_MIN_WARNING)
  async handleThirtyMinWarning(job: Job<MockExamTimerJobPayload>): Promise<void> {
    await this.sendTimerMessage(job.data.phone, 'mock.thirtyMinWarning');
  }

  @Process(JOB_TYPE_10_MIN_WARNING)
  async handleTenMinWarning(job: Job<MockExamTimerJobPayload>): Promise<void> {
    await this.sendTimerMessage(job.data.phone, 'mock.tenMinWarning');
  }

  @Process(JOB_TYPE_AUTO_SUBMIT)
  async handleAutoSubmit(job: Job<MockExamTimerJobPayload>): Promise<void> {
    this.logger.log(`Auto-submit fired for exam ${job.data.examId} (phone ${job.data.phone})`);
    await this.sendTimerMessage(job.data.phone, 'mock.autoSubmit');
    // Shares the exact same finish-up logic (cancel timers, transition state,
    // confirm submission) as a manual early /submit or the last question
    // being answered - submitExam guards against a redundant call if the
    // student already submitted through one of those paths first.
    await this.mockExamHandler.submitExam(job.data.phone);
  }

  private async sendTimerMessage(phone: string, i18nKey: string): Promise<void> {
    const user = await this.usersService.getUserProfile(phone);
    const lang = user?.language ?? Language.EN;
    await this.whatsappSendService.sendText(phone, this.i18n.t(i18nKey, lang));
  }
}
