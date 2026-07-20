// Canonical subject list now lives in @gcebot/shared - the admin portal's
// document upload form (apps/admin) needs the exact same list, so it moved
// out of this WhatsApp-specific file to avoid the two drifting apart.
export { SUBJECTS_BY_LEVEL } from '@gcebot/shared';

// WhatsApp interactive list messages cap out at 10 rows total; A-Level has 11
// subjects, so callers must chunk() this before handing rows to sendList().
export const MAX_LIST_ROWS_PER_MESSAGE = 10;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
