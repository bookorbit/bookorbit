export type AchievementCategory = "reading" | "library" | "exploration" | "dedication" | "devices";

export type AchievementRarity = "common" | "rare" | "epic" | "legendary";

export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  reading: "Reading",
  library: "Library",
  exploration: "Exploration",
  dedication: "Dedication",
  devices: "Devices",
};

export interface AchievementItem {
  key: string;
  groupKey: string | null;
  tier: number | null;
  category: AchievementCategory;
  name: string;
  description: string;
  iconName: string;
  rarity: AchievementRarity;
  threshold: number | null;
  hidden: boolean;
  sortOrder: number;
  earned: boolean;
  awardedAt: string | null;
  context: Record<string, unknown> | null;
  contextBookId?: number | null;
  contextBookTitle?: string | null;
  currentProgress: number | null;
}

export interface AchievementCategoryGroup {
  key: AchievementCategory;
  label: string;
  earnedCount: number;
  totalCount: number;
  achievements: AchievementItem[];
}

export interface AchievementCatalogueResponse {
  categories: AchievementCategoryGroup[];
  totalEarned: number;
  totalAvailable: number;
}

export interface AchievementCelebrationClaim {
  claimId: string;
  expiresAt: string;
  achievement: AchievementItem;
}

/**
 * What a "how to get it" hint says. The list grows: a client renders the kinds it knows and skips the rest.
 * - `reading_pace`: hours read in the last `days` days, and how long the next tier takes at that pace.
 * - `period_unread`: unfinished books from a decade or century not finished yet; `period` is its first year.
 * - `stalled_book`: an in-progress book started long enough ago to qualify once finished.
 * - `nearly_finished`: in-progress books past `minPercent`.
 * - `unrated_finished`: finished books with no rating.
 * - `short_books` / `long_books`: unfinished books under or over a page count.
 * - `old_books`: unfinished books published before `year`.
 * - `author_unread`: unfinished books by the author already read most among those with enough books.
 * - `language_unread`: unfinished books in a language not finished yet.
 * - `months_left`: months of `year` still needed, all of them still ahead.
 * - `unavailable`: nothing in the library or calendar can earn it now; `reason` says why.
 */
export type AchievementHintKind =
  | "reading_pace"
  | "period_unread"
  | "stalled_book"
  | "nearly_finished"
  | "unrated_finished"
  | "short_books"
  | "long_books"
  | "old_books"
  | "author_unread"
  | "language_unread"
  | "months_left"
  | "unavailable";

export type AchievementHintUnavailableReason = "no_long_book" | "nothing_before_year" | "too_few_periods" | "missed_month";

/** A book a hint can open in the reader. */
export interface AchievementHintResumeTarget {
  bookId: number;
  fileId: number;
  format: string | null;
}

interface AchievementHintBase {
  /** The achievement the hint is for: the next unearned tier of a set, or a single achievement. */
  key: string;
  /** How many books (or months) the hint counts. */
  count?: number;
  /** Up to three books the user can open, best first. */
  bookIds?: number[];
  /** Titles of `bookIds`, in the same order. */
  bookTitles?: (string | null)[];
}

export type AchievementHint = AchievementHintBase &
  (
    | { kind: "reading_pace"; values: { hours: number; days: number; remaining: number; etaDays: number } }
    | { kind: "period_unread"; values: { period: number; years: 10 | 100 } }
    | {
        kind: "stalled_book";
        values: { title: string | null; percent: number | null; startedAt: string; resume: AchievementHintResumeTarget | null };
      }
    | { kind: "nearly_finished"; values: { minPercent: number; resume: AchievementHintResumeTarget | null } }
    | { kind: "unrated_finished"; values: Record<string, never> }
    | { kind: "short_books"; values: { maxPages: number; inProgress: number } }
    | { kind: "long_books"; values: { minPages: number } }
    | { kind: "old_books"; values: { year: number } }
    | { kind: "author_unread"; values: { authorId: number; author: string; finished: number } }
    | { kind: "language_unread"; values: { language: string } }
    | { kind: "months_left"; values: { year: number; monthsRead: number; months: number[] } }
    | {
        kind: "unavailable";
        values: { reason: AchievementHintUnavailableReason; pages?: number; year?: number; years?: 10 | 100; reachable?: number; month?: number };
      }
  );

export interface AchievementHintsResponse {
  hints: AchievementHint[];
}
