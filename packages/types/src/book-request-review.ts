import type { BookDockUnitFile } from "./book-dock";

/** The fields the import is compared on. Order is the order the drawer lists them in. */
export const BOOK_REQUEST_VERIFICATION_FIELDS = ["title", "authors", "isbn13"] as const;
export type BookRequestVerificationField = (typeof BOOK_REQUEST_VERIFICATION_FIELDS)[number];

/**
 * `unknown` is not a soft mismatch: it means one side never carried the field, so it neither
 * earned nor cost anything. Showing it as a mismatch would blame a missing ISBN for a shortfall
 * the title actually caused.
 */
export type BookRequestVerificationVerdict = "match" | "mismatch" | "unknown";

export interface BookRequestVerificationRow {
  field: BookRequestVerificationField;
  requested: string | null;
  imported: string | null;
  verdict: BookRequestVerificationVerdict;
}

/**
 * Why the check landed where it did, as a code rather than a sentence. The server's prose is
 * still stored on the request for logs and for older clients, but the drawer localizes from this.
 */
export const BOOK_REQUEST_VERIFICATION_REASONS = ["isbn_match", "above_threshold", "below_threshold", "author_mismatch", "no_title"] as const;
export type BookRequestVerificationReason = (typeof BOOK_REQUEST_VERIFICATION_REASONS)[number];

export interface BookRequestVerification {
  score: number;
  threshold: number;
  passed: boolean;
  reason: BookRequestVerificationReason;
  rows: BookRequestVerificationRow[];
}

/**
 * What the imported file says about itself, for telling one edition from another. The comparison
 * is about the work, and two editions of one work agree on its title and author.
 *
 * Read from the file's own metadata only, never from what a provider matched it to: a provider
 * match is itself a guess at the edition, and this is what an approver checks that guess against.
 */
export interface BookRequestReviewEdition {
  publisher: string | null;
  /** As the file states it, which may be a year, a month or a full date. Shown, never parsed. */
  publishedDate: string | null;
  language: string | null;
  pageCount: number | null;
  isbn10: string | null;
  narrators: string[];
  durationSeconds: number | null;
  abridged: boolean | null;
  chapterCount: number | null;
}

/** One file of the imported entry. Names only: a dock path is a server path and never leaves. */
export type BookRequestReviewFile = Pick<BookDockUnitFile, "fileName" | "fileSize" | "format" | "role">;

/**
 * Everything an approver needs to answer "what actually landed, and why is it waiting on me".
 *
 * The verification is recomputed against the dock entry as it stands rather than replayed from
 * what was stored at hold time, so correcting the metadata in the Book Dock and reopening the
 * request shows the corrected score.
 */
export interface BookRequestReview {
  requestId: number;
  /**
   * Null when the entry this request was held over is no longer in the Book Dock. Both pointers
   * to it are `on delete set null`, so filing or discarding it by hand empties them and leaves the
   * request held over a file that does not exist. The drawer has to say so rather than go blank.
   */
  bookDockFileId: number | null;
  /** Null when the hold was not a scoring decision: no destination folder, or the dock refused it. */
  verification: BookRequestVerification | null;
  /** Every file the entry is made of, in unit order. A loose single file is one row. Empty once the dock entry is gone. */
  files: BookRequestReviewFile[];
  totalSizeBytes: number | null;
  /** False when the request has no library to be filed into, which force-filing cannot invent. */
  canFile: boolean;
  /**
   * Whoever sent the release asked to look at the import before it was filed, so it is held
   * whatever the score says. Absent on servers older than the `book-request-review-hold` feature.
   */
  heldOnRequest: boolean;
  /** The page of the release this import came from, where its source published one. */
  releaseInfoUrl: string | null;
  /** Null once the dock entry is gone, and on a file that states none of it. */
  edition: BookRequestReviewEdition | null;
  /** Whether `.../review/cover` will answer with the cover found in the imported file. */
  hasCover: boolean;
}
