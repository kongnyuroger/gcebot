import { Queue } from 'bull';
import {
  JOB_TYPE_30_MIN_WARNING,
  JOB_TYPE_10_MIN_WARNING,
  JOB_TYPE_AUTO_SUBMIT,
  MockExamTimerJobPayload,
} from './queues/mock-exam-timer.queue';
import { MockTimerService } from './mock-timer.service';

const THIRTY_MIN_MS = 30 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;
// Generous tolerance for the real Date.now() calls inside scheduleJob -
// this test isn't asserting exact wall-clock timing, just that each job's
// delay is targeting the right point relative to endTime.
const DELAY_TOLERANCE_MS = 2000;

describe('MockTimerService', () => {
  let service: MockTimerService;
  let add: jest.Mock;
  let getJob: jest.Mock;

  const phone = '237670000011';
  const examId = 'exam-1';

  beforeEach(() => {
    add = jest.fn().mockResolvedValue({ id: 'job-id' });
    getJob = jest.fn();

    service = new MockTimerService({ add, getJob } as unknown as Queue<MockExamTimerJobPayload>);
  });

  describe('scheduleTimers', () => {
    it('schedules exactly 3 jobs: 30-min warning, 10-min warning, and auto-submit', async () => {
      const endTime = Date.now() + 90 * 60 * 1000;

      await service.scheduleTimers(phone, examId, endTime);

      expect(add).toHaveBeenCalledTimes(3);
      const jobTypes = add.mock.calls.map((call) => call[0]);
      expect(jobTypes).toEqual([
        JOB_TYPE_30_MIN_WARNING,
        JOB_TYPE_10_MIN_WARNING,
        JOB_TYPE_AUTO_SUBMIT,
      ]);
    });

    it('passes the phone and examId as the job payload for every job type', async () => {
      const endTime = Date.now() + 90 * 60 * 1000;

      await service.scheduleTimers(phone, examId, endTime);

      for (const call of add.mock.calls) {
        expect(call[1]).toEqual({ phone, examId });
      }
    });

    it('schedules each job with a delay targeting the right point relative to endTime', async () => {
      const endTime = Date.now() + 90 * 60 * 1000;
      const before = Date.now();

      await service.scheduleTimers(phone, examId, endTime);

      const [, , warning30Opts] = add.mock.calls[0];
      const [, , warning10Opts] = add.mock.calls[1];
      const [, , autoSubmitOpts] = add.mock.calls[2];

      // delay = targetTime - Date.now(), so it can only be as small as
      // (targetTime - before) once test execution time is accounted for -
      // a tolerance window covers that gap either side.
      expect(Math.abs(warning30Opts.delay - (endTime - THIRTY_MIN_MS - before))).toBeLessThan(
        DELAY_TOLERANCE_MS,
      );
      expect(Math.abs(warning10Opts.delay - (endTime - TEN_MIN_MS - before))).toBeLessThan(
        DELAY_TOLERANCE_MS,
      );
      expect(Math.abs(autoSubmitOpts.delay - (endTime - before))).toBeLessThan(DELAY_TOLERANCE_MS);
    });

    it('clamps a negative delay (endTime already in the past) to 0 rather than rejecting', async () => {
      // 5 minutes total - shorter than the 30-min-warning offset, so that
      // warning's target time is already behind "now".
      const endTime = Date.now() + 5 * 60 * 1000;

      await service.scheduleTimers(phone, examId, endTime);

      const [, , warning30Opts] = add.mock.calls[0];
      expect(warning30Opts.delay).toBe(0);
    });

    it('derives each job id from examId + job type, so they are individually cancellable', async () => {
      const endTime = Date.now() + 90 * 60 * 1000;

      await service.scheduleTimers(phone, examId, endTime);

      expect(add.mock.calls[0][2].jobId).toBe(`${examId}:${JOB_TYPE_30_MIN_WARNING}`);
      expect(add.mock.calls[1][2].jobId).toBe(`${examId}:${JOB_TYPE_10_MIN_WARNING}`);
      expect(add.mock.calls[2][2].jobId).toBe(`${examId}:${JOB_TYPE_AUTO_SUBMIT}`);
    });

    it('returns the string ids of all 3 scheduled jobs', async () => {
      add
        .mockResolvedValueOnce({ id: 'job-30' })
        .mockResolvedValueOnce({ id: 'job-10' })
        .mockResolvedValueOnce({ id: 'job-auto' });

      const jobIds = await service.scheduleTimers(phone, examId, Date.now() + 90 * 60 * 1000);

      expect(jobIds).toEqual(['job-30', 'job-10', 'job-auto']);
    });
  });

  describe('cancelTimers', () => {
    it('removes every job that is still found in the queue', async () => {
      const remove1 = jest.fn();
      const remove2 = jest.fn();
      getJob.mockImplementation((jobId: string) =>
        Promise.resolve(jobId === 'job-1' ? { remove: remove1 } : { remove: remove2 }),
      );

      await service.cancelTimers(['job-1', 'job-2']);

      expect(remove1).toHaveBeenCalledTimes(1);
      expect(remove2).toHaveBeenCalledTimes(1);
    });

    it('skips job ids that no longer exist in the queue, without throwing', async () => {
      getJob.mockResolvedValue(null);

      await expect(service.cancelTimers(['gone-job'])).resolves.toBeUndefined();
    });

    it('swallows a job.remove() failure (already active/locked) instead of throwing', async () => {
      const remove = jest.fn().mockRejectedValue(new Error('Could not remove job'));
      getJob.mockResolvedValue({ remove });

      await expect(service.cancelTimers(['locked-job'])).resolves.toBeUndefined();
      expect(remove).toHaveBeenCalledTimes(1);
    });

    it('still removes the other jobs even when one fails to cancel', async () => {
      const failingRemove = jest.fn().mockRejectedValue(new Error('Could not remove job'));
      const succeedingRemove = jest.fn();
      getJob.mockImplementation((jobId: string) =>
        Promise.resolve(
          jobId === 'locked-job' ? { remove: failingRemove } : { remove: succeedingRemove },
        ),
      );

      await service.cancelTimers(['locked-job', 'cancellable-job']);

      expect(succeedingRemove).toHaveBeenCalledTimes(1);
    });
  });
});
