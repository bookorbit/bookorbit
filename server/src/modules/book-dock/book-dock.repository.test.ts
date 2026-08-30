vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  asc: vi.fn((value: unknown) => ({ op: 'asc', value })),
  count: vi.fn(() => ({ op: 'count' })),
  desc: vi.fn((value: unknown) => ({ op: 'desc', value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  gt: vi.fn((left: unknown, right: unknown) => ({ op: 'gt', left, right })),
  ilike: vi.fn((left: unknown, right: unknown) => ({ op: 'ilike', left, right })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ op: 'inArray', left, right })),
  isNotNull: vi.fn((value: unknown) => ({ op: 'isNotNull', value })),
  isNull: vi.fn((value: unknown) => ({ op: 'isNull', value })),
  lt: vi.fn((left: unknown, right: unknown) => ({ op: 'lt', left, right })),
  notInArray: vi.fn((left: unknown, right: unknown[]) => ({ op: 'notInArray', left, right })),
  or: vi.fn((...clauses: unknown[]) => ({ op: 'or', clauses })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
    {
      join: vi.fn((chunks: unknown[], separator: unknown) => ({ op: 'sql.join', chunks, separator })),
    },
  ),
  sum: vi.fn((value: unknown) => ({ op: 'sum', value })),
}));

import { BookDockRepository } from './book-dock.repository';

function makeDb() {
  const selectBuilder = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    groupBy: vi.fn(),
  };
  selectBuilder.from.mockReturnValue(selectBuilder);
  selectBuilder.innerJoin.mockReturnValue(selectBuilder);
  selectBuilder.where.mockReturnValue(selectBuilder);
  selectBuilder.orderBy.mockReturnValue(selectBuilder);
  selectBuilder.offset.mockResolvedValue([]);
  selectBuilder.limit.mockReturnValue(selectBuilder);
  selectBuilder.groupBy.mockResolvedValue([]);

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
    returning: vi.fn(),
  };
  deleteBuilder.where.mockReturnValue(deleteBuilder);
  deleteBuilder.returning.mockResolvedValue([]);

  const insertBuilder = {
    values: vi.fn(),
    returning: vi.fn(),
  };
  insertBuilder.values.mockReturnValue(insertBuilder);
  insertBuilder.returning.mockResolvedValue([]);

  return {
    db: {
      select: vi.fn().mockReturnValue(selectBuilder),
      insert: vi.fn().mockReturnValue(insertBuilder),
      update: vi.fn().mockReturnValue(updateBuilder),
      delete: vi.fn().mockReturnValue(deleteBuilder),
    },
    selectBuilder,
    insertBuilder,
    updateBuilder,
    deleteBuilder,
  };
}

function hasReadyToFileCondition(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const node = value as { op?: string; clauses?: unknown[]; right?: unknown };
  const clauses = node.clauses ?? [];
  if (
    node.op === 'and' &&
    clauses.some((clause) => (clause as { op?: string; right?: unknown }).op === 'eq' && (clause as { right?: unknown }).right === 'ready') &&
    clauses.filter((clause) => (clause as { op?: string }).op === 'isNotNull').length === 2
  ) {
    return true;
  }
  return clauses.some(hasReadyToFileCondition);
}

describe('BookDockRepository', () => {
  it('findExistingBooksByAbsolutePaths short-circuits an empty path list', async () => {
    const { db } = makeDb();
    const repo = new BookDockRepository(db as never);

    await expect(repo.findExistingBooksByAbsolutePaths([])).resolves.toEqual([]);

    expect(db.select).not.toHaveBeenCalled();
  });

  it('findExistingBooksByAbsolutePaths deduplicates paths in one joined query', async () => {
    const { db, selectBuilder } = makeDb();
    const existing = [{ absolutePath: '/library/book.epub', bookId: 12, libraryId: 5 }];
    selectBuilder.where.mockResolvedValueOnce(existing);
    const repo = new BookDockRepository(db as never);

    await expect(repo.findExistingBooksByAbsolutePaths(['/library/book.epub', '/library/book.epub'])).resolves.toEqual(existing);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(selectBuilder.innerJoin).toHaveBeenCalledTimes(1);
    expect(selectBuilder.where).toHaveBeenCalledWith(expect.objectContaining({ op: 'inArray', right: ['/library/book.epub'] }));
  });

  it('findByIds/deleteByIds/setTargetsByIds short-circuit empty selections', async () => {
    const { db } = makeDb();
    const repo = new BookDockRepository(db as never);

    await expect(repo.findByIds([])).resolves.toEqual([]);
    await expect(repo.deleteByIds([])).resolves.toBeUndefined();
    await expect(repo.setTargetsByIds([], 1, 2)).resolves.toBe(0);

    expect(db.select).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('countsByStatus maps queue statuses and computes total', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.groupBy.mockResolvedValue([
      { status: 'pending', cnt: '3', needsReview: '0', readyToFile: '0' },
      { status: 'ready', cnt: '5', needsReview: '2', readyToFile: '3' },
      { status: 'error', cnt: '2', needsReview: '0', readyToFile: '0' },
      { status: 'extracting', cnt: '1', needsReview: '0', readyToFile: '0' },
      { status: 'fetching', cnt: '4', needsReview: '0', readyToFile: '0' },
    ]);
    const repo = new BookDockRepository(db as never);

    await expect(repo.countsByStatus()).resolves.toEqual({
      pending: 8,
      working: 5,
      ready: 5,
      error: 2,
      needsReview: 2,
      readyToFile: 3,
      total: 15,
    });
  });

  it('getStatistics normalizes null formats and aggregates total size', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.groupBy.mockResolvedValue([
      { format: 'epub', cnt: '2', totalSize: '2000' },
      { format: null, cnt: '1', totalSize: null },
    ]);
    const repo = new BookDockRepository(db as never);

    await expect(repo.getStatistics()).resolves.toEqual({
      totalSizeBytes: 2000,
      byFormat: [
        { format: 'epub', count: 2, sizeBytes: 2000 },
        { format: 'unknown', count: 1, sizeBytes: 0 },
      ],
    });
  });

  it('findAllIds returns id list from filtered selection query', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.where.mockResolvedValue([{ id: 4 }, { id: 7 }]);
    const repo = new BookDockRepository(db as never);

    await expect(repo.findAllIds([1], 'pending', 'dune')).resolves.toEqual([4, 7]);
  });

  it('findSelectionBatch applies deterministic ordering and limit', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.limit.mockResolvedValue([{ id: 11 }, { id: 12 }]);
    const repo = new BookDockRepository(db as never);

    await expect(
      repo.findSelectionBatch({ limit: 2, afterId: 10, excludedIds: [3], status: 'error', search: 'foo', userId: 1, canManageAll: false }),
    ).resolves.toEqual([{ id: 11 }, { id: 12 }]);
    expect(selectBuilder.orderBy).toHaveBeenCalled();
    expect(selectBuilder.limit).toHaveBeenCalledWith(2);
  });

  it('uses the same ready-to-file predicate for paged results and select-all batches', async () => {
    const paged = makeDb();
    paged.selectBuilder.where.mockReturnValueOnce(paged.selectBuilder).mockResolvedValueOnce([{ total: 1 }]);
    paged.selectBuilder.offset.mockResolvedValueOnce([{ id: 1 }]);
    const pagedRepo = new BookDockRepository(paged.db as never);

    await pagedRepo.findAll({
      readyToFile: true,
      page: 1,
      limit: 20,
      sort: 'createdAt',
      order: 'desc',
      userId: 1,
      canManageAll: true,
    });

    expect(paged.selectBuilder.where.mock.calls).toHaveLength(2);
    for (const [where] of paged.selectBuilder.where.mock.calls) {
      expect(hasReadyToFileCondition(where)).toBe(true);
    }

    const batched = makeDb();
    batched.selectBuilder.limit.mockResolvedValueOnce([{ id: 1 }]);
    const batchedRepo = new BookDockRepository(batched.db as never);

    await batchedRepo.findSelectionBatch({ limit: 20, readyToFile: true, userId: 1, canManageAll: true });

    expect(hasReadyToFileCondition(batched.selectBuilder.where.mock.calls[0]?.[0])).toBe(true);
  });

  it('findAll returns paged rows and scalar total using status/search filters', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.where.mockReturnValueOnce(selectBuilder).mockResolvedValueOnce([{ total: 7 }]);
    selectBuilder.offset.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const repo = new BookDockRepository(db as never);

    await expect(
      repo.findAll({
        status: 'pending',
        page: 2,
        limit: 2,
        sort: 'fileName',
        order: 'asc',
        search: 'dune',
        userId: 1,
        canManageAll: true,
      }),
    ).resolves.toEqual({
      items: [{ id: 1 }, { id: 2 }],
      total: 7,
    });
  });

  it('findAll adds id as a deterministic tie-breaker for pagination order', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.where.mockReturnValueOnce(selectBuilder).mockResolvedValueOnce([{ total: 2 }]);
    selectBuilder.offset.mockResolvedValueOnce([{ id: 2 }, { id: 1 }]);
    const repo = new BookDockRepository(db as never);

    await repo.findAll({
      page: 1,
      limit: 20,
      sort: 'createdAt',
      order: 'desc',
      userId: 1,
      canManageAll: true,
    });

    expect(selectBuilder.orderBy).toHaveBeenCalledWith(expect.objectContaining({ op: 'desc' }), expect.objectContaining({ op: 'desc' }));
  });

  it('findById and findByAbsolutePath return the first selected row', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.limit.mockResolvedValueOnce([{ id: 9 }]).mockResolvedValueOnce([{ id: 10 }]);
    const repo = new BookDockRepository(db as never);

    await expect(repo.findById(9)).resolves.toEqual({ id: 9 });
    await expect(repo.findByAbsolutePath('/bucket/10.epub')).resolves.toEqual({ id: 10 });
  });

  it('create and update return first returning row or undefined when update misses', async () => {
    const { db, insertBuilder, updateBuilder } = makeDb();
    insertBuilder.returning.mockResolvedValueOnce([{ id: 1, fileName: 'book.epub' }]);
    updateBuilder.returning.mockResolvedValueOnce([{ id: 1, status: 'ready' }]).mockResolvedValueOnce([]);
    const repo = new BookDockRepository(db as never);

    await expect(repo.create({ fileName: 'book.epub' } as never)).resolves.toEqual({ id: 1, fileName: 'book.epub' });
    await expect(repo.update(1, { status: 'ready' } as never)).resolves.toEqual({ id: 1, status: 'ready' });
    await expect(repo.update(999, { status: 'error' } as never)).resolves.toBeUndefined();
  });

  it('deleteById and deleteByAbsolutePath issue delete queries', async () => {
    const { db } = makeDb();
    const repo = new BookDockRepository(db as never);

    await repo.deleteById(1);
    await repo.deleteByAbsolutePath('/bucket/book.epub');

    expect(db.delete).toHaveBeenCalledTimes(2);
  });

  it('findByIds and setTargetsByIds work for non-empty id sets', async () => {
    const { db, selectBuilder, updateBuilder } = makeDb();
    selectBuilder.where.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    updateBuilder.returning.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const repo = new BookDockRepository(db as never);

    await expect(repo.findByIds([1, 2])).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    await expect(repo.setTargetsByIds([1, 2], 4, 5)).resolves.toBe(2);
  });

  it('limits personal queries to files uploaded by that user', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.where.mockResolvedValueOnce([{ id: 1, uploadedBy: 7 }]);
    const repo = new BookDockRepository(db as never);

    await repo.findByIds([1, 2], 7, false);

    expect(selectBuilder.where).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'and',
        clauses: expect.arrayContaining([expect.objectContaining({ op: 'eq', right: 7 })]),
      }),
    );
  });

  it('does not add an uploader filter for global Book Dock managers', async () => {
    const { db, selectBuilder } = makeDb();
    selectBuilder.where.mockResolvedValueOnce([]);
    const repo = new BookDockRepository(db as never);

    await repo.findByIds([1, 2], 7, true);

    expect(selectBuilder.where).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'and',
        clauses: [expect.objectContaining({ op: 'inArray' })],
      }),
    );
  });
});
