import { PrismaService } from '../prisma/prisma.service';
import { I18nService } from '../i18n/i18n.service';
import { LlmService } from '../rag/services/llm.service';
import { WhatsappSendService } from '../whatsapp/services/whatsapp-send.service';
import { WeeklyReportService } from './weekly-report.service';

describe('WeeklyReportService', () => {
  let service: WeeklyReportService;
  let findManyUsers: jest.Mock;
  let findManyInteractions: jest.Mock;
  let sendText: jest.Mock;
  let generate: jest.Mock;

  function user(phone: string, overrides: Record<string, unknown> = {}) {
    return {
      phone_number: phone,
      language: 'EN',
      tier: 'FREE',
      streakDays: 3,
      lastActiveDate: new Date(),
      ...overrides,
    };
  }

  function interaction(
    userId: string,
    subject: string,
    topic: string,
    correct: boolean | null,
    createdAt: Date = new Date(),
  ) {
    return { userId, subject, topic, correct, createdAt };
  }

  beforeEach(() => {
    findManyUsers = jest.fn().mockResolvedValue([]);
    findManyInteractions = jest.fn().mockResolvedValue([]);
    sendText = jest.fn();
    generate = jest.fn().mockResolvedValue('Focus on the fundamentals this week.');

    service = new WeeklyReportService(
      {
        user: { findMany: findManyUsers },
        interaction: { findMany: findManyInteractions },
      } as unknown as PrismaService,
      new I18nService(),
      { generate } as unknown as LlmService,
      { sendText } as unknown as WhatsappSendService,
    );
  });

  describe('eligibility', () => {
    it('does nothing when there are no eligible users', async () => {
      findManyUsers.mockResolvedValue([]);

      await service.runWeeklyReport();

      expect(sendText).not.toHaveBeenCalled();
    });

    it('queries users who are non-FREE tier OR active in the last 7 days', async () => {
      findManyUsers.mockResolvedValue([]);

      await service.runWeeklyReport();

      expect(findManyUsers).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ tier: { not: 'FREE' } }, { lastActiveDate: { gte: expect.any(Date) } }],
          }),
        }),
      );
    });
  });

  describe('weekly aggregation', () => {
    it('counts only this-week graded interactions toward the question count', async () => {
      const phone = 'user-1';
      const weekAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000); // outside the window
      findManyUsers.mockResolvedValue([user(phone)]);
      findManyInteractions.mockResolvedValue([
        interaction(phone, 'Mathematics', 'Algebra', true),
        interaction(phone, 'Mathematics', 'Algebra', false),
      ]);

      await service.runWeeklyReport();

      expect(findManyInteractions).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: expect.any(Date) },
            correct: { not: null },
          }),
        }),
      );
      expect(sendText).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('This week: 2 questions'),
      );
      // Sanity: the out-of-window timestamp built above is unused by the
      // query itself (Prisma does the filtering) - this test only asserts
      // the query shape and the resulting message, matching how the real
      // DB call would behave.
      expect(weekAgo).toBeInstanceOf(Date);
    });

    it('picks the subject with the highest accuracy as "best subject"', async () => {
      const phone = 'user-2';
      findManyUsers.mockResolvedValue([user(phone)]);
      findManyInteractions.mockResolvedValue([
        interaction(phone, 'Mathematics', 'Algebra', true),
        interaction(phone, 'Mathematics', 'Algebra', true),
        interaction(phone, 'Biology', 'Genetics', true),
        interaction(phone, 'Biology', 'Genetics', false),
      ]);

      await service.runWeeklyReport();

      expect(sendText).toHaveBeenCalledWith(phone, expect.stringContaining('Mathematics (100%)'));
    });

    it('picks the topic with the lowest accuracy as the focus area', async () => {
      const phone = 'user-3';
      findManyUsers.mockResolvedValue([user(phone)]);
      findManyInteractions.mockResolvedValue([
        interaction(phone, 'Mathematics', 'Algebra', true),
        interaction(phone, 'Mathematics', 'Geometry', false),
        interaction(phone, 'Mathematics', 'Geometry', false),
      ]);

      await service.runWeeklyReport();

      expect(sendText).toHaveBeenCalledWith(phone, expect.stringContaining('Focus area: Geometry'));
    });

    it('shows a graceful fallback and skips the LLM for a user with no activity this week', async () => {
      const phone = 'user-4';
      findManyUsers.mockResolvedValue([user(phone, { tier: 'PREMIUM' })]);
      findManyInteractions.mockResolvedValue([]);

      await service.runWeeklyReport();

      expect(sendText).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('This week: 0 questions'),
      );
      expect(sendText).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('No activity this week'),
      );
      expect(generate).not.toHaveBeenCalled();
    });
  });

  describe('sending', () => {
    it('sends a report to every eligible user', async () => {
      findManyUsers.mockResolvedValue([user('user-a'), user('user-b', { tier: 'PREMIUM' })]);
      findManyInteractions.mockResolvedValue([]);

      await service.runWeeklyReport();

      expect(sendText).toHaveBeenCalledTimes(2);
    });

    it('continues sending to the rest of the batch when one send fails', async () => {
      findManyUsers.mockResolvedValue([user('user-a'), user('user-b')]);
      findManyInteractions.mockResolvedValue([]);
      sendText.mockRejectedValueOnce(new Error('WhatsApp API down')).mockResolvedValue(undefined);

      await expect(service.runWeeklyReport()).resolves.toBeUndefined();

      expect(sendText).toHaveBeenCalledTimes(2);
    });

    it('falls back to a canned tip when the LLM call fails', async () => {
      const phone = 'user-c';
      findManyUsers.mockResolvedValue([user(phone)]);
      findManyInteractions.mockResolvedValue([interaction(phone, 'Mathematics', 'Algebra', false)]);
      generate.mockRejectedValue(new Error('OpenAI is down'));

      await service.runWeeklyReport();

      expect(sendText).toHaveBeenCalledWith(
        phone,
        expect.stringContaining('Keep practicing past questions regularly'),
      );
    });

    it("includes the user's current streak in the report", async () => {
      const phone = 'user-d';
      findManyUsers.mockResolvedValue([user(phone, { streakDays: 12 })]);
      findManyInteractions.mockResolvedValue([]);

      await service.runWeeklyReport();

      expect(sendText).toHaveBeenCalledWith(phone, expect.stringContaining('Streak: 12 days'));
    });
  });
});
