import type { YearReviewPersonality, YearReviewPersonalityCode } from '@bookorbit/types';

import { addDateKeyDays, splitReadingSessionByDay } from '../../common/utils/reading-daily-stats.utils';

/** One reading or listening session, as the year's pass reads it. */
export interface YearSessionInput {
  bookId: number;
  sessionType: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  progressDelta: number | null;
}

export interface YearLongestSession {
  seconds: number;
  day: string;
  bookId: number;
}

/** The numbers one pass over a year's sessions produces. */
export interface YearSessionTotals {
  totalSeconds: number;
  readingSeconds: number;
  listeningSeconds: number;
  sessions: number;
  /** Seconds per local day from January 1 to the last counted day. */
  daily: number[];
  months: Array<{ readingSeconds: number; listeningSeconds: number }>;
  hours: number[];
  weekdays: number[];
  bookSeconds: Map<number, number>;
  sessionSeconds: number[];
  longestSession: YearLongestSession | null;
}

const LISTENING_TYPES = new Set(['tts', 'listen']);
const DAY_MS = 86_400_000;

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

/** The local hour, 0 to 23, an instant falls in. */
export function localHour(date: Date, timeZone: string): number {
  let formatter = hourFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' });
    hourFormatters.set(timeZone, formatter);
  }
  const hour = Number(formatter.format(date));
  return Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 0;
}

/** Whole days from one date key to another; negative when `to` comes first. */
export function dayDifference(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** 0 is Sunday. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/**
 * Adds up a year's sessions on the reader's calendar. A session that crosses midnight is split
 * between its days the way the daily statistics split it, and only the part inside the year counts,
 * so a New Year's Eve session gives each year its own share.
 */
export class YearSessionAccumulator {
  private readonly yearStart: string;
  private readonly totals: YearSessionTotals;

  constructor(
    year: number,
    private readonly throughDay: string,
    private readonly timeZone: string,
  ) {
    this.yearStart = `${year}-01-01`;
    const days = dayDifference(this.yearStart, throughDay) + 1;
    this.totals = {
      totalSeconds: 0,
      readingSeconds: 0,
      listeningSeconds: 0,
      sessions: 0,
      daily: Array.from({ length: Math.max(0, days) }, () => 0),
      months: Array.from({ length: 12 }, () => ({ readingSeconds: 0, listeningSeconds: 0 })),
      hours: Array.from({ length: 24 }, () => 0),
      weekdays: Array.from({ length: 7 }, () => 0),
      bookSeconds: new Map(),
      sessionSeconds: [],
      longestSession: null,
    };
  }

  add(session: YearSessionInput): void {
    const listening = LISTENING_TYPES.has(session.sessionType);
    let seconds = 0;
    let firstDay: string | null = null;
    for (const segment of splitReadingSessionByDay(session, this.timeZone)) {
      if (segment.day < this.yearStart || segment.day > this.throughDay || segment.readingSeconds <= 0) continue;
      const index = dayDifference(this.yearStart, segment.day);
      if (index < 0 || index >= this.totals.daily.length) continue;
      this.totals.daily[index]! += segment.readingSeconds;
      const month = this.totals.months[Number(segment.day.slice(5, 7)) - 1]!;
      if (listening) month.listeningSeconds += segment.readingSeconds;
      else month.readingSeconds += segment.readingSeconds;
      this.totals.weekdays[weekdayOf(segment.day)]! += segment.readingSeconds;
      seconds += segment.readingSeconds;
      firstDay ??= segment.day;
    }
    if (seconds <= 0 || firstDay === null) return;

    this.totals.sessions += 1;
    this.totals.totalSeconds += seconds;
    if (listening) this.totals.listeningSeconds += seconds;
    else this.totals.readingSeconds += seconds;
    this.totals.hours[localHour(session.startedAt, this.timeZone)]! += seconds;
    this.totals.bookSeconds.set(session.bookId, (this.totals.bookSeconds.get(session.bookId) ?? 0) + seconds);
    this.totals.sessionSeconds.push(seconds);
    const longest = this.totals.longestSession;
    if (!longest || seconds > longest.seconds) this.totals.longestSession = { seconds, day: firstDay, bookId: session.bookId };
  }

  result(): YearSessionTotals {
    return this.totals;
  }
}

/** The index of the largest positive value, the earliest on a tie; null when nothing is positive. */
export function busiestIndex(values: readonly number[]): number | null {
  let best: number | null = null;
  values.forEach((value, index) => {
    if (value > 0 && (best === null || value > values[best]!)) best = index;
  });
  return best;
}

/** The longest run of consecutive days with any reading, the earliest on a tie. */
export function longestStreak(daily: readonly number[], yearStart: string): { days: number; startDay: string; endDay: string } | null {
  let bestLength = 0;
  let bestStart = 0;
  let runStart = 0;
  let runLength = 0;
  daily.forEach((seconds, index) => {
    if (seconds > 0) {
      if (runLength === 0) runStart = index;
      runLength += 1;
      if (runLength > bestLength) {
        bestLength = runLength;
        bestStart = runStart;
      }
    } else {
      runLength = 0;
    }
  });
  if (bestLength === 0) return null;
  return {
    days: bestLength,
    startDay: addDateKeyDays(yearStart, bestStart),
    endDay: addDateKeyDays(yearStart, bestStart + bestLength - 1),
  };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/**
 * Labels metadata providers file books under that say nothing about what kind of book it is: shelf
 * names, formats and audiences. A year whose top genre came out as "Books" or "Audiobook" told the
 * reader nothing, so these never rank.
 */
const SHELF_LABELS = new Set([
  'adult',
  'adult fiction',
  'audio',
  'audio book',
  'audio books',
  'audiobook',
  'audiobooks',
  'book',
  'book club',
  'books',
  'currently reading',
  'default',
  'e book',
  'e books',
  'ebook',
  'ebooks',
  'favorites',
  'favourites',
  'fiction',
  'fiction & literature',
  'fiction and literature',
  'general',
  'kindle',
  'kindle unlimited',
  'library',
  'literature',
  'literature & fiction',
  'literature and fiction',
  'misc',
  'miscellaneous',
  'non fiction',
  'nonfiction',
  'novel',
  'novels',
  'other',
  'owned',
  'to read',
  'unknown',
]);

export function isShelfLabel(name: string): boolean {
  return SHELF_LABELS.has(name.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim());
}

/** Adds each book's time to every name it is filed under, counting the book once per name. */
export function rankByBooks<Key>(
  bookSeconds: ReadonlyMap<number, number>,
  keysByBook: ReadonlyMap<number, readonly Key[]>,
): Array<{ key: Key; seconds: number; books: number }> {
  const totals = new Map<Key, { seconds: number; books: number }>();
  for (const [bookId, seconds] of bookSeconds) {
    for (const key of new Set(keysByBook.get(bookId) ?? [])) {
      const entry = totals.get(key) ?? { seconds: 0, books: 0 };
      entry.seconds += seconds;
      entry.books += 1;
      totals.set(key, entry);
    }
  }
  return [...totals.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.seconds - a.seconds || b.books - a.books);
}

export interface PersonalityInput {
  totalSeconds: number;
  listeningSeconds: number;
  sessions: number;
  hours: readonly number[];
  weekdays: readonly number[];
  sessionSeconds: readonly number[];
  activeDays: number;
  daysElapsed: number;
  /** Seconds per genre, every genre read, a book's whole time counting in each of its genres. */
  genreSeconds: readonly number[];
  topAuthorSeconds: number;
  booksFinished: number;
}

/** Below this the year is too thin to say anything about how someone reads. */
export const PERSONALITY_MIN_SECONDS = 3_600;
export const PERSONALITY_MIN_SESSIONS = 5;

const EXPLORER_MIN_GENRES = 6;
const NIGHT_HOURS = new Set([21, 22, 23, 0, 1, 2, 3]);
const MORNING_HOURS = new Set([5, 6, 7, 8]);

const round = (value: number, places = 3) => Number(value.toFixed(places));

/**
 * The trait that stands out most, each measured against the point where it starts to be notable,
 * so a reader who is a little of everything is a free spirit rather than a weak night owl. Ties
 * keep the order below.
 */
export function computePersonality(input: PersonalityInput): YearReviewPersonality | null {
  if (input.totalSeconds < PERSONALITY_MIN_SECONDS || input.sessions < PERSONALITY_MIN_SESSIONS) return null;

  const total = input.totalSeconds;
  const share = (hours: Set<number>) => input.hours.reduce((sum, seconds, hour) => sum + (hours.has(hour) ? seconds : 0), 0) / total;
  const weekdayTotal = input.weekdays.reduce((sum, seconds) => sum + seconds, 0);
  const traits: YearReviewPersonality['traits'] = {
    nightShare: round(share(NIGHT_HOURS)),
    morningShare: round(share(MORNING_HOURS)),
    listeningShare: round(input.listeningSeconds / total),
    weekendShare: round(weekdayTotal > 0 ? ((input.weekdays[0] ?? 0) + (input.weekdays[6] ?? 0)) / weekdayTotal : 0),
    activeDayShare: round(input.daysElapsed > 0 ? input.activeDays / input.daysElapsed : 0),
    topAuthorShare: round(Math.min(1, input.topAuthorSeconds / total)),
    medianSessionMinutes: round(median(input.sessionSeconds) / 60, 1),
    genreCount: input.genreSeconds.filter((seconds) => seconds >= 3_600).length,
    topGenreShare: round(Math.min(1, Math.max(0, ...input.genreSeconds) / total)),
    booksPerMonth: round(input.daysElapsed > 0 ? input.booksFinished / (input.daysElapsed / 30.4375) : 0, 2),
  };

  const scores: Array<[YearReviewPersonalityCode, number]> = [
    ['night-owl', traits.nightShare / 0.4],
    ['early-bird', traits.morningShare / 0.3],
    ['listener', traits.listeningShare / 0.6],
    ['marathoner', traits.medianSessionMinutes / 45],
    ['page-turner', traits.booksPerMonth / 4],
    ['devotee', traits.topAuthorShare / 0.4],
    // Books carry several genres each, so a count of genres mostly measures how densely they are
    // tagged. How little of the year the leading genre held says more about range.
    ['explorer', traits.genreCount >= EXPLORER_MIN_GENRES && traits.topGenreShare > 0 ? 0.25 / traits.topGenreShare : 0],
    ['daily-ritual', traits.activeDayShare / 0.6],
    ['weekender', traits.weekendShare / 0.55],
  ];
  let code: YearReviewPersonalityCode = 'free-spirit';
  let best = 1;
  for (const [candidate, score] of scores) {
    if (score >= best && (code === 'free-spirit' || score > best)) {
      code = candidate;
      best = score;
    }
  }
  return { code, traits };
}
