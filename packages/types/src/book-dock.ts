import type { AudiobookChapter } from "./audiobook";

export type BookDockFileStatus = "pending" | "extracting" | "fetching" | "ready" | "error";
export type BookDockAutoFinalizeMetadataMode = "safe_merge" | "fetched_only" | "embedded_only";

export interface BookDockMetadata {
  title?: string;
  subtitle?: string;
  authors?: string[];
  narrators?: string[];
  description?: string;
  publisher?: string;
  publishedDate?: string;
  publishedYear?: number;
  language?: string;
  pageCount?: number;
  isbn10?: string;
  isbn13?: string;
  seriesName?: string;
  seriesIndex?: number;
  genres?: string[];
  coverUrl?: string;
  durationSeconds?: number;
  chapters?: AudiobookChapter[];
}

export interface BookDockFile {
  id: number;
  fileName: string;
  fileSize: number | null;
  format: string | null;
  status: BookDockFileStatus;
  embeddedMetadata: BookDockMetadata | null;
  selectedMetadata: BookDockMetadata | null;
  fetchedMetadata: BookDockMetadata | null;
  targetLibraryId: number | null;
  targetFolderId: number | null;
  confidence: number | null;
  fetchedMetadataSources: Partial<Record<keyof BookDockMetadata, string>> | null;
  errorMessage: string | null;
  metadataEditedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookDockFilesPage {
  items: BookDockFile[];
  total: number;
  page: number;
  size: number;
}

export interface BookDockSummary {
  pending: number;
  ready: number;
  error: number;
  total: number;
  paused: boolean;
}

export interface BookDockFinalizeOverride {
  fileId: number;
  libraryId?: number;
  folderId?: number;
  skipDuplicateCheck?: boolean;
  targetFileName?: string;
}

export interface BookDockFinalizeRequest {
  fileIds?: number[];
  selectAll?: boolean;
  excludedIds?: number[];
  status?: BookDockFileStatus;
  search?: string;
  defaultLibraryId?: number;
  defaultFolderId?: number;
  overrides?: BookDockFinalizeOverride[];
}

export interface BookDockFinalizeFileResult {
  fileId: number;
  fileName: string;
  newName?: string;
  success: boolean;
  bookId?: number;
  isDuplicate?: boolean;
  existingBookId?: number;
  message?: string;
}

export interface BookDockFinalizeResult {
  total: number;
  succeeded: number;
  failed: number;
  results: BookDockFinalizeFileResult[];
}

export type BookDockFinalizePreviewStatus =
  "ready" | "duplicate" | "destination_conflict" | "missing_destination" | "invalid_target" | "access_denied" | "invalid_format" | "error";

export interface BookDockFinalizePreviewItem {
  fileId: number;
  fileName: string;
  newName?: string;
  status: BookDockFinalizePreviewStatus;
  existingBookId?: number;
  message?: string;
}

export interface BookDockFinalizePreviewResult {
  total: number;
  ready: number;
  duplicates: number;
  destinationConflicts: number;
  missingDestination: number;
  blocked: number;
  truncated: boolean;
  itemLimit: number;
  items: BookDockFinalizePreviewItem[];
}

export interface BookDockDiscardDuplicatesResult {
  total: number;
  discarded: number;
  skipped: number;
  discardedFileIds: number[];
}

export interface BookDockBulkEditRequest {
  fileIds?: number[];
  selectAll?: boolean;
  excludedIds?: number[];
  status?: BookDockFileStatus;
  search?: string;
  fields: Partial<BookDockMetadata>;
  enabledFields: string[];
  mergeArrays: boolean;
}

export interface BookDockBulkEditResult {
  total: number;
  updated: number;
  failed: number;
}

export interface BookDockStatistics {
  totalSizeBytes: number;
  byFormat: { format: string; count: number; sizeBytes: number }[];
}
