export type BroadcastTarget = 'ALL' | 'TIER' | 'SUBJECT' | 'LEVEL';

export const BROADCAST_TARGETS: BroadcastTarget[] = ['ALL', 'TIER', 'SUBJECT', 'LEVEL'];

export type BroadcastStatus = 'SCHEDULED' | 'PROCESSING' | 'COMPLETE' | 'FAILED';

export interface Broadcast {
  id: string;
  message: string;
  target: BroadcastTarget;
  targetValue: string | null;
  scheduleAt: string | null;
  status: BroadcastStatus;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
}

export interface PaginatedBroadcasts {
  broadcasts: Broadcast[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const MESSAGE_MAX_LENGTH = 4096;
