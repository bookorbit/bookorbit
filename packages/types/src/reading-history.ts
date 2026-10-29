import type { ReadingAttemptOutcome } from "./book";
import type { ReadingSessionSource } from "./reading-session";
import type { ReadingSessionSourceBucket } from "./reading-session-source-bucket";

export const READING_HISTORY_SORTS = ["newest", "oldest"] as const;
export type ReadingHistorySort = (typeof READING_HISTORY_SORTS)[number];

export const READING_HISTORY_PAGE_SIZE_MAX = 200;

/** Month key (`YYYY-MM`) of the bucket that holds finished reads with no finish date. */
export const READING_HISTORY_UNDATED_MONTH = "undated";

/** One finished read: a completed, skimmed or abandoned attempt, newest first by default. */
export type ReadingHistoryItem = {
  id: number;
  /** Null once the book was deleted; the read keeps the snapshot taken when it went. */
  bookId: number | null;
  title: string | null;
  authors: string[];
  seriesName: string | null;
  seriesIndex: string | null;
  format: string | null;
  pageCount: number | null;
  coverVersion: string | null;
  startedOn: string | null;
  endedOn: string | null;
  outcome: ReadingAttemptOutcome;
  /** Which finish of this book it was, counting from the first. Null unless completed. */
  readNumber: number | null;
  /** Completed reads of this book in all. */
  completedReads: number;
  /** How far a skimmed or abandoned read got, in percent. */
  progressPercent: number | null;
  sessions: number;
  seconds: number;
  sources: ReadingSessionSource[];
  /** This read's stars. The latest completed read falls back to the book's rating. */
  rating: number | null;
  /** Highlights and journal entries made between the read's start and finish. */
  highlightCount: number;
  journalCount: number;
  removedAt: string | null;
};

/** The list's months in order, so the client can lay out every row before it loads. */
export type ReadingHistoryMonth = {
  /** `YYYY-MM`, or `undated`. */
  month: string;
  /** Rows in this month under the current filters. */
  reads: number;
  completed: number;
  rereads: number;
  pages: number;
  seconds: number;
};

export type ReadingHistoryPage = {
  items: ReadingHistoryItem[];
  offset: number;
  limit: number;
  total: number;
  /** Sent with the first page only (offset 0). */
  months: ReadingHistoryMonth[] | null;
};

export type ReadingHistoryRecord = {
  item: Pick<ReadingHistoryItem, "id" | "bookId" | "title" | "coverVersion" | "removedAt">;
  value: number;
};

export type ReadingHistorySummary = {
  year: number | null;
  quarter: number | null;
  /** Every year with a completed read, newest first, for the year picker. */
  years: { year: number; reads: number }[];
  /** Completed reads with no finish date; only All time lists them. */
  undatedReads: number;
  reads: number;
  books: number;
  rereads: number;
  pages: number;
  /** Reading time in the period, from every session, finished or not. */
  seconds: number;
  daysRead: number;
  averageRating: number | null;
  ratedReads: number;
  /** Skimmed and abandoned reads in the period. They never count toward the totals above. */
  notCounted: number;
  /** Every finished read of the period by how it ended, for the outcome filter. */
  outcomes: Record<ReadingAttemptOutcome, number>;
  /** Every month of the period's year, even when a quarter is chosen; empty for All time. */
  months: { month: number; reads: number; rereads: number; seconds: number }[];
  records: {
    longestBook: ReadingHistoryRecord | null;
    mostReread: ReadingHistoryRecord | null;
    longestRead: ReadingHistoryRecord | null;
    fastest: ReadingHistoryRecord | null;
  };
  formats: { format: string; reads: number }[];
  /** Completed reads with a session from each app or device, grouped as the charts group them. */
  sources: { source: ReadingSessionSourceBucket; reads: number }[];
  /** The reading goal of the period's year, when one is set. */
  goal: { target: number; reached: number; metOn: string | null } | null;
};

export type ReadingHistoryMark = {
  id: number;
  text: string;
  note: string | null;
  color: string;
  chapterTitle: string | null;
  createdAt: string;
};

export type ReadingHistoryJournalEntry = {
  id: number;
  body: string;
  chapterTitle: string | null;
  createdAt: string;
};

/** The marks a read left: the first few highlights and journal entries, and how many in all. */
export type ReadingHistoryMarks = {
  highlights: ReadingHistoryMark[];
  highlightCount: number;
  journal: ReadingHistoryJournalEntry[];
  journalCount: number;
};

export type ReadingHistoryRatingResponse = {
  rating: number | null;
  /** True when the read is its book's latest completed read, so the book's rating changed too. */
  bookRatingChanged: boolean;
};
