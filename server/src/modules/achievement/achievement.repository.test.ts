import { describe, it, expect, vi } from 'vitest';
import { AchievementRepository } from './achievement.repository';

function flattenSql(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenSql).join(' ');
  if (!value || typeof value !== 'object') return '';

  const record = value as { queryChunks?: unknown[]; value?: unknown };
  return [flattenSql(record.value), flattenSql(record.queryChunks)].join(' ');
}

function makeSelectChain(resolvedValue: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['from', 'where', 'orderBy', 'limit', 'groupBy', 'innerJoin', 'leftJoin', 'having', 'as', '$dynamic'];
  methods.forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  (chain as unknown as { then: (resolve: (v: unknown) => unknown) => Promise<unknown> }).then = (resolve) =>
    Promise.resolve(resolvedValue).then(resolve);
  return chain;
}

function makeInsertChain(resolvedValue: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['values', 'onConflictDoUpdate', 'onConflictDoNothing', 'returning'];
  methods.forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  (chain as unknown as { then: (resolve: (v: unknown) => unknown) => Promise<unknown> }).then = (resolve) =>
    Promise.resolve(resolvedValue).then(resolve);
  return chain;
}

function makeDeleteChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain['where'] = vi.fn().mockReturnValue(chain);
  (chain as unknown as { then: (resolve: (v: unknown) => unknown) => Promise<unknown> }).then = (resolve) => Promise.resolve(undefined).then(resolve);
  return chain;
}

function makeRepo(db: Record<string, unknown> = {}) {
  return new AchievementRepository(db as never);
}

describe('AchievementRepository', () => {
  describe('upsertCatalogue', () => {
    it('inserts seed rows and deletes stale ones when seed is non-empty', async () => {
      const insertChain = makeInsertChain(undefined);
      const deleteChain = makeDeleteChain();
      const tx = {
        insert: vi.fn().mockReturnValue(insertChain),
        delete: vi.fn().mockReturnValue(deleteChain),
      };
      const db = {
        transaction: vi.fn().mockImplementation(async (cb: (arg: typeof tx) => Promise<void>) => cb(tx)),
      };
      const repo = makeRepo(db as never);

      await repo.upsertCatalogue([
        {
          key: 'books_1',
          category: 'reading',
          name: 'First Book',
          description: 'Read one book',
          iconName: 'book',
          rarity: 'common',
          sortOrder: 1,
        },
      ]);

      expect(tx.insert).toHaveBeenCalledOnce();
      expect(insertChain.values).toHaveBeenCalledOnce();
      expect(insertChain.onConflictDoUpdate).toHaveBeenCalledOnce();
      expect(tx.delete).toHaveBeenCalledOnce();
      expect(deleteChain.where).toHaveBeenCalledOnce();
    });

    it('deletes all achievements when seed is empty', async () => {
      const deleteChain = makeDeleteChain();
      const tx = {
        insert: vi.fn(),
        delete: vi.fn().mockReturnValue(deleteChain),
      };
      const db = {
        transaction: vi.fn().mockImplementation(async (cb: (arg: typeof tx) => Promise<void>) => cb(tx)),
      };
      const repo = makeRepo(db as never);

      await repo.upsertCatalogue([]);

      expect(tx.insert).not.toHaveBeenCalled();
      expect(tx.delete).toHaveBeenCalledOnce();
      expect(deleteChain.where).not.toHaveBeenCalled();
    });
  });

  describe('findAchievementByKey', () => {
    it('returns the achievement when found', async () => {
      const row = { key: 'books_1', category: 'reading', name: 'First Book', description: '', iconName: 'book', rarity: 'common', sortOrder: 1 };
      const chain = makeSelectChain([row]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.findAchievementByKey('books_1');

      expect(result).toEqual(row);
      expect(chain.limit).toHaveBeenCalledWith(1);
    });

    it('returns null when not found', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.findAchievementByKey('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findAllAchievements', () => {
    it('returns all achievements ordered by category and sortOrder', async () => {
      const rows = [
        { key: 'books_1', category: 'reading', sortOrder: 1 },
        { key: 'lib_1', category: 'library', sortOrder: 1 },
      ];
      const chain = makeSelectChain(rows);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.findAllAchievements();

      expect(result).toEqual(rows);
      expect(chain.orderBy).toHaveBeenCalledOnce();
    });

    it('returns empty array when no achievements exist', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.findAllAchievements();

      expect(result).toEqual([]);
    });
  });

  describe('findUserAchievements', () => {
    it('returns user achievements ordered descending by awardedAt', async () => {
      const rows = [
        { id: 2, userId: 1, achievementKey: 'books_5', awardedAt: new Date('2024-02-01'), contextJson: null },
        { id: 1, userId: 1, achievementKey: 'books_1', awardedAt: new Date('2024-01-01'), contextJson: null },
      ];
      const chain = makeSelectChain(rows);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.findUserAchievements(1);

      expect(result).toEqual(rows);
      expect(chain.where).toHaveBeenCalledOnce();
      expect(chain.orderBy).toHaveBeenCalledOnce();
    });

    it('returns empty array when user has no achievements', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.findUserAchievements(99);

      expect(result).toEqual([]);
    });
  });

  describe('findUserEarnedKeys', () => {
    it('returns a Set of achievement keys for the user', async () => {
      const chain = makeSelectChain([{ achievementKey: 'books_1' }, { achievementKey: 'books_5' }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.findUserEarnedKeys(1);

      expect(result).toBeInstanceOf(Set);
      expect(result.has('books_1')).toBe(true);
      expect(result.has('books_5')).toBe(true);
      expect(result.size).toBe(2);
    });

    it('returns empty Set when user has no earned achievements', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.findUserEarnedKeys(42);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });
  });

  describe('hasAchievement', () => {
    it('returns true when user has the achievement', async () => {
      const chain = makeSelectChain([{ key: 'books_1' }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasAchievement(1, 'books_1');

      expect(result).toBe(true);
    });

    it('returns false when user does not have the achievement', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasAchievement(1, 'books_1');

      expect(result).toBe(false);
    });
  });

  describe('award', () => {
    it('returns the awarded row on success', async () => {
      const row = { id: 1, userId: 1, achievementKey: 'books_1', awardedAt: new Date(), contextJson: null };
      const insertChain = makeInsertChain([row]);
      const db = { insert: vi.fn().mockReturnValue(insertChain) };
      const repo = makeRepo(db);

      const result = await repo.award(1, 'books_1', null);

      expect(result).toEqual(row);
      expect(insertChain.onConflictDoNothing).toHaveBeenCalledOnce();
      expect(insertChain.returning).toHaveBeenCalledOnce();
    });

    it('returns null when a conflict prevents insertion (already awarded)', async () => {
      const insertChain = makeInsertChain([]);
      const db = { insert: vi.fn().mockReturnValue(insertChain) };
      const repo = makeRepo(db);

      const result = await repo.award(1, 'books_1', { bookCount: 1 });

      expect(result).toBeNull();
    });
  });

  describe('findUserIsSuperuser', () => {
    it('returns true for superuser', async () => {
      const chain = makeSelectChain([{ isSuperuser: true }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.findUserIsSuperuser(1);

      expect(result).toBe(true);
    });

    it('returns false for non-superuser', async () => {
      const chain = makeSelectChain([{ isSuperuser: false }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.findUserIsSuperuser(2);

      expect(result).toBe(false);
    });

    it('returns false when user not found', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.findUserIsSuperuser(999);

      expect(result).toBe(false);
    });
  });

  describe('countFinishedBooks', () => {
    it('returns the count of books with status read', async () => {
      const chain = makeSelectChain([{ value: 5 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countFinishedBooks(1);

      expect(result).toBe(5);
    });

    it('returns 0 when no books finished', async () => {
      const chain = makeSelectChain([{ value: 0 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countFinishedBooks(1);

      expect(result).toBe(0);
    });
  });

  describe('sumPagesRead', () => {
    it('returns floor of computed pages sum', async () => {
      const chain = makeSelectChain([{ value: 1234.7 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.sumPagesRead(1);

      expect(result).toBe(1234);
    });

    it('returns 0 when result is null', async () => {
      const chain = makeSelectChain([{ value: null }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.sumPagesRead(1);

      expect(result).toBe(0);
    });

    it('returns 0 when no sessions', async () => {
      const chain = makeSelectChain([{}]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.sumPagesRead(1);

      expect(result).toBe(0);
    });
  });

  describe('sumReadingHours', () => {
    it('returns floor of total seconds divided by 3600', async () => {
      const chain = makeSelectChain([{ value: '7200' }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.sumReadingHours(1);

      expect(result).toBe(2);
    });

    it('floors partial hours', async () => {
      const chain = makeSelectChain([{ value: '5400' }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.sumReadingHours(1);

      expect(result).toBe(1);
    });

    it('returns 0 when no reading sessions', async () => {
      const chain = makeSelectChain([{ value: null }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.sumReadingHours(1);

      expect(result).toBe(0);
    });
  });

  describe('countAnnotations', () => {
    it('returns annotation count for user', async () => {
      const chain = makeSelectChain([{ value: 12 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countAnnotations(1);

      expect(result).toBe(12);
    });

    it('returns 0 when no annotations', async () => {
      const chain = makeSelectChain([{ value: 0 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countAnnotations(1);

      expect(result).toBe(0);
    });
  });

  describe('countAccessibleBooks', () => {
    it('counts all present books for superuser without join', async () => {
      const chain = makeSelectChain([{ value: 100 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countAccessibleBooks(1, true);

      expect(result).toBe(100);
      expect(chain.innerJoin).not.toHaveBeenCalled();
    });

    it('counts books via library access join for regular user', async () => {
      const chain = makeSelectChain([{ value: 25 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countAccessibleBooks(1, false);

      expect(result).toBe(25);
      expect(chain.innerJoin).toHaveBeenCalledOnce();
    });
  });

  describe('countDistinctFormats', () => {
    it('counts formats without join for superuser', async () => {
      const chain = makeSelectChain([{ value: 3 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctFormats(1, true);

      expect(result).toBe(3);
      expect(chain.innerJoin).not.toHaveBeenCalled();
    });

    it('counts formats via library join for regular user', async () => {
      const chain = makeSelectChain([{ value: 2 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctFormats(1, false);

      expect(result).toBe(2);
      expect(chain.innerJoin).toHaveBeenCalled();
    });
  });

  describe('countCollections', () => {
    it('returns collection count for user', async () => {
      const chain = makeSelectChain([{ value: 4 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countCollections(1);

      expect(result).toBe(4);
    });
  });

  describe('countDistinctGenresRead', () => {
    it('returns distinct genre count', async () => {
      const chain = makeSelectChain([{ value: 7 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctGenresRead(1);

      expect(result).toBe(7);
    });
  });

  describe('countDistinctLanguagesRead', () => {
    it('returns distinct language count', async () => {
      const chain = makeSelectChain([{ value: 3 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctLanguagesRead(1);

      expect(result).toBe(3);
    });
  });

  describe('countDistinctCenturiesRead', () => {
    it('returns number of distinct centuries from grouped rows', async () => {
      const chain = makeSelectChain([{ century: 19 }, { century: 20 }, { century: 21 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctCenturiesRead(1);

      expect(result).toBe(3);
    });

    it('returns 0 when no books read with published year', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctCenturiesRead(1);

      expect(result).toBe(0);
    });
  });

  describe('hasCompletedSeries', () => {
    it('returns true when a complete series exists', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{}] }) };
      const repo = makeRepo(db);

      const result = await repo.hasCompletedSeries(7);

      expect(result).toBe(true);
      const sqlText = flattenSql(db.execute.mock.calls[0][0]);
      expect(sqlText).toContain('bm.series_id');
    });

    it('returns false when no complete series exists', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
      const repo = makeRepo(db);

      const result = await repo.hasCompletedSeries(7);

      expect(result).toBe(false);
    });
  });

  describe('maxBooksPerAuthor', () => {
    it('returns the highest count for a single author', async () => {
      const chain = makeSelectChain([{ cnt: 8 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.maxBooksPerAuthor(1);

      expect(result).toBe(8);
    });

    it('returns 0 when user has not finished any books', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.maxBooksPerAuthor(1);

      expect(result).toBe(0);
    });
  });

  describe('getBookPageCount', () => {
    it('returns pageCount when found', async () => {
      const chain = makeSelectChain([{ pageCount: 350 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getBookPageCount(42);

      expect(result).toBe(350);
    });

    it('returns null when book metadata not found', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getBookPageCount(999);

      expect(result).toBeNull();
    });

    it('returns null when pageCount is null', async () => {
      const chain = makeSelectChain([{ pageCount: null }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getBookPageCount(1);

      expect(result).toBeNull();
    });
  });

  describe('getBookPublishedYear', () => {
    it('returns publishedYear when found', async () => {
      const chain = makeSelectChain([{ publishedYear: 1984 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getBookPublishedYear(1);

      expect(result).toBe(1984);
    });

    it('returns null when not found', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getBookPublishedYear(1);

      expect(result).toBeNull();
    });
  });

  describe('getBookTitle', () => {
    it('returns title when found', async () => {
      const chain = makeSelectChain([{ title: 'Dune' }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getBookTitle(1);

      expect(result).toBe('Dune');
    });

    it('returns null when not found', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getBookTitle(1);

      expect(result).toBeNull();
    });
  });

  describe('getCurrentStreak', () => {
    it('returns the streak length from execute result', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ streak_length: '7' }] }) };
      const repo = makeRepo(db);

      const result = await repo.getCurrentStreak(1);

      expect(result).toBe(7);
    });

    it('returns 0 when no streak rows returned', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
      const repo = makeRepo(db);

      const result = await repo.getCurrentStreak(1);

      expect(result).toBe(0);
    });
  });

  describe('countDistinctMonthsWithReading', () => {
    it('returns count of distinct months with reading', async () => {
      const chain = makeSelectChain([{ month: '1' }, { month: '3' }, { month: '7' }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctMonthsWithReading(1, 2024);

      expect(result).toBe(3);
    });

    it('returns 0 when no reading in the year', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctMonthsWithReading(1, 2020);

      expect(result).toBe(0);
    });
  });

  describe('wasBookAbandonedBefore', () => {
    it('returns true when gap between startedAt and finishedAt exceeds monthsAgo', async () => {
      const startedAt = new Date('2023-01-01');
      const finishedAt = new Date('2023-07-01');
      const chain = makeSelectChain([{ startedAt, finishedAt }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.wasBookAbandonedBefore(1, 5, 3);

      expect(result).toBe(true);
    });

    it('returns false when gap is less than monthsAgo', async () => {
      const startedAt = new Date('2023-01-01');
      const finishedAt = new Date('2023-02-01');
      const chain = makeSelectChain([{ startedAt, finishedAt }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.wasBookAbandonedBefore(1, 5, 6);

      expect(result).toBe(false);
    });

    it('returns false when startedAt is missing', async () => {
      const chain = makeSelectChain([{ startedAt: null, finishedAt: new Date() }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.wasBookAbandonedBefore(1, 5, 1);

      expect(result).toBe(false);
    });

    it('returns false when finishedAt is missing', async () => {
      const chain = makeSelectChain([{ startedAt: new Date(), finishedAt: null }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.wasBookAbandonedBefore(1, 5, 1);

      expect(result).toBe(false);
    });

    it('returns false when no row found', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.wasBookAbandonedBefore(1, 5, 1);

      expect(result).toBe(false);
    });
  });

  describe('countBooksFinishedInDateRange', () => {
    it('returns the count within the range', async () => {
      const chain = makeSelectChain([{ value: 3 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);
      const start = new Date('2024-01-01');
      const end = new Date('2024-12-31');

      const result = await repo.countBooksFinishedInDateRange(1, start, end);

      expect(result).toBe(3);
    });

    it('returns 0 when no books in range', async () => {
      const chain = makeSelectChain([{ value: 0 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countBooksFinishedInDateRange(1, new Date('2020-01-01'), new Date('2020-12-31'));

      expect(result).toBe(0);
    });
  });

  describe('wasBookStartedAndFinishedOnSameDay', () => {
    it('returns true when startedAt and finishedAt are on the same day', async () => {
      const date = new Date('2024-03-15T10:00:00.000Z');
      const finishedAt = new Date('2024-03-15T22:00:00.000Z');
      const chain = makeSelectChain([{ startedAt: date, finishedAt }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.wasBookStartedAndFinishedOnSameDay(1, 5);

      expect(result).toBe(true);
    });

    it('returns false when dates span different days', async () => {
      const startedAt = new Date('2024-03-15T10:00:00.000Z');
      const finishedAt = new Date('2024-03-16T10:00:00.000Z');
      const chain = makeSelectChain([{ startedAt, finishedAt }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.wasBookStartedAndFinishedOnSameDay(1, 5);

      expect(result).toBe(false);
    });

    it('returns false when startedAt is null', async () => {
      const chain = makeSelectChain([{ startedAt: null, finishedAt: new Date() }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.wasBookStartedAndFinishedOnSameDay(1, 5);

      expect(result).toBe(false);
    });

    it('returns false when no row found', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.wasBookStartedAndFinishedOnSameDay(1, 5);

      expect(result).toBe(false);
    });
  });

  describe('sumWeekendReadingHours', () => {
    it('returns floor of total weekend reading seconds divided by 3600', async () => {
      const chain = makeSelectChain([{ value: '14400' }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.sumWeekendReadingHours(1, '2024-03-16');

      expect(result).toBe(4);
    });

    it('returns 0 when no reading data', async () => {
      const chain = makeSelectChain([{ value: null }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.sumWeekendReadingHours(1, '2024-03-16');

      expect(result).toBe(0);
    });
  });

  describe('getBookIdForFile', () => {
    it('returns bookId when file found', async () => {
      const chain = makeSelectChain([{ bookId: 42 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getBookIdForFile(7);

      expect(result).toBe(42);
    });

    it('returns null when file not found', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getBookIdForFile(999);

      expect(result).toBeNull();
    });
  });

  describe('getPreviousSessionEndedAt', () => {
    it('returns endedAt of the most recent other session', async () => {
      const endedAt = new Date('2024-03-10T20:00:00.000Z');
      const chain = makeSelectChain([{ endedAt }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getPreviousSessionEndedAt(1, 'current-session-id');

      expect(result).toEqual(endedAt);
    });

    it('returns null when no previous session exists', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getPreviousSessionEndedAt(1, 'current-session-id');

      expect(result).toBeNull();
    });
  });

  describe('findAllUserIds', () => {
    it('returns array of active user ids', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }) };
      const repo = makeRepo(db);

      const result = await repo.findAllUserIds();

      expect(result).toEqual([1, 2, 3]);
    });

    it('returns empty array when no active users', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
      const repo = makeRepo(db);

      const result = await repo.findAllUserIds();

      expect(result).toEqual([]);
    });
  });

  describe('hasSessionLongerThan', () => {
    it('returns true when a qualifying session exists', async () => {
      const chain = makeSelectChain([{ sessionId: 'abc' }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasSessionLongerThan(1, 3600);

      expect(result).toBe(true);
    });

    it('returns false when no qualifying session', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasSessionLongerThan(1, 3600);

      expect(result).toBe(false);
    });
  });

  describe('hasSessionInHourRange', () => {
    it('returns true when a session falls within the hour range', async () => {
      const chain = makeSelectChain([{ sessionId: 'abc' }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasSessionInHourRange(1, 22, 6);

      expect(result).toBe(true);
    });

    it('returns false when no session in hour range', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasSessionInHourRange(1, 22, 6);

      expect(result).toBe(false);
    });
  });

  describe('hasSessionStartingInHourRange', () => {
    it('returns true when a session starts within the hour range', async () => {
      const chain = makeSelectChain([{ sessionId: 'abc' }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasSessionStartingInHourRange(1, 5, 8);

      expect(result).toBe(true);
    });

    it('returns false when no session starts in hour range', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasSessionStartingInHourRange(1, 5, 8);

      expect(result).toBe(false);
    });
  });

  describe('getMaxFinishedBookPageCount', () => {
    it('returns max page count', async () => {
      const chain = makeSelectChain([{ value: 1200 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getMaxFinishedBookPageCount(1);

      expect(result).toBe(1200);
    });

    it('returns 0 when no finished books with page count', async () => {
      const chain = makeSelectChain([{ value: 0 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getMaxFinishedBookPageCount(1);

      expect(result).toBe(0);
    });

    it('returns 0 when result is undefined', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getMaxFinishedBookPageCount(1);

      expect(result).toBe(0);
    });
  });

  describe('hasFinishedBookWithMinPages', () => {
    it('returns true when a qualifying book exists', async () => {
      const chain = makeSelectChain([{ bookId: 7 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasFinishedBookWithMinPages(1, 500);

      expect(result).toBe(true);
    });

    it('returns false when no qualifying book', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasFinishedBookWithMinPages(1, 500);

      expect(result).toBe(false);
    });
  });

  describe('hasAnyBookStartedAndFinishedOnSameDay', () => {
    it('returns true when any book was read in a single day', async () => {
      const chain = makeSelectChain([{ bookId: 3 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasAnyBookStartedAndFinishedOnSameDay(1);

      expect(result).toBe(true);
    });

    it('returns false when no book was read in a single day', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasAnyBookStartedAndFinishedOnSameDay(1);

      expect(result).toBe(false);
    });
  });

  describe('hasFinishedBookPublishedBefore', () => {
    it('returns true when a book published before the year exists', async () => {
      const chain = makeSelectChain([{ bookId: 2 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasFinishedBookPublishedBefore(1, 1900);

      expect(result).toBe(true);
    });

    it('returns false when no such book', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasFinishedBookPublishedBefore(1, 1900);

      expect(result).toBe(false);
    });
  });

  describe('hasFinishedBookPublishedInYear', () => {
    it('returns true when a book published in the exact year exists', async () => {
      const chain = makeSelectChain([{ bookId: 5 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasFinishedBookPublishedInYear(1, 2001);

      expect(result).toBe(true);
    });

    it('returns false when no matching year', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasFinishedBookPublishedInYear(1, 2001);

      expect(result).toBe(false);
    });
  });

  describe('hasAnyBookRebornFromAbandoned', () => {
    it('returns true when a long-gap completion exists', async () => {
      const chain = makeSelectChain([{ bookId: 1 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasAnyBookRebornFromAbandoned(1, 6);

      expect(result).toBe(true);
    });

    it('returns false when no such completion', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasAnyBookRebornFromAbandoned(1, 6);

      expect(result).toBe(false);
    });
  });

  describe('hasLargeGapBetweenAnySessions', () => {
    it('returns true when a gap >= minDays is found', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ found: true }] }) };
      const repo = makeRepo(db);

      const result = await repo.hasLargeGapBetweenAnySessions(1, 30);

      expect(result).toBe(true);
    });

    it('returns false when no large gap exists', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ found: false }] }) };
      const repo = makeRepo(db);

      const result = await repo.hasLargeGapBetweenAnySessions(1, 30);

      expect(result).toBe(false);
    });

    it('returns false when no rows returned', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
      const repo = makeRepo(db);

      const result = await repo.hasLargeGapBetweenAnySessions(1, 30);

      expect(result).toBe(false);
    });
  });

  describe('hasSessionOnJanFirst', () => {
    it('returns true when a Jan 1 session exists', async () => {
      const chain = makeSelectChain([{ sessionId: 'new-year-session' }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasSessionOnJanFirst(1);

      expect(result).toBe(true);
    });

    it('returns false when no Jan 1 session', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasSessionOnJanFirst(1);

      expect(result).toBe(false);
    });
  });

  describe('getMaxSessionMinutes', () => {
    it('returns floor of max session duration in minutes', async () => {
      const chain = makeSelectChain([{ value: 125.8 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getMaxSessionMinutes(1);

      expect(result).toBe(125);
    });

    it('returns 0 when no sessions', async () => {
      const chain = makeSelectChain([{ value: null }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getMaxSessionMinutes(1);

      expect(result).toBe(0);
    });
  });

  describe('hasWeekendMarathon', () => {
    it('returns true when a weekend day has enough reading seconds', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ found: true }] }) };
      const repo = makeRepo(db);

      const result = await repo.hasWeekendMarathon(1, 6);

      expect(result).toBe(true);
    });

    it('returns false when no qualifying weekend day', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ found: false }] }) };
      const repo = makeRepo(db);

      const result = await repo.hasWeekendMarathon(1, 6);

      expect(result).toBe(false);
    });
  });

  describe('countBooksFinishedInYear', () => {
    it('delegates to countBooksFinishedInDateRange with correct year boundaries', async () => {
      const chain = makeSelectChain([{ value: 12 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countBooksFinishedInYear(1, 2024);

      expect(result).toBe(12);
      const where = chain.where.mock.calls[0];
      expect(where).toBeDefined();
    });
  });

  describe('countBooksFinishedInMonth', () => {
    it('delegates to countBooksFinishedInDateRange with correct month boundaries', async () => {
      const chain = makeSelectChain([{ value: 3 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countBooksFinishedInMonth(1, 2024, 3);

      expect(result).toBe(3);
    });
  });

  describe('hasCompletedSeriesOfSize', () => {
    it('returns true when a complete series of the given size exists', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{}] }) };
      const repo = makeRepo(db);

      const result = await repo.hasCompletedSeriesOfSize(7, 3);

      expect(result).toBe(true);
      const sqlText = flattenSql(db.execute.mock.calls[0][0]);
      expect(sqlText).toContain('bm.series_id');
    });

    it('returns false when no such series', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
      const repo = makeRepo(db);

      const result = await repo.hasCompletedSeriesOfSize(7, 3);

      expect(result).toBe(false);
    });
  });

  describe('countDistinctDecadesRead', () => {
    it('returns number of distinct decades from grouped rows', async () => {
      const chain = makeSelectChain([{ decade: 198 }, { decade: 199 }, { decade: 200 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctDecadesRead(1);

      expect(result).toBe(3);
    });

    it('returns 0 when no books read with published year', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctDecadesRead(1);

      expect(result).toBe(0);
    });
  });

  describe('countFinishedBooksByMaxPageCount', () => {
    it('returns count of books under maxPages', async () => {
      const chain = makeSelectChain([{ value: 5 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countFinishedBooksByMaxPageCount(1, 200);

      expect(result).toBe(5);
    });
  });

  describe('hasFinishedBookUnderPages', () => {
    it('returns true when a book under maxPages exists', async () => {
      const chain = makeSelectChain([{ bookId: 3 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasFinishedBookUnderPages(1, 100);

      expect(result).toBe(true);
    });

    it('returns false when no such book', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasFinishedBookUnderPages(1, 100);

      expect(result).toBe(false);
    });
  });

  describe('hasFinishedBookOverPages', () => {
    it('returns true when a book over minPages exists', async () => {
      const chain = makeSelectChain([{ bookId: 8 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasFinishedBookOverPages(1, 800);

      expect(result).toBe(true);
    });

    it('returns false when no book exceeds minPages', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasFinishedBookOverPages(1, 800);

      expect(result).toBe(false);
    });
  });

  describe('maxBooksPerGenre', () => {
    it('returns the highest count for a single genre', async () => {
      const chain = makeSelectChain([{ cnt: 15 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.maxBooksPerGenre(1);

      expect(result).toBe(15);
    });

    it('returns 0 when no books have been read', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.maxBooksPerGenre(1);

      expect(result).toBe(0);
    });
  });

  describe('countAnnotationsOnDay', () => {
    it('returns annotation count for a specific day', async () => {
      const chain = makeSelectChain([{ value: 8 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countAnnotationsOnDay(1, new Date('2024-03-15'));

      expect(result).toBe(8);
    });
  });

  describe('countAnnotationsWithNotes', () => {
    it('returns count of annotations with non-empty notes', async () => {
      const chain = makeSelectChain([{ value: 4 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countAnnotationsWithNotes(1);

      expect(result).toBe(4);
    });
  });

  describe('countCollectionBookLinks', () => {
    it('returns total book-collection links for user', async () => {
      const chain = makeSelectChain([{ value: 20 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countCollectionBookLinks(1);

      expect(result).toBe(20);
    });
  });

  describe('getBookSeriesName', () => {
    it('returns seriesName when found', async () => {
      const chain = makeSelectChain([{ seriesName: 'The Wheel of Time' }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getBookSeriesName(1);

      expect(result).toBe('The Wheel of Time');
    });

    it('returns null when book has no series', async () => {
      const chain = makeSelectChain([{ seriesName: null }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getBookSeriesName(1);

      expect(result).toBeNull();
    });

    it('returns null when book not found', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getBookSeriesName(999);

      expect(result).toBeNull();
    });
  });

  describe('countDistinctFinishedAnnotatedBooks', () => {
    it('returns count of distinct finished books that also have annotations', async () => {
      const chain = makeSelectChain([{ value: 5 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctFinishedAnnotatedBooks(1);

      expect(result).toBe(5);
    });
  });

  describe('countDistinctFinishedBooksInCollections', () => {
    it('returns count of distinct finished books in collections', async () => {
      const chain = makeSelectChain([{ value: 7 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctFinishedBooksInCollections(1);

      expect(result).toBe(7);
    });
  });

  describe('countDistinctEarnedCategories', () => {
    it('returns count of distinct achievement categories earned', async () => {
      const chain = makeSelectChain([{ value: 3 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctEarnedCategories(1);

      expect(result).toBe(3);
    });
  });

  describe('hasConsecutiveWeekendsWithReading', () => {
    it('returns true when enough consecutive weekend weeks found', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ found: true }] }) };
      const repo = makeRepo(db);

      const result = await repo.hasConsecutiveWeekendsWithReading(1, 4);

      expect(result).toBe(true);
    });

    it('returns false when not enough consecutive weekend weeks', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ found: false }] }) };
      const repo = makeRepo(db);

      const result = await repo.hasConsecutiveWeekendsWithReading(1, 4);

      expect(result).toBe(false);
    });
  });

  describe('countDistinctSeasonsWithReading', () => {
    it('returns count of distinct seasons with reading activity', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ season: 1 }, { season: 2 }, { season: 3 }] }) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctSeasonsWithReading(1, 2024);

      expect(result).toBe(3);
    });

    it('returns 0 when no reading in the year', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctSeasonsWithReading(1, 2020);

      expect(result).toBe(0);
    });
  });

  describe('hasReadEveryDayInAnyMonth', () => {
    it('returns true when a full month of reading exists', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ found: true }] }) };
      const repo = makeRepo(db);

      const result = await repo.hasReadEveryDayInAnyMonth(1);

      expect(result).toBe(true);
    });

    it('returns false when no full-month reading streak', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ found: false }] }) };
      const repo = makeRepo(db);

      const result = await repo.hasReadEveryDayInAnyMonth(1);

      expect(result).toBe(false);
    });
  });

  describe('hasConsecutiveDaysWithMinReading', () => {
    it('returns true when a qualifying streak exists', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ found: true }] }) };
      const repo = makeRepo(db);

      const result = await repo.hasConsecutiveDaysWithMinReading(1, 7, 1800);

      expect(result).toBe(true);
    });

    it('returns false when no qualifying streak', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ found: false }] }) };
      const repo = makeRepo(db);

      const result = await repo.hasConsecutiveDaysWithMinReading(1, 7, 1800);

      expect(result).toBe(false);
    });
  });

  describe('countSessionsLongerThan', () => {
    it('returns count of sessions exceeding minSeconds', async () => {
      const chain = makeSelectChain([{ value: 6 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countSessionsLongerThan(1, 3600);

      expect(result).toBe(6);
    });
  });

  describe('getBookStartedAndFinishedAt', () => {
    it('returns timestamps when found', async () => {
      const startedAt = new Date('2024-01-01');
      const finishedAt = new Date('2024-01-15');
      const chain = makeSelectChain([{ startedAt, finishedAt }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getBookStartedAndFinishedAt(1, 5);

      expect(result).toEqual({ startedAt, finishedAt });
    });

    it('returns null when no status row found', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getBookStartedAndFinishedAt(1, 5);

      expect(result).toBeNull();
    });
  });

  describe('hasAnySlowBurnBook', () => {
    it('returns true when a book took more than minDays to finish', async () => {
      const chain = makeSelectChain([{ bookId: 2 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasAnySlowBurnBook(1, 90);

      expect(result).toBe(true);
    });

    it('returns false when no slow burn book', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasAnySlowBurnBook(1, 90);

      expect(result).toBe(false);
    });
  });

  describe('hasMonthWithBooksFinished', () => {
    it('returns true when a month had enough finished books', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ found: true }] }) };
      const repo = makeRepo(db);

      const result = await repo.hasMonthWithBooksFinished(1, 5);

      expect(result).toBe(true);
    });

    it('returns false when no month reached the minimum', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ found: false }] }) };
      const repo = makeRepo(db);

      const result = await repo.hasMonthWithBooksFinished(1, 5);

      expect(result).toBe(false);
    });
  });

  describe('hasSessionWithProgressDeltaAtLeast', () => {
    it('returns true when a session with sufficient progress delta exists', async () => {
      const chain = makeSelectChain([{ sessionId: 'x' }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasSessionWithProgressDeltaAtLeast(1, 50);

      expect(result).toBe(true);
    });

    it('returns false when no qualifying session', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasSessionWithProgressDeltaAtLeast(1, 50);

      expect(result).toBe(false);
    });
  });

  describe('hasAnyDayWithAnnotationCount', () => {
    it('returns true when a day has enough annotations', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ found: true }] }) };
      const repo = makeRepo(db);

      const result = await repo.hasAnyDayWithAnnotationCount(1, 10);

      expect(result).toBe(true);
    });

    it('returns false when no day reached the minimum', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ found: false }] }) };
      const repo = makeRepo(db);

      const result = await repo.hasAnyDayWithAnnotationCount(1, 10);

      expect(result).toBe(false);
    });
  });

  describe('hasFinishedBookInSeries', () => {
    it('returns true when a finished book with a series name exists', async () => {
      const chain = makeSelectChain([{ bookId: 4 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasFinishedBookInSeries(1);

      expect(result).toBe(true);
    });

    it('returns false when no finished book belongs to a series', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasFinishedBookInSeries(1);

      expect(result).toBe(false);
    });
  });

  describe('countRatings', () => {
    it('returns total ratings by user', async () => {
      const chain = makeSelectChain([{ value: 9 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countRatings(1);

      expect(result).toBe(9);
    });

    it('excludes tombstone rows with a null rating', async () => {
      const chain = makeSelectChain([{ value: 9 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      await repo.countRatings(1);

      const whereSql = flattenSql(chain.where.mock.calls[0][0]);
      expect(whereSql).toContain('is not null');
    });
  });

  describe('countRatingsAtMost', () => {
    it('returns count of ratings at or below max', async () => {
      const chain = makeSelectChain([{ value: 3 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countRatingsAtMost(1, 2);

      expect(result).toBe(3);
    });
  });

  describe('countDistinctRatingValues', () => {
    it('returns count of distinct rating values used', async () => {
      const chain = makeSelectChain([{ value: 5 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctRatingValues(1);

      expect(result).toBe(5);
    });

    it('excludes tombstone rows with a null rating', async () => {
      const chain = makeSelectChain([{ value: 5 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      await repo.countDistinctRatingValues(1);

      const whereSql = flattenSql(chain.where.mock.calls[0][0]);
      expect(whereSql).toContain('is not null');
    });
  });

  describe('existsRatingValue', () => {
    it('returns true when the user has rated a book with the specific value', async () => {
      const chain = makeSelectChain([{ bookId: 7 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.existsRatingValue(1, 10);

      expect(result).toBe(true);
    });

    it('returns false when no book has been rated with that value', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.existsRatingValue(1, 10);

      expect(result).toBe(false);
    });
  });

  describe('getPageCountByBookFile', () => {
    it('returns pageCount when found via book file join', async () => {
      const chain = makeSelectChain([{ pageCount: 320 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getPageCountByBookFile(5);

      expect(result).toBe(320);
    });

    it('returns null when no matching file', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getPageCountByBookFile(999);

      expect(result).toBeNull();
    });
  });

  describe('getMaxSessionPages', () => {
    it('returns floor of max pages read in a single session', async () => {
      const chain = makeSelectChain([{ value: 87.3 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getMaxSessionPages(1);

      expect(result).toBe(87);
    });

    it('returns 0 when no qualifying sessions', async () => {
      const chain = makeSelectChain([{ value: null }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getMaxSessionPages(1);

      expect(result).toBe(0);
    });
  });

  describe('getPagesOnDay', () => {
    it('returns floor of pages read on a given day', async () => {
      const chain = makeSelectChain([{ value: 55.9 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getPagesOnDay(1, new Date('2024-03-15'));

      expect(result).toBe(55);
    });

    it('returns 0 when no reading on that day', async () => {
      const chain = makeSelectChain([{ value: null }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getPagesOnDay(1, new Date('2024-03-15'));

      expect(result).toBe(0);
    });
  });

  describe('getMaxPagesInADay', () => {
    it('returns floor of max pages read in any single day', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ max_pages: 203.7 }] }) };
      const repo = makeRepo(db);

      const result = await repo.getMaxPagesInADay(1);

      expect(result).toBe(203);
    });

    it('returns 0 when no reading data', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ max_pages: 0 }] }) };
      const repo = makeRepo(db);

      const result = await repo.getMaxPagesInADay(1);

      expect(result).toBe(0);
    });

    it('returns 0 when no rows returned', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
      const repo = makeRepo(db);

      const result = await repo.getMaxPagesInADay(1);

      expect(result).toBe(0);
    });
  });

  describe('getAnnotationNoteLength', () => {
    it('returns note length when annotation has a note', async () => {
      const chain = makeSelectChain([{ note: 'This is a great passage.' }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getAnnotationNoteLength(1, 1);

      expect(result).toBe(24);
    });

    it('returns null when note is null', async () => {
      const chain = makeSelectChain([{ note: null }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getAnnotationNoteLength(1, 1);

      expect(result).toBeNull();
    });

    it('returns null when annotation not found', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getAnnotationNoteLength(999, 1);

      expect(result).toBeNull();
    });
  });

  describe('getMaxNoteLength', () => {
    it('returns the max char length of any note', async () => {
      const chain = makeSelectChain([{ value: 500 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getMaxNoteLength(1);

      expect(result).toBe(500);
    });

    it('returns 0 when no notes', async () => {
      const chain = makeSelectChain([{ value: 0 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.getMaxNoteLength(1);

      expect(result).toBe(0);
    });
  });

  describe('countDistinctColors', () => {
    it('returns count of distinct annotation colors used', async () => {
      const chain = makeSelectChain([{ value: 4 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctColors(1);

      expect(result).toBe(4);
    });
  });

  describe('hasWebSession', () => {
    it('returns true when a web source session exists', async () => {
      const chain = makeSelectChain([{ id: 1 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasWebSession(1);

      expect(result).toBe(true);
    });

    it('returns false when no web session', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasWebSession(1);

      expect(result).toBe(false);
    });
  });

  describe('hasKoreaderSync', () => {
    it('returns true when a non-orphaned koreader progress entry exists', async () => {
      const chain = makeSelectChain([{ id: 1 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasKoreaderSync(1);

      expect(result).toBe(true);
    });

    it('returns false when no koreader progress found', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasKoreaderSync(1);

      expect(result).toBe(false);
    });
  });

  describe('hasKoboSync', () => {
    it('returns true when a kobo reading state exists', async () => {
      const chain = makeSelectChain([{ id: 1 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasKoboSync(1);

      expect(result).toBe(true);
    });

    it('returns false when no kobo state found', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasKoboSync(1);

      expect(result).toBe(false);
    });
  });

  describe('hasAnyExternalDevice', () => {
    it('returns true when koreader sync exists', async () => {
      const koreaderChain = makeSelectChain([{ id: 1 }]);
      const koboChain = makeSelectChain([]);
      let callCount = 0;
      const db = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? koreaderChain : koboChain;
        }),
      };
      const repo = makeRepo(db);

      const result = await repo.hasAnyExternalDevice(1);

      expect(result).toBe(true);
    });

    it('returns true when kobo sync exists', async () => {
      const koreaderChain = makeSelectChain([]);
      const koboChain = makeSelectChain([{ id: 5 }]);
      let callCount = 0;
      const db = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? koreaderChain : koboChain;
        }),
      };
      const repo = makeRepo(db);

      const result = await repo.hasAnyExternalDevice(1);

      expect(result).toBe(true);
    });

    it('returns false when neither device has synced', async () => {
      const emptyChain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(emptyChain) };
      const repo = makeRepo(db);

      const result = await repo.hasAnyExternalDevice(1);

      expect(result).toBe(false);
    });
  });

  describe('countDistinctSources', () => {
    it('returns 3 when all sources are active', async () => {
      const webChain = makeSelectChain([{ id: 1 }]);
      const koreaderChain = makeSelectChain([{ id: 1 }]);
      const koboChain = makeSelectChain([{ id: 1 }]);
      let callCount = 0;
      const db = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return webChain;
          if (callCount === 2) return koreaderChain;
          return koboChain;
        }),
      };
      const repo = makeRepo(db);

      const result = await repo.countDistinctSources(1);

      expect(result).toBe(3);
    });

    it('returns 0 when no sources active', async () => {
      const emptyChain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(emptyChain) };
      const repo = makeRepo(db);

      const result = await repo.countDistinctSources(1);

      expect(result).toBe(0);
    });

    it('returns 1 when only web is active', async () => {
      const webChain = makeSelectChain([{ id: 1 }]);
      const emptyChain = makeSelectChain([]);
      let callCount = 0;
      const db = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? webChain : emptyChain;
        }),
      };
      const repo = makeRepo(db);

      const result = await repo.countDistinctSources(1);

      expect(result).toBe(1);
    });
  });

  describe('maxSourcesOnSingleBook', () => {
    it('returns the max source count for any single book', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ max_sources: 3 }] }) };
      const repo = makeRepo(db);

      const result = await repo.maxSourcesOnSingleBook(1);

      expect(result).toBe(3);
    });

    it('returns 0 when no reading data exists', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [{ max_sources: 0 }] }) };
      const repo = makeRepo(db);

      const result = await repo.maxSourcesOnSingleBook(1);

      expect(result).toBe(0);
    });

    it('returns 0 when no rows returned', async () => {
      const db = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
      const repo = makeRepo(db);

      const result = await repo.maxSourcesOnSingleBook(1);

      expect(result).toBe(0);
    });
  });

  describe('hasAbandonedBook', () => {
    it('returns true when an abandoned book entry exists', async () => {
      const chain = makeSelectChain([{ bookId: 3 }]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasAbandonedBook(1);

      expect(result).toBe(true);
    });

    it('returns false when no abandoned books', async () => {
      const chain = makeSelectChain([]);
      const db = { select: vi.fn().mockReturnValue(chain) };
      const repo = makeRepo(db);

      const result = await repo.hasAbandonedBook(1);

      expect(result).toBe(false);
    });
  });
});
