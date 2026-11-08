import { isAudioFormat, type UserBookStatus } from "./book";
import { BOOK_LINK_MAX_MEMBERS } from "./book-link";
import type { DuplicateKeepRule } from "./book-duplicate-keeper";
import { BOOK_MERGE_MAX_BOOKS } from "./book-merge";

/**
 * `duplicate`: copies of one book in one medium. `other_format`: an ebook and an audiobook of one
 * work. The two never share a group, so a book holding both media cannot chain unrelated groups.
 */
export const BOOK_DUPLICATE_KINDS = ["duplicate", "other_format"] as const;
export type BookDuplicateKind = (typeof BOOK_DUPLICATE_KINDS)[number];

export const BOOK_DUPLICATE_MATCH_REASONS = [
  "file_hash",
  "isbn",
  "exact_metadata",
  "fuzzy_metadata",
  "same_work",
  "title_author",
  "series_position",
] as const;
export type BookDuplicateMatchReason = (typeof BOOK_DUPLICATE_MATCH_REASONS)[number];

/** The reasons each kind of group can carry, strongest first. */
export const BOOK_DUPLICATE_REASONS_BY_KIND: Readonly<Record<BookDuplicateKind, readonly BookDuplicateMatchReason[]>> = {
  duplicate: ["file_hash", "isbn", "exact_metadata", "fuzzy_metadata"],
  other_format: ["same_work", "title_author", "series_position"],
};

export const BOOK_DUPLICATE_SCAN_STATUSES = ["queued", "running", "completed", "failed"] as const;
export type BookDuplicateScanStatus = (typeof BOOK_DUPLICATE_SCAN_STATUSES)[number];

export const BOOK_DUPLICATE_GROUP_SORTS = ["reclaimable", "copies", "confidence", "title"] as const;
export type BookDuplicateGroupSort = (typeof BOOK_DUPLICATE_GROUP_SORTS)[number];

export const BOOK_DUPLICATE_SORT_ORDERS = ["asc", "desc"] as const;
export type BookDuplicateSortOrder = (typeof BOOK_DUPLICATE_SORT_ORDERS)[number];

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
  /** Copies beyond the first in every group, set when the scan completes. */
  totalExtraCopies: number | null;
  /**
   * Bytes freed by keeping the largest copy in every group, set when the scan completes. A floor:
   * keeping a smaller copy frees more.
   */
  totalReclaimableBytes: number | null;
  /** Ebook and audiobook pairs of one work, set when the scan completes. */
  totalOtherFormatPairs: number | null;
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
  /** From 0 to 100, the furthest any of the copy's files reached. */
  readingProgress: number | null;
  collections: { id: number; name: string }[];
  addedAt: string;
  updatedAt: string | null;
  hasCover: boolean;
  /** The book's library files every book on its own, where a merge has no folder to merge into. */
  bookPerFile: boolean;
};

export type BookDuplicatePair = {
  bookIdA: number;
  bookIdB: number;
  reasons: BookDuplicateMatchReason[];
  titleSimilarity: number | null;
};

export type BookDuplicateGroup = {
  id: number;
  kind: BookDuplicateKind;
  reasons: BookDuplicateMatchReason[];
  maxTitleSimilarity: number | null;
  /** Bytes freed by keeping the largest copy in this group. */
  reclaimableBytes: number;
  books: BookDuplicateCandidate[];
  pairs: BookDuplicatePair[];
};

export type BookDuplicateDismissal = {
  kind: BookDuplicateKind;
  bookIdA: number;
  bookIdB: number;
  titleA: string | null;
  titleB: string | null;
  createdAt: string;
};

export type CreateBookDuplicateDismissalRequest = {
  scanId: number;
  groupId: number;
};

export type BookDuplicateGroupsResponse = {
  groups: BookDuplicateGroup[];
  total: number;
  page: number;
  pageSize: number;
};

/** What a resolution does with the copies beside the keeper. Other-format pairs are never deleted. */
export const BOOK_DUPLICATE_ACTIONS = ["delete", "merge", "link"] as const;
export type BookDuplicateAction = (typeof BOOK_DUPLICATE_ACTIONS)[number];

/** A single copy's action; `skip` leaves that copy as it is. */
export const BOOK_DUPLICATE_BOOK_ACTIONS = [...BOOK_DUPLICATE_ACTIONS, "skip"] as const;
export type BookDuplicateBookAction = (typeof BOOK_DUPLICATE_BOOK_ACTIONS)[number];

/** Why "Merge into keeper" is not offered for a group. Stable codes; the client localizes them. */
export const BOOK_DUPLICATE_MERGE_UNAVAILABLE_REASONS = [
  "TOO_MANY_BOOKS",
  /** Sent by older servers only: books in different libraries now merge. Kept so clients still read it. */
  "DIFFERENT_LIBRARIES",
  "FILE_PER_BOOK_LIBRARY",
  "TARGET_NOT_PRESENT",
  "BOTH_HAVE_AUDIO",
] as const;
export type BookDuplicateMergeUnavailableReason = (typeof BOOK_DUPLICATE_MERGE_UNAVAILABLE_REASONS)[number];

export type BookDuplicateMergeAvailability = {
  available: boolean;
  reason: BookDuplicateMergeUnavailableReason | null;
};

type AvailabilityBook = Pick<BookDuplicateCandidate, "id" | "libraryId" | "status" | "bookPerFile" | "files">;

function hasAudioContent(book: Pick<BookDuplicateCandidate, "files">): boolean {
  return book.files.some((file) => file.format !== null && isAudioFormat(file.format));
}

/** True when the books sit in more than one library: a merge then moves files between libraries. */
export function duplicateGroupSpansLibraries(books: Pick<BookDuplicateCandidate, "libraryId">[]): boolean {
  return new Set(books.map((book) => book.libraryId)).size > 1;
}

/**
 * The cheap eligibility a group can be judged on before any preview: a library that keeps books in
 * their own folders to receive them, a keeper on disk, at most one audiobook. Books may sit in
 * different libraries. The merge itself re-checks everything, so this only decides what the tool offers.
 */
export function duplicateMergeAvailability(books: AvailabilityBook[], keeperId: number): BookDuplicateMergeAvailability {
  const unavailable = (reason: BookDuplicateMergeUnavailableReason) => ({ available: false, reason });
  if (books.length > BOOK_MERGE_MAX_BOOKS) return unavailable("TOO_MANY_BOOKS");
  const spansLibraries = duplicateGroupSpansLibraries(books);
  if (spansLibraries ? books.every((book) => book.bookPerFile) : books.some((book) => book.bookPerFile)) {
    return unavailable("FILE_PER_BOOK_LIBRARY");
  }
  const keeper = books.find((book) => book.id === keeperId);
  if (!keeper || keeper.status !== "present") return unavailable("TARGET_NOT_PRESENT");
  if (books.filter(hasAudioContent).length > 1) return unavailable("BOTH_HAVE_AUDIO");
  return { available: true, reason: null };
}

export function duplicateLinkAvailable(books: AvailabilityBook[]): boolean {
  return books.length >= 2 && books.length <= BOOK_LINK_MAX_MEMBERS;
}

export type BookDuplicatePermissions = {
  canDelete: boolean;
  canMerge: boolean;
};

/** The actions a user may choose for a group; the server enforces the same rule. */
export function allowedDuplicateActions(kind: BookDuplicateKind, permissions: BookDuplicatePermissions): BookDuplicateAction[] {
  const actions: BookDuplicateAction[] = [];
  if (kind === "duplicate" && permissions.canDelete) actions.push("delete");
  if (permissions.canMerge) actions.push("merge", "link");
  return actions;
}

type DefaultActionGroup = Pick<BookDuplicateGroup, "kind" | "reasons"> & {
  books: AvailabilityBook[];
  /** The group's pairs among `books`. Without them no group is proven identical. */
  pairs?: Pick<BookDuplicatePair, "bookIdA" | "bookIdB" | "reasons">[];
};

/**
 * True when every book of the group has the same content files. A `file_hash` pair means two books'
 * whole content file sets hash alike, but a group's reasons are the union of its pairs', so only the
 * pairs prove it: each must carry `file_hash`, and together they must join every book.
 */
function duplicateGroupProvenIdentical(group: DefaultActionGroup): boolean {
  if (group.kind !== "duplicate" || !group.reasons.includes("file_hash")) return false;
  const pairs = group.pairs ?? [];
  if (pairs.length === 0 || !pairs.every((pair) => pair.reasons.includes("file_hash"))) return false;
  const ids = new Set(group.books.map((book) => book.id));
  const [first] = ids;
  if (first === undefined || ids.size < 2) return false;
  const joined = new Set([first]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const { bookIdA, bookIdB } of pairs) {
      if (!ids.has(bookIdA) || !ids.has(bookIdB) || joined.has(bookIdA) === joined.has(bookIdB)) continue;
      joined.add(bookIdA).add(bookIdB);
      grew = true;
    }
  }
  return joined.size === ids.size;
}

/**
 * The action a group starts with, applied as is to the groups a "select all" never showed. Merge for
 * a match close to certain (an identical file set or a shared ISBN) that the merge can run within one
 * library: copies in two libraries are often kept apart on purpose, so moving files between libraries
 * is never a default. Delete never, except for a user who cannot merge and a group proven identical by
 * file hash. Anything else starts with nothing chosen, and a group with nothing chosen is left as it is.
 */
export function defaultDuplicateAction(
  group: DefaultActionGroup,
  keeperId: number,
  permissions: BookDuplicatePermissions,
): BookDuplicateAction | null {
  if (group.kind !== "duplicate") return null;
  if (permissions.canMerge) {
    const strong = group.reasons.includes("file_hash") || group.reasons.includes("isbn");
    return strong && !duplicateGroupSpansLibraries(group.books) && duplicateMergeAvailability(group.books, keeperId).available ? "merge" : null;
  }
  return permissions.canDelete && duplicateGroupProvenIdentical(group) ? "delete" : null;
}

/** At most this many groups go into one resolution. The rest of a larger selection needs another run. */
export const BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS = 1000;

export type BookDuplicateResolutionBookChoice = {
  bookId: number;
  action: BookDuplicateBookAction;
};

export type BookDuplicateResolutionGroupRequest = {
  groupId: number;
  keeperId: number;
  action: BookDuplicateAction;
  /** A different action for single copies beside the keeper. */
  perBook?: BookDuplicateResolutionBookChoice[];
};

/** Every group of the scan that matches, apart from those listed explicitly or excluded (H8). */
export type BookDuplicateResolutionAllGroups = {
  kind?: BookDuplicateKind;
  reason?: BookDuplicateMatchReason;
  keepRule: DuplicateKeepRule;
  /** Applied to every matching group. Each group's default action when omitted. */
  action?: BookDuplicateAction;
  excludeGroupIds?: number[];
};

export type BookDuplicateResolutionRequest = {
  scanId: number;
  groups?: BookDuplicateResolutionGroupRequest[];
  allGroups?: BookDuplicateResolutionAllGroups;
  /** Retire byte-identical copies after merging. Needs the delete-books permission. Defaults to false. */
  removeIdenticalCopies?: boolean;
};

export type BookDuplicateResolutionStartResponse = {
  jobId: number;
  total: number;
};

export const BOOK_DUPLICATE_RESOLUTION_STATUSES = ["running", "completed", "failed"] as const;
export type BookDuplicateResolutionStatus = (typeof BOOK_DUPLICATE_RESOLUTION_STATUSES)[number];

export type BookDuplicateBookOutcomeStatus = "merged" | "deleted" | "linked" | "skipped" | "failed";

export type BookDuplicateBookOutcome = {
  bookId: number;
  action: BookDuplicateBookAction;
  status: BookDuplicateBookOutcomeStatus;
  /** A stable code: `STALE`, `KEEPER_MISSING`, a merge blocker or failure code, `DELETE_FAILED`, `LINK_FAILED`. */
  reason: string | null;
};

export type BookDuplicateGroupOutcomeStatus = "pending" | "done" | "partial" | "skipped" | "failed";

export type BookDuplicateGroupOutcome = {
  groupId: number;
  /** The keeper the group resolved to; a keeper merged by an earlier group of the run resolves to its new book. */
  keeperId: number | null;
  status: BookDuplicateGroupOutcomeStatus;
  reason: string | null;
  books: BookDuplicateBookOutcome[];
};

export type BookDuplicateResolutionJob = {
  id: number;
  scanId: number | null;
  status: BookDuplicateResolutionStatus;
  processed: number;
  total: number;
  currentGroupId: number | null;
  outcomes: BookDuplicateGroupOutcome[];
  errorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
};

/** Socket `book-duplicates:resolution-progress` and `book-duplicates:resolution-finished`, to the requesting user. */
export type BookDuplicateResolutionEvent = {
  jobId: number;
  status: BookDuplicateResolutionStatus;
  processed: number;
  total: number;
  currentGroupId: number | null;
  /** The group that just finished, on progress events. */
  outcome: BookDuplicateGroupOutcome | null;
};
