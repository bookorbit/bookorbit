vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  asc: vi.fn((value: unknown) => ({ op: 'asc', value })),
  count: vi.fn(() => ({ op: 'count' })),
  desc: vi.fn((value: unknown) => ({ op: 'desc', value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  gt: vi.fn((left: unknown, right: unknown) => ({ op: 'gt', left, right })),
  ilike: vi.fn((left: unknown, right: unknown) => ({ op: 'ilike', left, right })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ op: 'inArray', left, right })),
  isNull: vi.fn((value: unknown) => ({ op: 'isNull', value })),
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
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    groupBy: vi.fn(),
  };
  selectBuilder.from.mockReturnValue(selectBuilder);
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

describe('BookDockRepository', () => {
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
      { status: 'pending', cnt: '3' },
      { status: 'ready', cnt: '5' },
      { status: 'error', cnt: '2' },
      { status: 'extracting', cnt: '1' },
      { status: 'fetching', cnt: '4' },
    ]);
    const repo = new BookDockRepository(db as never);

    await expect(repo.countsByStatus()).resolves.toEqual({
      pending: 8,
      ready: 5,
      error: 2,
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
      repo.findSelectionBatch({ limit: 2, afterId: 10, excludedIds: [3], status: 'error', search: 'foo', userId: 1, isSuperuser: false }),
    ).resolves.toEqual([{ id: 11 }, { id: 12 }]);
    expect(selectBuilder.orderBy).toHaveBeenCalled();
    expect(selectBuilder.limit).toHaveBeenCalledWith(2);
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
        isSuperuser: true,
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
      isSuperuser: true,
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
});
