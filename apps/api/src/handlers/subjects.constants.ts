import { Subject } from '@gcebot/shared';

// WhatsApp interactive list messages cap out at 10 rows total; A-Level has 11
// subjects, so callers must chunk() this before handing rows to sendList().
export const MAX_LIST_ROWS_PER_MESSAGE = 10;

export const SUBJECTS_BY_LEVEL: Record<'O_LEVEL' | 'A_LEVEL', Subject[]> = {
  O_LEVEL: [
    { id: 'biology', name: 'Biology', level: 'O_LEVEL' },
    { id: 'chemistry', name: 'Chemistry', level: 'O_LEVEL' },
    { id: 'mathematics', name: 'Mathematics', level: 'O_LEVEL' },
    { id: 'physics', name: 'Physics', level: 'O_LEVEL' },
    { id: 'english_language', name: 'English Language', level: 'O_LEVEL' },
    { id: 'literature_in_english', name: 'Literature in English', level: 'O_LEVEL' },
    { id: 'economics', name: 'Economics', level: 'O_LEVEL' },
    { id: 'geography', name: 'Geography', level: 'O_LEVEL' },
    { id: 'history', name: 'History', level: 'O_LEVEL' },
    { id: 'computer_science', name: 'Computer Science', level: 'O_LEVEL' },
  ],
  A_LEVEL: [
    { id: 'biology', name: 'Biology', level: 'A_LEVEL' },
    { id: 'chemistry', name: 'Chemistry', level: 'A_LEVEL' },
    { id: 'mathematics', name: 'Mathematics', level: 'A_LEVEL' },
    { id: 'physics', name: 'Physics', level: 'A_LEVEL' },
    { id: 'literature_in_english', name: 'Literature in English', level: 'A_LEVEL' },
    { id: 'economics', name: 'Economics', level: 'A_LEVEL' },
    { id: 'geography', name: 'Geography', level: 'A_LEVEL' },
    { id: 'history', name: 'History', level: 'A_LEVEL' },
    { id: 'computer_science', name: 'Computer Science', level: 'A_LEVEL' },
    { id: 'additional_mathematics', name: 'Additional Mathematics', level: 'A_LEVEL' },
    { id: 'food_nutrition', name: 'Food & Nutrition', level: 'A_LEVEL' },
  ],
};

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
