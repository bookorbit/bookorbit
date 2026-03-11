export type StagingFileStatus = "pending" | "extracting" | "fetching" | "ready" | "error";

export interface StagingMetadata {
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

export interface StagingFile {
  id: number;
  fileName: string;
  fileSize: number | null;
  format: string | null;
  status: StagingFileStatus;
  embeddedMetadata: StagingMetadata | null;
  selectedMetadata: StagingMetadata | null;
  fetchedMetadata: StagingMetadata | null;
  targetLibraryId: number | null;
  targetFolderId: number | null;
  confidence: number | null;
  fetchedMetadataSources: Partial<Record<keyof StagingMetadata, string>> | null;
  errorMessage: string | null;
  metadataEditedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StagingFilesPage {
  items: StagingFile[];
  total: number;
  page: number;
  size: number;
}

export interface StagingSummary {
  pending: number;
  ready: number;
  error: number;
  total: number;
}

export interface StagingFinalizeOverride {
  fileId: number;
  libraryId?: number;
  folderId?: number;
}

export interface StagingFinalizeRequest {
  fileIds?: number[];
  selectAll?: boolean;
  excludedIds?: number[];
  status?: StagingFileStatus;
  search?: string;
  defaultLibraryId?: number;
  defaultFolderId?: number;
  overrides?: StagingFinalizeOverride[];
}

export interface StagingFinalizeFileResult {
  fileId: number;
  fileName: string;
  newName?: string;
  success: boolean;
  bookId?: number;
  isDuplicate?: boolean;
  existingBookId?: number;
  message?: string;
}

export interface StagingFinalizeResult {
  total: number;
  succeeded: number;
  failed: number;
  results: StagingFinalizeFileResult[];
}

export interface StagingBulkEditRequest {
  fileIds?: number[];
  selectAll?: boolean;
  excludedIds?: number[];
  status?: StagingFileStatus;
  search?: string;
  fields: Partial<StagingMetadata>;
  enabledFields: string[];
  mergeArrays: boolean;
}

export interface StagingBulkEditResult {
  total: number;
  updated: number;
  failed: number;
}

export interface StagingStatistics {
  totalSizeBytes: number;
  byFormat: { format: string; count: number; sizeBytes: number }[];
}
