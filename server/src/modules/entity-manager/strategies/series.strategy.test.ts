import { BadRequestException, NotFoundException } from '@nestjs/common';

import { SeriesStrategy } from './series.strategy';

function makeStrategy(db: Record<string, unknown> = {}) {
  return new SeriesStrategy(db as never);
}

function flattenSql(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenSql).join(' ');
  if (!value || typeof value !== 'object') return '';

  const record = value as { queryChunks?: unknown[]; value?: unknown };
  return [flattenSql(record.value), flattenSql(record.queryChunks)].join(' ');
}

function extractSqlParams(value: unknown): unknown[] {
  if (typeof value === 'number' || typeof value === 'string' || value === null || typeof value === 'boolean') return [value];
  if (!value || typeof value !== 'object') return [];

  const record = value as { queryChunks?: unknown[] };
  return Array.isArray(record.queryChunks) ? record.queryChunks.flatMap(extractSqlParams) : [];
}

function makeSelectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  const innerJoin = vi.fn();
  innerJoin.mockReturnValue({ where, innerJoin });
  const leftJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ where, innerJoin, leftJoin });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, innerJoin, leftJoin, where, orderBy, limit };
}

function makeWhereRowsSelectChain(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const innerJoin = vi.fn();
  innerJoin.mockReturnValue({ innerJoin, where });
  const from = vi.fn().mockReturnValue({ where, innerJoin });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, innerJoin, where };
}

function makeUpdateTx() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFrom = vi.fn().mockReturnValue({ where: deleteWhere });
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const tx = { update, execute, delete: deleteFrom };
  const transaction = vi.fn().mockImplementation(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx));
  return { transaction, tx, update, set, where, deleteFrom, deleteWhere, execute };
}

describe('SeriesStrategy', () => {
  function thenableRows(rows: unknown[]) {
    const promise = Promise.resolve(rows);
    return { then: promise.then.bind(promise) };
  }

  it('does not compute candidate pairs without a library scope', async () => {
    const transaction = vi.fn();
    const strategy = makeStrategy({ transaction });

    await expect(strategy.findCandidatePairs([], 0.5)).resolves.toEqual([]);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('computes candidate pairs inside a transaction with clamped similarity', async () => {
    const rows = [{ idA: 1, idB: 2, nameA: 'Dune', nameB: 'Dune Saga', simScore: 0.8 }];
    const execute = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows });
    const transaction = vi.fn().mockImplementation(async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }));
    const strategy = makeStrategy({ transaction });

    await expect(strategy.findCandidatePairs([1, 2], 2)).resolves.toEqual(rows);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
    const matchSql = execute.mock.calls[1]![0];
    const matchSqlText = flattenSql(matchSql).replace(/\s+/g, ' ');
    expect(matchSqlText).toContain('b.library_id IN (');
    expect(matchSqlText).not.toContain('b.library_id IN (1,2)');
    expect(extractSqlParams(matchSql)).toEqual(expect.arrayContaining([1, 2]));
  });

  it('does not compute candidate pairs when library ids are invalid after normalization', async () => {
    const transaction = vi.fn();
    const strategy = makeStrategy({ transaction });

    await expect(strategy.findCandidatePairs([0, Number.NaN], 0.5)).resolves.toEqual([]);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('computes batch candidate pairs for non-empty batches', async () => {
    const rows = [{ idA: 1, idB: 3, nameA: 'Dune', nameB: 'Dune Deluxe', simScore: 0.9 }];
    const execute = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows });
    const transaction = vi.fn().mockImplementation(async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }));
    const strategy = makeStrategy({ transaction });

    await expect(strategy.computeCandidatePairsForBatch([1], 0.9)).resolves.toEqual(rows);

    expect(execute).toHaveBeenCalledTimes(2);
    const matchSql = execute.mock.calls[1]![0];
    const matchSqlText = flattenSql(matchSql).replace(/\s+/g, ' ');
    expect(matchSqlText).toContain('WHERE id IN (');
    expect(matchSqlText).not.toContain('ARRAY[1]');
    expect(extractSqlParams(matchSql)).toEqual(expect.arrayContaining([1]));
  });

  it('returns an empty batch candidate set for empty batches', async () => {
    const transaction = vi.fn();
    const strategy = makeStrategy({ transaction });

    await expect(strategy.computeCandidatePairsForBatch([], 0.5)).resolves.toEqual([]);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns an empty batch candidate set when batch ids are invalid after normalization', async () => {
    const transaction = vi.fn();
    const strategy = makeStrategy({ transaction });

    await expect(strategy.computeCandidatePairsForBatch([0, Number.NaN], 0.5)).resolves.toEqual([]);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('browses table-backed series with left joined memberships so empty rows can appear', async () => {
    const subqueryWhere = vi.fn().mockReturnValue({ _isSubquery: true });
    const subqueryFrom = vi.fn().mockReturnValue({ where: subqueryWhere });

    const relationWhere = vi.fn().mockReturnValue({ _isRelationSubquery: true });
    const relationFrom = vi.fn().mockReturnValue({ where: relationWhere });

    const countWhere = vi.fn().mockResolvedValue([{ total: 1 }]);
    const countFrom = vi.fn().mockReturnValue({ where: countWhere });

    const offset = vi.fn().mockResolvedValue([{ id: 42, name: 'Dune', bookCount: 6 }]);
    const limit = vi.fn().mockReturnValue({ offset });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const dynamic = { having: vi.fn(), orderBy, ...thenableRows([{ id: 42, name: 'Dune', bookCount: 6 }]) };
    const groupBy = vi.fn().mockReturnValue({ $dynamic: vi.fn().mockReturnValue(dynamic) });
    const itemWhere = vi.fn().mockReturnValue({ groupBy });
    const itemLeftJoin = vi.fn().mockReturnValue({ where: itemWhere });
    const itemFrom = vi.fn().mockReturnValue({ leftJoin: itemLeftJoin });

    const select = vi
      .fn()
      .mockReturnValueOnce({ from: subqueryFrom })
      .mockReturnValueOnce({ from: relationFrom })
      .mockReturnValueOnce({ from: relationFrom })
      .mockReturnValueOnce({ from: countFrom })
      .mockReturnValueOnce({ from: itemFrom });
    const strategy = makeStrategy({ select });

    const result = await strategy.browse({
      libraryIds: [1],
      search: 'Dune',
      page: 1,
      pageSize: 25,
      sortBy: 'bookCount',
      sortOrder: 'desc',
      bookCount: 'any',
    });

    expect(result).toEqual({ items: [{ id: 42, name: 'Dune', bookCount: 6 }], total: 1 });
    expect(select).toHaveBeenCalledTimes(5);
    expect(relationWhere).toHaveBeenCalledTimes(2);
    expect(itemLeftJoin).toHaveBeenCalledTimes(1);
  });

  it('returns zero-book series when filtering to empty entities', async () => {
    const subqueryWhere = vi.fn().mockReturnValue({ _isSubquery: true });
    const subqueryFrom = vi.fn().mockReturnValue({ where: subqueryWhere });

    const relationWhere = vi.fn().mockReturnValue({ _isRelationSubquery: true });
    const relationFrom = vi.fn().mockReturnValue({ where: relationWhere });

    const countWhere = vi.fn().mockResolvedValue([{ total: 1 }]);
    const countFrom = vi.fn().mockReturnValue({ where: countWhere });

    const offset = vi.fn().mockResolvedValue([{ id: 99, name: 'Unused', bookCount: 0 }]);
    const limit = vi.fn().mockReturnValue({ offset });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const dynamic = { having: vi.fn(), orderBy, ...thenableRows([{ id: 99, name: 'Unused', bookCount: 0 }]) };
    const groupBy = vi.fn().mockReturnValue({ $dynamic: vi.fn().mockReturnValue(dynamic) });
    const itemWhere = vi.fn().mockReturnValue({ groupBy });
    const itemLeftJoin = vi.fn().mockReturnValue({ where: itemWhere });
    const itemFrom = vi.fn().mockReturnValue({ leftJoin: itemLeftJoin });

    const select = vi
      .fn()
      .mockReturnValueOnce({ from: subqueryFrom })
      .mockReturnValueOnce({ from: relationFrom })
      .mockReturnValueOnce({ from: relationFrom })
      .mockReturnValueOnce({ from: countFrom })
      .mockReturnValueOnce({ from: itemFrom });
    const strategy = makeStrategy({ select });

    await expect(
      strategy.browse({ libraryIds: [1], page: 1, pageSize: 25, sortBy: 'bookCount', sortOrder: 'asc', bookCount: 'empty' }),
    ).resolves.toEqual({
      items: [{ id: 99, name: 'Unused', bookCount: 0 }],
      total: 1,
    });

    expect(relationWhere).toHaveBeenCalledTimes(2);
    expect(dynamic.having).not.toHaveBeenCalled();
  });

  it('merges source series memberships into a target for scoped books only', async () => {
    const { transaction, execute } = makeUpdateTx();
    const strategy = makeStrategy({ transaction });
    vi.spyOn(strategy, 'findEntityById').mockResolvedValue({ id: 1, name: 'Target' });
    vi.spyOn(strategy as never, 'findAffectedBookIdsInLibraries').mockResolvedValue([10, 20]);
    vi.spyOn(strategy as never, 'deleteUnusedSeriesRows').mockResolvedValue(undefined);

    await expect(strategy.merge({ targetId: 1, sourceIds: [2, 3], userId: 9, libraryIds: [5] })).resolves.toEqual({
      affectedBookIds: [10, 20],
    });

    const statements = execute.mock.calls.map((call) => flattenSql(call[0]).replace(/\s+/g, ' '));
    expect(statements.some((statement) => statement.includes('UPDATE book_series_memberships'))).toBe(true);
    expect(statements.some((statement) => statement.includes('UPDATE book_metadata bm'))).toBe(true);
  });

  it('does not merge when target or source ids are invalid', async () => {
    const strategy = makeStrategy({});

    await expect(strategy.merge({ targetId: 0, sourceIds: [2], userId: 9, libraryIds: [1] })).resolves.toEqual({ affectedBookIds: [] });
    await expect(strategy.merge({ targetId: 1, sourceIds: [1, 'bad'], userId: 9, libraryIds: [1] })).resolves.toEqual({ affectedBookIds: [] });
  });

  it('throws when merge target series is missing', async () => {
    const strategy = makeStrategy({});
    vi.spyOn(strategy, 'findEntityById').mockResolvedValue(null);

    await expect(strategy.merge({ targetId: 1, sourceIds: [2], userId: 9, libraryIds: [1] })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('renames a series and reports implicit merges', async () => {
    const { transaction, execute } = makeUpdateTx();
    const strategy = makeStrategy({ transaction });
    vi.spyOn(strategy, 'findEntityById').mockResolvedValue({ id: 2, name: 'Old' });
    vi.spyOn(strategy as never, 'upsertSeries').mockResolvedValue({ id: 5, name: 'New' });
    vi.spyOn(strategy as never, 'findAffectedBookIdsInLibraries').mockResolvedValue([10]);
    vi.spyOn(strategy as never, 'deleteUnusedSeriesRows').mockResolvedValue(undefined);

    const result = await strategy.rename({ entityId: 2, newName: ' New ', userId: 9, libraryIds: [1] });

    expect(result).toEqual({ oldName: 'Old', affectedBookIds: [10], wasImplicitMerge: true, mergedEntityId: 5 });
    const statements = execute.mock.calls.map((call) => flattenSql(call[0]).replace(/\s+/g, ' '));
    expect(statements.some((statement) => statement.includes('UPDATE book_series_memberships'))).toBe(true);
    expect(statements.some((statement) => statement.includes('UPDATE book_metadata bm'))).toBe(true);
  });

  it('renames a series without reporting a merge when the identity is unchanged', async () => {
    const { transaction } = makeUpdateTx();
    const strategy = makeStrategy({ transaction });
    vi.spyOn(strategy, 'findEntityById').mockResolvedValue({ id: 2, name: 'Old' });
    vi.spyOn(strategy as never, 'upsertSeries').mockResolvedValue({ id: 2, name: 'New' });
    vi.spyOn(strategy as never, 'findAffectedBookIdsInLibraries').mockResolvedValue([10]);
    vi.spyOn(strategy as never, 'deleteUnusedSeriesRows').mockResolvedValue(undefined);

    await expect(strategy.rename({ entityId: 2, newName: 'New', userId: 9, libraryIds: [1] })).resolves.toEqual({
      oldName: 'Old',
      affectedBookIds: [10],
      wasImplicitMerge: false,
      mergedEntityId: undefined,
    });
  });

  it('does not create a target series row when rename affects no scoped books', async () => {
    const transaction = vi.fn();
    const strategy = makeStrategy({ transaction });
    vi.spyOn(strategy, 'findEntityById').mockResolvedValue({ id: 2, name: 'Old' });
    const upsertSeries = vi.spyOn(strategy as never, 'upsertSeries').mockResolvedValue({ id: 5, name: 'New' });
    vi.spyOn(strategy as never, 'findAffectedBookIdsInLibraries').mockResolvedValue([]);

    const result = await strategy.rename({ entityId: 2, newName: ' New ', userId: 9, libraryIds: [1] });

    expect(result).toEqual({ oldName: 'Old', affectedBookIds: [], wasImplicitMerge: false });
    expect(upsertSeries).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects blank series renames', async () => {
    const strategy = makeStrategy({});
    vi.spyOn(strategy, 'findEntityById').mockResolvedValue({ id: 2, name: 'Old' });

    await expect(strategy.rename({ entityId: 2, newName: '   ', userId: 9, libraryIds: [1] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes a series by removing scoped memberships and syncing primary metadata', async () => {
    const { transaction, deleteFrom, deleteWhere, execute } = makeUpdateTx();
    const strategy = makeStrategy({ transaction });
    vi.spyOn(strategy, 'findEntityById').mockResolvedValue({ id: 2, name: 'Old' });
    vi.spyOn(strategy as never, 'findAffectedBookIdsInLibraries').mockResolvedValue([10, 11]);
    vi.spyOn(strategy as never, 'deleteUnusedSeriesRows').mockResolvedValue(undefined);

    const result = await strategy.deleteEntity({ entityId: 2, mode: 'hard', libraryIds: [1] });

    expect(result).toEqual({ name: 'Old', affectedBookIds: [10, 11] });
    expect(deleteFrom).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    const statements = execute.mock.calls.map((call) => flattenSql(call[0]).replace(/\s+/g, ' '));
    expect(statements.some((statement) => statement.includes('UPDATE book_metadata bm'))).toBe(true);
  });

  it('hard deletes an unused series row when no scoped books are affected', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const strategy = makeStrategy({ execute });
    vi.spyOn(strategy, 'findEntityById').mockResolvedValue({ id: 2, name: 'Old' });
    vi.spyOn(strategy as never, 'findAffectedBookIdsInLibraries').mockResolvedValue([]);

    await expect(strategy.deleteEntity({ entityId: 2, mode: 'hard', libraryIds: [1] })).resolves.toEqual({
      name: 'Old',
      affectedBookIds: [],
    });

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('throws when deleting a missing series', async () => {
    const strategy = makeStrategy({});
    vi.spyOn(strategy, 'findEntityById').mockResolvedValue(null);

    await expect(strategy.deleteEntity({ entityId: 2, mode: 'hard', libraryIds: [1] })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not support splitting series', () => {
    const strategy = makeStrategy({});

    expect(() => strategy.split()).toThrow(BadRequestException);
  });

  it('finds all series ids', async () => {
    const orderBy = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const from = vi.fn().mockReturnValue({ orderBy });
    const select = vi.fn().mockReturnValue({ from });
    const strategy = makeStrategy({ select });

    await expect(strategy.getAllEntityIds()).resolves.toEqual([1, 2]);
  });

  it('finds affected book ids by series id', async () => {
    const { select } = makeWhereRowsSelectChain([{ bookId: 10 }, { bookId: 20 }]);
    const strategy = makeStrategy({ select });

    await expect(strategy.findAffectedBookIds([1, '2', 'bad'])).resolves.toEqual([10, 20]);
  });

  it('skips affected book lookup for invalid ids', async () => {
    const select = vi.fn();
    const strategy = makeStrategy({ select });

    await expect(strategy.findAffectedBookIds(['bad'])).resolves.toEqual([]);

    expect(select).not.toHaveBeenCalled();
  });

  it('counts books for a series', async () => {
    const where = vi.fn().mockResolvedValue([{ count: 3 }]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const strategy = makeStrategy({ select });

    await expect(strategy.getBookCount(1)).resolves.toBe(3);
  });

  it('returns zero when a series has no book count row', async () => {
    const where = vi.fn().mockResolvedValue([]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const strategy = makeStrategy({ select });

    await expect(strategy.getBookCount(1)).resolves.toBe(0);
  });

  it('returns book titles for a series', async () => {
    const limit = vi.fn().mockResolvedValue([{ title: 'A' }, { title: 'B' }]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const innerJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ innerJoin });
    const select = vi.fn().mockReturnValue({ from });
    const strategy = makeStrategy({ select });

    await expect(strategy.getBookTitles(1, 5)).resolves.toEqual(['A', 'B']);
  });

  it('finds a series entity by id', async () => {
    const { select } = makeSelectChain([{ id: 3, name: 'Dune' }]);
    const strategy = makeStrategy({ select });

    await expect(strategy.findEntityById(3)).resolves.toEqual({ id: 3, name: 'Dune' });
  });

  it('returns null when a series entity is missing by id', async () => {
    const { select } = makeSelectChain([]);
    const strategy = makeStrategy({ select });

    await expect(strategy.findEntityById(3)).resolves.toBeNull();
  });

  it('upserts a series by normalized name', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 9, name: 'Dune Chronicles' }]);
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const strategy = makeStrategy({ insert });

    await expect(
      (strategy as unknown as { upsertSeries(name: string): Promise<{ id: number; name: string }> }).upsertSeries('  Dune   Chronicles '),
    ).resolves.toEqual({
      id: 9,
      name: 'Dune Chronicles',
    });

    expect(values).toHaveBeenCalledWith({ name: 'Dune Chronicles', normalizedName: 'dune chronicles' });
  });

  it('rejects a series upsert when the database returns no row', async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const strategy = makeStrategy({ insert });

    await expect(
      (strategy as unknown as { upsertSeries(name: string): Promise<{ id: number; name: string }> }).upsertSeries('Dune'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('finds affected book ids in scoped libraries', async () => {
    const { select } = makeWhereRowsSelectChain([{ bookId: 10 }]);
    const strategy = makeStrategy({ select });

    await expect(
      (
        strategy as unknown as { findAffectedBookIdsInLibraries(seriesIds: number[], libraryIds?: number[]): Promise<number[]> }
      ).findAffectedBookIdsInLibraries([1], [5]),
    ).resolves.toEqual([10]);
  });

  it('skips scoped affected lookup without ids or libraries', async () => {
    const select = vi.fn();
    const strategy = makeStrategy({ select });
    const privateStrategy = strategy as unknown as { findAffectedBookIdsInLibraries(seriesIds: number[], libraryIds?: number[]): Promise<number[]> };

    await expect(privateStrategy.findAffectedBookIdsInLibraries([], [1])).resolves.toEqual([]);
    await expect(privateStrategy.findAffectedBookIdsInLibraries([1], [])).resolves.toEqual([]);
    await expect(privateStrategy.findAffectedBookIdsInLibraries([1], undefined)).resolves.toEqual([]);

    expect(select).not.toHaveBeenCalled();
  });

  it('deletes only unused series rows', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const strategy = makeStrategy({});

    await (
      strategy as unknown as { deleteUnusedSeriesRows(seriesIds: number[], db: { execute: typeof execute }): Promise<void> }
    ).deleteUnusedSeriesRows([1, 2], { execute });

    expect(execute).toHaveBeenCalledTimes(1);
    const deleteSql = execute.mock.calls[0]![0];
    expect(flattenSql(deleteSql).replace(/\s+/g, ' ')).not.toContain('s.id IN (1,2)');
    expect(extractSqlParams(deleteSql)).toEqual(expect.arrayContaining([1, 2]));
  });

  it('skips unused series cleanup when ids normalize empty', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const strategy = makeStrategy({});

    await (
      strategy as unknown as { deleteUnusedSeriesRows(seriesIds: number[], db: { execute: typeof execute }): Promise<void> }
    ).deleteUnusedSeriesRows([0, Number.NaN], { execute });

    expect(execute).not.toHaveBeenCalled();
  });
});
