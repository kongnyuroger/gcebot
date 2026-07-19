import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  MOCK_EXAM_TIMER_QUEUE_NAME,
  MockExamTimerJobPayload,
  JOB_TYPE_30_MIN_WARNING,
  JOB_TYPE_10_MIN_WARNING,
  JOB_TYPE_AUTO_SUBMIT,
} from './queues/mock-exam-timer.queue';

const THIRTY_MIN_MS = 30 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;

@Injectable()
export class MockTimerService {
  private readonly logger = new Logger(MockTimerService.name);

  constructor(
    @InjectQueue(MOCK_EXAM_TIMER_QUEUE_NAME)
    private readonly queue: Queue<MockExamTimerJobPayload>,
  ) {}

  // Schedules the 3 delayed jobs relative to endTime and returns their job
  // ids, so the caller can store them in session for early-submit cancellation.
  async scheduleTimers(phone: string, examId: string, endTime: number): Promise<string[]> {
    const payload: MockExamTimerJobPayload = { phone, examId };

    const jobs = await Promise.all([
      this.scheduleJob(JOB_TYPE_30_MIN_WARNING, payload, endTime - THIRTY_MIN_MS, examId),
      this.scheduleJob(JOB_TYPE_10_MIN_WARNING, payload, endTime - TEN_MIN_MS, examId),
      this.scheduleJob(JOB_TYPE_AUTO_SUBMIT, payload, endTime, examId),
    ]);

    this.logger.log(`Scheduled ${jobs.length} timer jobs for exam ${examId}`);
    return jobs.map((job) => String(job.id));
  }

  // Called on early /submit, so a student who finishes ahead of time doesn't
  // get a stale "10 minutes left!" warning or an auto-submit after they've
  // already submitted.
  async cancelTimers(jobIds: string[]): Promise<void> {
    await Promise.all(
      jobIds.map(async (jobId) => {
        try {
          const job = await this.queue.getJob(jobId);
          if (job) {
            await job.remove();
          }
        } catch (error) {
          // Bull's Job.remove() throws (rather than no-op) if the job is
          // already active/locked - e.g. a submit landing at the exact moment
          // a warning fires. That message may still go out this one time,
          // which is harmless; it must not crash the early-submit flow.
          this.logger.warn(
            `Could not cancel timer job ${jobId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );
  }

  private scheduleJob(
    jobType: string,
    payload: MockExamTimerJobPayload,
    targetTime: number,
    examId: string,
  ) {
    // Clamps negative delays to 0 rather than letting Bull reject them -
    // real exam durations (90/120/150 min) always exceed 30 min, but this is
    // cheap insurance against a pathologically short paper.
    const delay = Math.max(0, targetTime - Date.now());
    return this.queue.add(jobType, payload, { delay, jobId: `${examId}:${jobType}` });
  }
}
