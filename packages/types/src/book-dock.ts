import type { AudiobookChapter } from "./audiobook";
import type { ComicMetadataFields, MetadataProviderKey, MetadataSeriesMembership } from "./metadata-fetch";
import type { SeriesIndex } from "./series-index";

export type BookDockFileStatus = "pending" | "extracting" | "fetching" | "ready" | "error";
export type BookDockAutoFinalizeMetadataMode = "safe_merge" | "fetched_only" | "embedded_only";

export interface BookDockSettings {
  bookDockPath: string;
  autoFetchMetadata: boolean;
  autoFinalizeEnabled: boolean;
  autoFinalizeThreshold: number;
  autoFinalizeLibraryId: number | null;
  autoFinalizeFolderId: number | null;
  autoFinalizeMetadataMode: BookDockAutoFinalizeMetadataMode;
}

export type UpdateBookDockSettingsRequest = Omit<BookDockSettings, "bookDockPath">;

export function resolveBookDockSearchTitle(fileName: string, metadataTitle?: string | null): string | undefined {
  const normalizedMetadataTitle = metadataTitle?.trim();
  if (normalizedMetadataTitle) return normalizedMetadataTitle;

  const normalizedFileName = fileName.trim();
  if (!normalizedFileName) return undefined;

  const extensionIndex = normalizedFileName.lastIndexOf(".");
  const stem = extensionIndex > 0 ? normalizedFileName.slice(0, extensionIndex) : normalizedFileName;
  return stem.trim() || undefined;
}

export interface BookDockMetadata {
  title?: string | null;
  subtitle?: string | null;
  authors?: string[];
  narrators?: string[];
  description?: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  publishedYear?: number | null;
  language?: string | null;
  pageCount?: number | null;
  isbn10?: string | null;
  isbn13?: string | null;
  seriesName?: string | null;
  seriesIndex?: SeriesIndex | null;
  seriesMemberships?: MetadataSeriesMembership[] | null;
  genres?: string[];
  coverUrl?: string | null;
  durationSeconds?: number | null;
  abridged?: boolean | null;
  chapters?: AudiobookChapter[] | null;
  communityRatings?: Array<{ provider: MetadataProviderKey; rating: number; ratingCount?: number | null }> | null;
  googleBooksId?: string | null;
  goodreadsId?: string | null;
  amazonId?: string | null;
  hardcoverId?: string | null;
  hardcoverEditionId?: string | null;
  openLibraryId?: string | null;
  itunesId?: string | null;
  audibleId?: string | null;
  librofmId?: string | null;
  koboId?: string | null;
  comicvineId?: string | null;
  ranobedbId?: string | null;
  lubimyczytacId?: string | null;
  aladinId?: string | null;
  comicMetadata?: ComicMetadataFields | null;
}

/** One file of a multi-file dock unit. Read-only in the UI: a unit is finalized whole. */
export interface BookDockUnitFile {
  fileName: string;
  fileSize: number | null;
  format: string | null;
  role: "content" | "cover" | "metadata" | "supplement";
  sortOrder: number | null;
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
  /**
   * The files this entry is made of, in playback or format order. Empty for the ordinary loose
   * single file, which is what `fileName` and `fileSize` already describe.
   */
  unitFiles: BookDockUnitFile[];
}

export interface BookDockFilesPage {
  items: BookDockFile[];
  total: number;
  page: number;
  size: number;
}

export interface BookDockSummary {
  /** Everything not yet settled, including files still extracting or fetching. */
  pending: number;
  /** The in-flight subset of `pending`: extracting plus fetching. */
  working: number;
  ready: number;
  error: number;
  /** Ready files with no destination or a match too weak to trust. */
  needsReview: number;
  /** Ready files finalize would accept right now: destination resolved. */
  readyToFile: number;
  total: number;
  paused: boolean;
}

export interface BookDockFinalizeOverride {
  fileId: number;
  libraryId?: number;
  folderId?: number;
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
  | "ready"
  | "duplicate"
  | "destination_conflict"
  | "missing_destination"
  | "invalid_target"
  | "access_denied"
  | "invalid_format"
  /** A multi-file unit the target library's organization mode cannot represent. */
  | "unsupported_layout"
  | "error";

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
