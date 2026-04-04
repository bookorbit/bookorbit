export type BookBucketFileStatus = "pending" | "extracting" | "fetching" | "ready" | "error";
export type BookBucketAutoFinalizeMetadataMode = "safe_merge" | "fetched_only" | "embedded_only";

export interface BookBucketMetadata {
  title?: string;
  subtitle?: string;
  authors?: string[];
  description?: string;
  publisher?: string;
  publishedYear?: number;
  language?: string;
  pageCount?: number;
  isbn10?: string;
  isbn13?: string;
  seriesName?: string;
  seriesIndex?: number;
  genres?: string[];
  coverUrl?: string;
}

export interface BookBucketFile {
  id: number;
  fileName: string;
  fileSize: number | null;
  format: string | null;
  status: BookBucketFileStatus;
  embeddedMetadata: BookBucketMetadata | null;
  selectedMetadata: BookBucketMetadata | null;
  fetchedMetadata: BookBucketMetadata | null;
  targetLibraryId: number | null;
  targetFolderId: number | null;
  confidence: number | null;
  fetchedMetadataSources: Partial<Record<keyof BookBucketMetadata, string>> | null;
  errorMessage: string | null;
  metadataEditedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookBucketFilesPage {
  items: BookBucketFile[];
  total: number;
  page: number;
  size: number;
}

export interface BookBucketSummary {
  pending: number;
  ready: number;
  error: number;
  total: number;
}

export interface BookBucketFinalizeOverride {
  fileId: number;
  libraryId?: number;
  folderId?: number;
}

export interface BookBucketFinalizeRequest {
  fileIds?: number[];
  selectAll?: boolean;
  excludedIds?: number[];
  status?: BookBucketFileStatus;
  search?: string;
  defaultLibraryId?: number;
  defaultFolderId?: number;
  overrides?: BookBucketFinalizeOverride[];
}

export interface BookBucketFinalizeFileResult {
  fileId: number;
  fileName: string;
  newName?: string;
  success: boolean;
  bookId?: number;
  isDuplicate?: boolean;
  existingBookId?: number;
  message?: string;
}

export interface BookBucketFinalizeResult {
  total: number;
  succeeded: number;
  failed: number;
  results: BookBucketFinalizeFileResult[];
}

export interface BookBucketBulkEditRequest {
  fileIds?: number[];
  selectAll?: boolean;
  excludedIds?: number[];
  status?: BookBucketFileStatus;
  search?: string;
  fields: Partial<BookBucketMetadata>;
  enabledFields: string[];
  mergeArrays: boolean;
}

export interface BookBucketBulkEditResult {
  total: number;
  updated: number;
  failed: number;
}

export interface BookBucketStatistics {
  totalSizeBytes: number;
  byFormat: { format: string; count: number; sizeBytes: number }[];
}
