import type { AudiobookChapterSource } from "./audiobook";

/**
 * Ways an audiobook's chapters can need attention, plus `edited` for lists a person shaped by hand.
 * `needs_review` holds bulk lookups that were not confident enough to apply on their own.
 */
export const CHAPTER_HEALTH_CATEGORIES = ["no_chapters", "one_per_file", "numbered_tracks", "needs_review", "edited"] as const;
export type ChapterHealthCategory = (typeof CHAPTER_HEALTH_CATEGORIES)[number];

export interface ChapterHealthSummary {
  counts: Record<ChapterHealthCategory, number>;
  /** How many books in each category have an Audible ASIN to look up. */
  withAsin: Record<ChapterHealthCategory, number>;
}

export const CHAPTER_LOOKUP_QUEUE_STATUSES = ["queued", "processing", "applied", "review", "not_found", "failed", "skipped"] as const;
export type ChapterLookupQueueStatus = (typeof CHAPTER_LOOKUP_QUEUE_STATUSES)[number];

/** Why a bulk lookup was left for a person instead of applied. */
export const CHAPTER_LOOKUP_REVIEW_REASONS = ["runtime_mismatch", "not_exact", "implausible", "unknown_length", "locked"] as const;
export type ChapterLookupReviewReason = (typeof CHAPTER_LOOKUP_REVIEW_REASONS)[number];

/** What a bulk lookup found, kept so the review list can say why it stopped short. */
export interface ChapterLookupReviewSummary {
  provider: "audible" | "audnexus";
  chapterCount: number;
  runtimeMs: number | null;
  totalDurationMs: number | null;
  isAccurate: boolean | null;
}

export interface ChapterHealthBook {
  bookId: number;
  title: string | null;
  authors: string[];
  libraryName: string;
  audioFiles: number;
  chapterCount: number;
  source: AudiobookChapterSource | null;
  audibleId: string | null;
  /** Set on `needs_review` rows. */
  review: { reason: ChapterLookupReviewReason | null; summary: ChapterLookupReviewSummary | null } | null;
}

export interface ChapterHealthPage {
  items: ChapterHealthBook[];
  total: number;
}

export interface EnqueueChapterLookupRequest {
  /** Exactly these books; or, without them, every book with an ASIN in `category`. */
  bookIds?: number[];
  category?: ChapterHealthCategory;
  libraryId?: number;
}

export interface EnqueueChapterLookupResult {
  queued: number;
  /** Books left out because they have no ASIN or are not reachable. */
  skipped: number;
}

/** The caller's own bulk lookups: what is waiting and how the finished ones went. */
export interface ChapterLookupQueueState {
  queued: number;
  processing: { bookId: number; title: string | null } | null;
  finished: Record<"applied" | "review" | "not_found" | "failed" | "skipped", number>;
}
