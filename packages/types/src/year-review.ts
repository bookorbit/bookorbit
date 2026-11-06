/**
 * A reader's year, answered by `GET /mobile/year-review/:year`, for a story the app plays through
 * one card at a time. Every number is on the reader's own calendar (their timezone setting).
 */

/**
 * The reading personality a year earns. Append only: a released client maps a code it does not
 * know to a generic reader, so a value is never renamed or removed.
 */
export const YEAR_REVIEW_PERSONALITIES = [
  "night-owl",
  "early-bird",
  "marathoner",
  "listener",
  "explorer",
  "devotee",
  "daily-ritual",
  "page-turner",
  "weekender",
  "free-spirit",
] as const;

export type YearReviewPersonalityCode = (typeof YEAR_REVIEW_PERSONALITIES)[number];

/** Earliest year the route answers for. */
export const YEAR_REVIEW_MIN_YEAR = 2000;

export interface YearReviewBook {
  /** Null for a finished read whose book has since been deleted. */
  bookId: number | null;
  title: string | null;
  authors: string[];
  hasCover: boolean;
  /** Changes when the cover does, for the client's image cache. */
  coverVersion: string | null;
}

export interface YearReviewFinishedBook extends YearReviewBook {
  /** Local day the book was first finished this year. */
  endedOn: string;
  pageCount: number | null;
  rating: number | null;
}

export interface YearReviewTimedBook extends YearReviewBook {
  seconds: number;
}

export interface YearReviewMonth {
  month: number;
  seconds: number;
  readingSeconds: number;
  listeningSeconds: number;
  booksFinished: number;
}

export interface YearReviewGenre {
  name: string;
  seconds: number;
  /** Books in the genre opened this year. */
  books: number;
}

export interface YearReviewAuthor {
  authorId: number;
  name: string;
  hasPhoto: boolean;
  seconds: number;
  /** The author's books opened this year. */
  books: number;
}

export interface YearReviewHighlight {
  annotationId: number;
  text: string;
  note: string | null;
  chapterTitle: string | null;
  color: string;
  createdAt: string;
  starred: boolean;
  book: YearReviewBook;
}

export interface YearReviewPersonality {
  code: YearReviewPersonalityCode;
  /** The numbers behind the code, each from 0 to 1 unless named otherwise. */
  traits: {
    /** Share of time in sessions begun from 9 PM to 4 AM. */
    nightShare: number;
    /** Share of time in sessions begun from 5 AM to 9 AM. */
    morningShare: number;
    listeningShare: number;
    weekendShare: number;
    /** Share of the year's days so far with any reading. */
    activeDayShare: number;
    /** Share of time spent with the most read author. */
    topAuthorShare: number;
    /** Median session length in minutes. */
    medianSessionMinutes: number;
    /** Genres with at least an hour of reading. */
    genreCount: number;
    /** Share of time spent with books in the leading genre. */
    topGenreShare: number;
    /** Books finished per month so far. */
    booksPerMonth: number;
  };
}

export interface YearReviewResponse {
  year: number;
  timezone: string;
  generatedAt: string;
  /** The last local day counted: today while the year is still running, else December 31. */
  throughDay: string;
  /** True while the year is still running. */
  partial: boolean;
  totals: {
    /** Distinct books finished, the number History and the reading goal count. */
    booksFinished: number;
    /** Completed reads, a reread counting again. */
    reads: number;
    rereads: number;
    pages: number;
    totalSeconds: number;
    readingSeconds: number;
    listeningSeconds: number;
    activeDays: number;
    sessions: number;
    /** Books with any reading or listening this year. */
    booksOpened: number;
    highlights: number;
    notes: number;
  };
  /** The year before, for a comparison. Null when nothing was read in it. */
  previousYear: { year: number; booksFinished: number; totalSeconds: number } | null;
  goal: { target: number; reached: number; metOn: string | null } | null;
  /** Minutes per local day from January 1 to `throughDay`, in order. */
  dailyMinutes: number[];
  /** All twelve months, January first. */
  months: YearReviewMonth[];
  /** Seconds by the local hour a session began, midnight first (24 entries). */
  hours: number[];
  /** Seconds by local weekday, Sunday first (7 entries). */
  weekdays: number[];
  busiestMonth: number | null;
  busiestHour: number | null;
  /** 0 is Sunday. */
  busiestWeekday: number | null;
  busiestDay: { day: string; seconds: number } | null;
  longestStreak: { days: number; startDay: string; endDay: string } | null;
  longestSession: { seconds: number; day: string; book: YearReviewBook | null } | null;
  /** Each book finished this year once, oldest finish first, at most 100. */
  finishedBooks: YearReviewFinishedBook[];
  /** The books given the most time, at most 5. */
  topBooks: YearReviewTimedBook[];
  /** At most 5. */
  topGenres: YearReviewGenre[];
  /** At most 5. */
  topAuthors: YearReviewAuthor[];
  /** One highlight from the year: a starred one first, then one with a note, of a quotable length. */
  highlight: YearReviewHighlight | null;
  mostHighlightedBook: { book: YearReviewBook; highlights: number } | null;
  /** Null for a year too thin to read a personality from. */
  personality: YearReviewPersonality | null;
}
