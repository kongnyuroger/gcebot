import type { Subject } from '@gcebot/shared';

// Canonical subject list now lives in @gcebot/shared - the admin portal's
// document upload form (apps/admin) needs the exact same list, so it moved
// out of this WhatsApp-specific file to avoid the two drifting apart.
export { SUBJECTS_BY_LEVEL } from '@gcebot/shared';

// WhatsApp interactive list messages cap out at 10 rows total; still used by
// callers that send tappable lists (practice-mode topic lists, weekly-report
// batching) - subject selection itself no longer uses interactive lists, see
// parseSubjectSelections below.
export const MAX_LIST_ROWS_PER_MESSAGE = 10;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export interface SubjectSelectionResult {
  // Subject names, in the order first matched, deduplicated.
  matched: string[];
  // Raw tokens that didn't match a valid number or subject name.
  unmatched: string[];
}

// Parses a free-text reply like "1,3,5" or "Biology, Physics" (or a mix) into
// subject names - lets a user pick several subjects in a single message,
// since WhatsApp's interactive list/button messages only support single
// selection per tap.
export function parseSubjectSelections(text: string, subjects: Subject[]): SubjectSelectionResult {
  const tokens = text
    .split(/[,\n]+/)
    .flatMap((token) => (/^\d+(\s+\d+)+$/.test(token.trim()) ? token.trim().split(/\s+/) : [token]))
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const token of tokens) {
    const asIndex = /^\d+$/.test(token) ? Number(token) : null;
    const subjectName =
      asIndex !== null && asIndex >= 1 && asIndex <= subjects.length
        ? subjects[asIndex - 1].name
        : (subjects.find((subject) => subject.name.toLowerCase() === token.toLowerCase())?.name ??
          null);

    if (!subjectName) {
      unmatched.push(token);
    } else if (!matched.includes(subjectName)) {
      matched.push(subjectName);
    }
  }

  return { matched, unmatched };
}
