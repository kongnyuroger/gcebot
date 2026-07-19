import { PrismaService } from '../prisma/prisma.service';
import { Language, Level } from '../../generated/prisma';
import { UsersService } from './users.service';

describe('UsersService (integration)', () => {
  let prisma: PrismaService;
  let service: UsersService;
  const phone = 'test-integration-237600000003';

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new UsersService(prisma);
  });

  afterEach(async () => {
    await prisma.subscription.deleteMany({ where: { userId: phone } });
    await prisma.user.deleteMany({ where: { phone_number: phone } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a user on first upsert and generates a referral code', async () => {
    expect(await service.isNewUser(phone)).toBe(true);

    const user = await service.upsertUser(phone);

    expect(user.phone_number).toBe(phone);
    expect(user.tier).toBe('FREE');
    expect(user.referralCode).toHaveLength(8);
    expect(await service.isNewUser(phone)).toBe(false);
  });

  it('returns the same user on a second upsert call, without creating a duplicate', async () => {
    const first = await service.upsertUser(phone);
    const second = await service.upsertUser(phone);

    expect(second.phone_number).toBe(first.phone_number);
    expect(second.referralCode).toBe(first.referralCode);

    const count = await prisma.user.count({ where: { phone_number: phone } });
    expect(count).toBe(1);
  });

  it('updates level, subjects, and language', async () => {
    await service.upsertUser(phone);

    expect((await service.updateLevel(phone, Level.A_LEVEL)).level).toBe('A_LEVEL');
    expect((await service.updateSubjects(phone, ['Biology', 'Physics'])).subjects).toEqual([
      'Biology',
      'Physics',
    ]);
    expect((await service.updateLanguage(phone, Language.FR)).language).toBe('FR');
  });

  it('includes the active subscription in the user profile', async () => {
    await service.upsertUser(phone);
    await prisma.subscription.create({
      data: {
        userId: phone,
        tier: 'PREMIUM',
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        paymentMethod: 'MTN_MOMO',
        paymentReference: 'INTEGRATION-TEST-REF',
      },
    });

    const profile = await service.getUserProfile(phone);
    expect(profile?.subscription?.tier).toBe('PREMIUM');
  });
});
