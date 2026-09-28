import type { CurrentlyReadingWidgetData, LibraryOverviewWidgetData, NeglectedGemsWidgetData, ReadingStreakWidgetData } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { pickAnnotationIndex } from './dashboard-widget.calculations';
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
    countCompletedBooks: vi.fn(),
    getCurrentlyReadingBooks: vi.fn(),
    getReadingStreak: vi.fn(),
    getLibraryOverview: vi.fn(),
    getAnnotationCount: vi.fn(),
    getAnnotationByOffset: vi.fn(),
    getHighlightsFromOtherBooks: vi.fn().mockResolvedValue([]),
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
      widgetRepo.countCompletedBooks.mockResolvedValue(7);

      const result = await service.getReadingGoal(user);

      const year = new Date().getUTCFullYear();
      expect(libraryService.findAccessibleLibraryIds).toHaveBeenCalledWith(user);
      expect(widgetRepo.countCompletedBooks).toHaveBeenCalledWith(42, [1, 2], `${year}-01-01`, `${year + 1}-01-01`, EMPTY_CONTENT_FILTER_RULES);
      expect(result).toEqual({
        goalBooks: 24,
        completedBooks: 7,
        year,
      });
    });

    it('returns null goalBooks when user has no reading goal set', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.countCompletedBooks.mockResolvedValue(0);

      const result = await service.getReadingGoal(makeUser());

      expect(result.goalBooks).toBeNull();
      expect(result.completedBooks).toBe(0);
    });

    it('returns null goalBooks when dashboardConfig exists but readingGoal is absent', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      const user = makeUser({ settings: { dashboardConfig: { widgets: [] } } });
      libraryService.findAccessibleLibraryIds.mockResolvedValue([]);
      widgetRepo.countCompletedBooks.mockResolvedValue(0);

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

    it('intersects widget queries with the saved dashboard library selection', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      const user = makeUser({ id: 7, settings: { dashboardConfig: { libraryIds: [5, 99] } } });
      libraryService.findAccessibleLibraryIds.mockResolvedValue([3, 5]);
      widgetRepo.getCurrentlyReadingBooks.mockResolvedValue({ books: [] });

      await service.getCurrentlyReading(user);

      expect(widgetRepo.getCurrentlyReadingBooks).toHaveBeenCalledWith(7, [5], EMPTY_CONTENT_FILTER_RULES);
    });

    it('does not reuse cached widget data after the dashboard library selection changes', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      const firstUser = makeUser({ id: 7, settings: { dashboardConfig: { libraryIds: [3] } } });
      const secondUser = makeUser({ id: 7, settings: { dashboardConfig: { libraryIds: [5] } } });
      libraryService.findAccessibleLibraryIds.mockResolvedValue([3, 5]);
      widgetRepo.getCurrentlyReadingBooks.mockResolvedValueOnce({ books: [{ bookId: 3 }] }).mockResolvedValueOnce({ books: [{ bookId: 5 }] });

      const first = await service.getCurrentlyReading(firstUser);
      const second = await service.getCurrentlyReading(secondUser);

      expect(first.books).toEqual([{ bookId: 3 }]);
      expect(second.books).toEqual([{ bookId: 5 }]);
      expect(widgetRepo.getCurrentlyReadingBooks).toHaveBeenCalledTimes(2);
      expect(widgetRepo.getCurrentlyReadingBooks).toHaveBeenNthCalledWith(1, 7, [3], EMPTY_CONTENT_FILTER_RULES);
      expect(widgetRepo.getCurrentlyReadingBooks).toHaveBeenNthCalledWith(2, 7, [5], EMPTY_CONTENT_FILTER_RULES);
    });

    it('does not reuse cached widget data after library access is revoked', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      const user = makeUser({ id: 7, settings: { dashboardConfig: { libraryIds: [3, 5] } } });
      libraryService.findAccessibleLibraryIds.mockResolvedValueOnce([3, 5]).mockResolvedValueOnce([3]);
      widgetRepo.getCurrentlyReadingBooks.mockResolvedValueOnce({ books: [{ bookId: 5 }] }).mockResolvedValueOnce({ books: [] });

      const beforeRevocation = await service.getCurrentlyReading(user);
      const afterRevocation = await service.getCurrentlyReading(user);

      expect(beforeRevocation.books).toEqual([{ bookId: 5 }]);
      expect(afterRevocation.books).toEqual([]);
      expect(widgetRepo.getCurrentlyReadingBooks).toHaveBeenCalledTimes(2);
      expect(widgetRepo.getCurrentlyReadingBooks).toHaveBeenNthCalledWith(1, 7, [3, 5], EMPTY_CONTENT_FILTER_RULES);
      expect(widgetRepo.getCurrentlyReadingBooks).toHaveBeenNthCalledWith(2, 7, [3], EMPTY_CONTENT_FILTER_RULES);
    });

    it('loads fresh data after the user cache is cleared', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      const user = makeUser({ id: 7 });
      libraryService.findAccessibleLibraryIds.mockResolvedValue([3]);
      widgetRepo.getCurrentlyReadingBooks
        .mockResolvedValueOnce({ books: [{ bookId: 10, title: 'First', authors: [], progress: 10, hasCover: false }] })
        .mockResolvedValueOnce({ books: [{ bookId: 10, title: 'First', authors: [], progress: 25, hasCover: false }] });

      const initial = await service.getCurrentlyReading(user);
      service.clearCacheForUser(user.id);
      const refreshed = await service.getCurrentlyReading(user);

      expect(initial.books[0]?.progress).toBe(10);
      expect(refreshed.books[0]?.progress).toBe(25);
      expect(widgetRepo.getCurrentlyReadingBooks).toHaveBeenCalledTimes(2);
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
      expect(widgetRepo.getReadingStreak).toHaveBeenCalledWith(99, [1, 2], expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), EMPTY_CONTENT_FILTER_RULES);
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
      expect(widgetRepo.getLibraryOverview).toHaveBeenCalledWith([10], expect.any(Date), EMPTY_CONTENT_FILTER_RULES);
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

  describe('getHighlights', () => {
    it('prefers highlights from other books after the daily highlight', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([7]);
      widgetRepo.getAnnotationCount.mockResolvedValue(10);
      const highlight = (bookId: number) => ({
        text: `Passage ${bookId}`,
        note: null,
        bookTitle: `Book ${bookId}`,
        bookId,
        hasCover: true,
        chapterTitle: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      widgetRepo.getAnnotationByOffset.mockResolvedValue(highlight(5));
      widgetRepo.getHighlightsFromOtherBooks.mockResolvedValue([highlight(6), highlight(7)]);

      const result = await service.getHighlights(makeUser());
      expect(result.map((item) => item.bookId)).toEqual([5, 6, 7]);
      expect(widgetRepo.getHighlightsFromOtherBooks).toHaveBeenCalledWith(42, [7], 5, 2, EMPTY_CONTENT_FILTER_RULES);
      expect(widgetRepo.getAnnotationByOffset).toHaveBeenCalledTimes(1);
    });

    it('returns up to three real, distinct annotation rows from the scoped pool', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([7]);
      widgetRepo.getAnnotationCount.mockResolvedValue(2);
      widgetRepo.getAnnotationByOffset.mockImplementation((_userId: number, _libraries: number[], offset: number) =>
        Promise.resolve({
          text: `Highlight ${offset}`,
          note: null,
          bookTitle: 'Book',
          bookId: offset + 1,
          hasCover: false,
          chapterTitle: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      );

      const result = await service.getHighlights(makeUser({ id: 42 }));
      expect(result).toHaveLength(2);
      expect(new Set(result.map((item) => item.text)).size).toBe(2);
      expect(widgetRepo.getAnnotationByOffset).toHaveBeenCalledTimes(2);
      for (const call of widgetRepo.getAnnotationByOffset.mock.calls) {
        expect(call[0]).toBe(42);
        expect(call[1]).toEqual([7]);
        expect(call[3]).toEqual(EMPTY_CONTENT_FILTER_RULES);
      }
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
      widgetRepo.countCompletedBooks.mockResolvedValue(5);

      const userWithOldGoal = makeUser({ settings: { dashboardConfig: { readingGoal: 12, widgets: [] } } });
      const userWithNewGoal = makeUser({ settings: { dashboardConfig: { readingGoal: 24, widgets: [] } } });

      const first = await service.getReadingGoal(userWithOldGoal);
      const second = await service.getReadingGoal(userWithNewGoal);

      expect(widgetRepo.countCompletedBooks).toHaveBeenCalledTimes(1);
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

    it('clearing a user cache invalidates both live and stale widgets', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      const user = makeUser();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getReadingStreak.mockResolvedValue({ currentStreak: 5, longestStreak: 10, lastSevenDays: [] });
      widgetRepo.getLibraryOverview.mockResolvedValue({
        totalBooks: 100,
        totalAuthors: 25,
        totalSeries: 10,
        totalStorageBytes: 1_000,
        booksAddedThisYear: 8,
      });

      await service.getReadingStreak(user);
      await service.getLibraryOverview(user);
      service.clearCacheForUser(user.id);
      await service.getReadingStreak(user);
      await service.getLibraryOverview(user);

      expect(widgetRepo.getReadingStreak).toHaveBeenCalledTimes(2);
      expect(widgetRepo.getLibraryOverview).toHaveBeenCalledTimes(2);
    });
  });

  describe("the reader's time zone", () => {
    const denver = () => makeUser({ id: 42, settings: { timezone: 'America/Denver' } });
    const highlight = {
      text: 'A line',
      note: null,
      bookTitle: 'Book',
      bookId: 5,
      hasCover: false,
      chapterTitle: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      // 7:58 PM on Sep 27 in Denver, already 01:58 on Sep 28 in UTC.
      vi.setSystemTime(new Date('2026-09-28T01:58:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('ends the reading rhythm on the local day, not the UTC one', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getReadingRhythmData.mockResolvedValue([
        { day: '2026-09-27', readingSeconds: 900 },
        { day: '2026-09-28', readingSeconds: 60 },
      ]);

      const result = await service.getReadingRhythm(denver());

      expect(widgetRepo.getReadingRhythmData).toHaveBeenCalledWith(42, [1], '2026-09-14', EMPTY_CONTENT_FILTER_RULES);
      expect(result.days).toHaveLength(14);
      expect(result.days[0]?.date).toBe('2026-09-14');
      expect(result.days.at(-1)).toEqual({ date: '2026-09-27', readingSeconds: 900 });
      expect(result.activeDays).toBe(1);
    });

    it('keeps UTC days for a reader with no time zone set', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getReadingRhythmData.mockResolvedValue([]);

      const result = await service.getReadingRhythm(makeUser());

      expect(result.days.at(-1)?.date).toBe('2026-09-28');
    });

    it('asks for the streak as of the local day', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getReadingStreak.mockResolvedValue({ currentStreak: 3, longestStreak: 3, lastSevenDays: [] });

      await service.getReadingStreak(denver());

      expect(widgetRepo.getReadingStreak).toHaveBeenCalledWith(42, [1], '2026-09-27', EMPTY_CONTENT_FILTER_RULES);
    });

    it('does not serve the previous local day from the live cache after local midnight', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getReadingRhythmData.mockResolvedValue([]);
      widgetRepo.getReadingStreak.mockResolvedValue({ currentStreak: 1, longestStreak: 1, lastSevenDays: [] });

      vi.setSystemTime(new Date('2026-09-28T05:59:00Z'));
      const beforeMidnight = await service.getReadingRhythm(denver());
      await service.getReadingStreak(denver());
      vi.setSystemTime(new Date('2026-09-28T06:01:00Z'));
      const afterMidnight = await service.getReadingRhythm(denver());
      await service.getReadingStreak(denver());

      expect(beforeMidnight.days.at(-1)?.date).toBe('2026-09-27');
      expect(afterMidnight.days.at(-1)?.date).toBe('2026-09-28');
      expect(widgetRepo.getReadingRhythmData).toHaveBeenCalledTimes(2);
      expect(widgetRepo.getReadingStreak).toHaveBeenNthCalledWith(2, 42, [1], '2026-09-28', EMPTY_CONTENT_FILTER_RULES);
    });

    it('does not answer a changed time zone from the old zone cache entry', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getReadingRhythmData.mockResolvedValue([]);

      await service.getReadingRhythm(makeUser({ id: 42 }));
      const afterChange = await service.getReadingRhythm(denver());

      expect(afterChange.days.at(-1)?.date).toBe('2026-09-27');
      expect(widgetRepo.getReadingRhythmData).toHaveBeenCalledTimes(2);
    });

    it("counts the reading goal for the reader's year on New Year's Eve", async () => {
      vi.setSystemTime(new Date('2027-01-01T03:00:00Z'));
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.countCompletedBooks.mockResolvedValue(44);

      const result = await service.getReadingGoal(denver());

      expect(result.year).toBe(2026);
      expect(widgetRepo.countCompletedBooks).toHaveBeenCalledWith(42, [1], '2026-01-01', '2027-01-01', EMPTY_CONTENT_FILTER_RULES);
    });

    it('projects the year from local windows', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getYearProjectionData.mockResolvedValue({
        booksCompletedYtd: 44,
        pagesReadLast30Days: 3_000,
        hoursReadLast30Days: 22.5,
        booksCompletedLast30Days: 2,
      });

      const result = await service.getYearProjection(denver());

      expect(widgetRepo.getYearProjectionData).toHaveBeenCalledWith(
        42,
        [1],
        {
          yearStartDay: '2026-01-01',
          nextYearStartDay: '2027-01-01',
          recentStartDay: '2026-08-29',
          recentEndDay: '2026-09-28',
          // Midnight on Aug 29 in Denver, which is on daylight time.
          recentStart: new Date('2026-08-29T06:00:00Z'),
        },
        EMPTY_CONTENT_FILTER_RULES,
      );
      // Sep 27 is day 270 of 2026.
      expect(result.daysRemaining).toBe(95);
      expect(result.booksCompletedYtd).toBe(44);
      expect(result.projectedPages).toBe(36_500);
    });

    it('scopes the monthly challenge to the local month', async () => {
      vi.setSystemTime(new Date('2026-10-01T03:00:00Z'));
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getChallengePatternData.mockResolvedValue({
        avgPageCount: 300,
        uniqueGenresLast6Months: 3,
        staleInProgressCount: 0,
        currentStreak: 2,
        maxStreakThisMonth: 3,
        topAuthorBookCount: 1,
        totalBooksRead: 20,
        pagesThisMonth: 200,
        shortBooksCompleted: 0,
        newGenresRead: 0,
        oldestInProgressFinished: false,
        newAuthorsRead: 0,
        pagesReadThisMonth: 200,
      });

      const result = await service.getMonthlyChallenge(denver());

      expect(result).toMatchObject({ month: 9, year: 2026 });
      expect(widgetRepo.getChallengePatternData).toHaveBeenCalledWith(
        42,
        [1],
        { start: new Date('2026-09-01T06:00:00Z'), startDay: '2026-09-01', today: '2026-09-30' },
        expect.any(Date),
        EMPTY_CONTENT_FILTER_RULES,
      );
    });

    it('seeds the highlight of the day with the local date', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getAnnotationCount.mockResolvedValue(97);
      widgetRepo.getAnnotationByOffset.mockResolvedValue(highlight);

      await service.getHighlightOfTheDay(denver());
      await service.getHighlights(denver());

      const expectedOffset = pickAnnotationIndex(42, '2026-09-27', 97);
      expect(expectedOffset).not.toBe(pickAnnotationIndex(42, '2026-09-28', 97));
      expect(widgetRepo.getAnnotationByOffset).toHaveBeenNthCalledWith(1, 42, [1], expectedOffset, EMPTY_CONTENT_FILTER_RULES);
      expect(widgetRepo.getAnnotationByOffset).toHaveBeenNthCalledWith(2, 42, [1], expectedOffset, EMPTY_CONTENT_FILTER_RULES);
    });

    it("counts books added since the start of the reader's year", async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getLibraryOverview.mockResolvedValue({
        totalBooks: 1,
        totalAuthors: 1,
        totalSeries: 0,
        totalStorageBytes: 1,
        booksAddedThisYear: 1,
      });

      await service.getLibraryOverview(denver());

      // Midnight on Jan 1 in Denver, which is on standard time.
      expect(widgetRepo.getLibraryOverview).toHaveBeenCalledWith([1], new Date('2026-01-01T07:00:00Z'), EMPTY_CONTENT_FILTER_RULES);
    });

    it('reads the reading DNA peak hour in the local zone', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.getReadingDnaData.mockResolvedValue({
        avgPageCount: 300,
        uniqueGenres: 4,
        totalBooks: 10,
        readingDaysRatio: 0.5,
        peakHour: 20,
        avgPagesPerHour: null,
      });

      await service.getReadingDna(denver());

      expect(widgetRepo.getReadingDnaData).toHaveBeenCalledWith(42, [1], expect.any(Date), 'America/Denver', EMPTY_CONTENT_FILTER_RULES);
    });
  });

  describe('getWidgets', () => {
    it('resolves several widgets in one call', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.countCompletedBooks.mockResolvedValue(4);
      widgetRepo.getLibraryOverview.mockResolvedValue({ totalBooks: 100, formats: [] });

      const response = await service.getWidgets(['reading-goal', 'library-overview'], makeUser());

      expect(response.items).toHaveLength(2);
      expect(response.items.map((item) => item.type)).toEqual(['reading-goal', 'library-overview']);
      expect(response.items.every((item) => item.failed)).toBe(false);
      expect(response.items[0]?.data).toMatchObject({ completedBooks: 4 });
    });

    it('isolates a failing widget so the rest of the dashboard still loads', async () => {
      const { service, widgetRepo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      widgetRepo.countCompletedBooks.mockRejectedValue(new Error('statement timeout'));
      widgetRepo.getLibraryOverview.mockResolvedValue({ totalBooks: 100, formats: [] });

      const response = await service.getWidgets(['reading-goal', 'library-overview'], makeUser());

      const readingGoal = response.items.find((item) => item.type === 'reading-goal');
      const libraryOverview = response.items.find((item) => item.type === 'library-overview');
      expect(readingGoal).toMatchObject({ failed: true, data: null });
      expect(libraryOverview?.failed).toBe(false);
      expect(libraryOverview?.data).toBeTruthy();
    });
  });
});
