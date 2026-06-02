import { basename } from 'path';

import type { BookCard, BookMetadataLockField, CollapsedSeriesInfo, UserBookStatus } from '@bookorbit/types';
import { BOOK_METADATA_LOCK_FIELDS } from '@bookorbit/types';

const LOCK_FIELD_SET = new Set<string>(BOOK_METADATA_LOCK_FIELDS);

function normalizeLockedFields(raw: string[] | null | undefined): BookMetadataLockField[] {
  if (!raw?.length) return [];
  return raw.filter((f) => LOCK_FIELD_SET.has(f)) as BookMetadataLockField[];
}

type BookRow = {
  id: number;
  status: string;
  primaryFileId?: number | null;
  folderPath: string;
  addedAt: Date;
  updatedAt?: Date;
  title: string | null;
  seriesId?: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  publishedYear: number | null;
  language: string | null;
  rating: number | null;
  metadataScore?: number | null;
  coverSource: string | null;
  lockedFields: string[] | null;
  subtitle: string | null;
  publisher: string | null;
  pageCount: number | null;
  isbn13: string | null;
};

type CollapsedBookRow = BookRow & {
  bookCount: number | null;
  readCount: number | null;
  coverBookIds: number[] | null;
  seriesLatestAddedAt: Date | null;
  firstVolumeBookId: number | null;
  latestVolumeBookId: number | null;
  firstUnreadBookId: number | null;
};

type NameRow = { bookId: number; name: string };
type NarratorRow = { bookId: number; name: string };
type FileRow = { bookId: number; id: number; format: string | null; role: string; sizeBytes: number | null };
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
  narratorRows: NarratorRow[] = [],
  tagRows: NameRow[] = [],
): BookCard[] {
  const authorsByBook = new Map<number, string[]>();
  for (const row of authorRows) {
    const list = authorsByBook.get(row.bookId) ?? [];
    list.push(row.name);
    authorsByBook.set(row.bookId, list);
  }

  const filesByBook = new Map<number, { id: number; format: string | null; role: string; sizeBytes: number | null }[]>();
  for (const row of fileRows) {
    const list = filesByBook.get(row.bookId) ?? [];
    list.push({ id: row.id, format: row.format, role: row.role, sizeBytes: row.sizeBytes });
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

  const narratorsByBook = new Map<number, string[]>();
  for (const row of narratorRows) {
    const list = narratorsByBook.get(row.bookId) ?? [];
    list.push(row.name);
    narratorsByBook.set(row.bookId, list);
  }

  const tagsByBook = new Map<number, string[]>();
  for (const row of tagRows) {
    const list = tagsByBook.get(row.bookId) ?? [];
    list.push(row.name);
    tagsByBook.set(row.bookId, list);
  }

  return rows.map((row) => {
    const rawFiles = filesByBook.get(row.id) ?? [];
    const primaryFile =
      (row.primaryFileId != null ? rawFiles.find((f) => f.id === row.primaryFileId) : undefined) ??
      rawFiles.find((f) => f.role === 'primary') ??
      rawFiles.find((f) => f.role === 'content') ??
      rawFiles[0] ??
      null;
    const files = rawFiles.map((f) => ({
      id: f.id,
      format: f.format,
      role: primaryFile && f.id === primaryFile.id ? 'primary' : f.role,
      sizeBytes: f.sizeBytes,
    }));
    const readingProgress = primaryFile != null ? (progressByFileId.get(primaryFile.id) ?? null) : null;

    return {
      id: row.id,
      status: row.status,
      title: row.title ?? basename(row.folderPath),
      seriesId: row.seriesId ?? null,
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
      updatedAt: row.updatedAt?.toISOString() ?? null,
      metadataScore: row.metadataScore ?? null,
      hasCover: row.coverSource != null,
      hasMetadataLocks: (row.lockedFields?.length ?? 0) > 0,
      lockedFields: normalizeLockedFields(row.lockedFields),
      subtitle: row.subtitle ?? null,
      publisher: row.publisher ?? null,
      pageCount: row.pageCount ?? null,
      isbn13: row.isbn13 ?? null,
      narrators: narratorsByBook.get(row.id) ?? [],
      tags: tagsByBook.get(row.id) ?? [],
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
  narratorRows: NarratorRow[] = [],
  tagRows: NameRow[] = [],
): BookCard[] {
  const base = assembleBookCards(rows, authorRows, fileRows, genreRows, progressRows, statusRows, narratorRows, tagRows);

  for (let i = 0; i < base.length; i++) {
    const row = rows[i];
    if (row && row.bookCount !== null) {
      const collapsed: CollapsedSeriesInfo = {
        bookCount: row.bookCount,
        readCount: row.readCount ?? 0,
        coverBookIds: row.coverBookIds ?? [],
        seriesLatestAddedAt: row.seriesLatestAddedAt?.toISOString() ?? null,
        firstVolumeBookId: row.firstVolumeBookId ?? null,
        latestVolumeBookId: row.latestVolumeBookId ?? null,
        firstUnreadBookId: row.firstUnreadBookId ?? null,
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

    const firstUnread = sorted.find((b) => b.readStatus?.status !== 'read');
    const lastWithIndex = sorted.findLast((b) => b.seriesIndex !== null);

    representative.collapsedSeries = {
      bookCount: group.length,
      readCount,
      coverBookIds: coverIds.length > 0 ? coverIds : fallbackIds,
      seriesLatestAddedAt,
      firstVolumeBookId: sorted[0]!.id,
      latestVolumeBookId: (lastWithIndex ?? sorted[sorted.length - 1]!).id,
      firstUnreadBookId: firstUnread?.id ?? null,
    };
    result.push({ index: firstIndex, card: representative });
  }

  for (const { index, card } of standalones) {
    result.push({ index, card });
  }

  return result.sort((a, b) => a.index - b.index).map((r) => r.card);
}
