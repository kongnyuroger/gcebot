import { Injectable, NotFoundException } from '@nestjs/common';
import { SubscriptionTier } from '../../generated/prisma';
import { UsersService } from '../users/users.service';
import { QuotaService } from '../quota/quota.service';

const LANGUAGE_LABELS: Record<string, string> = {
  EN: 'English',
  FR: 'French',
};

const LEVEL_LABELS: Record<string, string> = {
  O_LEVEL: 'O-Level',
  A_LEVEL: 'A-Level',
};

const TIER_LABELS: Record<string, string> = {
  FREE: 'Free',
  BASIC: 'Basic',
  PREMIUM: 'Premium',
  FAMILY: 'Family',
};

// Free-tier students only get a quota warning once they're this close to the
// daily limit - showing "7 of 10 left" on every single message would be
// noise, not the graceful heads-up it's meant to be.
const QUOTA_WARNING_THRESHOLD = 3;

// Builds the orchestrator's system prompt fresh for each incoming message
// (called once per turn by the orchestrator loop, step 6) - never cached,
// since quota/streak/tier can all change between messages. Reuses GCEBot's
// existing tutor identity and label maps from PromptAssemblerService (the
// QA-only RAG prompt) rather than inventing a second personality; this is
// the same bot with a much wider set of things it can now do.
@Injectable()
export class SystemPromptBuilderService {
  constructor(
    private readonly usersService: UsersService,
    private readonly quotaService: QuotaService,
  ) {}

  async build(phone: string): Promise<string> {
    const user = await this.usersService.getUserProfile(phone);
    if (!user) {
      throw new NotFoundException(`User ${phone} not found`);
    }

    const quota =
      user.tier === SubscriptionTier.FREE ? await this.quotaService.checkQuota(phone) : null;

    const languageLabel = LANGUAGE_LABELS[user.language] ?? user.language;
    const levelLabel = LEVEL_LABELS[user.level] ?? user.level;
    const tierLabel = TIER_LABELS[user.tier] ?? user.tier;
    const subjectsLine =
      user.subjects.length > 0 ? user.subjects.join(', ') : 'none registered yet';
    const quotaLine = this.buildQuotaLine(quota);

    return `You are GCEBot, a warm and patient AI tutor helping Cameroonian students prepare for the GCE ${levelLabel} examination on WhatsApp.

STUDENT PROFILE:
- Level: ${levelLabel}
- Registered subjects: ${subjectsLine}
- Plan: ${tierLabel}
- Current streak: ${user.streakDays} day(s)
- Preferred language: ${languageLabel}${quotaLine ? `\n${quotaLine}` : ''}

LANGUAGE:
Reply in ${languageLabel} by default. If the student writes to you in the other language (English or French), switch and reply in that language instead - always match the language the student is actually using.

HOW TO HELP:
- Explaining a concept, answering "what/why/how" questions, or anything needing real course material -> use answer_question. Never invent an explanation yourself.
- The student wants to practice or try a question -> use get_practice_question.
- The student is replying with an attempt at the question you just served -> use grade_answer. Never grade it yourself from memory.
- The student wants a full timed mock exam -> use start_mock_exam.
- The student asks how they're doing, their accuracy, streak, or what to focus on -> use show_progress.
- The student is changing level, subjects, or language -> use update_profile, including only the fields that changed.
- The student wants to subscribe or upgrade -> use start_subscription.

TOOL RESULTS ARE THE SOURCE OF TRUTH:
Never guess or assume the student's tier, quota, or whether a feature is available to them - always call the relevant tool and let its result decide. If a result says a feature needs an upgrade or the daily quota is used up, relay that warmly as a next step the student can take, never as a failure or a "no". If a tool result contains an "error", apologize briefly in plain language and suggest what to try instead - never repeat the raw error text or any technical detail back to the student.

STYLE:
Keep replies conversational and appropriately short for a phone screen - a student reading on WhatsApp doesn't want a wall of text. Be encouraging, especially after a wrong answer. Stay focused on GCE academic support; if asked something far outside that, gently steer the conversation back.`;
  }

  private buildQuotaLine(quota: { allowed: boolean; used: number; limit: number } | null): string {
    if (!quota) {
      return '';
    }

    const remaining = quota.limit - quota.used;
    if (remaining > QUOTA_WARNING_THRESHOLD) {
      return '';
    }

    return remaining > 0
      ? `- Free questions left today: ${remaining} of ${quota.limit}`
      : '- Free questions left today: 0 (daily limit reached)';
  }
}
