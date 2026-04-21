import { basename } from 'path';

import type { BookCard, CollapsedSeriesInfo, UserBookStatus } from '@bookorbit/types';

type BookRow = {
  id: number;
  status: string;
  primaryFileId?: number | null;
  folderPath: string;
  addedAt: Date;
  title: string | null;
  seriesName: string | null;
  seriesIndex: number | null;
  publishedYear: number | null;
  language: string | null;
  rating: number | null;
  coverSource: string | null;
  lockedFields: string[] | null;
};

type CollapsedBookRow = BookRow & {
  bookCount: number | null;
  readCount: number | null;
  coverBookIds: number[] | null;
  seriesLatestAddedAt: Date | null;
};

type NameRow = { bookId: number; name: string };
type FileRow = { bookId: number; id: number; format: string | null; role: string };
type ProgressRow = { bookFileId: number; percentage: number | null };
type StatusRow = {
  bookId: number;
  status: string;
  source: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  updatedAt: Date;
};

export function assembleBookCards(
  rows: BookRow[],
  authorRows: NameRow[],
  fileRows: FileRow[],
  genreRows: NameRow[],
  progressRows: ProgressRow[],
  statusRows: StatusRow[] = [],
): BookCard[] {
  const authorsByBook = new Map<number, string[]>();
  for (const row of authorRows) {
    const list = authorsByBook.get(row.bookId) ?? [];
    list.push(row.name);
    authorsByBook.set(row.bookId, list);
  }

  const filesByBook = new Map<number, { id: number; format: string | null; role: string }[]>();
  for (const row of fileRows) {
    const list = filesByBook.get(row.bookId) ?? [];
    list.push({ id: row.id, format: row.format, role: row.role });
    filesByBook.set(row.bookId, list);
  }

  const genresByBook = new Map<number, string[]>();
  for (const row of genreRows) {
    const list = genresByBook.get(row.bookId) ?? [];
    list.push(row.name);
    genresByBook.set(row.bookId, list);
  }

  const progressByFileId = new Map<number, number | null>();
  for (const row of progressRows) {
    progressByFileId.set(row.bookFileId, row.percentage);
  }

  const statusByBookId = new Map<number, UserBookStatus>();
  for (const row of statusRows) {
    statusByBookId.set(row.bookId, {
      status: row.status as UserBookStatus['status'],
      source: row.source as UserBookStatus['source'],
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  return rows.map((row) => {
    const rawFiles = filesByBook.get(row.id) ?? [];
    const primaryFile =
      (row.primaryFileId != null ? rawFiles.find((f) => f.id === row.primaryFileId) : undefined) ??
      rawFiles.find((f) => f.role === 'primary') ??
      rawFiles.find((f) => f.role === 'content') ??
      rawFiles[0] ??
      null;
    const files = rawFiles.map((f) => ({ ...f, role: primaryFile && f.id === primaryFile.id ? 'primary' : f.role }));
    const readingProgress = primaryFile != null ? (progressByFileId.get(primaryFile.id) ?? null) : null;

    return {
      id: row.id,
      status: row.status,
      title: row.title ?? basename(row.folderPath),
      seriesName: row.seriesName ?? null,
      seriesIndex: row.seriesIndex ?? null,
      authors: authorsByBook.get(row.id) ?? [],
      files,
      publishedYear: row.publishedYear ?? null,
      language: row.language ?? null,
      genres: genresByBook.get(row.id) ?? [],
      rating: row.rating ?? null,
      readingProgress,
      readStatus: statusByBookId.get(row.id) ?? null,
      addedAt: row.addedAt.toISOString(),
      hasCover: row.coverSource != null,
      hasMetadataLocks: (row.lockedFields?.length ?? 0) > 0,
    };
  });
}

export function assembleCollapsedBookCards(
  rows: CollapsedBookRow[],
  authorRows: NameRow[],
  fileRows: FileRow[],
  genreRows: NameRow[],
  progressRows: ProgressRow[],
  statusRows: StatusRow[] = [],
): BookCard[] {
  const base = assembleBookCards(rows, authorRows, fileRows, genreRows, progressRows, statusRows);

  for (let i = 0; i < base.length; i++) {
    const row = rows[i];
    if (row && row.bookCount !== null) {
      const collapsed: CollapsedSeriesInfo = {
        bookCount: row.bookCount,
        readCount: row.readCount ?? 0,
        coverBookIds: row.coverBookIds ?? [],
        seriesLatestAddedAt: row.seriesLatestAddedAt?.toISOString() ?? null,
      };
      base[i] = { ...base[i]!, collapsedSeries: collapsed };
    }
  }

  return base;
}

export function collapseBookCards(cards: BookCard[]): BookCard[] {
  const seriesGroups = new Map<string, { firstIndex: number; books: BookCard[] }>();
  const standalones: { index: number; card: BookCard }[] = [];

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!;
    if (card.seriesName?.trim()) {
      const key = card.seriesName.trim().toLowerCase();
      const group = seriesGroups.get(key);
      if (group) {
        group.books.push(card);
      } else {
        seriesGroups.set(key, { firstIndex: i, books: [card] });
      }
    } else {
      standalones.push({ index: i, card });
    }
  }

  const result: { index: number; card: BookCard }[] = [];

  for (const [, { firstIndex, books: group }] of seriesGroups) {
    const sorted = [...group].sort((a, b) => {
      if (a.seriesIndex !== null && b.seriesIndex !== null) return a.seriesIndex - b.seriesIndex;
      if (a.seriesIndex !== null) return -1;
      if (b.seriesIndex !== null) return 1;
      return new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
    });

    const representative = { ...sorted[0]! };
    const readCount = group.filter((b) => b.readStatus?.status === 'read').length;
    const seriesLatestAddedAt =
      [...group]
        .map((b) => b.addedAt)
        .sort()
        .at(-1) ?? null;

    const coverIds = sorted
      .filter((b) => b.hasCover)
      .slice(0, 4)
      .map((b) => b.id);
    const fallbackIds = sorted.slice(0, 4).map((b) => b.id);

    representative.collapsedSeries = {
      bookCount: group.length,
      readCount,
      coverBookIds: coverIds.length > 0 ? coverIds : fallbackIds,
      seriesLatestAddedAt,
    };
    result.push({ index: firstIndex, card: representative });
  }

  for (const { index, card } of standalones) {
    result.push({ index, card });
  }

  return result.sort((a, b) => a.index - b.index).map((r) => r.card);
}
