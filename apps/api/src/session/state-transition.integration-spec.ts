import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationState } from '@gcebot/shared';
import { SessionService } from './session.service';
import { StateTransitionService } from './state-transition.service';

describe('StateTransitionService (integration)', () => {
  let sessionService: SessionService;
  let transitionService: StateTransitionService;
  const phone = 'test-integration-237600000002';

  beforeAll(() => {
    const configService = {
      getOrThrow: () => process.env.REDIS_URL,
    } as unknown as ConfigService;
    sessionService = new SessionService(configService);
    transitionService = new StateTransitionService(sessionService);
  });

  afterEach(async () => {
    await sessionService.clearSession(phone);
  });

  afterAll(async () => {
    await sessionService.onModuleDestroy();
  });

  it('throws when there is no active session to transition from', async () => {
    await expect(
      transitionService.transition(phone, ConversationState.LEVEL_SELECTION),
    ).rejects.toThrow(BadRequestException);
  });

  it('walks the valid onboarding path: ONBOARDING -> LEVEL_SELECTION -> SUBJECT_SELECTION -> MAIN_MENU', async () => {
    await sessionService.setSession(phone, { state: ConversationState.ONBOARDING });

    await expect(
      transitionService.transition(phone, ConversationState.LEVEL_SELECTION),
    ).resolves.toBe(ConversationState.LEVEL_SELECTION);

    await expect(
      transitionService.transition(phone, ConversationState.SUBJECT_SELECTION),
    ).resolves.toBe(ConversationState.SUBJECT_SELECTION);

    await expect(transitionService.transition(phone, ConversationState.MAIN_MENU)).resolves.toBe(
      ConversationState.MAIN_MENU,
    );

    expect(await sessionService.getSession(phone)).toEqual({ state: ConversationState.MAIN_MENU });
  });

  it('rejects an invalid transition and leaves the session state unchanged', async () => {
    await sessionService.setSession(phone, { state: ConversationState.ONBOARDING });

    await expect(
      transitionService.transition(phone, ConversationState.MOCK_EXAM_ACTIVE),
    ).rejects.toThrow(BadRequestException);

    expect(await sessionService.getSession(phone)).toEqual({ state: ConversationState.ONBOARDING });
  });
});
