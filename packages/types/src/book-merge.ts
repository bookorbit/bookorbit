/** At most this many books, the kept one included, go into one merge request. */
export const BOOK_MERGE_MAX_BOOKS = 10;

/** The error code a merged-away book id answers with, alongside `errorMeta.targetBookId`. */
export const BOOK_MERGED_ERROR_CODE = "BOOK_MERGED";

/** Reasons a merge cannot run. Stable codes; clients localize them and never match English. */
export const BOOK_MERGE_BLOCKERS = [
  "NOT_FOUND",
  "BOOK_MERGED",
  "SAME_BOOK",
  "TOO_MANY_BOOKS",
  /** Sent by older servers only: books in different libraries now merge. Kept so clients still read it. */
  "DIFFERENT_LIBRARIES",
  "FILE_PER_BOOK_LIBRARY",
  "TARGET_NOT_PRESENT",
  "SOURCE_PROCESSING",
  "BOTH_HAVE_AUDIO",
  "NO_DESTINATION_FOLDER",
  "LEGACY_VIRTUAL_FOLDER",
  "FOLDER_NOT_WRITABLE",
  "LIBRARY_BUSY",
  "BOOK_BUSY",
  "PATH_CONFLICT",
  "NESTED_BOOK_CONFLICT",
  "PERMISSION_DENIED",
  /** The destination drive lacks room for the files copied onto it; `bytes` is what the copy needs. */
  "INSUFFICIENT_SPACE",
  /** A moved file's `format` is not allowed in the destination library (`libraryId`). */
  "FORMAT_NOT_ALLOWED",
  /** A moved file would land on a path (`relPath`) the destination library excludes from scans. */
  "PATH_EXCLUDED",
  /** A book file stays behind in another library's folder, where the next scan would add it again. */
  "LEFTOVER_CONTENT",
  /** Other readers would lose access to the book and the viewer may not decide that for them. */
  "READERS_LOSE_ACCESS",
] as const;
export type BookMergeBlockerCode = (typeof BOOK_MERGE_BLOCKERS)[number];

/** Things the merge will do that the reviewer should know about. Never blocking. */
export const BOOK_MERGE_WARNINGS = [
  "CROSS_DEVICE_COPY",
  "IDENTICAL_COPIES",
  "RENAMED_ON_COLLISION",
  "KOBO_REDELIVERY",
  "ISBN_DROPPED",
  "OTHER_READERS_AFFECTED",
  "LEFTOVER_FILES",
  "DESTINATION_MOVES_TARGET",
  "SIDECARS_LEFT_BEHIND",
  "VISIBILITY_WIDENS",
  "VISIBILITY_NARROWS",
  "REMOTE_BOOKS_DIFFER",
  /** Readers with data on a book that changes library cannot open the destination library. Needs `acknowledgeAccessLoss`. */
  "LIBRARY_ACCESS_NARROWS",
  /** Readers' Kobo devices lose the book because they cannot open the destination library. */
  "KOBO_REMOVAL",
  /** Custom field values are kept but hidden: the destination library does not use those fields. */
  "CUSTOM_FIELDS_HIDDEN",
  /** Files with other hard links (a torrent client's copy) are copied to another drive; the other links keep theirs. */
  "HARDLINKED_FILES",
  /** The kept book moves to the destination library (`libraryId`). */
  "TARGET_CHANGES_LIBRARY",
  /** An open request for the book's other format joins only in its own library (`libraryId`): it arrives there as a book of its own. */
  "COMPANION_REQUEST_STAYS",
] as const;
export type BookMergeWarningCode = (typeof BOOK_MERGE_WARNINGS)[number];

/**
 * Fields the reviewer can take from a specific book. Paired fields travel as one: `publishedYear`
 * carries the date with it, `isbn` both ISBNs, `series` every series membership, and `hardcoverId`
 * the edition id. Genres and tags are not picked: they are united (see `includeTagIds`).
 */
export const BOOK_MERGE_FIELDS = [
  "title",
  "subtitle",
  "authors",
  "description",
  "publisher",
  "publishedYear",
  "language",
  "pageCount",
  "series",
  "isbn",
  "narrators",
  "googleBooksId",
  "goodreadsId",
  "amazonId",
  "hardcoverId",
  "openLibraryId",
  "itunesId",
  "audibleId",
  "librofmId",
  "koboId",
  "comicvineId",
  "ranobedbId",
  "lubimyczytacId",
  "aladinId",
] as const;
export type BookMergeField = (typeof BOOK_MERGE_FIELDS)[number];

/** What holds a book for `BOOK_BUSY`. Clients must treat an unknown value as a generic busy book. */
export const BOOK_MERGE_BUSY_REASONS = ["metadata_fetch", "chapter_lookup", "chapter_job", "read_aloud", "upload", "file_operation"] as const;
export type BookMergeBusyReason = (typeof BOOK_MERGE_BUSY_REASONS)[number];

export interface BookMergeBlocker {
  code: BookMergeBlockerCode;
  /** For `BOOK_BUSY`: what the book is busy with. Absent from older servers. */
  busyReason?: BookMergeBusyReason;
  /** The book the blocker is about, when it is about one. */
  bookId?: number;
  /** For `BOOK_MERGED`: the book the id was merged into. */
  targetBookId?: number;
  /** For path blockers: the conflicting path, relative to its library folder. */
  relPath?: string;
  /** For `INSUFFICIENT_SPACE`: bytes the copy needs. Absent from older servers. */
  bytes?: number;
  /** The library the blocker is about (`LIBRARY_BUSY`, `FORMAT_NOT_ALLOWED`, `PATH_EXCLUDED`, `LEFTOVER_CONTENT`, `FOLDER_NOT_WRITABLE`). Absent from older servers. */
  libraryId?: number;
  /** For `FORMAT_NOT_ALLOWED`: the refused format. */
  format?: string;
}

export interface BookMergeWarning {
  code: BookMergeWarningCode;
  bookId?: number;
  /** The library the warning is about. Absent from older servers. */
  libraryId?: number;
  /** Files, users or rows, depending on the warning. Absent where the count is not the viewer's to see. */
  count?: number;
  /** For `CROSS_DEVICE_COPY`: bytes copied between devices. */
  bytes?: number;
  tagIds?: number[];
  genreIds?: number[];
}

export interface BookMergeBookSummary {
  id: number;
  title: string;
  authors: string[];
  libraryId: number;
  status: string;
  formats: string[];
  fileCount: number;
  hasAudio: boolean;
  /** The book's folder relative to its library folder; absent for a root-level single-file book. */
  folderRelPath: string | null;
  /** True when the book can be the destination folder (it has a folder of its own). */
  canBeDestination: boolean;
  addedAt: string | null;
  /** The library folder holding the book. Absent from older servers. */
  libraryFolderId?: number;
  /** That folder's last path segment, for "Files will be stored in". Never a full server path. */
  libraryFolderName?: string;
  /** The book's library name. Absent from older servers. */
  libraryName?: string;
  /** Reading data on the book, for the keeper cards. Absent from older servers. */
  activity?: BookMergeBookActivity;
}

export interface BookMergeBookActivity {
  /** The viewer's own highlights and notes on the book. */
  highlights: number;
  /** The viewer's own shelves and collections holding the book. */
  shelves: number;
  /** The viewer has a reading status, history or progress on the book. */
  hasProgress: boolean;
  /** Readers with a status, history or progress, the viewer included. Null unless the viewer may see other users' data. */
  readers: number | null;
}

export type BookMergeFieldValue = string | number | boolean | string[] | null;

export interface BookMergeFieldCandidate {
  bookId: number;
  value: BookMergeFieldValue;
  locked: boolean;
}

export interface BookMergeFieldPreview {
  field: BookMergeField;
  /** One entry per book in request order, the kept book first. */
  candidates: BookMergeFieldCandidate[];
  /** The book whose value the merge keeps unless the request overrides it. */
  defaultBookId: number;
  /** True when at least two books hold different non-blank values. */
  differs: boolean;
  lockedOnTarget: boolean;
}

export type BookMergeFileAction = "move" | "stay" | "hide";

export type BookMergeFileReason =
  "content" | "supplement" | "cover" | "already_in_destination" | "cover_kept_in_place" | "metadata_kept_in_place" | "metadata_hidden" | "missing";

export interface BookMergeFilePlanEntry {
  fileId: number;
  bookId: number;
  role: string;
  format: string | null;
  fromRelPath: string;
  toRelPath: string;
  action: BookMergeFileAction;
  reason: BookMergeFileReason;
  /** Renamed with a numeric suffix because the name was taken in the destination. */
  renamed: boolean;
  /** Byte-for-byte equal to another file of the merged book (full content hash). */
  identical: boolean;
  crossDevice: boolean;
  sizeBytes: number | null;
  /** The library the file is in now. Absent from older servers. */
  fromLibraryId?: number;
  /** The library the file is in after the merge. Absent from older servers. */
  toLibraryId?: number;
}

/** Destination library settings that apply to the merged book differently than its old library's did. */
export const BOOK_MERGE_LIBRARY_SETTINGS = ["primaryFormat", "fileWrite", "namingPattern"] as const;
export type BookMergeLibrarySetting = (typeof BOOK_MERGE_LIBRARY_SETTINGS)[number];

export interface BookMergeLibrarySettingChange {
  setting: BookMergeLibrarySetting;
  /** The library a moving book leaves. */
  fromLibraryId: number;
  /** The destination library, whose setting applies afterwards. */
  toLibraryId: number;
  /** For `primaryFormat`: the format of the main file afterwards. */
  format?: string;
}

export const BOOK_MERGE_USER_DATA_CATEGORIES = [
  "readingProgress",
  "readingHistory",
  "readingSessions",
  "annotations",
  "bookmarks",
  "journal",
  "notes",
  "ratings",
  "collections",
  "kobo",
  "hardcover",
  "storygraph",
] as const;
export type BookMergeUserDataCategory = (typeof BOOK_MERGE_USER_DATA_CATEGORIES)[number];

export interface BookMergeUserDataCount {
  category: BookMergeUserDataCategory;
  /** Rows that move to the kept book. */
  rows: number;
  /** Distinct users those rows belong to. */
  users: number;
}

export interface BookMergeUserData {
  /** The requesting user's own data on the books being merged away. */
  own: BookMergeUserDataCount[];
  /** Everyone else's. Null unless the viewer may see other readers' activity (user managers). */
  others: BookMergeUserDataCount[] | null;
  /** True when other readers have data that moves, whether or not the counts are shown. */
  otherReadersAffected: boolean;
}

export interface BookMergeVisibilityCandidate {
  id: number;
  name: string;
  /** `widens`: would show the kept book to a filtered user who cannot see it now. `narrows`: would hide it from one who can. */
  effect: "widens" | "narrows";
}

export interface BookMergeVisibility {
  /** Tags and genres left out of the union by default because they change who can see the kept book. */
  tags: BookMergeVisibilityCandidate[];
  genres: BookMergeVisibilityCandidate[];
  /** Only user managers may add a left-out tag or genre back. */
  canOverride: boolean;
  /** Tag names the kept book ends with, as previewed. Absent from older servers. */
  resultTags?: string[];
  /** Genre names the kept book ends with, as previewed. Absent from older servers. */
  resultGenres?: string[];
}

export interface BookMergePreviewRequest {
  targetBookId: number;
  sourceBookIds: number[];
  /** The book whose folder receives every file. The kept book's own folder when omitted. */
  destinationBookId?: number;
}

export interface BookMergePreviewResponse {
  eligible: boolean;
  blockers: BookMergeBlocker[];
  warnings: BookMergeWarning[];
  /** The kept book first, then the sources in request order. */
  books: BookMergeBookSummary[];
  targetBookId: number;
  destinationBookId: number | null;
  /** Books whose folder can receive the files. */
  destinationCandidates: number[];
  /**
   * Set when every book is a single file at the top of its folder: the kept book gets this new folder,
   * relative to its library folder, and every file moves into it. Absent from older servers.
   */
  newFolderRelPath?: string | null;
  fields: BookMergeFieldPreview[];
  files: BookMergeFilePlanEntry[];
  userData: BookMergeUserData;
  visibility: BookMergeVisibility;
  /** True when identical copies exist and the viewer may delete books. */
  canRemoveIdenticalCopies: boolean;
  /** The library the merged book lives in afterwards. Absent from older servers. */
  destinationLibraryId?: number | null;
  /** Per destination candidate: how many other readers would lose access with it. Null counts are not the viewer's to see. Absent from older servers. */
  destinationAccessLoss?: Array<{ bookId: number; libraryId: number; losesAccess: boolean; count: number | null }>;
  /** Destination library settings that change for the merged book. Absent from older servers. */
  librarySettingChanges?: BookMergeLibrarySettingChange[];
  /** Echo it in the merge request; a stale token answers 409 `MERGE_PREVIEW_STALE`. Null when not eligible. */
  previewToken: string | null;
}

export interface BookMergeRequest {
  targetBookId: number;
  sourceBookIds: number[];
  destinationBookId?: number;
  /** Field to the book whose value it takes, overriding the default. Every book named must be in the request. */
  fieldOverrides?: Partial<Record<BookMergeField, number>>;
  /** Visibility-changing tags (or genres) to add to the kept book anyway. User managers only. */
  includeTagIds?: number[];
  includeGenreIds?: number[];
  /** Retire byte-identical copies after merging. Needs the delete-books permission. Defaults to false. */
  deleteIdenticalCopies?: boolean;
  /**
   * Confirms the merge may leave other readers without access (`LIBRARY_ACCESS_NARROWS`). Defaults to
   * false. Send it only to a server whose preview carried that warning: older servers reject the field.
   */
  acknowledgeAccessLoss?: boolean;
  previewToken: string;
}

export interface BookMergeStartResponse {
  jobId: number;
  /** Every library the merge touches, the destination included. Absent from older servers. */
  libraryIds?: number[];
}

export const BOOK_MERGE_JOB_STATUSES = ["planned", "moving", "committing", "committed", "done", "failed", "rolled_back"] as const;
export type BookMergeJobStatus = (typeof BOOK_MERGE_JOB_STATUSES)[number];

export type BookMergeSourceStatus = "pending" | "merged" | "rolled_back" | "failed";

export interface BookMergeSourceOutcome {
  sourceBookId: number;
  status: BookMergeSourceStatus;
  errorCode: string | null;
}

export interface BookMergeJobResult {
  movedFileCount: number;
  crossDevice: boolean;
  leftoverFileCount: number;
  retiredFileCount: number;
}

export interface BookMergeJob {
  id: number;
  libraryId: number;
  targetBookId: number;
  sourceBookIds: number[];
  status: BookMergeJobStatus;
  processed: number;
  total: number;
  currentSourceBookId: number | null;
  outcomes: BookMergeSourceOutcome[];
  result: BookMergeJobResult | null;
  errorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Socket `book:merged`, to the room of every library the merge touched. */
export interface BookMergedEvent {
  /** The library the merged book lives in. */
  libraryId: number;
  targetBookId: number;
  sourceBookIds: number[];
  /** Libraries the merged-away books, or the kept book, were in before. Absent from older servers. */
  sourceLibraryIds?: number[];
}

/** Socket `book-merge:progress` and `book-merge:finished`, to the requesting user. */
export interface BookMergeJobEvent {
  jobId: number;
  status: BookMergeJobStatus;
  targetBookId: number;
  processed: number;
  total: number;
  currentSourceBookId: number | null;
  outcomes: BookMergeSourceOutcome[];
  /** Bytes the merge moves in all. Absent from older servers and from finished events. */
  bytesTotal?: number;
  /** Bytes moved so far. */
  bytesDone?: number;
}
