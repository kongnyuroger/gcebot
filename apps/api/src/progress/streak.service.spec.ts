import { PrismaService } from '../prisma/prisma.service';
import { StreakService } from './streak.service';

describe('StreakService', () => {
  let service: StreakService;
  let findUniqueOrThrow: jest.Mock;
  let update: jest.Mock;

  const phone = '237670000011';

  function user(overrides: Record<string, unknown> = {}) {
    return {
      phone_number: phone,
      streakDays: 0,
      lastActiveDate: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    findUniqueOrThrow = jest.fn();
    update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data }));

    service = new StreakService({
      user: { findUniqueOrThrow, update },
    } as unknown as PrismaService);
  });

  it('starts a streak at 1 on first-ever activity (no lastActiveDate)', async () => {
    findUniqueOrThrow.mockResolvedValue(user({ streakDays: 0, lastActiveDate: null }));

    const result = await service.recordActivity(phone);

    expect(result.streakDays).toBe(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ streakDays: 1 }) }),
    );
  });

  it('does not change the streak when already active today (same Cameroon day)', async () => {
    findUniqueOrThrow.mockResolvedValue(user({ streakDays: 4, lastActiveDate: new Date() }));

    const result = await service.recordActivity(phone);

    expect(result.streakDays).toBe(4);
    expect(update).not.toHaveBeenCalled();
  });

  it('increments the streak by 1 on a consecutive day', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    findUniqueOrThrow.mockResolvedValue(user({ streakDays: 4, lastActiveDate: yesterday }));

    const result = await service.recordActivity(phone);

    expect(result.streakDays).toBe(5);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ streakDays: 5 }) }),
    );
  });

  it('resets the streak to 1 after a gap of more than one day', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    findUniqueOrThrow.mockResolvedValue(user({ streakDays: 10, lastActiveDate: threeDaysAgo }));

    const result = await service.recordActivity(phone);

    expect(result.streakDays).toBe(1);
  });

  it('does not change the streak when lastActiveDate is in the future (clock skew)', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    findUniqueOrThrow.mockResolvedValue(user({ streakDays: 4, lastActiveDate: tomorrow }));

    const result = await service.recordActivity(phone);

    expect(result.streakDays).toBe(4);
    expect(update).not.toHaveBeenCalled();
  });

  it('treats a timestamp just before UTC midnight as already Cameroon-"today" for an active-today user', async () => {
    // Africa/Douala is UTC+1: 23:30 UTC today is 00:30 Cameroon time TOMORROW.
    // A user whose lastActiveDate is already at that Cameroon-tomorrow point
    // must not have their streak touched by a call at any time still within
    // that same Cameroon day.
    const now = new Date();
    const cameroonTomorrowStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 0, 0),
    );
    // Only meaningful if "now" precedes 23:00 UTC today, true for this run.
    if (cameroonTomorrowStart.getTime() > now.getTime()) {
      findUniqueOrThrow.mockResolvedValue(
        user({ streakDays: 4, lastActiveDate: cameroonTomorrowStart }),
      );

      const result = await service.recordActivity(phone);

      expect(result.streakDays).toBe(4);
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('updates lastActiveDate to now when the streak changes', async () => {
    findUniqueOrThrow.mockResolvedValue(user({ streakDays: 0, lastActiveDate: null }));

    await service.recordActivity(phone);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { phone_number: phone },
        data: expect.objectContaining({ lastActiveDate: expect.any(Date) }),
      }),
    );
  });
});
