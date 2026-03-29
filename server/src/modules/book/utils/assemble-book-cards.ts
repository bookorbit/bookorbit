import { basename } from 'path';

import type { BookCard, UserBookStatus } from '@projectx/types';

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
    };
  });
}
