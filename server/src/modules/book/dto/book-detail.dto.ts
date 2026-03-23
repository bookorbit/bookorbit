import type { AudiobookChapter, ComicMetadataFields, NarratorRef, ProviderIds, UserBookStatus } from '@projectx/types';

export class BookFileDto {
  id: number;
  format: string | null;
  role: string;
  sizeBytes: number | null;
  absolutePath: string;
  createdAt: Date;
  filename: string | null;
  durationSeconds: number | null;
}

export class BookDetailDto {
  id: number;
  libraryId: number;
  libraryName: string;
  status: string;
  folderPath: string;
  addedAt: Date;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  rating: number | null;
  coverSource: 'extracted' | 'custom' | null;
  providerIds: ProviderIds;
  authors: { id: number; name: string; sortName: string | null }[];
  narrators: NarratorRef[];
  genres: string[];
  tags: string[];
  files: BookFileDto[];
  lastWrittenAt: Date | null;
  metadataScore: number | null;
  readStatus: UserBookStatus | null;
  durationSeconds: number | null;
  abridged: boolean;
  chapters: AudiobookChapter[] | null;
  formatPriority: string[];
  comicMetadata: ComicMetadataFields | null;
}
