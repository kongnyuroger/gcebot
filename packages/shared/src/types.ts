export type ExamLevel = 'O_LEVEL' | 'A_LEVEL';

export interface Subject {
  id: string;
  name: string;
  level: ExamLevel;
}
