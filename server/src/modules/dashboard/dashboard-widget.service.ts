import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import type {
  CurrentlyReadingWidgetData,
  DashboardWidgetBatchResponse,
  DashboardWidgetBatchResult,
  DiversityScoreWidgetData,
  HighlightOfTheDayWidgetData,
  HighlightsWidgetData,
  LibraryOverviewWidgetData,
  LongWaitWidgetData,
  MonthlyChallengeWidgetData,
  NeglectedGemsWidgetData,
  ReadingDnaWidgetData,
  ReadingGoalWidgetData,
  ReadingRhythmWidgetData,
  ReadingStreakWidgetData,
  UserSettings,
  WidgetType,
  YearProjectionWidgetData,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { StatsCache } from '../../common/cache/stats-cache';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { addDateKeyDays } from '../../common/utils/reading-daily-stats.utils';
import { toTimeZoneStartOfDay } from '../../common/utils/timezone.utils';
import { LibraryService } from '../library/library.service';
import {
  READING_ATTEMPT_CHANGED,
  ReadingAttemptEventsService,
  type ReadingAttemptChangedPayload,
} from '../user-book-status/reading-attempt-events.service';
import {
  buildDaysSeries,
  computeChallengeResult,
  computeDiversityScore,
  computeProjection,
  computeReadingDna,
  computeRhythm,
  daysBetweenDateKeys,
  findEligibleChallenges,
  pickAnnotationIndex,
  resolveReaderClock,
  selectChallenge,
  type ReaderClock,
} from './dashboard-widget.calculations';
import { DashboardWidgetRepository } from './dashboard-widget.repository';
import { dashboardLibraryScopeCacheKey, resolveDashboardLibraryIds } from './dashboard-library-scope';

const DASHBOARD_LIVE_TTL_MS = 120_000;
const DASHBOARD_STALE_TTL_MS = 300_000;
const DASHBOARD_CACHE_MAX_ENTRIES = 200;
// Matches the scroller batch: enough to overlap query latency without flooding the connection pool.
const WIDGET_QUERY_CONCURRENCY = 3;
const RHYTHM_WINDOW_DAYS = 14;
// computeProjection divides the recent window's totals by 30.
const PROJECTION_RECENT_DAYS = 30;

@Injectable()
export class DashboardWidgetService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DashboardWidgetService.name);
  private readonly liveCache = new StatsCache({
    ttlMs: DASHBOARD_LIVE_TTL_MS,
    maxEntries: DASHBOARD_CACHE_MAX_ENTRIES,
  });
  private readonly staleCache = new StatsCache({
    ttlMs: DASHBOARD_STALE_TTL_MS,
    maxEntries: DASHBOARD_CACHE_MAX_ENTRIES,
  });

  constructor(
    private readonly widgetRepo: DashboardWidgetRepository,
    private readonly libraryService: LibraryService,
    private readonly readingAttemptEvents: ReadingAttemptEventsService,
  ) {}

  private readonly onReadingAttemptChanged = ({ userId }: ReadingAttemptChangedPayload): void => {
    if (userId === null) {
      this.liveCache.clear();
      this.staleCache.clear();
    } else this.clearCacheForUser(userId);
  };

  onModuleInit(): void {
    this.readingAttemptEvents.on(READING_ATTEMPT_CHANGED, this.onReadingAttemptChanged);
  }

  onModuleDestroy(): void {
    this.readingAttemptEvents.removeListener(READING_ATTEMPT_CHANGED, this.onReadingAttemptChanged);
  }

  private getContentFilters(user: RequestUser) {
    return user.isSuperuser ? undefined : user.contentFilters;
  }

  private cacheOwnerKey(user: RequestUser, libraryIds: readonly number[]): string {
    return `${user.id}:${dashboardLibraryScopeCacheKey(libraryIds)}`;
  }

  private async getLibraryIds(user: RequestUser): Promise<number[]> {
    return resolveDashboardLibraryIds(await this.libraryService.findAccessibleLibraryIds(user), user);
  }

  private readerClock(user: RequestUser): ReaderClock {
    return resolveReaderClock(user.settings?.timezone);
  }

  /**
   * Cache key for a widget whose answer depends on the reader's calendar. Carrying the local day
   * means an entry cached before the reader's midnight is never served after it, and carrying the
   * zone means a changed timezone setting is not answered from the old zone's entry.
   */
  private calendarCacheKey(widget: string, clock: ReaderClock): string {
    return `${widget}:${clock.timeZone}:${clock.today}`;
  }

  clearCacheForUser(userId: number): void {
    const scopePrefix = `${userId}:`;
    this.liveCache.clearForScopePrefix(scopePrefix);
    this.staleCache.clearForScopePrefix(scopePrefix);
  }

  async getReadingGoal(user: RequestUser): Promise<ReadingGoalWidgetData> {
    const settings = user.settings as UserSettings | undefined;
    const goalBooks = settings?.dashboardConfig?.readingGoal ?? null;
    const { year } = this.readerClock(user);

    const accessibleLibraryIds = await this.getLibraryIds(user);
    // Keyed by the local year alone: attempt end dates are already local days, so the zone only
    // decides which year it is.
    this.readingAttemptEvents.flushPendingChanges(user.id);
    const completedBooks = await this.staleCache.get(this.cacheOwnerKey(user, accessibleLibraryIds), `reading-goal-completed:${year}`, async () => {
      const contentFilters = this.getContentFilters(user);
      return this.widgetRepo.countCompletedBooks(user.id, accessibleLibraryIds, `${year}-01-01`, `${year + 1}-01-01`, contentFilters);
    });

    return { goalBooks, completedBooks, year };
  }

  async getCurrentlyReading(user: RequestUser): Promise<CurrentlyReadingWidgetData> {
    const accessibleLibraryIds = await this.getLibraryIds(user);
    this.readingAttemptEvents.flushPendingChanges(user.id);
    return this.liveCache.get(this.cacheOwnerKey(user, accessibleLibraryIds), 'currently-reading', async () => {
      const contentFilters = this.getContentFilters(user);
      return this.widgetRepo.getCurrentlyReadingBooks(user.id, accessibleLibraryIds, contentFilters);
    });
  }

  async getReadingStreak(user: RequestUser): Promise<ReadingStreakWidgetData> {
    const accessibleLibraryIds = await this.getLibraryIds(user);
    const clock = this.readerClock(user);
    this.readingAttemptEvents.flushPendingChanges(user.id);
    return this.liveCache.get(this.cacheOwnerKey(user, accessibleLibraryIds), this.calendarCacheKey('reading-streak', clock), async () => {
      const contentFilters = this.getContentFilters(user);
      return this.widgetRepo.getReadingStreak(user.id, accessibleLibraryIds, clock.today, contentFilters);
    });
  }

  async getLibraryOverview(user: RequestUser): Promise<LibraryOverviewWidgetData> {
    const accessibleLibraryIds = await this.getLibraryIds(user);
    const clock = this.readerClock(user);
    this.readingAttemptEvents.flushPendingChanges(user.id);
    return this.staleCache.get(this.cacheOwnerKey(user, accessibleLibraryIds), this.calendarCacheKey('library-overview', clock), async () => {
      const contentFilters = this.getContentFilters(user);
      const yearStart = toTimeZoneStartOfDay(`${clock.year}-01-01`, clock.timeZone);
      return this.widgetRepo.getLibraryOverview(accessibleLibraryIds, yearStart, contentFilters);
    });
  }

  async getHighlightOfTheDay(user: RequestUser): Promise<HighlightOfTheDayWidgetData | null> {
    const accessibleLibraryIds = await this.getLibraryIds(user);
    const clock = this.readerClock(user);
    this.readingAttemptEvents.flushPendingChanges(user.id);
    return this.liveCache.get(this.cacheOwnerKey(user, accessibleLibraryIds), this.calendarCacheKey('highlight-of-the-day', clock), async () => {
      const contentFilters = this.getContentFilters(user);
      const total = await this.widgetRepo.getAnnotationCount(user.id, accessibleLibraryIds, contentFilters);
      if (total === 0) return null;
      const offset = pickAnnotationIndex(user.id, clock.today, total);
      return this.widgetRepo.getAnnotationByOffset(user.id, accessibleLibraryIds, offset, contentFilters);
    });
  }

  async getHighlights(user: RequestUser): Promise<HighlightsWidgetData> {
    const accessibleLibraryIds = await this.getLibraryIds(user);
    const clock = this.readerClock(user);
    this.readingAttemptEvents.flushPendingChanges(user.id);
    return this.liveCache.get(this.cacheOwnerKey(user, accessibleLibraryIds), this.calendarCacheKey('highlights', clock), async () => {
      const contentFilters = this.getContentFilters(user);
      const total = await this.widgetRepo.getAnnotationCount(user.id, accessibleLibraryIds, contentFilters);
      if (total === 0) return [];
      const start = pickAnnotationIndex(user.id, clock.today, total);
      const first = await this.widgetRepo.getAnnotationByOffset(user.id, accessibleLibraryIds, start, contentFilters);
      if (!first) return [];
      const others = await this.widgetRepo.getHighlightsFromOtherBooks(user.id, accessibleLibraryIds, first.bookId, 2, contentFilters);
      const highlights = [first, ...others];
      // An account with highlights in one or two books can still fill its remaining cards with
      // other annotations. The offset scan never repeats the first row and skips selected rows.
      for (let step = 1; highlights.length < Math.min(total, 3) && step < total; step++) {
        const candidate = await this.widgetRepo.getAnnotationByOffset(user.id, accessibleLibraryIds, (start + step) % total, contentFilters);
        if (
          candidate &&
          !highlights.some((item) => item.bookId === candidate.bookId && item.createdAt === candidate.createdAt && item.text === candidate.text)
        ) {
          highlights.push(candidate);
        }
      }
      return highlights;
    });
  }

  async getMonthlyChallenge(user: RequestUser): Promise<MonthlyChallengeWidgetData> {
    const accessibleLibraryIds = await this.getLibraryIds(user);
    const clock = this.readerClock(user);
    this.readingAttemptEvents.flushPendingChanges(user.id);
    return this.staleCache.get(this.cacheOwnerKey(user, accessibleLibraryIds), this.calendarCacheKey('monthly-challenge', clock), async () => {
      const contentFilters = this.getContentFilters(user);
      const { year, month } = clock;
      const monthStartDay = `${clock.today.slice(0, 7)}-01`;
      const monthStart = toTimeZoneStartOfDay(monthStartDay, clock.timeZone);
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);

      const data = await this.widgetRepo.getChallengePatternData(
        user.id,
        accessibleLibraryIds,
        { start: monthStart, startDay: monthStartDay, today: clock.today },
        sixMonthsAgo,
        contentFilters,
      );
      const eligible = findEligibleChallenges(data);
      const challengeType = selectChallenge(eligible, user.id, year, month);

      const result = computeChallengeResult(
        challengeType,
        {
          shortBooksCompleted: data.shortBooksCompleted,
          newGenresRead: data.newGenresRead,
          oldestInProgressFinished: data.oldestInProgressFinished,
          maxStreakThisMonth: data.maxStreakThisMonth,
          newAuthorsRead: data.newAuthorsRead,
          pagesReadThisMonth: data.pagesReadThisMonth,
        },
        year,
        month,
      );

      return { challengeType, ...result };
    });
  }

  async getYearProjection(user: RequestUser): Promise<YearProjectionWidgetData> {
    const accessibleLibraryIds = await this.getLibraryIds(user);
    const clock = this.readerClock(user);
    this.readingAttemptEvents.flushPendingChanges(user.id);
    return this.staleCache.get(this.cacheOwnerKey(user, accessibleLibraryIds), this.calendarCacheKey('year-projection', clock), async () => {
      const contentFilters = this.getContentFilters(user);
      const yearStartDay = `${clock.year}-01-01`;
      const nextYearStartDay = `${clock.year + 1}-01-01`;
      const recentStartDay = addDateKeyDays(clock.today, -(PROJECTION_RECENT_DAYS - 1));

      const daysInYear = daysBetweenDateKeys(yearStartDay, nextYearStartDay);
      const dayOfYear = daysBetweenDateKeys(yearStartDay, clock.today) + 1;

      const data = await this.widgetRepo.getYearProjectionData(
        user.id,
        accessibleLibraryIds,
        {
          yearStartDay,
          nextYearStartDay,
          recentStartDay,
          recentEndDay: addDateKeyDays(clock.today, 1),
          recentStart: toTimeZoneStartOfDay(recentStartDay, clock.timeZone),
        },
        contentFilters,
      );

      return computeProjection({
        ...data,
        daysInYear,
        dayOfYear,
        prevProjectedBooks: null,
      });
    });
  }

  async getNeglectedGems(user: RequestUser): Promise<NeglectedGemsWidgetData> {
    const accessibleLibraryIds = await this.getLibraryIds(user);
    this.readingAttemptEvents.flushPendingChanges(user.id);
    return this.staleCache.get(this.cacheOwnerKey(user, accessibleLibraryIds), 'neglected-gems', async () => {
      const contentFilters = this.getContentFilters(user);
      return this.widgetRepo.getNeglectedGems(user.id, accessibleLibraryIds, new Date(), contentFilters);
    });
  }

  async getReadingDna(user: RequestUser): Promise<ReadingDnaWidgetData> {
    const accessibleLibraryIds = await this.getLibraryIds(user);
    const clock = this.readerClock(user);
    this.readingAttemptEvents.flushPendingChanges(user.id);
    return this.staleCache.get(this.cacheOwnerKey(user, accessibleLibraryIds), this.calendarCacheKey('reading-dna', clock), async () => {
      const contentFilters = this.getContentFilters(user);
      const since = new Date();
      since.setUTCMonth(since.getUTCMonth() - 6);
      const data = await this.widgetRepo.getReadingDnaData(user.id, accessibleLibraryIds, since, clock.timeZone, contentFilters);
      return computeReadingDna(data.avgPageCount, data.uniqueGenres, data.totalBooks, data.readingDaysRatio, data.peakHour, data.avgPagesPerHour);
    });
  }

  async getLongWait(user: RequestUser): Promise<LongWaitWidgetData | null> {
    const accessibleLibraryIds = await this.getLibraryIds(user);
    this.readingAttemptEvents.flushPendingChanges(user.id);
    return this.staleCache.get(this.cacheOwnerKey(user, accessibleLibraryIds), 'long-wait', async () => {
      const contentFilters = this.getContentFilters(user);
      return this.widgetRepo.getLongWait(user.id, accessibleLibraryIds, new Date(), contentFilters);
    });
  }

  async getDiversityScore(user: RequestUser): Promise<DiversityScoreWidgetData> {
    const accessibleLibraryIds = await this.getLibraryIds(user);
    this.readingAttemptEvents.flushPendingChanges(user.id);
    return this.staleCache.get(this.cacheOwnerKey(user, accessibleLibraryIds), 'diversity-score', async () => {
      const contentFilters = this.getContentFilters(user);
      const data = await this.widgetRepo.getDiversityData(user.id, accessibleLibraryIds, contentFilters);
      return computeDiversityScore(
        data.uniqueGenresRead,
        data.totalGenresInLibrary,
        data.uniqueAuthorsRead,
        data.totalBooksRead,
        data.publicationYears,
        data.uniqueLanguages,
      );
    });
  }

  async getReadingRhythm(user: RequestUser): Promise<ReadingRhythmWidgetData> {
    const accessibleLibraryIds = await this.getLibraryIds(user);
    const clock = this.readerClock(user);
    this.readingAttemptEvents.flushPendingChanges(user.id);
    return this.liveCache.get(this.cacheOwnerKey(user, accessibleLibraryIds), this.calendarCacheKey('reading-rhythm', clock), async () => {
      const contentFilters = this.getContentFilters(user);
      const since = addDateKeyDays(clock.today, -(RHYTHM_WINDOW_DAYS - 1));
      const rawDays = await this.widgetRepo.getReadingRhythmData(user.id, accessibleLibraryIds, since, contentFilters);
      const days = buildDaysSeries(rawDays, clock.today, RHYTHM_WINDOW_DAYS);
      const rhythm = computeRhythm(days);
      return { days, ...rhythm };
    });
  }

  private readonly widgetLoaders: Record<WidgetType, (user: RequestUser) => Promise<DashboardWidgetBatchResult['data']>> = {
    'reading-goal': (user) => this.getReadingGoal(user),
    'currently-reading': (user) => this.getCurrentlyReading(user),
    'reading-streak': (user) => this.getReadingStreak(user),
    'library-overview': (user) => this.getLibraryOverview(user),
    'highlight-of-the-day': (user) => this.getHighlightOfTheDay(user),
    'monthly-challenge': (user) => this.getMonthlyChallenge(user),
    'year-projection': (user) => this.getYearProjection(user),
    'neglected-gems': (user) => this.getNeglectedGems(user),
    'reading-dna': (user) => this.getReadingDna(user),
    'long-wait': (user) => this.getLongWait(user),
    'diversity-score': (user) => this.getDiversityScore(user),
    'reading-rhythm': (user) => this.getReadingRhythm(user),
  };

  /**
   * Resolves a whole dashboard's widgets over one request.
   *
   * Twelve separate widget calls plus the shelves and the sidebar put a page load well past the six
   * connections a browser will open to one origin, and every widget fetches once on mount with no
   * retry, so a request lost in that crowd leaves a tile stuck on "Failed to load" for the life of
   * the page. Failures are reported per widget rather than failing the batch.
   */
  async getWidgets(types: readonly WidgetType[], user: RequestUser): Promise<DashboardWidgetBatchResponse> {
    const startedAt = Date.now();
    this.logger.debug(`[dashboard.widget_batch] [start] userId=${user.id} widgetCount=${types.length} - widget batch started`);

    const items = await mapWithConcurrency(types, WIDGET_QUERY_CONCURRENCY, async (type): Promise<DashboardWidgetBatchResult> => {
      const widgetStartedAt = Date.now();
      try {
        return { type, data: await this.widgetLoaders[type](user), failed: false };
      } catch (error) {
        const errorClass = error instanceof Error ? error.constructor.name : typeof error;
        const message = sanitizeLogValue(error instanceof Error ? error.message : error);
        this.logger.warn(
          `[dashboard.widget_query] [fail] userId=${user.id} type=${type} durationMs=${Date.now() - widgetStartedAt} errorClass=${errorClass} error="${message}" - widget query failed`,
        );
        return { type, data: null, failed: true };
      }
    });

    const failedCount = items.filter((item) => item.failed).length;
    this.logger.debug(
      `[dashboard.widget_batch] [end] userId=${user.id} durationMs=${Date.now() - startedAt} widgetCount=${items.length} failedCount=${failedCount} - widget batch completed`,
    );

    return { items };
  }
}
