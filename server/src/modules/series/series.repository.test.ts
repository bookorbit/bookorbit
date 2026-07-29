import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SeriesRepository } from './series.repository';

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  const methods = [
    'from',
    'innerJoin',
    'leftJoin',
    'where',
    'groupBy',
    'orderBy',
    'limit',
    'offset',
    'having',
    'as',
    '$dynamic',
    'select',
    'selectDistinct',
  ];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

function makeFindPageDb(countResult: unknown, dataResult: unknown) {
  const baseChain = makeChain([]);
  const countChain = makeChain(countResult);
  const dataChain = makeChain(dataResult);

  const select = vi.fn().mockReturnValueOnce(baseChain).mockReturnValueOnce(countChain).mockReturnValueOnce(dataChain);

  return { select, baseChain, countChain, dataChain };
}

function makeDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

const BASE_PARAMS = {
  page: 0,
  size: 25,
  sort: 'name' as const,
  order: 'asc' as const,
  libraryIds: [1],
  userId: 7,
};

describe('SeriesRepository', () => {
  let db: ReturnType<typeof makeDb>;
  let repo: SeriesRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeDb();
    repo = new SeriesRepository(db as never);
  });

  describe('findPage', () => {
    it('returns empty page when no series rows found', async () => {
      const { select, dataChain } = makeFindPageDb([{ total: 0 }], []);
      dataChain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
      db.select = select;

      vi.spyOn(repo as never, 'fetchAuthorsForSeries').mockResolvedValue(new Map());
      vi.spyOn(repo as never, 'fetchCoverBookIds').mockResolvedValue(new Map());

      const result = await repo.findPage(BASE_PARAMS);

      expect(result).toEqual({ items: [], total: 0, page: 0, size: 25 });
    });

    it('returns items with authors and coverBookIds when rows found', async () => {
      const seriesRows = [
        { id: 10, name: 'Dune', bookCount: 6, readCount: 3, lastAddedAt: '2024-01-01' },
        { id: 11, name: 'Foundation', bookCount: 7, readCount: 0, lastAddedAt: '2023-06-15' },
      ];
      const { select } = makeFindPageDb([{ total: 2 }], seriesRows);
      db.select = select;

      const authorsMap = new Map([
        [10, ['Frank Herbert']],
        [11, ['Isaac Asimov']],
      ]);
      const coversMap = new Map([
        [10, [100, 101]],
        [11, [200]],
      ]);

      vi.spyOn(repo as never, 'fetchAuthorsForSeries').mockResolvedValue(authorsMap);
      vi.spyOn(repo as never, 'fetchCoverBookIds').mockResolvedValue(coversMap);

      const result = await repo.findPage(BASE_PARAMS);

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        id: 10,
        name: 'Dune',
        bookCount: 6,
        readCount: 3,
        authors: ['Frank Herbert'],
        coverBookIds: [100, 101],
        lastAddedAt: '2024-01-01',
      });
      expect(result.items[1]).toEqual({
        id: 11,
        name: 'Foundation',
        bookCount: 7,
        readCount: 0,
        authors: ['Isaac Asimov'],
        coverBookIds: [200],
        lastAddedAt: '2023-06-15',
      });
    });

    it('uses empty arrays for authors and covers when maps have no entry', async () => {
      const { select } = makeFindPageDb([{ total: 1 }], [{ id: 99, name: 'Unknown', bookCount: 1, readCount: 0, lastAddedAt: null }]);
      db.select = select;

      vi.spyOn(repo as never, 'fetchAuthorsForSeries').mockResolvedValue(new Map());
      vi.spyOn(repo as never, 'fetchCoverBookIds').mockResolvedValue(new Map());

      const result = await repo.findPage(BASE_PARAMS);

      expect(result.items[0]!.authors).toEqual([]);
      expect(result.items[0]!.coverBookIds).toEqual([]);
      expect(result.items[0]!.lastAddedAt).toBeNull();
    });

    it('calls having() when completionStatus is provided', async () => {
      const { select, dataChain } = makeFindPageDb([{ total: 0 }], []);
      db.select = select;

      vi.spyOn(repo as never, 'fetchAuthorsForSeries').mockResolvedValue(new Map());
      vi.spyOn(repo as never, 'fetchCoverBookIds').mockResolvedValue(new Map());

      await repo.findPage({ ...BASE_PARAMS, completionStatus: 'complete' });

      expect(dataChain.having).toHaveBeenCalled();
    });

    it('does not call having() when completionStatus is undefined', async () => {
      const { select, dataChain } = makeFindPageDb([{ total: 0 }], []);
      db.select = select;

      vi.spyOn(repo as never, 'fetchAuthorsForSeries').mockResolvedValue(new Map());
      vi.spyOn(repo as never, 'fetchCoverBookIds').mockResolvedValue(new Map());

      await repo.findPage({ ...BASE_PARAMS, completionStatus: undefined });

      expect(dataChain.having).not.toHaveBeenCalled();
    });

    it('passes correct pagination values to limit and offset', async () => {
      const { select, dataChain } = makeFindPageDb([{ total: 0 }], []);
      db.select = select;

      vi.spyOn(repo as never, 'fetchAuthorsForSeries').mockResolvedValue(new Map());
      vi.spyOn(repo as never, 'fetchCoverBookIds').mockResolvedValue(new Map());

      await repo.findPage({ ...BASE_PARAMS, page: 2, size: 10 });

      expect(dataChain.limit).toHaveBeenCalledWith(10);
      expect(dataChain.offset).toHaveBeenCalledWith(20);
    });

    it('handles total fallback to 0 when count row is missing', async () => {
      const { select } = makeFindPageDb([], []);
      db.select = select;

      vi.spyOn(repo as never, 'fetchAuthorsForSeries').mockResolvedValue(new Map());
      vi.spyOn(repo as never, 'fetchCoverBookIds').mockResolvedValue(new Map());

      const result = await repo.findPage(BASE_PARAMS);

      expect(result.total).toBe(0);
    });

    it('returns correct page and size in result', async () => {
      const { select } = makeFindPageDb([{ total: 0 }], []);
      db.select = select;

      vi.spyOn(repo as never, 'fetchAuthorsForSeries').mockResolvedValue(new Map());
      vi.spyOn(repo as never, 'fetchCoverBookIds').mockResolvedValue(new Map());

      const result = await repo.findPage({ ...BASE_PARAMS, page: 3, size: 15 });

      expect(result.page).toBe(3);
      expect(result.size).toBe(15);
    });
  });

  describe('countSeries', () => {
    it('returns the distinct series total for the accessible libraries', async () => {
      const chain = makeChain([{ total: 1200 }]);
      db.select.mockReturnValue(chain);

      await expect(repo.countSeries({ libraryIds: [1, 2] })).resolves.toBe(1200);
    });

    it('short-circuits without querying when no library is accessible', async () => {
      await expect(repo.countSeries({ libraryIds: [] })).resolves.toBe(0);
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('findDetail', () => {
    it('returns null when query returns empty rows', async () => {
      const chain = makeChain([]);
      db.select.mockReturnValue(chain);

      const result = await repo.findDetail({ seriesId: 1, userId: 7, libraryIds: [1] });

      expect(result).toBeNull();
    });

    it('returns detail row with authors and indices when series is found', async () => {
      const mainChain = makeChain([{ id: 42, name: 'Dune', bookCount: 6, readCount: 2 }]);
      const indicesChain = makeChain([{ idx: 1 }, { idx: 2 }, { idx: 3 }]);
      db.select.mockReturnValueOnce(mainChain).mockReturnValueOnce(indicesChain);

      const authorsMap = new Map([[42, ['Frank Herbert']]]);
      vi.spyOn(repo as never, 'fetchAuthorsForSeries').mockResolvedValue(authorsMap);

      const result = await repo.findDetail({ seriesId: 42, userId: 7, libraryIds: [1] });

      expect(result).not.toBeNull();
      expect(result!.id).toBe(42);
      expect(result!.name).toBe('Dune');
      expect(result!.bookCount).toBe(6);
      expect(result!.readCount).toBe(2);
      expect(result!.authors).toEqual(['Frank Herbert']);
      expect(result!.indices).toEqual([1, 2, 3]);
    });

    it('returns empty authors when map has no entry for seriesId', async () => {
      const mainChain = makeChain([{ id: 55, name: 'NoAuthor', bookCount: 1, readCount: 0 }]);
      const indicesChain = makeChain([]);
      db.select.mockReturnValueOnce(mainChain).mockReturnValueOnce(indicesChain);

      vi.spyOn(repo as never, 'fetchAuthorsForSeries').mockResolvedValue(new Map());

      const result = await repo.findDetail({ seriesId: 55, userId: 7, libraryIds: [1] });

      expect(result!.authors).toEqual([]);
      expect(result!.indices).toEqual([]);
    });
  });

  describe('findBookIds', () => {
    const BOOK_PARAMS = {
      seriesId: 42,
      page: 0,
      size: 50,
      sort: 'seriesIndex' as const,
      order: 'asc' as const,
      libraryIds: [1],
    };

    it('returns bookIds and total from parallel queries', async () => {
      const dataChain = makeChain([{ id: 10 }, { id: 20 }, { id: 30 }]);
      const countChain = makeChain([{ total: 3 }]);
      db.select.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

      const result = await repo.findBookIds(BOOK_PARAMS);

      expect(result.bookIds).toEqual([10, 20, 30]);
      expect(result.total).toBe(3);
    });

    it('returns empty bookIds when no books found', async () => {
      const dataChain = makeChain([]);
      const countChain = makeChain([{ total: 0 }]);
      db.select.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

      const result = await repo.findBookIds(BOOK_PARAMS);

      expect(result.bookIds).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('passes limit and offset for pagination', async () => {
      const dataChain = makeChain([]);
      const countChain = makeChain([{ total: 0 }]);
      db.select.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

      await repo.findBookIds({ ...BOOK_PARAMS, page: 2, size: 10 });

      expect(dataChain.limit).toHaveBeenCalledWith(10);
      expect(dataChain.offset).toHaveBeenCalledWith(20);
    });

    it('sorts by title when sort is title', async () => {
      const dataChain = makeChain([{ id: 5 }]);
      const countChain = makeChain([{ total: 1 }]);
      db.select.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

      await repo.findBookIds({ ...BOOK_PARAMS, sort: 'title', order: 'asc' });

      expect(dataChain.orderBy).toHaveBeenCalledTimes(1);
    });

    it('sorts by addedAt when sort is addedAt', async () => {
      const dataChain = makeChain([{ id: 5 }]);
      const countChain = makeChain([{ total: 1 }]);
      db.select.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

      await repo.findBookIds({ ...BOOK_PARAMS, sort: 'addedAt', order: 'desc' });

      expect(dataChain.orderBy).toHaveBeenCalledTimes(1);
    });

    it('sorts by seriesIndex when sort is seriesIndex', async () => {
      const dataChain = makeChain([{ id: 5 }]);
      const countChain = makeChain([{ total: 1 }]);
      db.select.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

      await repo.findBookIds({ ...BOOK_PARAMS, sort: 'seriesIndex', order: 'asc' });

      expect(dataChain.orderBy).toHaveBeenCalledTimes(1);
    });

    it('coerces total to number', async () => {
      const dataChain = makeChain([]);
      const countChain = makeChain([{ total: '42' }]);
      db.select.mockReturnValueOnce(dataChain).mockReturnValueOnce(countChain);

      const result = await repo.findBookIds(BOOK_PARAMS);

      expect(typeof result.total).toBe('number');
      expect(result.total).toBe(42);
    });
  });
});
