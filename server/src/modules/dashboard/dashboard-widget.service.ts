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

@Injectable()
export class DashboardWidgetService {
  constructor(
    private readonly widgetRepo: DashboardWidgetRepository,
    private readonly libraryService: LibraryService,
  ) {}

  async getReadingGoal(user: RequestUser): Promise<ReadingGoalWidgetData> {
    const settings = user.settings as UserSettings | undefined;
    const goalBooks = settings?.dashboardConfig?.readingGoal ?? null;

    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const completedBooks = await this.widgetRepo.getCompletedBooksThisYear(user.id, accessibleLibraryIds);

    return {
      goalBooks,
      completedBooks,
      year: new Date().getUTCFullYear(),
    };
  }

  async getCurrentlyReading(user: RequestUser): Promise<CurrentlyReadingWidgetData> {
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    return this.widgetRepo.getCurrentlyReadingBooks(user.id, accessibleLibraryIds);
  }

  async getReadingStreak(user: RequestUser): Promise<ReadingStreakWidgetData> {
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    return this.widgetRepo.getReadingStreak(user.id, accessibleLibraryIds);
  }

  async getLibraryOverview(user: RequestUser): Promise<LibraryOverviewWidgetData> {
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    return this.widgetRepo.getLibraryOverview(accessibleLibraryIds);
  }

  async getHighlightOfTheDay(user: RequestUser): Promise<HighlightOfTheDayWidgetData | null> {
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const total = await this.widgetRepo.getAnnotationCount(user.id, accessibleLibraryIds);
    if (total === 0) return null;

    const dateStr = formatDay(new Date());
    const offset = pickAnnotationIndex(user.id, dateStr, total);
    return this.widgetRepo.getAnnotationByOffset(user.id, accessibleLibraryIds, offset);
  }

  async getMonthlyChallenge(user: RequestUser): Promise<MonthlyChallengeWidgetData> {
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const today = new Date();
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth() + 1;
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const sixMonthsAgo = new Date(today);
    sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);

    const data = await this.widgetRepo.getChallengePatternData(user.id, accessibleLibraryIds, monthStart, sixMonthsAgo);
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
  }

  async getYearProjection(user: RequestUser): Promise<YearProjectionWidgetData> {
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const today = new Date();
    const year = today.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const daysInYear = isLeapYear ? 366 : 365;
    const dayOfYear = Math.ceil((today.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24));

    const data = await this.widgetRepo.getYearProjectionData(user.id, accessibleLibraryIds, yearStart, thirtyDaysAgo);

    return computeProjection({
      ...data,
      daysInYear,
      dayOfYear,
      prevProjectedBooks: null,
    });
  }

  async getNeglectedGems(user: RequestUser): Promise<NeglectedGemsWidgetData> {
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    return this.widgetRepo.getNeglectedGems(user.id, accessibleLibraryIds, new Date());
  }

  async getReadingDna(user: RequestUser): Promise<ReadingDnaWidgetData> {
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - 6);

    const data = await this.widgetRepo.getReadingDnaData(user.id, accessibleLibraryIds, since);

    return computeReadingDna(data.avgPageCount, data.uniqueGenres, data.totalBooks, data.readingDaysRatio, data.peakHour, data.avgPagesPerHour);
  }

  async getLongWait(user: RequestUser): Promise<LongWaitWidgetData | null> {
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    return this.widgetRepo.getLongWait(user.id, accessibleLibraryIds, new Date());
  }

  async getDiversityScore(user: RequestUser): Promise<DiversityScoreWidgetData> {
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const data = await this.widgetRepo.getDiversityData(user.id, accessibleLibraryIds);

    return computeDiversityScore(
      data.uniqueGenresRead,
      data.totalGenresInLibrary,
      data.uniqueAuthorsRead,
      data.totalBooksRead,
      data.publicationYears,
      data.uniqueLanguages,
    );
  }

  async getReadingRhythm(user: RequestUser): Promise<ReadingRhythmWidgetData> {
    const accessibleLibraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const today = new Date();
    const since = new Date(today);
    since.setUTCDate(since.getUTCDate() - 13);
    const sinceStr = formatDay(since);

    const rawDays = await this.widgetRepo.getReadingRhythmData(user.id, accessibleLibraryIds, sinceStr);
    const days = buildDaysSeries(rawDays, today, 14);
    const rhythm = computeRhythm(days);

    return { days, ...rhythm };
  }
}
