import type { RequestUser } from '../../common/types/request-user';
import { DashboardController } from './dashboard.controller';
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

function makeController() {
  const dashboardService = {
    getScroller: vi.fn(),
  };
  const widgetService = {
    getReadingGoal: vi.fn(),
    getCurrentlyReading: vi.fn(),
    getReadingStreak: vi.fn(),
    getLibraryOverview: vi.fn(),
    getHighlightOfTheDay: vi.fn(),
    getMonthlyChallenge: vi.fn(),
    getYearProjection: vi.fn(),
    getNeglectedGems: vi.fn(),
    getReadingDna: vi.fn(),
    getLongWait: vi.fn(),
    getDiversityScore: vi.fn(),
    getReadingRhythm: vi.fn(),
  };

  const controller = new DashboardController(dashboardService as never, widgetService as never);
  return { controller, dashboardService, widgetService };
}

describe('DashboardController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scroller endpoint', () => {
    it('getScroller delegates to dashboardService with the provided scroller type and params', async () => {
      const { controller, dashboardService } = makeController();
      const user = makeUser({ id: 7 });
      const mockResult = [{ id: 101 }];
      dashboardService.getScroller.mockResolvedValue(mockResult);

      const result = await controller.getScroller('up-next-in-series', 33, 0, user);

      expect(dashboardService.getScroller).toHaveBeenCalledWith('up-next-in-series', user, 33, 0);
      expect(result).toEqual(mockResult);
    });
  });

  describe('widget endpoints', () => {
    it('getReadingGoal delegates to widgetService', async () => {
      const { controller, widgetService } = makeController();
      const user = makeUser();
      const mockResult = { goalBooks: 12, completedBooks: 5, year: 2025 };
      widgetService.getReadingGoal.mockResolvedValue(mockResult);

      const result = await controller.getReadingGoal(user);

      expect(widgetService.getReadingGoal).toHaveBeenCalledWith(user);
      expect(result).toEqual(mockResult);
    });

    it('getCurrentlyReading delegates to widgetService', async () => {
      const { controller, widgetService } = makeController();
      const user = makeUser({ id: 7 });
      const mockResult = { books: [] };
      widgetService.getCurrentlyReading.mockResolvedValue(mockResult);

      const result = await controller.getCurrentlyReading(user);

      expect(widgetService.getCurrentlyReading).toHaveBeenCalledWith(user);
      expect(result).toEqual(mockResult);
    });

    it('getReadingStreak delegates to widgetService', async () => {
      const { controller, widgetService } = makeController();
      const user = makeUser({ id: 99 });
      const mockResult = {
        currentStreak: 3,
        longestStreak: 10,
        lastSevenDays: [false, false, true, true, true, false, false],
      };
      widgetService.getReadingStreak.mockResolvedValue(mockResult);

      const result = await controller.getReadingStreak(user);

      expect(widgetService.getReadingStreak).toHaveBeenCalledWith(user);
      expect(result).toEqual(mockResult);
    });

    it('getLibraryOverview delegates to widgetService', async () => {
      const { controller, widgetService } = makeController();
      const user = makeUser({ id: 55 });
      const mockResult = {
        totalBooks: 100,
        totalAuthors: 40,
        totalSeries: 10,
        totalStorageBytes: 1234567890,
        booksAddedThisYear: 15,
      };
      widgetService.getLibraryOverview.mockResolvedValue(mockResult);

      const result = await controller.getLibraryOverview(user);

      expect(widgetService.getLibraryOverview).toHaveBeenCalledWith(user);
      expect(result).toEqual(mockResult);
    });

    it.each([
      ['getHighlightOfTheDay', { text: 'quote', bookId: 1 }],
      ['getMonthlyChallenge', { challengeType: 'page-milestone', progress: 0, target: 500 }],
      ['getYearProjection', { projectedBooks: 30, daysRemaining: 200 }],
      ['getNeglectedGems', { gems: [] }],
      ['getReadingDna', { archetype: 'Reader', booksAnalyzed: 10 }],
      ['getLongWait', null],
      ['getDiversityScore', { score: 50, label: 'Curious Explorer' }],
      ['getReadingRhythm', { days: [], consistencyPercent: 0 }],
    ] as const)('%s delegates to widgetService', async (method, mockResult) => {
      const { controller, widgetService } = makeController();
      const user = makeUser();
      (widgetService[method] as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const result = await (controller as Record<string, (u: RequestUser) => Promise<unknown>>)[method]!(user);

      expect(widgetService[method]).toHaveBeenCalledWith(user);
      expect(result).toEqual(mockResult);
    });
  });
});
