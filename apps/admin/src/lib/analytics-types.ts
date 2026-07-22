export interface DailyCount {
  date: string;
  count: number;
}

export interface SubjectCount {
  subject: string;
  count: number;
}

export interface TopicCount {
  topic: string;
  count: number;
}

export interface AnalyticsResult {
  dau: number[];
  totalMessages: number;
  newUsers: number;
  activeUsers: number;
  revenue: number;
  messagesPerDay: DailyCount[];
  questionsPerSubject: SubjectCount[];
  conversionFunnel: { registered: number; activated: number; paying: number };
  topTopics: TopicCount[];
}

export type DateRangePreset = '7' | '30' | '90' | 'custom';
