import type { CurrentlyReadingWidgetData, LibraryOverviewWidgetData, NeglectedGemsWidgetData, ReadingStreakWidgetData } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { DashboardWidgetService } from './dashboard-widget.service';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 42,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeService() {
  const widgetRepo = {
    getCompletedBooksThisYear: vi.fn(),
    getCurrentlyReadingBooks: vi.fn(),
    getReadingStreak: vi.fn(),
    getLibraryOverview: vi.fn(),
    getAnnotationCount: vi.fn(),
    getAnnotationByOffset: vi.fn(),
    getChallengePatternData: vi.fn(),
    getYearProjectionData: vi.fn(),
    getNeglectedGems: vi.fn(),
    getReadingDnaData: vi.fn(),
    getLongWait: vi.fn(),
    getDiversityData: vi.fn(),
    getReadingRhythmData: vi.fn(),
  };
  const libraryService = {
    findAccessibleLibraryIds: vi.fn(),
  };

  const service = new DashboardWidgetService(widgetRepo as never, libraryService as never);
  return { service, widgetRepo, libraryService };
}

describe('DashboardWidgetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getReadingGoal', () => {
    it('returns goal and completed count for user with a reading goal', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      const user = makeUser({
        settings: { dashboardConfig: { readingGoal: 24, widgets: [] } },
      });
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1, 2]);
      widgetRepo.getCompletedBooksThisYear.mockResolvedValue(7);

      const result = await service.getReadingGoal(user);

      expect(libraryService.findAccessibleLibraryIds).toHaveBeenCalledWith(user);
      expect(widgetRepo.getCompletedBooksThisYear).toHaveBeenCalledWith(42, [1, 2], EMPTY_CONTENT_FILTER_RULES);
      expect(result).toEqual({
        goalBooks: 24,
        completedBooks: 7,
        year: new Date().getUTCFullYear(),
      });
    });

    it('returns null goalBooks when user has no reading goal set', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getCompletedBooksThisYear.mockResolvedValue(0);

      const result = await service.getReadingGoal(makeUser());

      expect(result.goalBooks).toBeNull();
      expect(result.completedBooks).toBe(0);
    });

    it('returns null goalBooks when dashboardConfig exists but readingGoal is absent', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      const user = makeUser({ settings: { dashboardConfig: { widgets: [] } } });
      libraryService.findAccessibleLibraryIds.mockResolvedValue([]);
      widgetRepo.getCompletedBooksThisYear.mockResolvedValue(0);

      const result = await service.getReadingGoal(user);

      expect(result.goalBooks).toBeNull();
    });
  });

  describe('getCurrentlyReading', () => {
    it('delegates to widgetRepo with accessible library ids', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      const user = makeUser({ id: 7 });
      const mockData: CurrentlyReadingWidgetData = {
        books: [{ bookId: 10, title: 'Test Book', authors: ['Author'], progress: 45, hasCover: true }],
      };
      libraryService.findAccessibleLibraryIds.mockResolvedValue([3, 5]);
      widgetRepo.getCurrentlyReadingBooks.mockResolvedValue(mockData);

      const result = await service.getCurrentlyReading(user);

      expect(libraryService.findAccessibleLibraryIds).toHaveBeenCalledWith(user);
      expect(widgetRepo.getCurrentlyReadingBooks).toHaveBeenCalledWith(7, [3, 5], EMPTY_CONTENT_FILTER_RULES);
      expect(result).toEqual(mockData);
    });
  });

  describe('getReadingStreak', () => {
    it('delegates to widgetRepo with user id and accessible library ids', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      const user = makeUser({ id: 99 });
      const mockData: ReadingStreakWidgetData = {
        currentStreak: 5,
        longestStreak: 12,
        lastSevenDays: [true, false, true, true, true, true, true],
      };
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1, 2]);
      widgetRepo.getReadingStreak.mockResolvedValue(mockData);

      const result = await service.getReadingStreak(user);

      expect(libraryService.findAccessibleLibraryIds).toHaveBeenCalledWith(user);
      expect(widgetRepo.getReadingStreak).toHaveBeenCalledWith(99, [1, 2], EMPTY_CONTENT_FILTER_RULES);
      expect(result).toEqual(mockData);
    });
  });

  describe('getLibraryOverview', () => {
    it('delegates to widgetRepo with accessible library ids', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      const user = makeUser({ id: 55 });
      const mockData: LibraryOverviewWidgetData = {
        totalBooks: 500,
        totalAuthors: 120,
        totalSeries: 30,
        totalStorageBytes: 5000000000,
        booksAddedThisYear: 45,
      };
      libraryService.findAccessibleLibraryIds.mockResolvedValue([10]);
      widgetRepo.getLibraryOverview.mockResolvedValue(mockData);

      const result = await service.getLibraryOverview(user);

      expect(libraryService.findAccessibleLibraryIds).toHaveBeenCalledWith(user);
      expect(widgetRepo.getLibraryOverview).toHaveBeenCalledWith([10], EMPTY_CONTENT_FILTER_RULES);
      expect(result).toEqual(mockData);
    });
  });

  describe('getHighlightOfTheDay', () => {
    it('returns null when no annotations exist', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getAnnotationCount.mockResolvedValue(0);

      const result = await service.getHighlightOfTheDay(makeUser());
      expect(result).toBeNull();
      expect(widgetRepo.getAnnotationByOffset).not.toHaveBeenCalled();
    });

    it('fetches annotation by offset when annotations exist', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getAnnotationCount.mockResolvedValue(10);
      widgetRepo.getAnnotationByOffset.mockResolvedValue({
        text: 'A great quote',
        note: null,
        bookTitle: 'Test Book',
        bookId: 5,
        hasCover: true,
        chapterTitle: 'Chapter 1',
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await service.getHighlightOfTheDay(makeUser());
      expect(result).not.toBeNull();
      expect(result!.text).toBe('A great quote');
      expect(widgetRepo.getAnnotationByOffset).toHaveBeenCalled();
    });
  });

  describe('getMonthlyChallenge', () => {
    it('returns a challenge with computed progress', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getChallengePatternData.mockResolvedValue({
        avgPageCount: 300,
        uniqueGenresLast6Months: 3,
        staleInProgressCount: 1,
        currentStreak: 2,
        maxStreakThisMonth: 3,
        topAuthorBookCount: 5,
        totalBooksRead: 20,
        pagesThisMonth: 200,
        shortBooksCompleted: 1,
        newGenresRead: 0,
        oldestInProgressFinished: false,
        newAuthorsRead: 1,
        pagesReadThisMonth: 200,
      });

      const result = await service.getMonthlyChallenge(makeUser());
      expect(result.challengeType).toBeTruthy();
      expect(result.title).toBeTruthy();
      expect(result.target).toBeGreaterThan(0);
      expect(typeof result.completed).toBe('boolean');
    });

    it('marks finish-oldest challenge complete when oldestInProgressFinished is true', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getChallengePatternData.mockResolvedValue({
        avgPageCount: 200,
        uniqueGenresLast6Months: 10,
        staleInProgressCount: 1,
        currentStreak: 10,
        maxStreakThisMonth: 10,
        topAuthorBookCount: 1,
        totalBooksRead: 20,
        pagesThisMonth: 0,
        shortBooksCompleted: 0,
        newGenresRead: 0,
        oldestInProgressFinished: true,
        newAuthorsRead: 0,
        pagesReadThisMonth: 0,
      });

      const result = await service.getMonthlyChallenge(makeUser());
      if (result.challengeType === 'finish-oldest') {
        expect(result.completed).toBe(true);
        expect(result.progress).toBe(1);
      }
    });
  });

  describe('getYearProjection', () => {
    it('returns projection data', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getYearProjectionData.mockResolvedValue({
        booksCompletedYtd: 10,
        pagesReadLast30Days: 900,
        hoursReadLast30Days: 30,
        booksCompletedLast30Days: 3,
      });

      const result = await service.getYearProjection(makeUser());
      expect(result.projectedBooks).toBeGreaterThanOrEqual(10);
      expect(result.daysRemaining).toBeGreaterThan(0);
    });
  });

  describe('getNeglectedGems', () => {
    it('delegates to repo and returns result', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      const mockData: NeglectedGemsWidgetData = {
        gems: [{ bookId: 1, title: 'Gem', hasCover: true, rating: 5, waitingDays: 100, genre: 'Fantasy' }],
      };
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getNeglectedGems.mockResolvedValue(mockData);

      const result = await service.getNeglectedGems(makeUser());
      expect(result.gems).toHaveLength(1);
    });
  });

  describe('getReadingDna', () => {
    it('computes DNA from raw repo data', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getReadingDnaData.mockResolvedValue({
        avgPageCount: 350,
        uniqueGenres: 8,
        totalBooks: 25,
        readingDaysRatio: 0.7,
        peakHour: 21,
        avgPagesPerHour: 45,
      });

      const result = await service.getReadingDna(makeUser());
      expect(result.archetype).toBeTruthy();
      expect(result.booksAnalyzed).toBe(25);
      expect(result.timeLabel).toBe('Evening');
      expect(result.speedLabel).toBe('Steady Pacer');
      expect(result.speedScore).toBe(56);
    });

    it('returns speedLabel N/A when no speed data is available', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getReadingDnaData.mockResolvedValue({
        avgPageCount: 350,
        uniqueGenres: 8,
        totalBooks: 25,
        readingDaysRatio: 0.7,
        peakHour: 21,
        avgPagesPerHour: null,
      });

      const result = await service.getReadingDna(makeUser());
      expect(result.speedLabel).toBe('N/A');
      expect(result.speedScore).toBe(0);
    });
  });

  describe('getLongWait', () => {
    it('returns null when repo returns null', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getLongWait.mockResolvedValue(null);

      const result = await service.getLongWait(makeUser());
      expect(result).toBeNull();
    });

    it('returns book data when found', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getLongWait.mockResolvedValue({
        bookId: 7,
        title: 'Old Book',
        hasCover: false,
        addedAt: '2024-01-01T00:00:00.000Z',
        waitingDays: 847,
        pageCount: 400,
        genre: 'Mystery',
      });

      const result = await service.getLongWait(makeUser());
      expect(result!.bookId).toBe(7);
      expect(result!.waitingDays).toBe(847);
    });
  });

  describe('getDiversityScore', () => {
    it('computes diversity from raw data', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getDiversityData.mockResolvedValue({
        uniqueGenresRead: 5,
        totalGenresInLibrary: 10,
        uniqueAuthorsRead: 8,
        totalBooksRead: 15,
        publicationYears: [1990, 2020],
        uniqueLanguages: 3,
      });

      const result = await service.getDiversityScore(makeUser());
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.booksAnalyzed).toBe(15);
    });
  });

  describe('getReadingRhythm', () => {
    it('fills missing days and computes consistency', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getReadingRhythmData.mockResolvedValue([{ day: new Date().toISOString().slice(0, 10), readingSeconds: 600 }]);

      const result = await service.getReadingRhythm(makeUser());
      expect(result.days).toHaveLength(14);
      expect(result.totalDays).toBe(14);
      expect(result.activeDays).toBeGreaterThanOrEqual(1);
    });

    it('returns all zeroes when no reading data', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getReadingRhythmData.mockResolvedValue([]);

      const result = await service.getReadingRhythm(makeUser());
      expect(result.days).toHaveLength(14);
      expect(result.activeDays).toBe(0);
      expect(result.consistencyPercent).toBe(0);
    });
  });

  describe('caching', () => {
    it('live cache: second call to getReadingStreak does not hit repo', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getReadingStreak.mockResolvedValue({ currentStreak: 5, longestStreak: 10, todayRead: false });

      const user = makeUser();
      await service.getReadingStreak(user);
      await service.getReadingStreak(user);

      expect(widgetRepo.getReadingStreak).toHaveBeenCalledTimes(1);
    });

    it('stale cache: second call to getLibraryOverview does not hit repo', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getLibraryOverview.mockResolvedValue({ totalBooks: 100, formats: [] });

      const user = makeUser();
      await service.getLibraryOverview(user);
      await service.getLibraryOverview(user);

      expect(widgetRepo.getLibraryOverview).toHaveBeenCalledTimes(1);
    });

    it('getReadingGoal returns fresh goalBooks from user settings but reuses cached completedBooks', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getCompletedBooksThisYear.mockResolvedValue(5);

      const userWithOldGoal = makeUser({ settings: { dashboardConfig: { readingGoal: 12, widgets: [] } } });
      const userWithNewGoal = makeUser({ settings: { dashboardConfig: { readingGoal: 24, widgets: [] } } });

      const first = await service.getReadingGoal(userWithOldGoal);
      const second = await service.getReadingGoal(userWithNewGoal);

      expect(widgetRepo.getCompletedBooksThisYear).toHaveBeenCalledTimes(1);
      expect(first.goalBooks).toBe(12);
      expect(second.goalBooks).toBe(24);
      expect(second.completedBooks).toBe(5);
    });

    it('cache is scoped per user: different users get independent cache entries', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getLibraryOverview.mockResolvedValue({ totalBooks: 100, formats: [] });

      const userA = makeUser();
      const userB = makeUser({ id: 99 });

      await service.getLibraryOverview(userA);
      await service.getLibraryOverview(userB);
      expect(widgetRepo.getLibraryOverview).toHaveBeenCalledTimes(2);

      await service.getLibraryOverview(userA);
      await service.getLibraryOverview(userB);
      expect(widgetRepo.getLibraryOverview).toHaveBeenCalledTimes(2);
    });
  });
});
