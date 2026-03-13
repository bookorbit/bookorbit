import type { ProviderIds } from '@projectx/types';

export class BookFileDto {
  id: number;
  format: string | null;
  role: string;
  sizeBytes: number | null;
  absolutePath: string;
  createdAt: Date;
  filename: string | null;
}

export class BookDetailDto {
  id: number;
  libraryId: number;
  status: string;
  folderPath: string;
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
  genres: string[];
  tags: string[];
  files: BookFileDto[];
  lastWrittenAt: Date | null;
  metadataScore: number | null;
}
