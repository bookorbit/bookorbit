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
  const from = vi.fn().mockReturnValue({ where, innerJoin });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, innerJoin, where, orderBy, limit };
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
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const tx = { update, execute };
  const transaction = vi.fn().mockImplementation(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx));
  return { transaction, tx, update, set, where, execute };
}

describe('SeriesStrategy', () => {
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

  it('browses table-backed series within accessible libraries', async () => {
    const countWhere = vi.fn().mockResolvedValue([{ total: 1 }]);
    const countInnerJoin = vi.fn();
    countInnerJoin.mockReturnValue({ innerJoin: countInnerJoin, where: countWhere });
    const countFrom = vi.fn().mockReturnValue({ innerJoin: countInnerJoin });

    const offset = vi.fn().mockResolvedValue([{ id: 42, name: 'Dune', bookCount: 6 }]);
    const limit = vi.fn().mockReturnValue({ offset });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const groupBy = vi.fn().mockReturnValue({ orderBy });
    const itemWhere = vi.fn().mockReturnValue({ groupBy });
    const itemInnerJoin = vi.fn();
    itemInnerJoin.mockReturnValue({ innerJoin: itemInnerJoin, where: itemWhere });
    const itemFrom = vi.fn().mockReturnValue({ innerJoin: itemInnerJoin });

    const select = vi.fn().mockReturnValueOnce({ from: countFrom }).mockReturnValueOnce({ from: itemFrom });
    const strategy = makeStrategy({ select });

    const result = await strategy.browse({ libraryIds: [1], search: 'Dune', page: 1, pageSize: 25, sortBy: 'bookCount', sortOrder: 'desc' });

    expect(result).toEqual({ items: [{ id: 42, name: 'Dune', bookCount: 6 }], total: 1 });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('returns an empty browse result without library access', async () => {
    const select = vi.fn();
    const strategy = makeStrategy({ select });

    await expect(strategy.browse({ libraryIds: [], page: 1, pageSize: 25, sortBy: 'name', sortOrder: 'asc' })).resolves.toEqual({
      items: [],
      total: 0,
    });

    expect(select).not.toHaveBeenCalled();
  });

  it('merges source series into a target for scoped books only', async () => {
    const { transaction, set, where } = makeUpdateTx();
    const strategy = makeStrategy({ transaction });
    vi.spyOn(strategy, 'findEntityById').mockResolvedValue({ id: 1, name: 'Target' });
    vi.spyOn(strategy as never, 'findAffectedBookIdsInLibraries').mockResolvedValue([10, 20]);
    vi.spyOn(strategy as never, 'deleteUnusedSeriesRows').mockResolvedValue(undefined);

    await expect(strategy.merge({ targetId: 1, sourceIds: [2, 3], userId: 9, libraryIds: [5] })).resolves.toEqual({
      affectedBookIds: [10, 20],
    });

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ seriesId: 1, seriesName: 'Target', updatedAt: expect.any(Date) }));
    expect(where).toHaveBeenCalledTimes(1);
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
    const { transaction, set } = makeUpdateTx();
    const strategy = makeStrategy({ transaction });
    vi.spyOn(strategy, 'findEntityById').mockResolvedValue({ id: 2, name: 'Old' });
    vi.spyOn(strategy as never, 'upsertSeries').mockResolvedValue({ id: 5, name: 'New' });
    vi.spyOn(strategy as never, 'findAffectedBookIdsInLibraries').mockResolvedValue([10]);
    vi.spyOn(strategy as never, 'deleteUnusedSeriesRows').mockResolvedValue(undefined);

    const result = await strategy.rename({ entityId: 2, newName: ' New ', userId: 9, libraryIds: [1] });

    expect(result).toEqual({ oldName: 'Old', affectedBookIds: [10], wasImplicitMerge: true, mergedEntityId: 5 });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ seriesId: 5, seriesName: 'New', updatedAt: expect.any(Date) }));
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

  it('deletes a series by clearing metadata for scoped books', async () => {
    const { transaction, set } = makeUpdateTx();
    const strategy = makeStrategy({ transaction });
    vi.spyOn(strategy, 'findEntityById').mockResolvedValue({ id: 2, name: 'Old' });
    vi.spyOn(strategy as never, 'findAffectedBookIdsInLibraries').mockResolvedValue([10, 11]);
    vi.spyOn(strategy as never, 'deleteUnusedSeriesRows').mockResolvedValue(undefined);

    const result = await strategy.deleteEntity({ entityId: 2, mode: 'hard', libraryIds: [1] });

    expect(result).toEqual({ name: 'Old', affectedBookIds: [10, 11] });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ seriesId: null, seriesName: null, updatedAt: expect.any(Date) }));
  });

  it('does not start a delete transaction when no scoped books are affected', async () => {
    const transaction = vi.fn();
    const strategy = makeStrategy({ transaction });
    vi.spyOn(strategy, 'findEntityById').mockResolvedValue({ id: 2, name: 'Old' });
    vi.spyOn(strategy as never, 'findAffectedBookIdsInLibraries').mockResolvedValue([]);

    await expect(strategy.deleteEntity({ entityId: 2, mode: 'hard', libraryIds: [1] })).resolves.toEqual({
      name: 'Old',
      affectedBookIds: [],
    });

    expect(transaction).not.toHaveBeenCalled();
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
    const from = vi.fn().mockReturnValue({ where });
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
    const returning = vi.fn().mockResolvedValue([{ id: 9, name: 'Dune' }]);
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const strategy = makeStrategy({ insert });

    await expect(
      (strategy as unknown as { upsertSeries(name: string): Promise<{ id: number; name: string }> }).upsertSeries('Dune'),
    ).resolves.toEqual({
      id: 9,
      name: 'Dune',
    });

    expect(values).toHaveBeenCalledWith({ name: 'Dune', normalizedName: 'dune' });
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
