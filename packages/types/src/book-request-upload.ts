import type { BookRequestItem } from "./book-request";
import type { ReleaseUnitMediaKind } from "./indexer";

/**
 * Uploading a book's files straight to its request, so the upload is the release.
 *
 * The files are described before a byte is sent, read by the same interpreter a downloaded
 * release goes through, so the drawer can say what they become and refuse a set that could never
 * close the request. Each file then travels as an ordinary upload session whose target is one
 * entry of the attempt's manifest, and the request's import runs once the last one lands.
 *
 * Send any of it only to a server advertising `book-request-upload`.
 */

/** At most this many files in one upload, which is the release interpreter's own bound. */
export const BOOK_REQUEST_UPLOAD_MAX_FILES = 2_000;

/** How long a picked path may be, folders included, before the plan refuses it. */
export const BOOK_REQUEST_UPLOAD_MAX_PATH_LENGTH = 1_024;

/** One picked file, described by name and size only. */
export interface BookRequestUploadFileInput {
  /**
   * Where the file sits inside what was picked, `/` separated: `The Silent Patient/CD 1/01.mp3`
   * for a dropped folder, the bare name for a loose file.
   */
  path: string;
  sizeBytes: number;
}

export interface PlanBookRequestUploadPayload {
  files: BookRequestUploadFileInput[];
}

/**
 * What the picked files come to, and whether they can close the request.
 *
 * - `ready`: one book of the kind the request asks for.
 * - `archive`: one archive whose contents are read once it has arrived.
 * - `choose`: several books of the requested kind; one has to be picked before anything is sent.
 * - `wrong_medium`: books, but none of the kind the request asks for.
 * - `no_book`: nothing that could become a book.
 * - `several_archives`: more than one separate archive, which an import never opens.
 * - `file_too_large`: a file the book needs is over the server's upload limit.
 */
export const BOOK_REQUEST_UPLOAD_PLAN_STATUSES = [
  "ready",
  "archive",
  "choose",
  "wrong_medium",
  "no_book",
  "several_archives",
  "file_too_large",
] as const;
export type BookRequestUploadPlanStatus = (typeof BOOK_REQUEST_UPLOAD_PLAN_STATUSES)[number];

/** Whether a plan in this state can be uploaded once a book is chosen, where one has to be. */
export function bookRequestUploadPlanIsSendable(status: BookRequestUploadPlanStatus): boolean {
  return status === "ready" || status === "archive" || status === "choose";
}

/** What one picked file is to the plan. Only `skipped` files are left out of the upload. */
export type BookRequestUploadFileRole = "content" | "artwork" | "extra" | "archive" | "skipped";

export const BOOK_REQUEST_UPLOAD_SKIP_REASONS = [
  "hidden",
  "sample",
  "padding",
  "unsupported",
  "junk_folder",
  /** Part of another book in the same set, which a choice left out. */
  "other_book",
  "empty",
] as const;
export type BookRequestUploadSkipReason = (typeof BOOK_REQUEST_UPLOAD_SKIP_REASONS)[number];

export interface BookRequestUploadPlanFile {
  /** The picked path, cleaned the way the server stores it. `start` takes it back verbatim. */
  path: string;
  sizeBytes: number;
  format: string | null;
  role: BookRequestUploadFileRole;
  /** The book in `units` this file belongs to, or null for archives and skipped files. */
  unitIndex: number | null;
  skipReason: BookRequestUploadSkipReason | null;
  /** Over `maxFileSizeBytes`, so the server would refuse it. */
  tooLarge: boolean;
}

export interface BookRequestUploadPlanUnit {
  index: number;
  mediaKind: ReleaseUnitMediaKind;
  /** Best guess from the folder or file name, for display only. */
  title: string | null;
  contentFileCount: number;
  totalFileCount: number;
  sizeBytes: number;
  /** Content formats, best first: `["epub", "azw3", "pdf"]`. */
  formats: string[];
  /** The kind the request asks for, so this book could close it. */
  matchesMedium: boolean;
  /** Its name matches the request's title, which is what the default choice goes by. */
  matchesTitle: boolean;
}

export interface BookRequestUploadPlan {
  status: BookRequestUploadPlanStatus;
  /** The folder every picked path sat in, when a folder was picked. */
  rootName: string | null;
  units: BookRequestUploadPlanUnit[];
  /** The book that goes: the only one for `ready`, the suggested one for `choose`, else null. */
  selectedUnitIndex: number | null;
  /** Every picked file, in the order it was sent. */
  files: BookRequestUploadPlanFile[];
  maxFileSizeBytes: number;
}

/**
 * The files an upload in this state sends: the chosen book's, or the archive. What `start` takes
 * must be exactly this set, so the client and the server read it from one rule.
 */
export function bookRequestUploadSet<T extends Pick<BookRequestUploadPlanFile, "role" | "unitIndex">>(
  files: readonly T[],
  status: BookRequestUploadPlanStatus,
  unitIndex: number | null,
): T[] {
  if (status === "archive") return files.filter((file) => file.role === "archive");
  if (unitIndex === null) return [];
  return files.filter((file) => file.role !== "skipped" && file.unitIndex === unitIndex);
}

export interface StartBookRequestUploadPayload {
  /** Exactly the files that will be sent: the plan's paths for the chosen book, or the archive. */
  files: BookRequestUploadFileInput[];
  /** Wait in review once the files arrive rather than being filed on a passing score. */
  holdForReview?: boolean;
}

export type BookRequestUploadFileStatus = "pending" | "received";

/** One file an upload still expects or already has. Its `id` is the upload session's target. */
export interface BookRequestUploadFile {
  id: number;
  path: string;
  sizeBytes: number;
  receivedBytes: number;
  status: BookRequestUploadFileStatus;
}

/** The upload an attempt is waiting on, file by file. */
export interface BookRequestUploadManifest {
  downloadId: number;
  uploadedByUserId: number | null;
  files: BookRequestUploadFile[];
}

export interface BookRequestUploadManifestResponse {
  upload: BookRequestUploadManifest | null;
}

export interface BookRequestUploadStartResult {
  request: BookRequestItem;
  upload: BookRequestUploadManifest;
}
