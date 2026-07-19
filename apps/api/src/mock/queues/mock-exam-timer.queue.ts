export const MOCK_EXAM_TIMER_QUEUE_NAME = 'mock-exam-timer';

export const JOB_TYPE_30_MIN_WARNING = '30_MIN_WARNING';
export const JOB_TYPE_10_MIN_WARNING = '10_MIN_WARNING';
export const JOB_TYPE_AUTO_SUBMIT = 'AUTO_SUBMIT';

export interface MockExamTimerJobPayload {
  phone: string;
  examId: string;
}
