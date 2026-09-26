import { bookFormatKey, formatKeyRank, isContentBookFile, normalizeFormatPriority, READ_ALONG_FORMAT_PRIORITY } from '@bookorbit/types';

export type PrimaryFileCandidate = {
  id: number;
  format: string | null;
  sizeBytes: number | null;
  mediaOverlayAvailable?: boolean | null;
};

function isReadAlong(file: PrimaryFileCandidate): boolean {
  return file.format?.toLowerCase() === 'epub' && file.mediaOverlayAvailable === true;
}

function matchesPriorityEntry(file: PrimaryFileCandidate, entry: string, readAlongRankedApart: boolean): boolean {
  if (entry === READ_ALONG_FORMAT_PRIORITY) return isReadAlong(file);
  if (entry === 'epub' && readAlongRankedApart) return file.format?.toLowerCase() === 'epub' && !isReadAlong(file);
  return file.format?.toLowerCase() === entry;
}

export function selectPrimaryFile<T extends PrimaryFileCandidate>(
  files: readonly T[],
  formatPriority: readonly string[],
  options: {
    allowZeroByteFallback?: boolean;
  } = {},
): T | null {
  if (files.length === 0) return null;

  const nonEmpty = files.filter((file) => (file.sizeBytes ?? 0) > 0);
  const pool = nonEmpty.length > 0 ? nonEmpty : options.allowZeroByteFallback ? [...files] : [];
  if (pool.length === 0) return null;

  const normalizedPriority = formatPriority.map((format) => format.toLowerCase());
  const readAlongRankedApart = normalizedPriority.includes(READ_ALONG_FORMAT_PRIORITY);
  const preferredEntry = normalizedPriority.find((entry) => pool.some((file) => matchesPriorityEntry(file, entry, readAlongRankedApart)));
  const entryPool = preferredEntry ? pool.filter((file) => matchesPriorityEntry(file, preferredEntry, readAlongRankedApart)) : pool;
  const first = entryPool[0] ?? null;
  if (readAlongRankedApart && preferredEntry) return first;
  if (first?.format?.toLowerCase() !== 'epub') return first;

  return entryPool.find((file) => file.mediaOverlayAvailable === true) ?? first;
}

/**
 * {@link selectPrimaryFile} for a book that already has a primary: a file that only ties with it,
 * such as a second EPUB beside the first, does not take its place. Only a better-ranked file does.
 */
export function selectPrimaryFileKeepingCurrent<T extends PrimaryFileCandidate>(
  files: readonly T[],
  currentPrimaryFileId: number | null,
  formatPriority: readonly string[],
): T | null {
  const ordered =
    currentPrimaryFileId == null
      ? files
      : [...files.filter((file) => file.id === currentPrimaryFileId), ...files.filter((file) => file.id !== currentPrimaryFileId)];
  return selectPrimaryFile(ordered, formatPriority);
}

/**
 * A book's files in edition order: the primary first, then content files by the library's format
 * priority (a read-along EPUB ranked apart from a plain one), then covers and sidecars. The sort is
 * stable, so files of one format, an audiobook's tracks, keep the order they came in.
 */
export function rankFilesByFormatPriority<T extends PrimaryFileCandidate & { role: string }>(
  files: readonly T[],
  formatPriority: readonly string[] | null | undefined,
  primaryFileId?: number | null,
): T[] {
  const priority = normalizeFormatPriority(formatPriority);
  return files
    .map((file, index) => {
      const content = isContentBookFile(file);
      const rank = content ? formatKeyRank(bookFormatKey(file.format!, file.mediaOverlayAvailable === true), priority) : Number.MAX_SAFE_INTEGER;
      return { file, index, content, rank, primary: primaryFileId != null && file.id === primaryFileId };
    })
    .sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      if (a.content !== b.content) return a.content ? -1 : 1;
      return a.rank - b.rank || a.index - b.index;
    })
    .map((entry) => entry.file);
}

export type FileRankingContext = { formatPriority: readonly string[] | null | undefined; primaryFileId: number | null };

/** File rows for many books, each book's files ranked with its own library priority and primary. */
export function rankFileRowsByBook<T extends PrimaryFileCandidate & { bookId: number; role: string }>(
  rows: readonly T[],
  contextByBook: ReadonlyMap<number, FileRankingContext>,
): T[] {
  const rowsByBook = new Map<number, T[]>();
  for (const row of rows) {
    const list = rowsByBook.get(row.bookId) ?? [];
    list.push(row);
    rowsByBook.set(row.bookId, list);
  }
  return [...rowsByBook.entries()].flatMap(([bookId, bookRows]) => {
    const context = contextByBook.get(bookId);
    return rankFilesByFormatPriority(bookRows, context?.formatPriority, context?.primaryFileId);
  });
}
