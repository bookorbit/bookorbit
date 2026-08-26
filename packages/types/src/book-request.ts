import { CONCRETE_BOOK_MEDIA_KINDS, type ConcreteBookMediaKind } from "./book";
import type { BookRequestDownloadItem } from "./download-client";

export const BOOK_REQUEST_MEDIA_KINDS = CONCRETE_BOOK_MEDIA_KINDS;
export type BookRequestMediaKind = ConcreteBookMediaKind;

/** Bounds exact indexer passes before the title-and-author fallback. */
export const MAX_BOOK_REQUEST_SEARCH_ISBNS = 8;

/**
 * A .torrent is a few kilobytes of metadata; anything larger is not one. Shared so the grab dialog
 * refuses a file before uploading it rather than learning the ceiling from a 400.
 */
export const MAX_TORRENT_FILE_BYTES = 2 * 1024 * 1024;

export const BOOK_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "searching",
  "grabbed",
  "downloading",
  "importing",
  "needs_review",
  "available",
  "failed",
] as const;
export type BookRequestStatus = (typeof BOOK_REQUEST_STATUSES)[number];

/**
 * Statuses that hold a claim on the requested work. A second request for the same work is
 * folded into the existing one while it is in one of these; once it leaves, the work can be
 * requested again (a rejected request may be re-argued, an available book may be removed).
 * Kept in sync with the partial unique index on `book_requests.dedupe_key`.
 */
export const ACTIVE_BOOK_REQUEST_STATUSES: readonly BookRequestStatus[] = [
  "pending",
  "approved",
  "searching",
  "grabbed",
  "downloading",
  "importing",
  "needs_review",
];

/**
 * Grouping token for a title or an author name. Shared so the search list collapses exactly the
 * candidates the server would fold into one request, rather than approximating that rule twice.
 *
 * The allowlist is every Unicode letter and number rather than `a-z0-9`. An ASCII title tokenizes
 * identically either way; a Cyrillic, CJK, Greek or Arabic one used to lose every character and
 * come back empty, which on a multilingual app meant every non-Latin title of a medium shared one
 * key. Diacritics are still folded first, so "Les Misérables" and "les miserables" agree.
 */
export function normalizeWorkToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

/**
 * A title no allowlist can tokenize - punctuation, symbols or emoji alone - hashed so it still
 * identifies itself.
 *
 * Rare, and the alternative is what makes it worth handling: a token that comes back empty either
 * collapses every such title onto one shared key, or leaves the work with no key at all. Both are
 * wrong in the same direction, and the second requester of the day pays for it.
 */
function rawTitleToken(title: string): string {
  return `x${fnv1a(title.trim().toLowerCase())}`;
}

/**
 * The width of `book_requests.dedupe_key`. The submission DTO allows a 500-character title beside a
 * 255-character author, so an unbounded work key overflowed the column and reached the requester as
 * a Postgres 22001 dressed up as a 500.
 */
const MAX_DEDUPE_KEY = 500;

/** How much of one token a shortened work key spends, chosen so two of them plus the frame fit. */
const MAX_WORK_KEY_TOKEN = 160;

/**
 * Truncated with the full token's hash appended rather than simply cut. Two long titles sharing
 * their first hundred and sixty characters - a series with a common prefix, a subtitle-heavy
 * edition - would otherwise collapse onto one key, and dedupe would fold two different books into
 * one request. `~` cannot appear in a token, so a shortened key can never collide with a whole one.
 */
function boundToken(token: string): string {
  return token.length <= MAX_WORK_KEY_TOKEN ? token : `${token.slice(0, MAX_WORK_KEY_TOKEN)}~${fnv1a(token)}`;
}

/**
 * The key two records share when they describe the same work in the same medium.
 *
 * Shortened only when the whole key would not fit the column, rather than at a fixed token width.
 * A stored key is only useful while the probe still computes it: shortening one that already fits
 * would change what every existing request of a long-titled work is filed under, and the next
 * person to ask for that book would open a second request instead of joining theirs.
 */
export function bookRequestWorkKey(title: string, author: string | null | undefined, mediaKind: BookRequestMediaKind): string {
  const titleToken = normalizeWorkToken(title) || rawTitleToken(title);
  const authorToken = normalizeWorkToken(author ?? "");

  const key = `work:${titleToken}:${authorToken}:${mediaKind}`;
  if (key.length <= MAX_DEDUPE_KEY) return key;
  return `work:${boundToken(titleToken)}:${boundToken(authorToken)}:${mediaKind}`;
}

/**
 * Statuses a release may be grabbed from. `failed` is included so a bad release can be replaced
 * without re-approving. Shared so a card cannot offer a button the grab endpoint would refuse.
 */
export const GRABBABLE_BOOK_REQUEST_STATUSES: readonly BookRequestStatus[] = ["approved", "searching", "failed"];

export function isGrabbableBookRequestStatus(status: BookRequestStatus): boolean {
  return GRABBABLE_BOOK_REQUEST_STATUSES.includes(status);
}

/**
 * Whether one person is the one a request is theirs to fulfil.
 *
 * Usually the requester, because a self-serve row is created by the person about to fulfil it.
 * Not always: one live request per work, so a self-fulfiller whose submission collides with
 * somebody else's undriven request takes that row on rather than opening a second one, and
 * `fulfillerUserId` records that it is now theirs. Null means nobody took it on, and the
 * requester is the fulfiller by construction - which is also every row created before the
 * column existed.
 *
 * Shared so the UI cannot offer an action `assertCanFulfil` would refuse, and holds no permission
 * check: the caller still needs `book_request_self_fulfill`, or to be moderating the queue.
 */
export function isBookRequestFulfiller(request: Pick<BookRequestItem, "userId" | "fulfillerUserId">, userId: number | null | undefined): boolean {
  if (userId === null || userId === undefined) return false;
  return (request.fulfillerUserId ?? request.userId) === userId;
}

/** Statuses an approver may close by pointing at a book or Book Dock file. */
export const FULFILLABLE_BOOK_REQUEST_STATUSES: readonly BookRequestStatus[] = [
  "pending",
  "approved",
  "searching",
  "grabbed",
  "downloading",
  "importing",
  "needs_review",
  "failed",
];

export function isFulfillableBookRequestStatus(status: BookRequestStatus): boolean {
  return FULFILLABLE_BOOK_REQUEST_STATUSES.includes(status);
}

/**
 * Statuses a request can still be walked back from: everything that has not settled. Stopping a
 * grab mid-flight is the only exit a request that stalled in `downloading` or `needs_review` ever
 * gets, so the list is deliberately wider than the pending-or-approved pair it started as.
 */
export const CANCELLABLE_BOOK_REQUEST_STATUSES: readonly BookRequestStatus[] = [
  "pending",
  "approved",
  "searching",
  "grabbed",
  "downloading",
  "importing",
  "needs_review",
  "failed",
];

export function isCancellableBookRequestStatus(status: BookRequestStatus): boolean {
  return CANCELLABLE_BOOK_REQUEST_STATUSES.includes(status);
}

/**
 * Statuses background fulfilment work may still write to. The three that are missing are the
 * decisions a person made and expects to stand: a poll that was already in flight, an import that
 * was already extracting or a watchdog sweep must not drag a cancelled, rejected or already-filed
 * request back into the pipeline.
 */
export const WORKER_WRITABLE_BOOK_REQUEST_STATUSES: readonly BookRequestStatus[] = [
  "pending",
  "approved",
  "searching",
  "grabbed",
  "downloading",
  "importing",
  "needs_review",
  "failed",
];

/**
 * Statuses nothing is still working on, which is what makes hiding or deleting one safe. `failed`
 * is both settled and cancellable on purpose: it can be retried, given up on, or tidied away.
 */
export const SETTLED_BOOK_REQUEST_STATUSES: readonly BookRequestStatus[] = ["rejected", "cancelled", "available", "failed"];

export function isSettledBookRequestStatus(status: BookRequestStatus): boolean {
  return SETTLED_BOOK_REQUEST_STATUSES.includes(status);
}

/**
 * Why automation handed a request back to a person, as a stable value rather than as the prose
 * that accompanies it. The prose is written in English at the point of failure and stays as the
 * fallback for the reasons nothing has classified; the code is what the UI translates.
 *
 * Parameters live in `failureMeta` rather than being interpolated into the code, so a translator
 * can put the number wherever their language wants it.
 */
export const BOOK_REQUEST_HANDBACK_CODES = [
  /** Automatic grabbing is switched off, so nothing was ever going to look for a release. */
  "AUTOMATION_DISABLED",
  /** The request has nowhere to file a book, which grab refuses before downloading anything. */
  "NO_DESTINATION",
  /** The per-request budget of automated attempts is spent. Carries `attempts`. */
  "ATTEMPT_LIMIT",
  /** The indexer search itself failed rather than coming back empty. Carries `detail`. */
  "SEARCH_FAILED",
  /**
   * Nothing was searched, because no indexer is configured at all. Kept apart from the two states
   * below it: the score floor and the profile are both answers about releases, and reporting one
   * of those for a search that never ran sends the operator to tune a number that had no bearing
   * on anything.
   */
  "NO_SOURCES_CONFIGURED",
  /** Nothing was searched, because every configured indexer is switched off. A toggle away. */
  "NO_SOURCES_ENABLED",
  /** Indexers are enabled, but not one of them carries the requested medium. */
  "MEDIUM_UNCOVERED",
  /** A release profile is active for this medium and nothing the search returned fell in a tier. */
  "PROFILE_EXCLUDED_ALL",
  /** Everything good enough has already been tried for this request. */
  "ALL_TRIED",
  /** Nothing cleared the operator's score floor. Carries `floor`. */
  "BELOW_SCORE_FLOOR",
  /** Everything good enough was ruled out by an earlier refusal in the same pass. */
  "ALL_BLOCKED",
  /**
   * Not automation at all: a self-serve request whose picker was opened and never acted on. Swept
   * so it stops holding the dedupe claim on a work nobody is actually fetching.
   */
  "ABANDONED",
] as const;

export type BookRequestHandbackCode = (typeof BOOK_REQUEST_HANDBACK_CODES)[number];

/** Values a handback message interpolates. Deliberately flat: these are message parameters. */
export type BookRequestFailureMeta = Record<string, string | number>;

/**
 * Why a submission was turned down, as a stable value rather than as the sentence beside it.
 *
 * Every refusal the submit endpoint raises is copy this application wrote about a rule this
 * instance applies, so a client that can only repeat the English is a client that cannot
 * translate any of them. A refusal that originates outside - a tracker saying no - deliberately
 * carries no code, because there is nothing to translate there either.
 *
 * Parameters live in `errorMeta` for the same reason handback parameters live in `failureMeta`:
 * a translator has to be able to put the number where their language wants it.
 */
export const BOOK_REQUEST_SUBMIT_ERROR_CODES = [
  /** The title was blank once trimmed, so there is no work to ask for. */
  "SUBMIT_TITLE_REQUIRED",
  /** Self-fulfilment was asked for by somebody who does not hold the permission. */
  "SUBMIT_SELF_FULFIL_FORBIDDEN",
  /** The requester named a destination library they cannot reach. */
  "SUBMIT_LIBRARY_FORBIDDEN",
  /** A folder was named with no library for it to sit in. */
  "SUBMIT_FOLDER_NEEDS_LIBRARY",
  /** The named folder belongs to some other library than the named destination. */
  "SUBMIT_FOLDER_NOT_IN_LIBRARY",
  /** A self-server fell through to an instance default they cannot reach. */
  "SUBMIT_DEFAULT_LIBRARY_UNREACHABLE",
  /** Nobody decides on this request later, so it needs a destination now. */
  "SUBMIT_DESTINATION_REQUIRED",
  /** The cap on self-serve downloads in flight is full. Carries `limit`. */
  "SUBMIT_SELF_SERVE_LIMIT",
  /** Somebody else was named as the requester by a caller who may not file on their behalf. */
  "SUBMIT_ON_BEHALF_FORBIDDEN",
  /** The named requester does not exist, or is not an account that could file this itself. */
  "SUBMIT_ON_BEHALF_UNKNOWN_USER",
] as const;

export type BookRequestSubmitErrorCode = (typeof BOOK_REQUEST_SUBMIT_ERROR_CODES)[number];

/** The code a submission was refused with, where it carried one. Null is "we do not know". */
export function bookRequestSubmitErrorCode(value: unknown): BookRequestSubmitErrorCode | null {
  return typeof value === "string" && (BOOK_REQUEST_SUBMIT_ERROR_CODES as readonly string[]).includes(value)
    ? (value as BookRequestSubmitErrorCode)
    : null;
}

/** One metadata record that contributed to a grouped work result. */
export interface BookRequestMetadataSource {
  providerKey: string;
  providerId: string;
  providerLabel: string;
  isbn10: string | null;
  isbn13: string | null;
}

export function normalizeBookRequestIsbn(value: string | null | undefined): string | null {
  const normalized = (value ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
  return normalized || null;
}

export function isValidBookRequestIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const digit = index === 9 && value[index] === "X" ? 10 : Number(value[index]);
    sum += digit * (10 - index);
  }
  return sum % 11 === 0;
}

export function isValidBookRequestIsbn13(value: string): boolean {
  if (!/^\d{13}$/.test(value) || (!value.startsWith("978") && !value.startsWith("979"))) return false;
  let sum = 0;
  for (let index = 0; index < 13; index += 1) {
    sum += Number(value[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}

export function bookRequestIsbn10To13(value: string): string {
  const body = `978${value.slice(0, 9)}`;
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    sum += Number(body[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** Canonical ISBN-13, including a converted ISBN-10 where that is the only valid identifier. */
export function canonicalizeBookRequestIsbn(isbn10: string | null | undefined, isbn13: string | null | undefined): string | null {
  const normalized13 = normalizeBookRequestIsbn(isbn13);
  if (normalized13 && isValidBookRequestIsbn13(normalized13)) return normalized13;

  const normalized10 = normalizeBookRequestIsbn(isbn10);
  if (normalized10 && isValidBookRequestIsbn10(normalized10)) return bookRequestIsbn10To13(normalized10);
  return null;
}

/** The work as it looked at request time, so the request stays readable if the provider moves on. */
export interface BookRequestWorkSnapshot {
  title: string;
  subtitle: string | null;
  authors: string[];
  seriesName: string | null;
  seriesIndex: number | null;
  isbn10: string | null;
  isbn13: string | null;
  publishedYear: number | null;
  language: string | null;
  coverUrl: string | null;
  providerKey: string | null;
  providerId: string | null;
  metadataSources: BookRequestMetadataSource[];
}

export interface BookRequestSubscriber {
  userId: number;
  username: string;
  name: string;
}

export interface BookRequestItem extends BookRequestWorkSnapshot {
  id: number;
  userId: number;
  requesterUsername: string;
  requesterName: string;
  mediaKind: BookRequestMediaKind;
  status: BookRequestStatus;
  preferredFormats: string[];
  note: string | null;
  targetLibraryId: number | null;
  targetLibraryName: string | null;
  targetFolderId: number | null;
  decidedByUserId: number | null;
  decidedByUsername: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  matchedBookId: number | null;
  bookDockFileId: number | null;
  /**
   * Created by somebody fulfilling it themselves rather than asking for it. Badged in the
   * moderation queue, and never waiting on a decision.
   */
  selfServe: boolean;
  /**
   * Who may drive fulfilment when that is not the requester, which happens when a self-fulfiller's
   * own submission collides with somebody else's undriven request and they take it on. Null
   * everywhere else, including on a self-serve row whose requester is its own fulfiller.
   */
  fulfillerUserId: number | null;
  statusReason: string | null;
  /**
   * Set only where a failure has been classified, which today means automation handing a request
   * back. Null elsewhere, and the UI falls back to `statusReason` when it is.
   */
  failureCode: BookRequestHandbackCode | null;
  failureMeta: BookRequestFailureMeta | null;
  subscribers: BookRequestSubscriber[];
  /** The most recent grab attempt, so a card can show live progress. Null before the first grab. */
  download: BookRequestDownloadItem | null;
  /** Whether the signed-in user has hidden this from their own list. Never shared between users. */
  dismissed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BookRequestPage {
  items: BookRequestItem[];
  total: number;
}

export interface BookRequestRequesterOption {
  userId: number;
  username: string;
  name: string;
}

export interface CreateBookRequestPayload extends Partial<BookRequestWorkSnapshot> {
  title: string;
  mediaKind: BookRequestMediaKind;
  targetLibraryId?: number | null;
  targetFolderId?: number | null;
  preferredFormats?: string[];
  note?: string | null;
  /**
   * Fulfil this one yourself instead of queueing it. Refused server-side without
   * `book_request_self_fulfill`, and never inferred from the permission.
   */
  selfServe?: boolean;
  /**
   * File this on somebody else's behalf. Refused without `manage_book_requests`, and every rule
   * the submission applies then reads from the subject rather than the caller. Omitted is the
   * ordinary case: the caller is the requester.
   */
  userId?: number;
}

/**
 * What submitting answers with. `subscribed` is the whole reason this is not just the request:
 * one live request per work, so a submission for a work somebody already asked for attaches the
 * caller to that row rather than opening a second, and the form says something different for each.
 */
export interface BookRequestSubmitResult {
  request: BookRequestItem;
  /** True when the work was already requested and the caller was attached to it instead. */
  subscribed: boolean;
}

export interface DecideBookRequestPayload {
  decisionNote?: string | null;
  /** Approver may reroute the request to a different library than the requester picked. */
  targetLibraryId?: number | null;
  targetFolderId?: number | null;
}

export interface FulfillBookRequestPayload {
  bookDockFileId?: number | null;
  matchedBookId?: number | null;
  note?: string | null;
}

/**
 * What the request UI needs to annotate a metadata search result before anything is submitted:
 * whether the library already has it, and whether someone already asked for it.
 */
export interface BookRequestAvailabilityQuery {
  isbn13?: string | null;
  title: string;
  author?: string | null;
  mediaKind: BookRequestMediaKind;
  providerKey?: string | null;
  providerId?: string | null;
}

export interface BookRequestAvailability {
  ownedBookId: number | null;
  existingRequestId: number | null;
  existingRequestStatus: BookRequestStatus | null;
  /** True when the signed-in user is the requester or already a subscriber on that request. */
  alreadySubscribed: boolean;
}

export interface BookRequestSummary {
  pending: number;
  active: number;
  mine: number;
  /** Unfiltered, non-dismissed totals for the request-page tabs. */
  mineTotal: number;
  allTotal: number;
}

/**
 * Columns the request list can be ordered by. Shared so the table cannot offer a sort the query
 * does not know how to build, and so a rename breaks the client at compile time.
 */
export const BOOK_REQUEST_SORT_FIELDS = ["createdAt", "title", "mediaKind", "requester", "status"] as const;
export type BookRequestSortField = (typeof BOOK_REQUEST_SORT_FIELDS)[number];

export const BOOK_REQUEST_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type BookRequestSortDirection = (typeof BOOK_REQUEST_SORT_DIRECTIONS)[number];

/** One page of the queue is the most a selection can hold, so the batch stays bounded. */
export const BOOK_REQUEST_BULK_LIMIT = 100;

export interface BulkBookRequestsPayload {
  ids: number[];
}

/**
 * The one bulk action that carries more than ids. A rejection is a sentence to the people who
 * asked, and refusing forty requests for the same reason is exactly when writing it forty times
 * is the wrong shape.
 */
export interface BulkRejectBookRequestsPayload extends BulkBookRequestsPayload {
  decisionNote?: string | null;
}

export interface BookRequestBulkFailure {
  id: number;
  /** Named rather than numbered, because the message that carries this is read by a person. */
  title: string;
  reason: string;
}

/**
 * A bulk action is not atomic. One request may have no destination library while the rest are
 * fine, and failing the whole batch over it would be worse than reporting it, so every id comes
 * back in exactly one of the two lists.
 */
export interface BookRequestBulkResult {
  updated: BookRequestItem[];
  failed: BookRequestBulkFailure[];
}
