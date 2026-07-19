export enum ConversationState {
  ONBOARDING = 'ONBOARDING',
  LEVEL_SELECTION = 'LEVEL_SELECTION',
  SUBJECT_SELECTION = 'SUBJECT_SELECTION',
  MAIN_MENU = 'MAIN_MENU',
  QA_MODE = 'QA_MODE',
  AWAITING_QUESTION = 'AWAITING_QUESTION',
  PRACTICE_FILTER = 'PRACTICE_FILTER',
  PRACTICE_TOPIC = 'PRACTICE_TOPIC',
  PRACTICE_YEAR = 'PRACTICE_YEAR',
  PRACTICE_TYPE = 'PRACTICE_TYPE',
  QUESTION_DELIVERY = 'QUESTION_DELIVERY',
  ANSWER_EVALUATION = 'ANSWER_EVALUATION',
  MOCK_EXAM_SETUP = 'MOCK_EXAM_SETUP',
  MOCK_EXAM_ACTIVE = 'MOCK_EXAM_ACTIVE',
  MOCK_EXAM_REPORT = 'MOCK_EXAM_REPORT',
  SUBSCRIBE = 'SUBSCRIBE',
  PAYMENT_INIT = 'PAYMENT_INIT',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Filters collected across PRACTICE_FILTER -> PRACTICE_TOPIC -> PRACTICE_YEAR
// -> PRACTICE_TYPE. Undefined fields mean "any" (the user picked the
// corresponding "All Topics" / "Any Year" / "Any" option).
export interface PracticeFilterState {
  subject?: string;
  topic?: string;
  yearRange?: string;
  type?: string;
  // EmbeddingChunk ids already delivered this practice session, so the same
  // question is never served twice in a row.
  seenIds?: string[];
}

export interface SessionContext {
  state: ConversationState;
  subject?: string;
  topic?: string;
  currentQuestionId?: string;
  // The free-text question currently being answered - in QA_MODE this is the
  // student's own question; in ANSWER_EVALUATION (practice mode) it's the
  // delivered past-question text. Used by /hint in both modes.
  currentQuestionText?: string;
  examId?: string;
  pendingPaymentId?: string;
  conversationHistory?: ConversationMessage[];
  // Subjects the user has tapped during onboarding's SUBJECT_SELECTION step,
  // held here until they press "Confirm" and it's persisted via UsersService.
  pendingSubjects?: string[];
  practice?: PracticeFilterState;
  // The actual type of the currently-delivered question (always concrete -
  // MCQ or STRUCTURED - never "any", even if practice.type filter was "Any").
  questionType?: string;
  markingSchemeChunkId?: string;
  // The specific topic of the currently-delivered question - distinct from
  // practice.topic, which is the user's filter selection and may be "any"
  // (undefined). Used by the "Retry Topic" post-answer navigation option.
  currentQuestionTopic?: string;
}
