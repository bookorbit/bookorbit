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
  /** Unsorted's own toggles; library docks carry theirs on the dock. Absent on older servers. */
  unsortedAutoJoin?: boolean;
  unsortedKeepOriginal?: boolean;
}

export type UpdateBookDockSettingsRequest = Omit<BookDockSettings, "bookDockPath">;

/** A dock's own values for the global Book Dock settings. `null` inherits the global value. */
export interface LibraryDockOverrides {
  autoFetchMetadata: boolean | null;
  autoFinalizeEnabled: boolean | null;
  autoFinalizeThreshold: number | null;
  autoFinalizeMetadataMode: BookDockAutoFinalizeMetadataMode | null;
}

/** What a dock actually does once its overrides are applied over the global settings. */
export interface BookDockEffectiveSettings {
  autoFetchMetadata: boolean;
  autoFinalizeEnabled: boolean;
  autoFinalizeThreshold: number;
  autoFinalizeMetadataMode: BookDockAutoFinalizeMetadataMode;
  autoJoin: boolean;
  keepOriginal: boolean;
}

/** A library's own drop folder, `_libraries/<folderName>` inside the Book Dock. */
export interface LibraryDock {
  id: number;
  libraryId: number;
  libraryName: string;
  folderName: string;
  enabled: boolean;
  /** Null when the folder it filed into was removed from the library; arrivals wait until one is chosen. */
  targetFolderId: number | null;
  overrides: LibraryDockOverrides;
  autoJoin: boolean;
  keepOriginal: boolean;
}

/**
 * Why a ready file waits instead of filing itself. Stable, so clients can show their own copy; new
 * codes may be added, so an unknown one must read as a plain "waiting for review".
 */
export const BOOK_DOCK_HOLD_REASONS = [
  /** The best match scored below the dock's threshold. */
  "low_confidence",
  /** No library to file into. */
  "no_destination",
  /** The library is known but the folder it filed into was removed. */
  "no_folder",
  /** The target library does not accept this format or layout. */
  "not_allowed_in_library",
  /** The target library already holds this book. */
  "duplicate",
  /** Something already sits at the path this file would be written to. */
  "destination_conflict",
  /** A multi-file unit the target library's organization mode cannot represent. */
  "unsupported_layout",
  /** The uploader may not add books to the target library, so a dock manager files it. */
  "waiting_for_manager",
] as const;

export type BookDockHoldReason = (typeof BOOK_DOCK_HOLD_REASONS)[number];

export function isBookDockHoldReason(value: unknown): value is BookDockHoldReason {
  return typeof value === "string" && (BOOK_DOCK_HOLD_REASONS as readonly string[]).includes(value);
}

/** The facts behind a hold reason. Which fields are set depends on the reason. */
export interface BookDockHoldDetail {
  confidence?: number;
  threshold?: number;
  libraryId?: number;
  libraryName?: string;
  /** The existing book a `duplicate` hold matched. */
  bookId?: number;
  /** A manager chose "Keep both" for a duplicate, so the duplicate check no longer holds the file. */
  keepBoth?: boolean;
}

/** A library folder a dock can file into. */
export interface LibraryDockFolderOption {
  id: number;
  path: string;
}

/** A library as the dock settings list it, with its dock when it has one. */
export interface LibraryDockAdminEntry {
  libraryId: number;
  libraryName: string;
  folders: LibraryDockFolderOption[];
  dock: LibraryDock | null;
  /** What the dock does with its overrides applied. For a library without a dock, the defaults it would start with. */
  effective: BookDockEffectiveSettings;
  /**
   * The folder name the library's current name gives. For a dock whose folder no longer matches,
   * what "Rename folder to match" would use; null when it already matches.
   */
  suggestedFolderName: string | null;
  /** Whether the dock's folder exists on disk. False for a library without a dock. */
  folderPresent: boolean;
}

/** A folder in `_libraries` that no dock owns. Its files are not taken in. */
export interface LibraryDockUnrecognisedFolder {
  name: string;
  /** A library without a dock whose name gives this folder name, so the folder can be adopted in one step. */
  matchesLibraryId: number | null;
}

/** Everything the dock settings page manages, read by dock managers. */
export interface LibraryDocksAdmin {
  /** The `_libraries` folder inside the Book Dock folder. */
  librariesPath: string;
  libraries: LibraryDockAdminEntry[];
  unrecognisedFolders: LibraryDockUnrecognisedFolder[];
  /** Files sitting directly in `_libraries`, which no dock takes in. At most 100 names. */
  strayFiles: string[];
  /** More stray files exist than `strayFiles` lists. */
  strayFilesTruncated: boolean;
  /** `_libraries` is a book an earlier version took in, so library docks cannot start until it is moved. */
  librariesFolderIsBook: boolean;
}

/**
 * Changes to a library's dock. Absent fields stay as they are; a `null` override goes back to
 * inheriting the global setting. A library without a dock gets one only with `enabled: true`.
 */
export interface UpdateLibraryDockRequest {
  enabled?: boolean;
  /** Renames the folder on disk. */
  folderName?: string;
  targetFolderId?: number;
  autoFetchMetadata?: boolean | null;
  autoFinalizeEnabled?: boolean | null;
  autoFinalizeThreshold?: number | null;
  autoFinalizeMetadataMode?: BookDockAutoFinalizeMetadataMode | null;
  autoJoin?: boolean;
  keepOriginal?: boolean;
}

export interface MoveLibraryDockFolderResult {
  /** Top-level entries moved into the Book Dock root. */
  moved: number;
  /** The folder was empty afterwards and was removed. */
  folderRemoved: boolean;
}

/** A library dock the caller may upload into: turned on, in a library the caller can see. */
export interface BookDockUploadTarget {
  dockId: number;
  libraryId: number;
  libraryName: string;
  /** The library's own format list; empty allows every supported format. */
  allowedFormats: string[];
}

/**
 * `GET /book-dock/docks`. A server without library docks answers 404, and a client then offers
 * Unsorted only: an older server would silently drop `libraryId` from a `book_dock` upload.
 */
export interface BookDockUploadTargets {
  docks: BookDockUploadTarget[];
}

/**
 * How filing from a dock reaches its library. `move` is instant: a rename, or a hardlink in a
 * keep-original dock. `copy` means the two sit on different filesystems or mounts. `unknown` means
 * a folder is missing or cannot be written, so nothing could be tried.
 */
export type LibraryDockFiling = "move" | "copy" | "unknown";

export interface LibraryDockFilingCheck {
  libraryId: number;
  filing: LibraryDockFiling;
  /** The OS error behind `copy` or `unknown`, EXDEV say. Shown verbatim; not translated. */
  errorCode?: string;
}

export interface LibraryDockFilingChecks {
  checks: LibraryDockFilingCheck[];
}

/**
 * The `dock` filter on the file list, bulk actions and finalize: `unsorted`, or a dock id as a
 * string. A request download counts under the dock of the library it is headed for.
 */
export const BOOK_DOCK_UNSORTED_FILTER = "unsorted";

/**
 * The `hold` filter on the file list, bulk actions and finalize: ready files that wait (`held`),
 * ready files that do not (`clear`), or ready files held for one reason.
 */
export type BookDockHoldFilter = "held" | "clear" | BookDockHoldReason;

export const BOOK_DOCK_HOLD_FILTERS: readonly BookDockHoldFilter[] = ["held", "clear", ...BOOK_DOCK_HOLD_REASONS];

/** Why a dock management request was refused. Stable, so clients can show their own copy. */
export const LIBRARY_DOCK_ERROR_CODES = [
  "LIBRARY_DOCK_NOT_FOUND",
  "LIBRARY_DOCK_NOT_ENABLED",
  "LIBRARY_DOCK_EXISTS",
  "LIBRARY_DOCK_BUSY",
  "LIBRARY_DOCK_TARGET_FOLDER_INVALID",
  "LIBRARY_DOCK_FOLDER_NAME_INVALID",
  "LIBRARY_DOCK_FOLDER_NAME_TAKEN",
  "LIBRARY_DOCK_FOLDER_EXISTS",
  "LIBRARY_DOCK_FOLDER_NOT_FOUND",
  "LIBRARY_DOCK_FOLDER_OWNED",
  "LIBRARY_DOCK_FOLDER_NOT_EMPTY",
  "LIBRARY_DOCK_FOLDER_UNWRITABLE",
  "LIBRARY_DOCK_OTHER_FILESYSTEM",
  "LIBRARY_DOCKS_FOLDER_IS_BOOK",
] as const;

export type LibraryDockErrorCode = (typeof LIBRARY_DOCK_ERROR_CODES)[number];

export function isLibraryDockErrorCode(value: unknown): value is LibraryDockErrorCode {
  return typeof value === "string" && (LIBRARY_DOCK_ERROR_CODES as readonly string[]).includes(value);
}

/** Per-dock counts on the summary. `dockId` null is Unsorted. */
export interface BookDockDockCounts {
  dockId: number | null;
  total: number;
  /** Not yet settled: pending, extracting or fetching. */
  working: number;
  /** Ready but held, with a `holdReason`. */
  onHold: number;
  ready: number;
  error: number;
  keptForSeeding: number;
  /** `onHold` split by reason. Reasons with no files are left out. Absent on older servers. */
  onHoldByReason?: Partial<Record<BookDockHoldReason, number>>;
}

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
  /** The library dock it arrived in; null for Unsorted. Absent on older servers. */
  dockId?: number | null;
  holdReason?: BookDockHoldReason | null;
  holdDetail?: BookDockHoldDetail | null;
  /** Set when the library this file was headed for was deleted. */
  formerLibraryName?: string | null;
  /** Other libraries that already hold this book, at most three. Never holds the file. */
  alsoIn?: string[];
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
  /** Counts per dock, Unsorted included. Absent on older servers. */
  docks?: BookDockDockCounts[];
  /** Files filed from keep-original docks and left in place for seeding. Absent on older servers. */
  keptForSeeding?: number;
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
