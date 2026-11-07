import {
  bookFormatKey,
  DEFAULT_FORMAT_PRIORITY,
  formatKeyRank,
  isContentBookFile,
  normalizeFormatPriority,
  READ_ALONG_FORMAT_PRIORITY,
} from '@bookorbit/types';

export type PrimaryFileCandidate = {
  id: number;
  format: string | null;
  sizeBytes: number | null;
  mediaOverlayAvailable?: boolean | null;
};

/** An EPUB with synced narration. Primary selection and file write-back both ask this one question. */
export function isReadAlongBookFile(file: Pick<PrimaryFileCandidate, 'format' | 'mediaOverlayAvailable'>): boolean {
  return file.format?.toLowerCase() === 'epub' && file.mediaOverlayAvailable === true;
}

function matchesPriorityEntry(file: PrimaryFileCandidate, entry: string, readAlongRankedApart: boolean): boolean {
  if (entry === READ_ALONG_FORMAT_PRIORITY) return isReadAlongBookFile(file);
  if (entry === 'epub' && readAlongRankedApart) return file.format?.toLowerCase() === 'epub' && !isReadAlongBookFile(file);
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

export interface MovedPrimaryCandidate {
  id: number;
  role: string;
  format: string | null;
  sizeBytes: number | null;
  sortOrder: number | null;
  mediaOverlayAvailable: boolean;
}

/**
 * The file a moved or merged book's primary becomes in its library, the way a scan of that library
 * would choose: among the content files whose format it allows, the one its format
 * priority ranks first, keeping the current primary on a tie. Null leaves the current primary in
 * place, which is what happens when nothing it allows has any bytes. The planner names files and
 * reports formats by this, and the move commits it, so the two cannot disagree.
 */
export function selectMovedPrimary<T extends MovedPrimaryCandidate>(
  files: readonly T[],
  currentPrimaryId: number | null,
  target: { formatPriority: readonly string[] | null; allowedFormats: readonly string[] },
): T | null {
  const allowed = target.allowedFormats.length > 0 ? new Set(target.allowedFormats.map((format) => format.toLowerCase())) : null;
  const candidates = files
    .filter((file) => file.role === 'content' && (!allowed || (file.format !== null && allowed.has(file.format.toLowerCase()))))
    .sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) || a.id - b.id);
  return selectPrimaryFileKeepingCurrent(candidates, currentPrimaryId, target.formatPriority ?? DEFAULT_FORMAT_PRIORITY);
}
