import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AchievementService } from './achievement.service';
import { AchievementEventsService, ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED } from './achievement-events.service';

function makeRepo() {
  return {
    findAllAchievements: vi.fn().mockResolvedValue([]),
    findAchievementByKey: vi.fn().mockResolvedValue(null),
    findUserAchievements: vi.fn().mockResolvedValue([]),
    findUserEarnedKeys: vi.fn().mockResolvedValue(new Set()),
    findUserIsSuperuser: vi.fn().mockResolvedValue(false),
    award: vi.fn().mockResolvedValue({ id: 1, achievementKey: 'test', userId: 1, awardedAt: new Date(), contextJson: null }),
    upsertCatalogue: vi.fn().mockResolvedValue(undefined),
    countFinishedBooks: vi.fn().mockResolvedValue(0),
    sumPagesRead: vi.fn().mockResolvedValue(0),
    sumReadingHours: vi.fn().mockResolvedValue(0),
    countAccessibleBooks: vi.fn().mockResolvedValue(0),
    countAnnotations: vi.fn().mockResolvedValue(0),
    countDistinctGenresRead: vi.fn().mockResolvedValue(0),
    countDistinctLanguagesRead: vi.fn().mockResolvedValue(0),
    getCurrentStreak: vi.fn().mockResolvedValue(0),
    getMaxFinishedBookPageCount: vi.fn().mockResolvedValue(0),
    getMaxSessionMinutes: vi.fn().mockResolvedValue(0),
    countBooksFinishedInDateRange: vi.fn().mockResolvedValue(0),
    countCollections: vi.fn().mockResolvedValue(0),
    maxBooksPerAuthor: vi.fn().mockResolvedValue(0),
    countDistinctFormats: vi.fn().mockResolvedValue(0),
    countDistinctCenturiesRead: vi.fn().mockResolvedValue(0),
    countDistinctDecadesRead: vi.fn().mockResolvedValue(0),
    countFinishedBooksByMaxPageCount: vi.fn().mockResolvedValue(0),
    maxBooksPerGenre: vi.fn().mockResolvedValue(0),
    countAnnotationsWithNotes: vi.fn().mockResolvedValue(0),
    countAnnotationsOnDay: vi.fn().mockResolvedValue(0),
    countBooksFinishedInMonth: vi.fn().mockResolvedValue(0),
    countBooksFinishedInYear: vi.fn().mockResolvedValue(0),
    countDistinctEarnedCategories: vi.fn().mockResolvedValue(0),
    countDistinctSeasonsWithReading: vi.fn().mockResolvedValue(0),
  };
}

function makeRegistry(awards: { key: string; context: Record<string, unknown> | null }[] = []) {
  return {
    evaluate: vi.fn().mockResolvedValue(awards),
  };
}

function makeNotificationService() {
  return {
    notify: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AchievementService', () => {
  let service: AchievementService;
  let repo: ReturnType<typeof makeRepo>;
  let events: AchievementEventsService;
  let registry: ReturnType<typeof makeRegistry>;
  let notificationService: ReturnType<typeof makeNotificationService>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    events = new AchievementEventsService();
    registry = makeRegistry();
    notificationService = makeNotificationService();
    service = new AchievementService(repo as never, events, registry as never, notificationService as never);
  });

  describe('onModuleInit', () => {
    it('seeds the catalogue', async () => {
      await service.onModuleInit();
      expect(repo.upsertCatalogue).toHaveBeenCalledOnce();
    });
  });

  describe('getCatalogue', () => {
    it('returns categorized achievements with progress', async () => {
      repo.findAllAchievements.mockResolvedValue([
        {
          key: 'books_finished_1',
          groupKey: 'books_finished',
          tier: 1,
          category: 'reading',
          name: 'Ink Initiate',
          description: 'Finish 1 book',
          iconName: 'book-open',
          rarity: 'common',
          threshold: 1,
          hidden: false,
          sortOrder: 1,
        },
      ]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countFinishedBooks.mockResolvedValue(0);

      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);

      expect(result.categories).toHaveLength(5);
      expect(result.totalAvailable).toBe(1);
      expect(result.totalEarned).toBe(0);
      const readingCategory = result.categories.find((c) => c.key === 'reading');
      expect(readingCategory?.achievements).toHaveLength(1);
      expect(readingCategory?.achievements[0]?.earned).toBe(false);
    });

    it('marks earned achievements correctly', async () => {
      repo.findAllAchievements.mockResolvedValue([
        {
          key: 'books_finished_1',
          groupKey: 'books_finished',
          tier: 1,
          category: 'reading',
          name: 'Ink Initiate',
          description: 'Finish 1',
          iconName: 'book-open',
          rarity: 'common',
          threshold: 1,
          hidden: false,
          sortOrder: 1,
        },
      ]);
      repo.findUserAchievements.mockResolvedValue([
        { achievementKey: 'books_finished_1', awardedAt: new Date('2026-01-01'), contextJson: { bookId: 1 } },
      ]);

      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'reading')?.achievements[0];
      expect(item?.earned).toBe(true);
      expect(item?.awardedAt).toBeTruthy();
    });

    it('hides name and description for hidden unearned achievements', async () => {
      repo.findAllAchievements.mockResolvedValue([
        {
          key: 'secret_1',
          groupKey: null,
          tier: null,
          category: 'reading',
          name: 'Secret',
          description: 'Hidden thing',
          iconName: 'gift',
          rarity: 'epic',
          threshold: null,
          hidden: true,
          sortOrder: 99,
        },
      ]);
      repo.findUserAchievements.mockResolvedValue([]);

      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'reading')?.achievements[0];
      expect(item?.name).toBe('???');
      expect(item?.description).toBe('Secret Achievement');
      expect(item?.iconName).toBe('help-circle');
    });
  });

  describe('getCatalogue - single badge progress', () => {
    const marathonerRow = {
      key: 'marathoner',
      groupKey: null,
      tier: null,
      category: 'reading',
      name: 'Marathoner',
      description: 'Complete a reading session of 90 minutes or more',
      iconName: 'timer',
      rarity: 'rare',
      threshold: 90,
      hidden: false,
      sortOrder: 13,
    };

    it('returns progress for marathoner based on max session minutes', async () => {
      repo.findAllAchievements.mockResolvedValue([marathonerRow]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.getMaxSessionMinutes.mockResolvedValue(45);

      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'reading')?.achievements.find((a) => a.key === 'marathoner');
      expect(item?.currentProgress).toBe(45);
      expect(repo.getMaxSessionMinutes).toHaveBeenCalledWith(1);
    });

    it('skips progress computation for earned single-badge achievements', async () => {
      repo.findAllAchievements.mockResolvedValue([marathonerRow]);
      repo.findUserAchievements.mockResolvedValue([{ achievementKey: 'marathoner', awardedAt: new Date('2026-01-01'), contextJson: null }]);
      repo.getMaxSessionMinutes.mockResolvedValue(120);

      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'reading')?.achievements.find((a) => a.key === 'marathoner');
      expect(item?.currentProgress).toBeNull();
      expect(repo.getMaxSessionMinutes).not.toHaveBeenCalled();
    });

    it('returns null progress for badges with no trackable progress query', async () => {
      const sprintRow = {
        key: 'sprint',
        groupKey: null,
        tier: null,
        category: 'reading',
        name: 'Sprint',
        description: 'Finish a book in a single day',
        iconName: 'zap',
        rarity: 'epic',
        threshold: null,
        hidden: false,
        sortOrder: 18,
      };
      repo.findAllAchievements.mockResolvedValue([sprintRow]);
      repo.findUserAchievements.mockResolvedValue([]);

      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'reading')?.achievements.find((a) => a.key === 'sprint');
      expect(item?.currentProgress).toBeNull();
    });

    it('returns curator progress from collection count', async () => {
      const curatorRow = {
        key: 'curator',
        groupKey: null,
        tier: null,
        category: 'library',
        name: 'Curator',
        description: 'Create 10 or more collections',
        iconName: 'folder-open',
        rarity: 'rare',
        threshold: 10,
        hidden: false,
        sortOrder: 10,
      };
      repo.findAllAchievements.mockResolvedValue([curatorRow]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countCollections.mockResolvedValue(6);

      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'library')?.achievements.find((a) => a.key === 'curator');
      expect(item?.currentProgress).toBe(6);
      expect(repo.countCollections).toHaveBeenCalledWith(1);
    });

    it('returns author_deep_dive progress from max books per author', async () => {
      const authorRow = {
        key: 'author_deep_dive',
        groupKey: null,
        tier: null,
        category: 'exploration',
        name: 'Author Deep Dive',
        description: 'Read 5 or more books by the same author',
        iconName: 'user',
        rarity: 'rare',
        threshold: 5,
        hidden: false,
        sortOrder: 13,
      };
      repo.findAllAchievements.mockResolvedValue([authorRow]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.maxBooksPerAuthor.mockResolvedValue(3);

      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'exploration')?.achievements.find((a) => a.key === 'author_deep_dive');
      expect(item?.currentProgress).toBe(3);
    });

    function makeSingleBadgeRow(key: string, category: string) {
      return {
        key,
        groupKey: null,
        tier: null,
        category,
        name: key,
        description: key,
        iconName: 'star',
        rarity: 'common',
        threshold: 1,
        hidden: false,
        sortOrder: 1,
      };
    }

    it('returns multi_format progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeSingleBadgeRow('multi_format', 'library')]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countDistinctFormats.mockResolvedValue(2);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'library')?.achievements.find((a) => a.key === 'multi_format');
      expect(item?.currentProgress).toBe(2);
    });

    it('returns century_span progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeSingleBadgeRow('century_span', 'exploration')]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countDistinctCenturiesRead.mockResolvedValue(3);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'exploration')?.achievements.find((a) => a.key === 'century_span');
      expect(item?.currentProgress).toBe(3);
    });

    it('returns decade_sampler progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeSingleBadgeRow('decade_sampler', 'exploration')]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countDistinctDecadesRead.mockResolvedValue(4);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'exploration')?.achievements.find((a) => a.key === 'decade_sampler');
      expect(item?.currentProgress).toBe(4);
    });

    it('returns short_story_fan progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeSingleBadgeRow('short_story_fan', 'exploration')]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countFinishedBooksByMaxPageCount.mockResolvedValue(3);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'exploration')?.achievements.find((a) => a.key === 'short_story_fan');
      expect(item?.currentProgress).toBe(3);
    });

    it('returns genre_devotee progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeSingleBadgeRow('genre_devotee', 'exploration')]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.maxBooksPerGenre.mockResolvedValue(7);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'exploration')?.achievements.find((a) => a.key === 'genre_devotee');
      expect(item?.currentProgress).toBe(7);
    });

    it('returns note_keeper progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeSingleBadgeRow('note_keeper', 'library')]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countAnnotationsWithNotes.mockResolvedValue(15);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'library')?.achievements.find((a) => a.key === 'note_keeper');
      expect(item?.currentProgress).toBe(15);
    });

    it('returns deep_dive_session progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeSingleBadgeRow('deep_dive_session', 'library')]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countAnnotationsOnDay.mockResolvedValue(5);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'library')?.achievements.find((a) => a.key === 'deep_dive_session');
      expect(item?.currentProgress).toBe(5);
    });

    it('returns monthly_reader_2 progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeSingleBadgeRow('monthly_reader_2', 'reading')]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countBooksFinishedInMonth.mockResolvedValue(8);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'reading')?.achievements.find((a) => a.key === 'monthly_reader_2');
      expect(item?.currentProgress).toBe(8);
    });

    it('returns yearly_finisher_12 progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeSingleBadgeRow('yearly_finisher_12', 'dedication')]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countBooksFinishedInYear.mockResolvedValue(9);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'dedication')?.achievements.find((a) => a.key === 'yearly_finisher_12');
      expect(item?.currentProgress).toBe(9);
    });

    it('returns category_sweeper progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeSingleBadgeRow('category_sweeper', 'dedication')]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countDistinctEarnedCategories.mockResolvedValue(3);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'dedication')?.achievements.find((a) => a.key === 'category_sweeper');
      expect(item?.currentProgress).toBe(3);
    });

    it('returns seasonal_reader progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeSingleBadgeRow('seasonal_reader', 'dedication')]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countDistinctSeasonsWithReading.mockResolvedValue(2);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'dedication')?.achievements.find((a) => a.key === 'seasonal_reader');
      expect(item?.currentProgress).toBe(2);
    });

    it('returns null progress for consistent_reader', async () => {
      repo.findAllAchievements.mockResolvedValue([makeSingleBadgeRow('consistent_reader', 'dedication')]);
      repo.findUserAchievements.mockResolvedValue([]);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'dedication')?.achievements.find((a) => a.key === 'consistent_reader');
      expect(item?.currentProgress).toBeNull();
    });

    it('returns null progress for weekend_rhythm', async () => {
      repo.findAllAchievements.mockResolvedValue([makeSingleBadgeRow('weekend_rhythm', 'dedication')]);
      repo.findUserAchievements.mockResolvedValue([]);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'dedication')?.achievements.find((a) => a.key === 'weekend_rhythm');
      expect(item?.currentProgress).toBeNull();
    });

    it('returns null progress for unknown badge key', async () => {
      repo.findAllAchievements.mockResolvedValue([makeSingleBadgeRow('totally_unknown_badge', 'dedication')]);
      repo.findUserAchievements.mockResolvedValue([]);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'dedication')?.achievements.find((a) => a.key === 'totally_unknown_badge');
      expect(item?.currentProgress).toBeNull();
    });
  });

  describe('getCatalogue - tiered group progress', () => {
    function makeTieredRow(key: string, groupKey: string, tier: number, category: string, threshold: number) {
      return {
        key,
        groupKey,
        tier,
        category,
        name: key,
        description: key,
        iconName: 'star',
        rarity: 'common',
        threshold,
        hidden: false,
        sortOrder: tier,
      };
    }

    it('returns books_finished group progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeTieredRow('books_finished_1', 'books_finished', 1, 'reading', 1)]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countFinishedBooks.mockResolvedValue(5);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'reading')?.achievements.find((a) => a.key === 'books_finished_1');
      expect(item?.currentProgress).toBe(5);
    });

    it('returns pages_read group progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeTieredRow('pages_read_1', 'pages_read', 1, 'reading', 1000)]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.sumPagesRead.mockResolvedValue(750);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'reading')?.achievements.find((a) => a.key === 'pages_read_1');
      expect(item?.currentProgress).toBe(750);
    });

    it('returns long_book group progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeTieredRow('long_book_1', 'long_book', 1, 'reading', 300)]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.getMaxFinishedBookPageCount.mockResolvedValue(540);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'reading')?.achievements.find((a) => a.key === 'long_book_1');
      expect(item?.currentProgress).toBe(540);
    });

    it('returns hours_read group progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeTieredRow('hours_read_1', 'hours_read', 1, 'reading', 10)]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.sumReadingHours.mockResolvedValue(7);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'reading')?.achievements.find((a) => a.key === 'hours_read_1');
      expect(item?.currentProgress).toBe(7);
    });

    it('returns library_builder group progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeTieredRow('library_builder_1', 'library_builder', 1, 'library', 50)]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countAccessibleBooks.mockResolvedValue(30);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'library')?.achievements.find((a) => a.key === 'library_builder_1');
      expect(item?.currentProgress).toBe(30);
    });

    it('returns annotator group progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeTieredRow('annotator_1', 'annotator', 1, 'library', 10)]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countAnnotations.mockResolvedValue(4);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'library')?.achievements.find((a) => a.key === 'annotator_1');
      expect(item?.currentProgress).toBe(4);
    });

    it('returns genre_explorer group progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeTieredRow('genre_explorer_1', 'genre_explorer', 1, 'exploration', 5)]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countDistinctGenresRead.mockResolvedValue(3);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'exploration')?.achievements.find((a) => a.key === 'genre_explorer_1');
      expect(item?.currentProgress).toBe(3);
    });

    it('returns polyglot group progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeTieredRow('polyglot_1', 'polyglot', 1, 'exploration', 3)]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.countDistinctLanguagesRead.mockResolvedValue(2);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'exploration')?.achievements.find((a) => a.key === 'polyglot_1');
      expect(item?.currentProgress).toBe(2);
    });

    it('returns streak group progress', async () => {
      repo.findAllAchievements.mockResolvedValue([makeTieredRow('streak_1', 'streak', 1, 'dedication', 7)]);
      repo.findUserAchievements.mockResolvedValue([]);
      repo.getCurrentStreak.mockResolvedValue(5);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'dedication')?.achievements.find((a) => a.key === 'streak_1');
      expect(item?.currentProgress).toBe(5);
    });

    it('returns null progress for unknown group key', async () => {
      repo.findAllAchievements.mockResolvedValue([makeTieredRow('unknown_group_badge', 'totally_unknown_group', 1, 'reading', 100)]);
      repo.findUserAchievements.mockResolvedValue([]);
      const result = await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      const item = result.categories.find((c) => c.key === 'reading')?.achievements.find((a) => a.key === 'unknown_group_badge');
      expect(item?.currentProgress).toBeNull();
    });

    it('skips progress for all earned tiers in a group', async () => {
      repo.findAllAchievements.mockResolvedValue([
        makeTieredRow('books_finished_1', 'books_finished', 1, 'reading', 1),
        makeTieredRow('books_finished_2', 'books_finished', 2, 'reading', 10),
      ]);
      repo.findUserAchievements.mockResolvedValue([
        { achievementKey: 'books_finished_1', awardedAt: new Date(), contextJson: null },
        { achievementKey: 'books_finished_2', awardedAt: new Date(), contextJson: null },
      ]);
      await service.getCatalogue({ id: 1, isSuperuser: false } as never);
      expect(repo.countFinishedBooks).not.toHaveBeenCalled();
    });
  });

  describe('handleEvent', () => {
    it('evaluates and awards achievements', async () => {
      registry.evaluate.mockResolvedValueOnce([{ key: 'books_finished_1', context: { count: 1 } }]).mockResolvedValueOnce([]);
      repo.findAchievementByKey.mockResolvedValue({ key: 'books_finished_1', name: 'Ink Initiate', rarity: 'common', iconName: 'book-open' });

      await service.handleEvent(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, { userId: 1, bookId: 5, newStatus: 'read' });

      expect(registry.evaluate).toHaveBeenCalledTimes(2);
      expect(repo.award).toHaveBeenCalledWith(1, 'books_finished_1', { count: 1 });
      expect(notificationService.notify).toHaveBeenCalledOnce();
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Ink Initiate',
          meta: expect.objectContaining({
            achievementKey: 'books_finished_1',
            achievementName: 'Ink Initiate',
            rarity: 'common',
          }),
        }),
      );
    });

    it('does not call evaluateMetaBadges when no achievement is awarded', async () => {
      registry.evaluate.mockResolvedValue([]);

      await service.handleEvent(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, { userId: 1, bookId: 5, newStatus: 'read' });

      expect(registry.evaluate).toHaveBeenCalledOnce();
      expect(repo.award).not.toHaveBeenCalled();
    });

    it('skips already earned achievements', async () => {
      repo.findUserEarnedKeys.mockResolvedValue(new Set(['books_finished_1']));
      registry.evaluate.mockResolvedValue([{ key: 'books_finished_1', context: { count: 1 } }]);

      await service.handleEvent(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, { userId: 1, bookId: 5, newStatus: 'read' });

      expect(repo.award).not.toHaveBeenCalled();
      expect(notificationService.notify).not.toHaveBeenCalled();
    });

    it('does nothing when no userId in payload', async () => {
      await service.handleEvent(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, { bookId: 5 });
      expect(registry.evaluate).not.toHaveBeenCalled();
    });

    it('handles errors gracefully', async () => {
      registry.evaluate.mockRejectedValue(new Error('DB timeout'));
      await expect(service.handleEvent(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, { userId: 1, bookId: 5, newStatus: 'read' })).resolves.toBeUndefined();
    });
  });

  describe('onModuleDestroy', () => {
    it('removes all registered event listeners', async () => {
      await service.onModuleInit();
      const removeListenerSpy = vi.spyOn(events, 'removeListener');
      service.onModuleDestroy();
      expect(removeListenerSpy).toHaveBeenCalledTimes(7);
    });
  });
});
