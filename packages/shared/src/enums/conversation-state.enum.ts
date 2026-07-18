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

export interface SessionContext {
  state: ConversationState;
  subject?: string;
  topic?: string;
  currentQuestionId?: string;
  // The free-text question currently being answered in QA_MODE - distinct from
  // currentQuestionId (which references a specific Question record in practice
  // mode), since a QA question has no DB record of its own. Used by /hint.
  currentQuestionText?: string;
  examId?: string;
  pendingPaymentId?: string;
  conversationHistory?: ConversationMessage[];
  // Subjects the user has tapped during onboarding's SUBJECT_SELECTION step,
  // held here until they press "Confirm" and it's persisted via UsersService.
  pendingSubjects?: string[];
}
