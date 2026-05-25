import { Injectable } from '@nestjs/common';

import type {
  CurrentlyReadingWidgetData,
  DiversityScoreWidgetData,
  HighlightOfTheDayWidgetData,
  LibraryOverviewWidgetData,
  LongWaitWidgetData,
  MonthlyChallengeWidgetData,
  NeglectedGemsWidgetData,
  ReadingDnaWidgetData,
  ReadingGoalWidgetData,
  ReadingRhythmWidgetData,
  ReadingStreakWidgetData,
  UserSettings,
  YearProjectionWidgetData,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { StatsCache } from '../../common/cache/stats-cache';
import { LibraryService } from '../library/library.service';
import {
  buildDaysSeries,
  computeChallengeResult,
  computeDiversityScore,
  computeProjection,
  computeReadingDna,
  computeRhythm,
  findEligibleChallenges,
  formatDay,
  pickAnnotationIndex,
  selectChallenge,
} from './dashboard-widget.calculations';
import { DashboardWidgetRepository } from './dashboard-widget.repository';

const DASHBOARD_LIVE_TTL_MS = 120_000;
const DASHBOARD_STALE_TTL_MS = 300_000;
const DASHBOARD_CACHE_MAX_ENTRIES = 200;

@Injectable()
export class DashboardWidgetService {
  private readonly liveCache = new StatsCache({ ttlMs: DASHBOARD_LIVE_TTL_MS, maxEntries: DASHBOARD_CACHE_MAX_ENTRIES });
  private readonly staleCache = new StatsCache({ ttlMs: DASHBOARD_STALE_TTL_MS, maxEntries: DASHBOARD_CACHE_MAX_ENTRIES });

  constructor(
    private readonly widgetRepo: DashboardWidgetRepository,
    private readonly libraryService: LibraryService,
  ) {}

  private getContentFilters(user: RequestUser) {
    return user.isSuperuser ? undefined : user.contentFilters;
  }

  async getReadingGoal(user: RequestUser): Promise<ReadingGoalWidgetData> {
    const settings = user.settings as UserSettings | undefined;
    const goalBooks = settings?.dashboardConfig?.readingGoal ?? null;
    const year = new Date().getUTCFullYear();

    const completedBooks = await this.staleCache.get(String(user.id), `reading-goal-completed:${year}`, async () => {
      const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const contentFilters = this.getContentFilters(user);
      return this.widgetRepo.getCompletedBooksThisYear(user.id, accessibleLibraryIds, contentFilters);
    });

    return { goalBooks, completedBooks, year };
  }

  async getCurrentlyReading(user: RequestUser): Promise<CurrentlyReadingWidgetData> {
    return this.liveCache.get(String(user.id), 'currently-reading', async () => {
      const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const contentFilters = this.getContentFilters(user);
      return this.widgetRepo.getCurrentlyReadingBooks(user.id, accessibleLibraryIds, contentFilters);
    });
  }

  async getReadingStreak(user: RequestUser): Promise<ReadingStreakWidgetData> {
    return this.liveCache.get(String(user.id), 'reading-streak', async () => {
      const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const contentFilters = this.getContentFilters(user);
      return this.widgetRepo.getReadingStreak(user.id, accessibleLibraryIds, contentFilters);
    });
  }

  async getLibraryOverview(user: RequestUser): Promise<LibraryOverviewWidgetData> {
    return this.staleCache.get(String(user.id), 'library-overview', async () => {
      const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const contentFilters = this.getContentFilters(user);
      return this.widgetRepo.getLibraryOverview(accessibleLibraryIds, contentFilters);
    });
  }

  async getHighlightOfTheDay(user: RequestUser): Promise<HighlightOfTheDayWidgetData | null> {
    return this.liveCache.get(String(user.id), 'highlight-of-the-day', async () => {
      const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const contentFilters = this.getContentFilters(user);
      const total = await this.widgetRepo.getAnnotationCount(user.id, accessibleLibraryIds, contentFilters);
      if (total === 0) return null;
      const dateStr = formatDay(new Date());
      const offset = pickAnnotationIndex(user.id, dateStr, total);
      return this.widgetRepo.getAnnotationByOffset(user.id, accessibleLibraryIds, offset, contentFilters);
    });
  }

  async getMonthlyChallenge(user: RequestUser): Promise<MonthlyChallengeWidgetData> {
    return this.staleCache.get(String(user.id), 'monthly-challenge', async () => {
      const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const contentFilters = this.getContentFilters(user);
      const today = new Date();
      const year = today.getUTCFullYear();
      const month = today.getUTCMonth() + 1;
      const monthStart = new Date(Date.UTC(year, month - 1, 1));
      const sixMonthsAgo = new Date(today);
      sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);

      const data = await this.widgetRepo.getChallengePatternData(user.id, accessibleLibraryIds, monthStart, sixMonthsAgo, contentFilters);
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
    return this.staleCache.get(String(user.id), 'year-projection', async () => {
      const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const contentFilters = this.getContentFilters(user);
      const today = new Date();
      const year = today.getUTCFullYear();
      const yearStart = new Date(Date.UTC(year, 0, 1));
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      const daysInYear = isLeapYear ? 366 : 365;
      const dayOfYear = Math.ceil((today.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24));

      const data = await this.widgetRepo.getYearProjectionData(user.id, accessibleLibraryIds, yearStart, thirtyDaysAgo, contentFilters);

      return computeProjection({
        ...data,
        daysInYear,
        dayOfYear,
        prevProjectedBooks: null,
      });
    });
  }

  async getNeglectedGems(user: RequestUser): Promise<NeglectedGemsWidgetData> {
    return this.staleCache.get(String(user.id), 'neglected-gems', async () => {
      const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const contentFilters = this.getContentFilters(user);
      return this.widgetRepo.getNeglectedGems(user.id, accessibleLibraryIds, new Date(), contentFilters);
    });
  }

  async getReadingDna(user: RequestUser): Promise<ReadingDnaWidgetData> {
    return this.staleCache.get(String(user.id), 'reading-dna', async () => {
      const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const contentFilters = this.getContentFilters(user);
      const since = new Date();
      since.setUTCMonth(since.getUTCMonth() - 6);
      const data = await this.widgetRepo.getReadingDnaData(user.id, accessibleLibraryIds, since, contentFilters);
      return computeReadingDna(data.avgPageCount, data.uniqueGenres, data.totalBooks, data.readingDaysRatio, data.peakHour, data.avgPagesPerHour);
    });
  }

  async getLongWait(user: RequestUser): Promise<LongWaitWidgetData | null> {
    return this.staleCache.get(String(user.id), 'long-wait', async () => {
      const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const contentFilters = this.getContentFilters(user);
      return this.widgetRepo.getLongWait(user.id, accessibleLibraryIds, new Date(), contentFilters);
    });
  }

  async getDiversityScore(user: RequestUser): Promise<DiversityScoreWidgetData> {
    return this.staleCache.get(String(user.id), 'diversity-score', async () => {
      const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
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
    return this.liveCache.get(String(user.id), 'reading-rhythm', async () => {
      const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
      const contentFilters = this.getContentFilters(user);
      const today = new Date();
      const since = new Date(today);
      since.setUTCDate(since.getUTCDate() - 13);
      const sinceStr = formatDay(since);
      const rawDays = await this.widgetRepo.getReadingRhythmData(user.id, accessibleLibraryIds, sinceStr, contentFilters);
      const days = buildDaysSeries(rawDays, today, 14);
      const rhythm = computeRhythm(days);
      return { days, ...rhythm };
    });
  }
}
