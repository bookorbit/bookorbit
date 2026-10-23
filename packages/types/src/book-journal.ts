export const BOOK_JOURNAL_BODY_MAX_LENGTH = 10000;
export const BOOK_JOURNAL_QUOTE_MAX_LENGTH = 5000;
export const BOOK_JOURNAL_CHAPTER_TITLE_MAX_LENGTH = 500;
export const BOOK_JOURNAL_CFI_MAX_LENGTH = 2000;
/** Defensive ceiling on one book's list; a per-book journal is expected to stay far below it. */
export const BOOK_JOURNAL_LIST_LIMIT = 2000;

export const BOOK_JOURNAL_STATUSES = ["active", "trashed"] as const;
export type BookJournalStatus = (typeof BOOK_JOURNAL_STATUSES)[number];

/** A free-form note a reader keeps about one book, optionally anchored to where they were. */
export interface BookJournalEntry {
  id: number;
  /** Client-generated UUID; the identity a client addresses the entry by in every route. */
  clientId: string;
  bookId: number;
  body: string;
  quote: string | null;
  chapterTitle: string | null;
  /** 0 to 100. */
  positionPercent: number | null;
  cfi: string | null;
  positionSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  /** Set while the entry is in the trash. */
  deletedAt: string | null;
}

export interface BookJournalEntryCreate {
  clientId: string;
  body: string;
  quote?: string | null;
  chapterTitle?: string | null;
  positionPercent?: number | null;
  cfi?: string | null;
  positionSeconds?: number | null;
  /** When the entry was written, for an entry captured offline. Clamped to now when ahead of it. */
  createdAt?: string;
}

/** Every field optional; `null` clears a nullable field, and `body` cannot be cleared. */
export interface BookJournalEntryUpdate {
  body?: string;
  quote?: string | null;
  chapterTitle?: string | null;
  positionPercent?: number | null;
  cfi?: string | null;
  positionSeconds?: number | null;
}
