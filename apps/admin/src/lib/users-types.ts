import type { ExamLevel } from '@gcebot/shared';

export type SubscriptionTier = 'FREE' | 'BASIC' | 'PREMIUM' | 'FAMILY';

export const SUBSCRIPTION_TIERS: SubscriptionTier[] = ['FREE', 'BASIC', 'PREMIUM', 'FAMILY'];

// Mirrors { [subject]: { [topic]: { correct, total } } } - the denormalized
// running per-topic tally TopicScoreService maintains on the User row.
export type TopicScores = Record<string, Record<string, { correct: number; total: number }>>;

export interface AdminUser {
  phone_number: string;
  level: ExamLevel;
  subjects: string[];
  tier: SubscriptionTier;
  streakDays: number;
  lastActiveDate: string | null;
  createdAt: string;
  topicScores: TopicScores | null;
}

export interface AdminSubscription {
  id: string;
  tier: SubscriptionTier;
  startDate: string;
  endDate: string;
  paymentMethod: string;
  paymentReference: string;
}

export interface AdminInteraction {
  id: string;
  type: string;
  subject: string;
  topic: string;
  questionText: string;
  userAnswer: string;
  correct: boolean | null;
  createdAt: string;
}

export interface UserDetail extends AdminUser {
  subscription: AdminSubscription | null;
  recentInteractions: AdminInteraction[];
}

export interface PaginatedUsers {
  users: AdminUser[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// Keeps the country code and last 2 digits visible, masks the middle -
// e.g. "237670001234" -> "2376******34".
export function maskPhone(phone: string): string {
  if (phone.length <= 6) {
    return phone;
  }
  const start = phone.slice(0, 4);
  const end = phone.slice(-2);
  const middle = '*'.repeat(phone.length - 6);
  return `${start}${middle}${end}`;
}
