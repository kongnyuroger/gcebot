import { NotFoundException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { QuotaService } from '../quota/quota.service';
import { SystemPromptBuilderService } from './system-prompt-builder.service';

describe('SystemPromptBuilderService', () => {
  let getUserProfile: jest.Mock;
  let checkQuota: jest.Mock;
  let service: SystemPromptBuilderService;

  const phone = '237670000011';

  function buildUser(overrides: Record<string, unknown> = {}) {
    return {
      level: 'O_LEVEL',
      subjects: ['Mathematics', 'Physics'],
      tier: 'FREE',
      streakDays: 5,
      language: 'EN',
      ...overrides,
    };
  }

  beforeEach(() => {
    getUserProfile = jest.fn().mockResolvedValue(buildUser());
    checkQuota = jest.fn().mockResolvedValue({ allowed: true, used: 2, limit: 10 });

    service = new SystemPromptBuilderService(
      { getUserProfile } as unknown as UsersService,
      { checkQuota } as unknown as QuotaService,
    );
  });

  it("includes the student's level, subjects, plan, streak, and language", async () => {
    const prompt = await service.build(phone);

    expect(prompt).toContain('O-Level');
    expect(prompt).toContain('Mathematics, Physics');
    expect(prompt).toContain('Free');
    expect(prompt).toContain('5 day(s)');
    expect(prompt).toContain('English');
  });

  it('instructs the model to match whichever language the student writes in', async () => {
    const prompt = await service.build(phone);

    expect(prompt).toMatch(/switch and reply in that language/i);
  });

  it('falls back to "none registered yet" when the student has no subjects', async () => {
    getUserProfile.mockResolvedValue(buildUser({ subjects: [] }));

    const prompt = await service.build(phone);

    expect(prompt).toContain('none registered yet');
  });

  it('checks quota for FREE-tier students but omits the line when quota is comfortable', async () => {
    checkQuota.mockResolvedValue({ allowed: true, used: 1, limit: 10 });

    const prompt = await service.build(phone);

    expect(checkQuota).toHaveBeenCalledWith(phone);
    expect(prompt).not.toContain('Free questions left today');
  });

  it('surfaces a quota warning once the student is close to the daily limit', async () => {
    checkQuota.mockResolvedValue({ allowed: true, used: 8, limit: 10 });

    const prompt = await service.build(phone);

    expect(prompt).toContain('Free questions left today: 2 of 10');
  });

  it('reports the limit as reached once quota is fully used', async () => {
    checkQuota.mockResolvedValue({ allowed: false, used: 10, limit: 10 });

    const prompt = await service.build(phone);

    expect(prompt).toContain('Free questions left today: 0 (daily limit reached)');
  });

  it('never checks quota for a paid tier', async () => {
    getUserProfile.mockResolvedValue(buildUser({ tier: 'PREMIUM' }));

    const prompt = await service.build(phone);

    expect(checkQuota).not.toHaveBeenCalled();
    expect(prompt).not.toContain('Free questions left today');
  });

  it('throws when the user does not exist', async () => {
    getUserProfile.mockResolvedValue(null);

    await expect(service.build(phone)).rejects.toThrow(NotFoundException);
  });
});
