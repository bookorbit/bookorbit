import type { UserBookStatus } from "./book";

export const BOOK_DUPLICATE_MATCH_REASONS = ["file_hash", "isbn", "exact_metadata", "fuzzy_metadata"] as const;
export type BookDuplicateMatchReason = (typeof BOOK_DUPLICATE_MATCH_REASONS)[number];

export const BOOK_DUPLICATE_SCAN_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type BookDuplicateScanStatus = (typeof BOOK_DUPLICATE_SCAN_STATUSES)[number];

export type CreateBookDuplicateScanRequest = {
  libraryId?: number;
  similarityPercent: number;
};

export type BookDuplicateScan = {
  id: number;
  status: BookDuplicateScanStatus;
  libraryIds: number[];
  requestedLibraryId: number | null;
  similarityPercent: number;
  processedBooks: number;
  totalBooks: number | null;
  progressPercent: number | null;
  totalGroups: number | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type BookDuplicateFile = {
  id: number;
  format: string | null;
  sizeBytes: number | null;
  path: string | null;
};

export type BookDuplicateCandidate = {
  id: number;
  title: string | null;
  subtitle: string | null;
  authors: string[];
  libraryId: number;
  libraryName: string;
  folderPath: string;
  status: string;
  files: BookDuplicateFile[];
  isbn10: string | null;
  isbn13: string | null;
  metadataScore: number | null;
  readStatus: UserBookStatus | null;
  readingProgress: number | null;
  collections: { id: number; name: string }[];
  addedAt: string;
  updatedAt: string | null;
  hasCover: boolean;
};

export type BookDuplicatePair = {
  bookIdA: number;
  bookIdB: number;
  reasons: BookDuplicateMatchReason[];
  titleSimilarity: number | null;
};

export type BookDuplicateGroup = {
  id: number;
  reasons: BookDuplicateMatchReason[];
  maxTitleSimilarity: number | null;
  books: BookDuplicateCandidate[];
  pairs: BookDuplicatePair[];
};

export type BookDuplicateGroupsResponse = {
  groups: BookDuplicateGroup[];
  total: number;
  page: number;
  pageSize: number;
};
