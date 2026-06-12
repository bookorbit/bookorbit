vi.mock('drizzle-orm', () => ({
  SQL: class {},
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  asc: vi.fn((value: unknown) => ({ op: 'asc', value })),
  desc: vi.fn((value: unknown) => ({ op: 'desc', value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  gt: vi.fn((left: unknown, right: unknown) => ({ op: 'gt', left, right })),
  gte: vi.fn((left: unknown, right: unknown) => ({ op: 'gte', left, right })),
  ilike: vi.fn((left: unknown, right: unknown) => ({ op: 'ilike', left, right })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ op: 'inArray', left, right })),
  isNull: vi.fn((value: unknown) => ({ op: 'isNull', value })),
  max: vi.fn((value: unknown) => ({ op: 'max', value })),
  or: vi.fn((...clauses: unknown[]) => ({ op: 'or', clauses })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
    {
      join: vi.fn((chunks: unknown[], separator: unknown) => ({ op: 'sql.join', chunks, separator })),
      raw: vi.fn((value: string) => ({ op: 'sql.raw', value })),
    },
  ),
}));

import { eq, sql } from 'drizzle-orm';

import { AuthorsRepository } from './authors.repository';

function makeDb() {
  const selectBuilder = {
    from: vi.fn(),
    where: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    groupBy: vi.fn(),
    having: vi.fn(),
    as: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  selectBuilder.from.mockReturnValue(selectBuilder);
  selectBuilder.where.mockReturnValue(selectBuilder);
  selectBuilder.innerJoin.mockReturnValue(selectBuilder);
  selectBuilder.leftJoin.mockReturnValue(selectBuilder);
  selectBuilder.groupBy.mockReturnValue(selectBuilder);
  selectBuilder.having.mockReturnValue(selectBuilder);
  selectBuilder.as.mockReturnValue(selectBuilder);
  selectBuilder.orderBy.mockReturnValue(selectBuilder);
  selectBuilder.offset.mockResolvedValue([]);
  selectBuilder.limit.mockReturnValue(selectBuilder);

  const selectDistinctBuilder = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  selectDistinctBuilder.from.mockReturnValue(selectDistinctBuilder);
  selectDistinctBuilder.innerJoin.mockReturnValue(selectDistinctBuilder);
  selectDistinctBuilder.where.mockResolvedValue([]);

  const updateBuilder = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  updateBuilder.set.mockReturnValue(updateBuilder);
  updateBuilder.where.mockReturnValue(updateBuilder);
  updateBuilder.returning.mockResolvedValue([]);

  const deleteBuilder = {
    where: vi.fn(),
  };
  deleteBuilder.where.mockResolvedValue(undefined);

  const insertBuilder = {
    values: vi.fn(),
    onConflictDoNothing: vi.fn(),
  };
  insertBuilder.values.mockReturnValue(insertBuilder);
  insertBuilder.onConflictDoNothing.mockResolvedValue(undefined);

  return {
    db: {
      select: vi.fn().mockReturnValue(selectBuilder),
      selectDistinct: vi.fn().mockReturnValue(selectDistinctBuilder),
      update: vi.fn().mockReturnValue(updateBuilder),
      insert: vi.fn().mockReturnValue(insertBuilder),
      delete: vi.fn().mockReturnValue(deleteBuilder),
      execute: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
      transaction: vi.fn().mockResolvedValue(undefined),
    },
    selectBuilder,
    selectDistinctBuilder,
    updateBuilder,
    insertBuilder,
    deleteBuilder,
  };
}

describe('AuthorsRepository', () => {
  it('updateAuthorDescriptionIfEmpty treats whitespace-only descriptions as empty', async () => {
    const updateBuilder = {
      set: vi.fn(),
      where: vi.fn(),
      returning: vi.fn(),
    };
    updateBuilder.set.mockReturnValue(updateBuilder);
    updateBuilder.where.mockReturnValue(updateBuilder);
    updateBuilder.returning.mockResolvedValue([{ id: 11 }]);

    const db = {
      update: vi.fn().mockReturnValue(updateBuilder),
    };

    const repo = new AuthorsRepository(db as never);
    await expect(repo.updateAuthorDescriptionIfEmpty(11, 'New bio')).resolves.toBe(true);

    expect(sql).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith(expect.objectContaining({ op: 'sql' }), '');
    expect(updateBuilder.returning).toHaveBeenCalled();
  });

  it('returns early defaults for empty-library and empty-id short-circuit branches', async () => {
    const { db } = makeDb();
    const repo = new AuthorsRepository(db as never);

    await expect(repo.findById(1, [])).resolves.toBeNull();
    await expect(repo.findBookIdsPage({ authorId: 1, page: 0, size: 10, sort: 'title', order: 'asc', libraryIds: [] })).resolves.toEqual({
      bookIds: [],
      total: 0,
      page: 0,
      size: 10,
    });
    await expect(repo.findVisibleAuthorIds([], [1])).resolves.toEqual([]);
    await expect(repo.findVisibleAuthorIds([1], [])).resolves.toEqual([]);
    await expect(repo.countDistinctBooks([])).resolves.toBe(0);
    await expect(repo.findRelatedLibraryIds([])).resolves.toEqual([]);
    await expect(repo.mergeAuthors(1, [])).resolves.toBeUndefined();
    await expect(repo.deleteAuthors([])).resolves.toBeUndefined();

    expect(db.select).not.toHaveBeenCalled();
    expect(db.selectDistinct).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('maps distinct ids for visibility and related-library lookup queries', async () => {
    const { db, selectDistinctBuilder } = makeDb();
    selectDistinctBuilder.where.mockResolvedValueOnce([{ id: 5 }, { id: 8 }]).mockResolvedValueOnce([{ libraryId: 11 }, { libraryId: 12 }]);
    const repo = new AuthorsRepository(db as never);

    await expect(repo.findVisibleAuthorIds([5, 8], [100])).resolves.toEqual([5, 8]);
    await expect(repo.findRelatedLibraryIds([1, 2])).resolves.toEqual([11, 12]);
  });

  it('converts sql numeric aggregates from strings to numbers', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.where.mockResolvedValueOnce([{ total: '4' }]);
    const repo = new AuthorsRepository(db as never);

    await expect(repo.countDistinctBooks([1, 2])).resolves.toBe(4);
  });

  it('findByIdForEnrichment returns null when no row is found', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.limit.mockResolvedValue([]);
    const repo = new AuthorsRepository(db as never);

    await expect(repo.findByIdForEnrichment(77)).resolves.toBeNull();
  });

  it('findPage maps rows and total for standard count branch', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.where.mockReturnValueOnce(selectBuilder).mockResolvedValueOnce([{ total: '3' }]);
    selectBuilder.offset.mockResolvedValueOnce([
      {
        id: 1,
        name: 'A',
        sortName: 'A',
        description: null,
        bookCount: 2,
        lastAddedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    const repo = new AuthorsRepository(db as never);

    await expect(
      repo.findPage({
        page: 0,
        size: 20,
        sort: 'name',
        order: 'asc',
        libraryIds: [1],
        q: 'au',
        hasPhoto: true,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 1,
          name: 'A',
          sortName: 'A',
          description: null,
          bookCount: 2,
          lastAddedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      total: 3,
      page: 0,
      size: 20,
    });
  });

  it('findPage uses grouped subquery count when minBookCount is provided', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.from
      .mockReturnValueOnce(selectBuilder)
      .mockReturnValueOnce(selectBuilder)
      .mockResolvedValueOnce([{ total: '2' }]);
    selectBuilder.where.mockReturnValue(selectBuilder);
    selectBuilder.offset.mockResolvedValueOnce([{ id: 1 }]);
    const repo = new AuthorsRepository(db as never);

    await expect(
      repo.findPage({
        page: 1,
        size: 10,
        sort: 'bookCount',
        order: 'desc',
        libraryIds: [1, 2],
        minBookCount: 3,
      }),
    ).resolves.toEqual({
      items: [{ id: 1 }],
      total: 2,
      page: 1,
      size: 10,
    });
  });

  it.each(['name', 'sortName', 'lastEnrichedAt'] as const)('findPage does not use raw SQL for %s sorting', async (sort) => {
    const { db, selectBuilder } = makeDb();
    vi.mocked(sql.raw).mockClear();
    selectBuilder.where.mockReturnValueOnce(selectBuilder).mockResolvedValueOnce([{ total: '0' }]);
    selectBuilder.offset.mockResolvedValueOnce([]);
    const repo = new AuthorsRepository(db as never);

    await repo.findPage({
      page: 0,
      size: 10,
      sort,
      order: 'desc',
      libraryIds: [1],
    });

    expect(sql.raw).not.toHaveBeenCalled();
  });

  it('findById returns a summary row when the author is visible in selected libraries', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.limit.mockResolvedValueOnce([
      {
        id: 9,
        name: 'Visible Author',
        sortName: null,
        description: 'bio',
        bookCount: 4,
        lastAddedAt: new Date('2026-01-02T00:00:00Z'),
      },
    ]);
    const repo = new AuthorsRepository(db as never);

    await expect(repo.findById(9, [3])).resolves.toEqual({
      id: 9,
      name: 'Visible Author',
      sortName: null,
      description: 'bio',
      bookCount: 4,
      lastAddedAt: new Date('2026-01-02T00:00:00Z'),
    });
  });

  it('findBookIdsPage maps ids and coerces total for non-empty libraries', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.where.mockReturnValueOnce(selectBuilder).mockResolvedValueOnce([{ total: '2' }]);
    selectBuilder.offset.mockResolvedValueOnce([{ id: 100 }, { id: 101 }]);
    const repo = new AuthorsRepository(db as never);

    await expect(
      repo.findBookIdsPage({
        authorId: 1,
        page: 0,
        size: 5,
        sort: 'publishedYear',
        order: 'desc',
        libraryIds: [7],
      }),
    ).resolves.toEqual({
      bookIds: [100, 101],
      total: 2,
      page: 0,
      size: 5,
    });
  });

  it('updateAuthorById returns updated row or null when no row is updated', async () => {
    const { db, updateBuilder } = makeDb();
    updateBuilder.returning.mockResolvedValueOnce([
      { id: 5, name: 'Renamed', sortName: null, description: null, hasPhoto: false, lastEnrichedAt: null },
    ]);
    updateBuilder.returning.mockResolvedValueOnce([]);
    const repo = new AuthorsRepository(db as never);

    await expect(repo.updateAuthorById(5, { name: 'Renamed' })).resolves.toEqual({
      id: 5,
      name: 'Renamed',
      sortName: null,
      description: null,
      hasPhoto: false,
      lastEnrichedAt: null,
    });
    await expect(repo.updateAuthorById(999, { name: 'Missing' })).resolves.toBeNull();
  });

  it('updateAuthorDescriptionIfEmpty returns false when no row matches', async () => {
    const { db, updateBuilder } = makeDb();
    updateBuilder.returning.mockResolvedValueOnce([]);
    const repo = new AuthorsRepository(db as never);

    await expect(repo.updateAuthorDescriptionIfEmpty(12, 'Bio')).resolves.toBe(false);
  });

  it('mergeAuthors inserts deduplicated links and deletes source relations inside one transaction', async () => {
    const txSelectBuilder = {
      from: vi.fn(),
      where: vi.fn(),
    };
    txSelectBuilder.from.mockReturnValue(txSelectBuilder);
    txSelectBuilder.where.mockResolvedValue([
      { bookId: 1, displayOrder: 0 },
      { bookId: 2, displayOrder: 1 },
    ]);
    const txInsertBuilder = {
      values: vi.fn(),
      onConflictDoNothing: vi.fn(),
    };
    txInsertBuilder.values.mockReturnValue(txInsertBuilder);
    txInsertBuilder.onConflictDoNothing.mockResolvedValue(undefined);
    const txDeleteBuilder = {
      where: vi.fn(),
    };
    txDeleteBuilder.where.mockResolvedValue(undefined);
    const tx = {
      select: vi.fn().mockReturnValue(txSelectBuilder),
      insert: vi.fn().mockReturnValue(txInsertBuilder),
      delete: vi.fn().mockReturnValue(txDeleteBuilder),
      execute: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };
    const db = {
      transaction: vi.fn(async (handler: (client: typeof tx) => Promise<void>) => handler(tx)),
    };
    const repo = new AuthorsRepository(db as never);

    await repo.mergeAuthors(99, [1, 2]);

    expect(tx.insert).toHaveBeenCalled();
    expect(txDeleteBuilder.where).toHaveBeenCalledTimes(2);
  });

  it('mergeAuthors skips insert when source authors have no linked books', async () => {
    const txSelectBuilder = {
      from: vi.fn(),
      where: vi.fn(),
    };
    txSelectBuilder.from.mockReturnValue(txSelectBuilder);
    txSelectBuilder.where.mockResolvedValue([]);
    const txDeleteBuilder = {
      where: vi.fn(),
    };
    txDeleteBuilder.where.mockResolvedValue(undefined);
    const tx = {
      select: vi.fn().mockReturnValue(txSelectBuilder),
      insert: vi.fn(),
      delete: vi.fn().mockReturnValue(txDeleteBuilder),
      execute: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };
    const db = {
      transaction: vi.fn(async (handler: (client: typeof tx) => Promise<void>) => handler(tx)),
    };
    const repo = new AuthorsRepository(db as never);

    await repo.mergeAuthors(99, [1]);

    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.delete).toHaveBeenCalledTimes(2);
  });

  it('deleteAuthors removes joins and authors inside one transaction', async () => {
    const txSelectBuilder = {
      from: vi.fn(),
      where: vi.fn(),
    };
    txSelectBuilder.from.mockReturnValue(txSelectBuilder);
    txSelectBuilder.where.mockResolvedValue([{ bookId: 10 }]);
    const txDeleteBuilder = {
      where: vi.fn(),
    };
    txDeleteBuilder.where.mockResolvedValue(undefined);
    const tx = {
      select: vi.fn().mockReturnValue(txSelectBuilder),
      delete: vi.fn().mockReturnValue(txDeleteBuilder),
      execute: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
    };
    const db = {
      transaction: vi.fn(async (handler: (client: typeof tx) => Promise<void>) => handler(tx)),
    };
    const repo = new AuthorsRepository(db as never);

    await repo.deleteAuthors([5, 6]);

    expect(tx.delete).toHaveBeenCalledTimes(2);
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });
});
