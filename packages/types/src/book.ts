import type { MetadataProviderKey } from './metadata-fetch';

export const BOOK_FORMATS = ['epub', 'pdf', 'mobi', 'azw3', 'cbz', 'cbr', 'cb7', 'fb2'] as const;
export type BookFormat = (typeof BOOK_FORMATS)[number];

export type BookFileRef = {
  id: number;
  format: string | null;
  role: string;
};

export type BookCard = {
  id: number;
  status: string;
  title: string | null;
  authors: string[];
  seriesName: string | null;
  seriesIndex: number | null;
  files: BookFileRef[];
  publishedYear: number | null;
  language: string | null;
  genres: string[];
  tags: string[];
  rating: number | null;
  readingProgress: number | null;
  metadataScore: number | null;
  addedAt: string;
};

export type BookDetailFile = {
  id: number;
  format: string | null;
  role: string;
  sizeBytes: number | null;
  absolutePath: string;
  createdAt: string;
  filename: string | null;
};

export type ProviderIds = Partial<Record<MetadataProviderKey, string | null>>;

export type BookDetail = {
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
  files: BookDetailFile[];
  lastWrittenAt: string | null;
  metadataScore: number | null;
};

export type BookKoboReadingState = {
  status: string | null;
  progressPercent: number | null;
  createdAtKobo: string | null;
  lastModifiedKobo: string | null;
  priorityTimestamp: string | null;
  progressSyncedAt: string | null;
  updatedAt: string;
};

export type BookKoboSnapshotState = {
  snapshotId: number;
  snapshotUpdatedAt: string;
  inSnapshot: boolean;
  synced: boolean | null;
  pendingDelete: boolean | null;
  isNew: boolean | null;
  removedByDevice: boolean | null;
  fileHash: string | null;
  metadataHash: string | null;
};

export type BookKoboState = {
  eligibleForKoboSync: boolean;
  syncCollections: string[];
  readingState: BookKoboReadingState | null;
  snapshot: BookKoboSnapshotState | null;
};

export type BooksPage = {
  items: BookCard[];
  total: number;
  page: number;
  size: number;
};

export type BookRecommendation = {
  book: BookCard;
  score: number;
};

export type CoverSearchResult = {
  url: number | string; // ID for proxy or direct URL
  previewUrl: string;
  sourceUrl: string;
  width: number;
  height: number;
  source: string;
};

export type CoverSearchResponse = {
  results: CoverSearchResult[];
  total: number;
};
