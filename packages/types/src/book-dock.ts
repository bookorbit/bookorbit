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
  /** Ids from external providers, keyed by provider. Absent on older servers. */
  externalProviderIds?: Partial<Record<string, string>> | null;
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
  /**
   * Whether this EPUB carries synced narration. Only a single file's read that asks for it with
   * `readAlong=true` answers it, since it means opening the file; every other response leaves it out.
   */
  readAlong?: boolean;
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

/**
 * Why a file could not be added to the book it was asked to join. Stable, so clients can show
 * their own copy; new codes may be added, so an unknown one must read as a generic refusal.
 */
export const BOOK_DOCK_JOIN_ERROR_CODES = [
  /** The book does not exist, or the requester cannot see it. */
  "BOOK_DOCK_JOIN_BOOK_NOT_FOUND",
  /** The book's files are missing from disk, so there is no folder to add to. */
  "BOOK_DOCK_JOIN_BOOK_MISSING",
  /** The requester can see the book but cannot edit its library. */
  "BOOK_DOCK_JOIN_FORBIDDEN",
  /** The book lives in a different library from the one the file is being filed into. */
  "BOOK_DOCK_JOIN_OTHER_LIBRARY",
  /** The library stores one book per file, so a second format cannot share a book. */
  "BOOK_DOCK_JOIN_FILE_PER_BOOK",
  /** The book sits loose at the library folder root and has no folder of its own to share. */
  "BOOK_DOCK_JOIN_ROOT_LEVEL",
  /** Both the book and the file hold audio; two audio sets in one book play as one doubled timeline. */
  "BOOK_DOCK_JOIN_AUDIO_CONFLICT",
] as const;

export type BookDockJoinErrorCode = (typeof BOOK_DOCK_JOIN_ERROR_CODES)[number];

export function isBookDockJoinErrorCode(value: unknown): value is BookDockJoinErrorCode {
  return typeof value === "string" && (BOOK_DOCK_JOIN_ERROR_CODES as readonly string[]).includes(value);
}

/** An existing book a docked file joins or could join. */
export interface BookDockJoinBook {
  bookId: number;
  title: string | null;
  authors: string[];
}

/**
 * What a suggestion was matched on: an ISBN, a work-level Hardcover or Open Library id, or the title
 * with an agreeing author. New reasons may be added; show an unknown one as a plain match.
 */
export type BookDockJoinSuggestionReason = "isbn" | "work_id" | "title_author";

export interface BookDockJoinSuggestion extends BookDockJoinBook {
  reason: BookDockJoinSuggestionReason;
}

export interface BookDockFinalizeOverride {
  fileId: number;
  libraryId?: number;
  folderId?: number;
  targetFileName?: string;
  /**
   * Add this file to an existing book as another format, in that book's own folder. The server
   * works out the folder from the book; the library must be the one the file is filed into and must
   * keep one book per folder. Servers that predate this reject the field, so send it only when a
   * finalize preview item carried `canJoinBook`.
   */
  joinBook?: { bookId: number };
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
  /** Set when a requested join was refused. */
  errorCode?: BookDockJoinErrorCode;
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
  /** Set when a requested join was refused. */
  errorCode?: BookDockJoinErrorCode;
  /** The library the file is headed for, once its destination resolved. */
  libraryId?: number;
  /** Whether this file may be added to an existing book: a folder-per-book library the requester can edit. */
  canJoinBook?: boolean;
  /** The existing book this file will be added to. Present only when the request named it in `joinBook`. */
  joinsBook?: BookDockJoinBook;
  /**
   * An existing book in the target library this file looks like another format of. Only a
   * suggestion: nothing joins it until a request names it in `joinBook`.
   */
  suggestedJoinBook?: BookDockJoinSuggestion;
}

export interface BookDockFinalizePreviewResult {
  total: number;
  ready: number;
  /** The subset of `ready` that will be added to an existing book. Absent on older servers. */
  joining?: number;
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
