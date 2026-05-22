import { BadRequestException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import * as schema from '../../db/schema';
import { ContentFilterRepository } from './content-filter.repository';

function makeTx() {
  return {
    delete: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
    values: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ContentFilterRepository', () => {
  let repo: ContentFilterRepository;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
      transaction: vi.fn().mockImplementation((cb) => cb(mockDb)),
    };
    repo = new ContentFilterRepository(mockDb as any);
  });

  it('findByUserId splits include and exclude ids by entity type', async () => {
    mockDb.where
      .mockResolvedValueOnce([
        { filterType: 'include', tagId: 1 },
        { filterType: 'exclude', tagId: 2 },
      ])
      .mockResolvedValueOnce([
        { filterType: 'include', genreId: 3 },
        { filterType: 'exclude', genreId: 4 },
      ]);

    await expect(repo.findByUserId(7)).resolves.toEqual({
      includeTagIds: [1],
      excludeTagIds: [2],
      includeGenreIds: [3],
      excludeGenreIds: [4],
    });
  });

  it('findByUserIdWithNames returns named include and exclude items', async () => {
    mockDb.where
      .mockResolvedValueOnce([
        { filterType: 'include', tagId: 1, tagName: 'Sci-Fi' },
        { filterType: 'exclude', tagId: 2, tagName: 'Horror' },
      ])
      .mockResolvedValueOnce([
        { filterType: 'include', genreId: 3, genreName: 'Fantasy' },
        { filterType: 'exclude', genreId: 4, genreName: 'Thriller' },
      ]);

    await expect(repo.findByUserIdWithNames(7)).resolves.toEqual({
      includeTags: [{ id: 1, name: 'Sci-Fi' }],
      excludeTags: [{ id: 2, name: 'Horror' }],
      includeGenres: [{ id: 3, name: 'Fantasy' }],
      excludeGenres: [{ id: 4, name: 'Thriller' }],
    });
  });

  it('replaceFilters clears all rows when filters are empty', async () => {
    const tx = makeTx();
    mockDb.transaction.mockImplementation(async (cb: (db: typeof tx) => Promise<void>) => cb(tx));

    await expect(repo.replaceFilters(7, EMPTY_CONTENT_FILTER_RULES)).resolves.toBeUndefined();

    expect(tx.delete).toHaveBeenNthCalledWith(1, schema.userContentFilterTags);
    expect(tx.where).toHaveBeenNthCalledWith(1, expect.anything());
    expect(tx.delete).toHaveBeenNthCalledWith(2, schema.userContentFilterGenres);
    expect(tx.where).toHaveBeenNthCalledWith(2, expect.anything());
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('replaceFilters inserts include-only tag and genre rows', async () => {
    const tx = makeTx();
    mockDb.where.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockResolvedValueOnce([{ id: 3 }]);
    mockDb.transaction.mockImplementation(async (cb: (db: typeof tx) => Promise<void>) => cb(tx));

    await repo.replaceFilters(7, {
      includeTagIds: [1, 2],
      excludeTagIds: [],
      includeGenreIds: [3],
      excludeGenreIds: [],
    });

    expect(tx.insert).toHaveBeenNthCalledWith(1, schema.userContentFilterTags);
    expect(tx.values).toHaveBeenNthCalledWith(1, [
      { userId: 7, filterType: 'include', tagId: 1 },
      { userId: 7, filterType: 'include', tagId: 2 },
    ]);
    expect(tx.insert).toHaveBeenNthCalledWith(2, schema.userContentFilterGenres);
    expect(tx.values).toHaveBeenNthCalledWith(2, [{ userId: 7, filterType: 'include', genreId: 3 }]);
  });

  it('replaceFilters inserts exclude-only tag and genre rows', async () => {
    const tx = makeTx();
    mockDb.where.mockResolvedValueOnce([{ id: 5 }]).mockResolvedValueOnce([{ id: 6 }, { id: 7 }]);
    mockDb.transaction.mockImplementation(async (cb: (db: typeof tx) => Promise<void>) => cb(tx));

    await repo.replaceFilters(9, {
      includeTagIds: [],
      excludeTagIds: [5],
      includeGenreIds: [],
      excludeGenreIds: [6, 7],
    });

    expect(tx.values).toHaveBeenNthCalledWith(1, [{ userId: 9, filterType: 'exclude', tagId: 5 }]);
    expect(tx.values).toHaveBeenNthCalledWith(2, [
      { userId: 9, filterType: 'exclude', genreId: 6 },
      { userId: 9, filterType: 'exclude', genreId: 7 },
    ]);
  });

  it('replaceFilters inserts mixed include and exclude rows in order', async () => {
    const tx = makeTx();
    mockDb.where.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockResolvedValueOnce([{ id: 3 }, { id: 4 }]);
    mockDb.transaction.mockImplementation(async (cb: (db: typeof tx) => Promise<void>) => cb(tx));

    await repo.replaceFilters(4, {
      includeTagIds: [1],
      excludeTagIds: [2],
      includeGenreIds: [3],
      excludeGenreIds: [4],
    });

    expect(tx.values).toHaveBeenNthCalledWith(1, [
      { userId: 4, filterType: 'include', tagId: 1 },
      { userId: 4, filterType: 'exclude', tagId: 2 },
    ]);
    expect(tx.values).toHaveBeenNthCalledWith(2, [
      { userId: 4, filterType: 'include', genreId: 3 },
      { userId: 4, filterType: 'exclude', genreId: 4 },
    ]);
  });

  it('replaceFilters throws for unknown tag ids', async () => {
    mockDb.where.mockResolvedValueOnce([{ id: 1 }]);

    await expect(
      repo.replaceFilters(7, {
        includeTagIds: [1, 99],
        excludeTagIds: [],
        includeGenreIds: [],
        excludeGenreIds: [],
      }),
    ).rejects.toThrow(new BadRequestException('Unknown tag IDs: 99'));

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('replaceFilters throws for unknown genre ids', async () => {
    mockDb.where.mockResolvedValueOnce([{ id: 3 }]);

    await expect(
      repo.replaceFilters(7, {
        includeTagIds: [],
        excludeTagIds: [],
        includeGenreIds: [3, 88],
        excludeGenreIds: [],
      }),
    ).rejects.toThrow(new BadRequestException('Unknown genre IDs: 88'));

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('replaceFilters accepts duplicate ids in tag and genre arrays', async () => {
    const tx = makeTx();
    mockDb.where.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockResolvedValueOnce([{ id: 3 }, { id: 4 }]);
    mockDb.transaction.mockImplementation(async (cb: (db: typeof tx) => Promise<void>) => cb(tx));

    await expect(
      repo.replaceFilters(7, {
        includeTagIds: [1, 1],
        excludeTagIds: [2, 2],
        includeGenreIds: [3, 3],
        excludeGenreIds: [4, 4],
      }),
    ).resolves.toBeUndefined();

    expect(mockDb.where).toHaveBeenCalledTimes(2);
    expect(tx.insert).toHaveBeenCalledTimes(2);
  });

  it('hasContentFilters returns true after the first matching tag row', async () => {
    mockDb.limit.mockResolvedValueOnce([{ tagId: 1 }]);

    await expect(repo.hasContentFilters(7)).resolves.toBe(true);
    expect(mockDb.limit).toHaveBeenCalledTimes(1);
  });

  it('hasContentFilters checks genres when tag filters are absent', async () => {
    mockDb.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ genreId: 2 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(repo.hasContentFilters(7)).resolves.toBe(true);
    await expect(repo.hasContentFilters(8)).resolves.toBe(false);
  });

  it('hasAnyContentFilters returns an empty set for no user ids', async () => {
    await expect(repo.hasAnyContentFilters([])).resolves.toEqual(new Set());
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('hasAnyContentFilters merges matching tag and genre user ids', async () => {
    mockDb.where.mockResolvedValueOnce([{ userId: 1 }, { userId: 2 }]).mockResolvedValueOnce([{ userId: 2 }, { userId: 3 }]);

    await expect(repo.hasAnyContentFilters([1, 2, 3, 4])).resolves.toEqual(new Set([1, 2, 3]));
  });
});
