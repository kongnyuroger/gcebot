import { ConfigService } from '@nestjs/config';
import { ConversationState } from '@gcebot/shared';
import { SessionService } from './session.service';

describe('SessionService (integration)', () => {
  let service: SessionService;
  const phone = 'test-integration-237600000001';

  beforeAll(() => {
    const configService = {
      getOrThrow: () => process.env.REDIS_URL,
    } as unknown as ConfigService;
    service = new SessionService(configService);
  });

  afterEach(async () => {
    await service.clearSession(phone);
  });

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  it('returns null when no session exists', async () => {
    expect(await service.getSession(phone)).toBeNull();
  });

  it('sets and gets a session', async () => {
    await service.setSession(phone, { state: ConversationState.ONBOARDING, subject: 'Biology' });

    expect(await service.getSession(phone)).toEqual({
      state: ConversationState.ONBOARDING,
      subject: 'Biology',
    });
  });

  it('updates a single field without clobbering the rest of the session', async () => {
    await service.setSession(phone, { state: ConversationState.ONBOARDING, subject: 'Biology' });
    await service.updateSessionField(phone, 'state', ConversationState.LEVEL_SELECTION);

    expect(await service.getSession(phone)).toEqual({
      state: ConversationState.LEVEL_SELECTION,
      subject: 'Biology',
    });
  });

  it('clears a session', async () => {
    await service.setSession(phone, { state: ConversationState.ONBOARDING });
    await service.clearSession(phone);

    expect(await service.getSession(phone)).toBeNull();
  });

  it('sets a TTL of 2 hours on the session key', async () => {
    await service.setSession(phone, { state: ConversationState.ONBOARDING });

    const ttl = await (
      service as unknown as { client: { ttl(key: string): Promise<number> } }
    ).client.ttl(`session:${phone}`);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(7200);
  });

  it('actually expires the session once its TTL elapses', async () => {
    const client = (service as unknown as { client: { set(...args: unknown[]): Promise<unknown> } })
      .client;
    await client.set(
      `session:${phone}`,
      JSON.stringify({ state: ConversationState.ONBOARDING }),
      'EX',
      1,
    );

    expect(await service.getSession(phone)).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(await service.getSession(phone)).toBeNull();
  }, 10_000);
});
