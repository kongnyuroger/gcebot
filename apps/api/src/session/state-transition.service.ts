import { BadRequestException, Injectable } from '@nestjs/common';
import { ConversationState } from '@gcebot/shared';
import { SessionService } from './session.service';

// The conversation graph. Deliberately not fully-connected: e.g. ONBOARDING can only
// reach LEVEL_SELECTION, and there is no path directly into an active mock exam - it
// must go through MOCK_EXAM_SETUP first. Revisit as the QA/practice/exam/payment
// engines land in later branches.
export const VALID_TRANSITIONS: Map<ConversationState, ConversationState[]> = new Map([
  [ConversationState.ONBOARDING, [ConversationState.LEVEL_SELECTION]],
  [ConversationState.LEVEL_SELECTION, [ConversationState.SUBJECT_SELECTION]],
  [ConversationState.SUBJECT_SELECTION, [ConversationState.MAIN_MENU]],

  [
    ConversationState.MAIN_MENU,
    [
      ConversationState.QA_MODE,
      ConversationState.PRACTICE_FILTER,
      ConversationState.MOCK_EXAM_SETUP,
      ConversationState.SUBSCRIBE,
      ConversationState.SUBJECT_SELECTION,
    ],
  ],

  [ConversationState.QA_MODE, [ConversationState.AWAITING_QUESTION, ConversationState.MAIN_MENU]],
  [ConversationState.AWAITING_QUESTION, [ConversationState.QA_MODE, ConversationState.MAIN_MENU]],

  [
    ConversationState.PRACTICE_FILTER,
    [
      ConversationState.PRACTICE_TOPIC,
      ConversationState.PRACTICE_YEAR,
      ConversationState.PRACTICE_TYPE,
      ConversationState.MAIN_MENU,
    ],
  ],
  [
    ConversationState.PRACTICE_TOPIC,
    [
      ConversationState.PRACTICE_YEAR,
      ConversationState.PRACTICE_TYPE,
      ConversationState.QUESTION_DELIVERY,
      ConversationState.MAIN_MENU,
    ],
  ],
  [
    ConversationState.PRACTICE_YEAR,
    [
      ConversationState.PRACTICE_TOPIC,
      ConversationState.PRACTICE_TYPE,
      ConversationState.QUESTION_DELIVERY,
      ConversationState.MAIN_MENU,
    ],
  ],
  [
    ConversationState.PRACTICE_TYPE,
    [ConversationState.QUESTION_DELIVERY, ConversationState.MAIN_MENU],
  ],

  [
    ConversationState.QUESTION_DELIVERY,
    [ConversationState.ANSWER_EVALUATION, ConversationState.MAIN_MENU],
  ],
  [
    ConversationState.ANSWER_EVALUATION,
    [ConversationState.QUESTION_DELIVERY, ConversationState.MAIN_MENU],
  ],

  [
    ConversationState.MOCK_EXAM_SETUP,
    [ConversationState.MOCK_EXAM_ACTIVE, ConversationState.MAIN_MENU],
  ],
  [ConversationState.MOCK_EXAM_ACTIVE, [ConversationState.MOCK_EXAM_REPORT]],
  [ConversationState.MOCK_EXAM_REPORT, [ConversationState.MAIN_MENU]],

  [ConversationState.SUBSCRIBE, [ConversationState.PAYMENT_INIT, ConversationState.MAIN_MENU]],
  [
    ConversationState.PAYMENT_INIT,
    [ConversationState.PAYMENT_PENDING, ConversationState.SUBSCRIBE],
  ],
  [ConversationState.PAYMENT_PENDING, [ConversationState.MAIN_MENU, ConversationState.SUBSCRIBE]],
]);

@Injectable()
export class StateTransitionService {
  constructor(private readonly sessionService: SessionService) {}

  async transition(phone: string, to: ConversationState): Promise<ConversationState> {
    const session = await this.sessionService.getSession(phone);

    if (!session) {
      throw new BadRequestException(`Cannot transition to ${to}: no active session for ${phone}`);
    }

    const from = session.state;
    const allowedTargets = VALID_TRANSITIONS.get(from) ?? [];

    if (!allowedTargets.includes(to)) {
      throw new BadRequestException(`Invalid state transition: cannot go from ${from} to ${to}`);
    }

    await this.sessionService.updateSessionField(phone, 'state', to);
    return to;
  }
}
