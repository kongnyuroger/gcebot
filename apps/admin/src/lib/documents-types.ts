import type { ExamLevel } from '@gcebot/shared';

// Mirrors apps/api's DocType/IngestionStatus Prisma enums as plain string
// literals - the admin app never imports the generated Prisma client
// directly (it's a separate app), so these are kept in sync by hand.
export type DocType = 'SYLLABUS' | 'PAST_PAPER' | 'TEXTBOOK' | 'MARKING_SCHEME';
export type IngestionStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETE' | 'FAILED';

export const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: 'SYLLABUS', label: 'Syllabus' },
  { value: 'PAST_PAPER', label: 'Past Paper' },
  { value: 'TEXTBOOK', label: 'Textbook' },
  { value: 'MARKING_SCHEME', label: 'Marking Scheme' },
];

export const EXAM_LEVELS: { value: ExamLevel; label: string }[] = [
  { value: 'O_LEVEL', label: 'O-Level' },
  { value: 'A_LEVEL', label: 'A-Level' },
];

export interface AdminDocument {
  id: string;
  filename: string;
  subject: string;
  level: ExamLevel;
  docType: DocType;
  year: number | null;
  ingestionStatus: IngestionStatus;
  errorMessage: string | null;
  chunkCount: number;
  createdAt: string;
}

export interface PaginatedDocuments {
  documents: AdminDocument[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
