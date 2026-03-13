import { basename } from 'path';

import type { BookCard } from '@projectx/types';

type BookRow = {
  id: number;
  status: string;
  folderPath: string;
  addedAt: Date;
  title: string | null;
  seriesName: string | null;
  seriesIndex: number | null;
  publishedYear: number | null;
  language: string | null;
  rating: number | null;
  metadataScore?: number | null;
};

type NameRow = { bookId: number; name: string };
type FileRow = { bookId: number; id: number; format: string | null; role: string };
type ProgressRow = { bookFileId: number; percentage: number | null };

export function assembleBookCards(
  rows: BookRow[],
  authorRows: NameRow[],
  fileRows: FileRow[],
  genreRows: NameRow[],
  tagRows: NameRow[],
  progressRows: ProgressRow[],
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

  const tagsByBook = new Map<number, string[]>();
  for (const row of tagRows) {
    const list = tagsByBook.get(row.bookId) ?? [];
    list.push(row.name);
    tagsByBook.set(row.bookId, list);
  }

  const progressByFileId = new Map<number, number | null>();
  for (const row of progressRows) {
    progressByFileId.set(row.bookFileId, row.percentage);
  }

  return rows.map((row) => {
    const files = filesByBook.get(row.id) ?? [];
    const primaryFile = files.find((f) => f.role === 'primary') ?? files[0] ?? null;
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
      tags: tagsByBook.get(row.id) ?? [],
      rating: row.rating ?? null,
      metadataScore: row.metadataScore !== undefined ? (row.metadataScore ?? null) : null,
      readingProgress,
      addedAt: row.addedAt.toISOString(),
    };
  });
}
