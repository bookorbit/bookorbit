/**
 * Bulk runs: the bulk book and author actions, and book moves, run on the server in the background
 * and survive the tab that started them. Each is one row in the Jobs area as the `bulk-run` type.
 */

export const BULK_RUN_KINDS = [
  "book-refresh-metadata",
  "book-re-extract-cover",
  "book-embed-audio-cover",
  "author-refresh-metadata",
  "book-move",
] as const;
export type BulkRunKind = (typeof BULK_RUN_KINDS)[number];

/** `interrupted`: the server stopped while it ran; Continue resumes where it stopped. */
export const BULK_RUN_STATUSES = ["queued", "running", "completed", "failed", "cancelled", "interrupted"] as const;
export type BulkRunStatus = (typeof BULK_RUN_STATUSES)[number];

/** The response header that carries the run's id on every bulk route's event stream. */
export const BULK_RUN_ID_HEADER = "X-Bulk-Run-Id";

/** Queued or running runs one account may hold; the next one is refused with 429. */
export const BULK_RUN_MAX_UNFINISHED = 10;
