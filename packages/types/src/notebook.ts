import type { AnnotationItem, AnnotationPositionStatus } from "./annotation";

/**
 * The library-wide Notebook: every highlight, journal entry, bookmark and review a reader has
 * written, across every book they can still open, as one cursor-paged stream. Served under
 * `/notebook` and advertised as the `notebook-hub` server feature.
 *
 * Nothing here is ever loaded whole. A page carries at most `NOTEBOOK_PAGE_SIZE_MAX` entries, the
 * counts come from their own route, and the cursor keeps page 200 as cheap as page 1.
 */

export const NOTEBOOK_ENTRY_KINDS = ["highlight", "journal", "bookmark", "review"] as const;
export type NotebookEntryKind = (typeof NOTEBOOK_ENTRY_KINDS)[number];

/** `newest` and `oldest` order by when an entry was written, `edited` by when it last changed. */
export const NOTEBOOK_SORTS = ["newest", "oldest", "edited"] as const;
export type NotebookSort = (typeof NOTEBOOK_SORTS)[number];

export const NOTEBOOK_PAGE_SIZE_DEFAULT = 40;
export const NOTEBOOK_PAGE_SIZE_MAX = 100;
export const NOTEBOOK_SEARCH_MAX_LENGTH = 200;
export const NOTEBOOK_BOOKS_PAGE_SIZE_DEFAULT = 30;
export const NOTEBOOK_BOOKS_PAGE_SIZE_MAX = 60;
export const NOTEBOOK_REVIEW_DAILY_SIZE = 10;
export const NOTEBOOK_REVIEW_SHUFFLE_MAX = 200;
export const NOTEBOOK_ON_THIS_DAY_MAX = 20;
/** Colours a book row reports, heaviest first. */
export const NOTEBOOK_BOOK_COLOR_MIX_MAX = 5;

/** Who a book is. Sent once per page in a sidecar map, never repeated on every entry. */
export interface NotebookBookLabel {
  id: number;
  title: string | null;
  /** Primary authors in display order, joined with ", ". */
  author: string | null;
  hasCover: boolean;
  /** The same cache key the library's book cards carry, so a cover cached there is reused here. */
  coverVersion: string | null;
  /** `"1/1"` for square (audiobook) art, else the book's ratio such as `"2/3"`. */
  coverAspectRatio: string | null;
  /** The file Open in Book opens (the book's primary readable file), or null when there is none. */
  readFileId: number | null;
  /** That file's format in lower case (`epub`, `pdf`, `cbz`, ...), or null. */
  readFileFormat: string | null;
  hasAudio: boolean;
}

interface NotebookEntryBase {
  kind: NotebookEntryKind;
  /** Server id within its kind. A review has no row id of its own and uses its book id. */
  id: number;
  bookId: number;
  /** The client UUID a journal entry or bookmark is addressed by; null for highlights and reviews. */
  clientId: string | null;
  /** When it was written. A highlight uses when it was highlighted, which a device may backdate. */
  createdAt: string;
  updatedAt: string;
  /** Set only on items from `GET /notebook/trash`. */
  deletedAt?: string | null;
}

export interface NotebookHighlightEntry extends NotebookEntryBase {
  kind: "highlight";
  text: string;
  color: string;
  style: string;
  note: string | null;
  chapterTitle: string | null;
  cfi: string | null;
  positionStatus: AnnotationPositionStatus | null;
  origin: AnnotationItem["origin"];
  starredAt: string | null;
}

export interface NotebookJournalItem extends NotebookEntryBase {
  kind: "journal";
  clientId: string;
  body: string;
  quote: string | null;
  chapterTitle: string | null;
  /** 0 to 100. */
  positionPercent: number | null;
  cfi: string | null;
  positionSeconds: number | null;
}

/** An EPUB bookmark carries a CFI; an audiobook bookmark carries a time instead. */
export interface NotebookBookmarkItem extends NotebookEntryBase {
  kind: "bookmark";
  clientId: string;
  title: string;
  note: string | null;
  cfi: string | null;
  positionSeconds: number | null;
  origin: string;
}

/** A book's My review. `createdAt` equals `updatedAt`: the server keeps only the latest edit time. */
export interface NotebookReviewItem extends NotebookEntryBase {
  kind: "review";
  body: string;
  /** The reader's own star rating for the book, 1 to 5, or null when unrated. */
  rating: number | null;
}

export type NotebookEntry = NotebookHighlightEntry | NotebookJournalItem | NotebookBookmarkItem | NotebookReviewItem;

/**
 * `GET /notebook/entries`.
 *
 * Filters: `kinds` (comma list, default all), `starred`, `colors` (comma list of stored colour
 * strings), `hasNote`, `approximate`, `origins` (comma list), `bookId`, `q`, `sort`, `cursor`,
 * `limit`. Highlight-only filters (`starred`, `colors`, `approximate`) leave out every other kind
 * while set. `origins` applies to highlights and bookmarks; journal entries and reviews count as
 * `web`. `hasNote` keeps highlights and bookmarks with a note plus every journal entry and review.
 * `q` matches the entry's own text and its book's title and authors, accent-insensitively.
 */
export interface NotebookEntriesResponse {
  items: NotebookEntry[];
  /** Keyed by book id as a string. */
  books: Record<string, NotebookBookLabel>;
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

/** `GET /notebook/overview`: the counts behind the chips and rail, for the same filters minus `kinds`. */
export interface NotebookOverview {
  total: number;
  highlights: number;
  journal: number;
  bookmarks: number;
  reviews: number;
  starred: number;
  withNotes: number;
  approximate: number;
  /** Books with at least one counted entry. */
  books: number;
  colors: { color: string; count: number }[];
  origins: { origin: AnnotationItem["origin"]; count: number }[];
}

export interface NotebookBookRow {
  book: NotebookBookLabel;
  highlights: number;
  journal: number;
  bookmarks: number;
  hasReview: boolean;
  /** Up to `NOTEBOOK_BOOK_COLOR_MIX_MAX` highlight colours, heaviest first. */
  colors: { color: string; count: number }[];
  /** The newest entry's write time. */
  lastActivityAt: string;
  /** The newest entry, for the row's one-line excerpt. */
  latest: NotebookEntry | null;
}

/** `GET /notebook/books`: books with entries, most recent activity first. Query: `q`, `cursor`, `limit`. */
export interface NotebookBooksResponse {
  items: NotebookBookRow[];
  nextCursor: string | null;
}

/**
 * `GET /notebook/review`. With `date=YYYY-MM-DD`, the day's deck: `NOTEBOOK_REVIEW_DAILY_SIZE`
 * highlights from different books, starred first, then older ones, stable for that day. With
 * `seed` plus the entry filters, up to `NOTEBOOK_REVIEW_SHUFFLE_MAX` matching highlights in a
 * shuffled order that the same seed repeats.
 */
export interface NotebookReviewResponse {
  items: NotebookHighlightEntry[];
  books: Record<string, NotebookBookLabel>;
}

export interface NotebookOnThisDayYear {
  year: number;
  items: NotebookEntry[];
}

/**
 * `GET /notebook/on-this-day?date=YYYY-MM-DD&tz=<IANA zone>`: entries written on that month and
 * day in earlier years, newest year first, at most `NOTEBOOK_ON_THIS_DAY_MAX` in all. `tz`
 * defaults to the reader's timezone setting.
 */
export interface NotebookOnThisDayResponse {
  date: string;
  years: NotebookOnThisDayYear[];
  books: Record<string, NotebookBookLabel>;
}

/** `GET /notebook/trash`: deleted highlights and journal entries across books, newest deletion first. */
export interface NotebookTrashResponse {
  items: (NotebookHighlightEntry | NotebookJournalItem)[];
  books: Record<string, NotebookBookLabel>;
  nextCursor: string | null;
}
