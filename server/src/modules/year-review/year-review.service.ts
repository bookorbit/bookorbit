import { LibraryScopeService } from '../../common/library-scope/library-scope.service';
import { principalCacheKey } from '../../common/types/request-user';
import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { YearReviewBook, YearReviewResponse } from '@bookorbit/types';
import { YEAR_REVIEW_MIN_YEAR } from '@bookorbit/types';

import { StatsCache } from '../../common/cache/stats-cache';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { addDateKeyDays } from '../../common/utils/reading-daily-stats.utils';
import { resolveTimeZone, toDateKeyInTimeZone, toTimeZoneStartOfDay } from '../../common/utils/timezone.utils';
import { ReadingHistoryService } from '../reading-history/reading-history.service';
import {
  READING_ATTEMPT_CHANGED,
  ReadingAttemptEventsService,
  type ReadingAttemptChangedPayload,
} from '../user-book-status/reading-attempt-events.service';
import {
  YearSessionAccumulator,
  busiestIndex,
  computePersonality,
  dayDifference,
  isShelfLabel,
  longestStreak,
  rankByBooks,
} from './year-review.calculations';
import { YearReviewRepository, type YearReviewScope, type YearReviewWindow } from './year-review.repository';

const SESSION_PAGE_SIZE = 2_000;
const FINISHED_BOOKS_LIMIT = 100;
const RANKED_LIMIT = 5;
/** A running year changes with every session, so it is kept briefly. */
const RUNNING_YEAR_TTL_MS = 10 * 60_000;
/** A closed year changes only when old sessions arrive late or reads are edited. */
const CLOSED_YEAR_TTL_MS = 6 * 60 * 60_000;
const CACHE_MAX_ENTRIES = 500;

/**
 * A reader's year in one answer: what the History screen counts for finished books, with the
 * sessions' time on the reader's calendar, the genres and authors it went to, a highlight, and the
 * personality that stands out. Computed once and cached per user, year and day.
 */
@Injectable()
export class YearReviewService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(YearReviewService.name);
  private readonly runningCache = new StatsCache({ ttlMs: RUNNING_YEAR_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });
  private readonly closedCache = new StatsCache({ ttlMs: CLOSED_YEAR_TTL_MS, maxEntries: CACHE_MAX_ENTRIES });

  constructor(
    private readonly repo: YearReviewRepository,
    private readonly readingHistory: ReadingHistoryService,
    private readonly readingAttemptEvents: ReadingAttemptEventsService,
    private readonly libraryScope: LibraryScopeService,
  ) {}

  private readonly onReadingAttemptChanged = ({ userId }: ReadingAttemptChangedPayload): void => {
    if (userId === null) {
      this.runningCache.clear();
      this.closedCache.clear();
    } else {
      this.runningCache.clearForScopePrefix(`${userId}:`);
      this.closedCache.clearForScopePrefix(`${userId}:`);
    }
  };

  onModuleInit(): void {
    this.readingAttemptEvents.on(READING_ATTEMPT_CHANGED, this.onReadingAttemptChanged);
  }

  onModuleDestroy(): void {
    this.readingAttemptEvents.removeListener(READING_ATTEMPT_CHANGED, this.onReadingAttemptChanged);
  }

  async getYear(user: RequestUser, year: number, now = new Date()): Promise<YearReviewResponse> {
    const timeZone = resolveTimeZone(user.settings?.timezone, 'UTC');
    const today = toDateKeyInTimeZone(now, timeZone);
    const currentYear = Number(today.slice(0, 4));
    if (!Number.isInteger(year) || year < YEAR_REVIEW_MIN_YEAR || year > currentYear) {
      throw new BadRequestException('Year in review is not available for that year');
    }

    const partial = year === currentYear;
    const throughDay = partial ? today : `${year}-12-31`;
    const scope: YearReviewScope = {
      userId: user.id,
      libraryIds: await this.libraryScope.visibleIdsOrAll(user),
      contentFilters: user.isSuperuser ? undefined : user.contentFilters,
    };
    const libraryKey = scope.libraryIds === null ? 'all' : [...scope.libraryIds].sort((a, b) => a - b).join(',');
    const key = `${timeZone}:${libraryKey}:${year}:${throughDay}`;
    const cache = partial ? this.runningCache : this.closedCache;

    this.readingAttemptEvents.flushPendingChanges(user.id);
    return cache.get(`${user.id}:`, principalCacheKey(user, key), () => this.load(user, scope, year, timeZone, throughDay, partial));
  }

  private async load(
    user: RequestUser,
    scope: YearReviewScope,
    year: number,
    timeZone: string,
    throughDay: string,
    partial: boolean,
  ): Promise<YearReviewResponse> {
    const event = 'year_review.load';
    const startedAt = Date.now();
    try {
      const until = addDateKeyDays(throughDay, 1);
      const window: YearReviewWindow = {
        start: toTimeZoneStartOfDay(`${year}-01-01`, timeZone),
        end: toTimeZoneStartOfDay(until, timeZone),
        from: `${year}-01-01`,
        until,
      };

      const [sessions, finishedBooks, summary, previous, highlightCounts, highlightRow, mostHighlighted] = await Promise.all([
        this.readSessions(scope, window, year, throughDay, timeZone),
        this.repo.getFinishedBooks(scope, window),
        this.readingHistory.summary(user, { year }),
        year - 1 >= YEAR_REVIEW_MIN_YEAR ? this.readingHistory.summary(user, { year: year - 1 }) : Promise.resolve(null),
        this.repo.countHighlights(scope, window),
        this.repo.pickHighlight(scope, window),
        this.repo.mostHighlightedBook(scope, window),
      ]);

      const openedBookIds = [...sessions.bookSeconds.keys()];
      const rankedBooks = [...sessions.bookSeconds.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, RANKED_LIMIT);
      const [genresByBook, authorsByBook] = await Promise.all([this.repo.getGenresByBook(openedBookIds), this.repo.getAuthorsByBook(openedBookIds)]);
      const detailIds = [
        ...rankedBooks.map(([bookId]) => bookId),
        ...(sessions.longestSession ? [sessions.longestSession.bookId] : []),
        ...(highlightRow ? [highlightRow.bookId] : []),
        ...(mostHighlighted ? [mostHighlighted.bookId] : []),
      ];
      const details = await this.repo.getBooks(detailIds);
      const book = (bookId: number): YearReviewBook =>
        details.get(bookId) ?? { bookId, title: null, authors: [], hasCover: false, coverVersion: null };

      const genres = rankByBooks(
        sessions.bookSeconds,
        new Map([...genresByBook].map(([bookId, names]) => [bookId, names.filter((name) => !isShelfLabel(name))])),
      );
      const authorKeys = new Map<number, number[]>();
      const authorInfo = new Map<number, { name: string; hasPhoto: boolean }>();
      for (const [bookId, list] of authorsByBook) {
        authorKeys.set(
          bookId,
          list.map((author) => author.authorId),
        );
        for (const author of list) authorInfo.set(author.authorId, { name: author.name, hasPhoto: author.hasPhoto });
      }
      const authors = rankByBooks(sessions.bookSeconds, authorKeys);

      const finishedByMonth = Array.from({ length: 12 }, () => 0);
      for (const finished of finishedBooks) finishedByMonth[Number(finished.endedOn.slice(5, 7)) - 1]! += 1;
      const monthSeconds = sessions.months.map((month) => month.readingSeconds + month.listeningSeconds);
      const activeDays = sessions.daily.filter((seconds) => seconds > 0).length;
      const busiestDayIndex = busiestIndex(sessions.daily);
      const daysElapsed = dayDifference(`${year}-01-01`, throughDay) + 1;

      const personality = computePersonality({
        totalSeconds: sessions.totalSeconds,
        listeningSeconds: sessions.listeningSeconds,
        sessions: sessions.sessions,
        hours: sessions.hours,
        weekdays: sessions.weekdays,
        sessionSeconds: sessions.sessionSeconds,
        activeDays,
        daysElapsed,
        genreSeconds: genres.map((genre) => genre.seconds),
        topAuthorSeconds: authors[0]?.seconds ?? 0,
        booksFinished: summary.books,
      });

      const previousYear =
        previous && (previous.books > 0 || previous.seconds > 0)
          ? { year: year - 1, booksFinished: previous.books, totalSeconds: previous.seconds }
          : null;

      const response: YearReviewResponse = {
        year,
        timezone: timeZone,
        generatedAt: new Date().toISOString(),
        throughDay,
        partial,
        totals: {
          booksFinished: summary.books,
          reads: summary.reads,
          rereads: summary.rereads,
          pages: summary.pages,
          totalSeconds: sessions.totalSeconds,
          readingSeconds: sessions.readingSeconds,
          listeningSeconds: sessions.listeningSeconds,
          activeDays,
          sessions: sessions.sessions,
          booksOpened: openedBookIds.length,
          highlights: highlightCounts.highlights,
          notes: highlightCounts.notes,
        },
        previousYear,
        goal: summary.goal,
        dailyMinutes: sessions.daily.map((seconds) => Math.round(seconds / 60)),
        months: sessions.months.map((month, index) => ({
          month: index + 1,
          seconds: monthSeconds[index]!,
          readingSeconds: month.readingSeconds,
          listeningSeconds: month.listeningSeconds,
          booksFinished: finishedByMonth[index]!,
        })),
        hours: sessions.hours,
        weekdays: sessions.weekdays,
        busiestMonth: (() => {
          const index = busiestIndex(monthSeconds);
          return index === null ? null : index + 1;
        })(),
        busiestHour: busiestIndex(sessions.hours),
        busiestWeekday: busiestIndex(sessions.weekdays),
        busiestDay:
          busiestDayIndex === null ? null : { day: addDateKeyDays(`${year}-01-01`, busiestDayIndex), seconds: sessions.daily[busiestDayIndex]! },
        longestStreak: longestStreak(sessions.daily, `${year}-01-01`),
        longestSession: sessions.longestSession
          ? { seconds: sessions.longestSession.seconds, day: sessions.longestSession.day, book: book(sessions.longestSession.bookId) }
          : null,
        finishedBooks: finishedBooks.slice(0, FINISHED_BOOKS_LIMIT),
        topBooks: rankedBooks.map(([bookId, seconds]) => ({ ...book(bookId), seconds })),
        topGenres: genres.slice(0, RANKED_LIMIT).map((genre) => ({ name: genre.key, seconds: genre.seconds, books: genre.books })),
        topAuthors: authors.slice(0, RANKED_LIMIT).map((author) => ({
          authorId: author.key,
          name: authorInfo.get(author.key)?.name ?? '',
          hasPhoto: authorInfo.get(author.key)?.hasPhoto ?? false,
          seconds: author.seconds,
          books: author.books,
        })),
        highlight: highlightRow
          ? {
              annotationId: highlightRow.annotationId,
              text: highlightRow.text,
              note: highlightRow.note,
              chapterTitle: highlightRow.chapterTitle,
              color: highlightRow.color,
              createdAt: highlightRow.createdAt,
              starred: highlightRow.starred,
              book: book(highlightRow.bookId),
            }
          : null,
        mostHighlightedBook: mostHighlighted ? { book: book(mostHighlighted.bookId), highlights: mostHighlighted.highlights } : null,
        personality,
      };

      this.logger.log(
        `[${event}] [end] userId=${user.id} year=${year} partial=${partial} sessions=${sessions.sessions} finished=${summary.books} durationMs=${Date.now() - startedAt} - year in review computed`,
      );
      return response;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `[${event}] [fail] userId=${user.id} year=${year} durationMs=${Date.now() - startedAt} errorClass=${err.constructor.name} error="${sanitizeLogValue(err.message)}" - year in review failed`,
      );
      throw error;
    }
  }

  private async readSessions(scope: YearReviewScope, window: YearReviewWindow, year: number, throughDay: string, timeZone: string) {
    const accumulator = new YearSessionAccumulator(year, throughDay, timeZone);
    let afterId = 0;
    while (true) {
      const rows = await this.repo.getSessionPage(scope, window, afterId, SESSION_PAGE_SIZE);
      for (const row of rows) accumulator.add(row);
      if (rows.length < SESSION_PAGE_SIZE) break;
      afterId = rows[rows.length - 1]!.id;
    }
    return accumulator.result();
  }
}
