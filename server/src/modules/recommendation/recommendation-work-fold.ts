/** The fields that decide which edition of a work a shelf shows. */
export interface WorkFoldRow {
  bookId: number;
  /** Editions of one work share it; a book outside any group has its own. */
  workKey: string | null;
  status: string | null;
  lastReadAt: Date | string | null;
  leadBookId: number | null;
}

/**
 * Editions of one work fetched per row would repeat on a shelf, so how many extra rows to read to
 * still fill it. A group holds at most ten editions; real shelves rarely hold more than two of one.
 */
export const WORK_FOLD_OVERFETCH = 4;

function readTime(value: Date | string | null): number {
  if (value === null) return Number.NEGATIVE_INFINITY;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Same order as `linkMembersCte`, with the open book ahead of its own editions. */
function prefers(candidate: WorkFoldRow, current: WorkFoldRow, openBookId: number | undefined): boolean {
  const rank = (row: WorkFoldRow) => [
    row.bookId === openBookId ? 0 : 1,
    row.status === 'present' ? 0 : 1,
    -readTime(row.lastReadAt),
    row.bookId === row.leadBookId ? 0 : 1,
    row.bookId,
  ];
  const a = rank(candidate);
  const b = rank(current);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! < b[i]!;
  }
  return false;
}

/**
 * Keeps one edition per work, at the place its first edition held in `rows`, and stops at `limit`
 * works. The edition kept is the open book when it is one of them, else the one the reader would see
 * in a library list.
 */
export function foldWorks<T extends WorkFoldRow>(rows: T[], limit: number, openBookId?: number): T[] {
  const slots = new Map<string, number>();
  const kept: T[] = [];
  for (const row of rows) {
    const key = row.workKey ?? `b${row.bookId}`;
    const slot = slots.get(key);
    if (slot === undefined) {
      if (kept.length >= limit) continue;
      slots.set(key, kept.length);
      kept.push(row);
    } else if (prefers(row, kept[slot]!, openBookId)) {
      kept[slot] = row;
    }
  }
  return kept;
}
