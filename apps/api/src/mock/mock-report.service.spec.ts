import { PrismaService } from '../prisma/prisma.service';
import { I18nService } from '../i18n/i18n.service';
import { LlmService } from '../rag/services/llm.service';
import { ResponseFormatterService } from '../rag/services/response-formatter.service';
import { MockReportService } from './mock-report.service';

describe('MockReportService', () => {
  let service: MockReportService;
  let findUniqueMockExam: jest.Mock;
  let findUniqueUser: jest.Mock;
  let generate: jest.Mock;

  function mockExam(overrides: Record<string, unknown> = {}) {
    return {
      id: 'exam-1',
      userId: '237670000011',
      subject: 'Mathematics',
      level: 'O_LEVEL',
      startedAt: new Date('2024-01-01T10:00:00Z'),
      submittedAt: new Date('2024-01-01T10:45:00Z'),
      score: 14,
      maxScore: 20,
      topicBreakdown: {
        Algebra: { scored: 9, possible: 10 },
        Geometry: { scored: 5, possible: 10 },
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    findUniqueMockExam = jest.fn();
    findUniqueUser = jest.fn().mockResolvedValue({ language: 'EN' });
    generate = jest.fn().mockResolvedValue('Practice more geometry problems daily.');

    service = new MockReportService(
      {
        mockExam: { findUnique: findUniqueMockExam },
        user: { findUnique: findUniqueUser },
      } as unknown as PrismaService,
      new I18nService(),
      { generate } as unknown as LlmService,
      new ResponseFormatterService(),
    );
  });

  it('returns a fallback message when the exam does not exist', async () => {
    findUniqueMockExam.mockResolvedValue(null);

    const report = await service.generateReport('nonexistent-exam-id');

    expect(report).toHaveLength(1);
    expect(report[0]).toMatch(/couldn't find/i);
    expect(findUniqueUser).not.toHaveBeenCalled();
  });

  it('returns a fallback message when the exam has not been graded yet', async () => {
    findUniqueMockExam.mockResolvedValue(mockExam({ score: null, maxScore: null }));

    const report = await service.generateReport('exam-1');

    expect(report).toHaveLength(1);
    expect(report[0]).toMatch(/couldn't grade it automatically/i);
  });

  it('reports PASS when the score is at or above the 50% threshold', async () => {
    findUniqueMockExam.mockResolvedValue(mockExam({ score: 10, maxScore: 20 }));

    const report = await service.generateReport('exam-1');

    expect(report.join(' ')).toContain('PASS');
    expect(report.join(' ')).not.toContain('KEEP PRACTICING');
  });

  it('reports KEEP PRACTICING when the score is below the 50% threshold', async () => {
    findUniqueMockExam.mockResolvedValue(mockExam({ score: 9, maxScore: 20 }));

    const report = await service.generateReport('exam-1');

    expect(report.join(' ')).toContain('KEEP PRACTICING');
  });

  it('includes the score, percentage, and every topic in the breakdown', async () => {
    findUniqueMockExam.mockResolvedValue(mockExam());

    const report = await service.generateReport('exam-1');
    const text = report.join(' ');

    expect(text).toContain('14/20');
    expect(text).toContain('70%');
    expect(text).toContain('Algebra: 9/10 (90%)');
    expect(text).toContain('Geometry: 5/10 (50%)');
  });

  it('identifies the lowest-scoring topic as the weakest area', async () => {
    findUniqueMockExam.mockResolvedValue(mockExam());

    const report = await service.generateReport('exam-1');

    expect(report.join(' ')).toContain('Weakest area:* Geometry');
  });

  it('computes time taken in minutes from submittedAt - startedAt', async () => {
    findUniqueMockExam.mockResolvedValue(mockExam());

    const report = await service.generateReport('exam-1');

    expect(report.join(' ')).toContain('45 min');
  });

  it('includes a real LLM-generated study tip focused on the weakest topic', async () => {
    findUniqueMockExam.mockResolvedValue(mockExam());

    const report = await service.generateReport('exam-1');

    expect(generate).toHaveBeenCalledWith(
      expect.stringContaining('Geometry'),
      expect.any(String),
      expect.objectContaining({ complexity: 'simple' }),
    );
    expect(report.join(' ')).toContain('Practice more geometry problems daily.');
  });

  it('falls back to a canned study tip when the LLM call fails', async () => {
    findUniqueMockExam.mockResolvedValue(mockExam());
    generate.mockRejectedValue(new Error('OpenAI is down'));

    const report = await service.generateReport('exam-1');

    expect(report.join(' ')).toContain('Keep practicing past questions regularly');
  });

  it('handles a missing topicBreakdown gracefully, with no weakest area', async () => {
    findUniqueMockExam.mockResolvedValue(mockExam({ topicBreakdown: null }));

    const report = await service.generateReport('exam-1');
    const text = report.join(' ');

    expect(text).toContain('No topic data available');
    expect(text).toContain('Weakest area:* N/A');
  });

  it("uses the exam owner's language, not English by default", async () => {
    findUniqueUser.mockResolvedValue({ language: 'FR' });
    findUniqueMockExam.mockResolvedValue(mockExam());

    const report = await service.generateReport('exam-1');

    expect(report.join(' ')).toContain('RÉUSSI');
  });
});
