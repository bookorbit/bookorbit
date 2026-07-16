import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { TagStrategy } from './tag.strategy';

function makeStrategy(db: Record<string, unknown> = {}) {
  return new TagStrategy({ execute: vi.fn().mockResolvedValue({ rows: [] }), ...db } as never);
}

function makeSelectChain(rows: unknown[]) {
  const offset = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn().mockReturnValue({ offset }).mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const groupBy = vi.fn().mockReturnValue({ orderBy });
  const where = vi.fn().mockReturnValue({ groupBy, orderBy, limit });
  const innerJoin = vi.fn();
  innerJoin.mockReturnValue({ where, innerJoin });
  const leftJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ where, innerJoin, leftJoin });
  const select = vi.fn().mockReturnValue({ from });
  const selectDistinct = vi.fn().mockReturnValue({ from });
  return { select, selectDistinct, from, innerJoin, leftJoin, where, groupBy, orderBy, limit, offset };
}

function makeTransactionMock(txOverrides: Record<string, unknown> = {}) {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFrom = vi.fn().mockReturnValue({ where: deleteWhere });
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  const insertOnConflict = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockReturnValue({
    onConflictDoNothing: insertOnConflict,
    onConflictDoUpdate: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
  });
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  const selectDistinctWhere = vi.fn().mockResolvedValue([]);
  const selectDistinctFrom = vi.fn().mockReturnValue({ where: selectDistinctWhere });
  const selectDistinct = vi.fn().mockReturnValue({ from: selectDistinctFrom });

  const selectWhere = vi.fn().mockResolvedValue([]);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere, innerJoin: vi.fn().mockReturnValue({ where: selectWhere }) });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const execute = vi.fn().mockResolvedValue(undefined);

  const tx = {
    delete: deleteFrom,
    update,
    insert,
    select,
    selectDistinct,
    execute,
    ...txOverrides,
  };

  const transaction = vi.fn().mockImplementation(async (cb: (txArg: typeof tx) => Promise<unknown>) => cb(tx));
  return {
    transaction,
    tx,
    deleteFrom,
    deleteWhere,
    update,
    updateSet,
    updateWhere,
    insert,
    insertValues,
    insertOnConflict,
    selectDistinct,
    selectDistinctFrom,
    selectDistinctWhere,
    select,
    selectFrom,
    selectWhere,
    execute,
  };
}

describe('TagStrategy (JunctionEntityStrategy)', () => {
  function thenableRows(rows: unknown[]) {
    const promise = Promise.resolve(rows);
    return { then: promise.then.bind(promise) };
  }

  describe('findCandidatePairs', () => {
    it('runs inside a transaction and executes two SQL statements', async () => {
      const rows = [{ idA: 1, idB: 2, nameA: 'Fantasy', nameB: 'Fantasi', simScore: 0.9 }];
      const execute = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows });
      const transaction = vi.fn().mockImplementation(async (cb: (tx: { execute: typeof execute }) => Promise<unknown>) => cb({ execute }));
      const strategy = makeStrategy({ transaction });

      await expect(strategy.findCandidatePairs([1, 2], 0.8)).resolves.toEqual(rows);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it('omits library filter when libraryIds is empty', async () => {
      const rows: unknown[] = [];
      const execute = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows });
      const transaction = vi.fn().mockImplementation(async (cb: (tx: { execute: typeof execute }) => Promise<unknown>) => cb({ execute }));
      const strategy = makeStrategy({ transaction });

      await strategy.findCandidatePairs([], 0.5);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('getAllEntityIds', () => {
    it('calls execute and returns ids', async () => {
      const execute = vi.fn().mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
      const strategy = makeStrategy({ execute });

      await expect(strategy.getAllEntityIds()).resolves.toEqual([1, 2]);

      expect(execute).toHaveBeenCalledTimes(1);
    });

    it('returns empty array when no entities exist', async () => {
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      const strategy = makeStrategy({ execute });

      await expect(strategy.getAllEntityIds()).resolves.toEqual([]);
    });
  });

  describe('computeCandidatePairsForBatch', () => {
    it('runs inside a transaction and executes two SQL statements', async () => {
      const rows = [{ idA: 1, idB: 3, nameA: 'Sci-Fi', nameB: 'SciFi', simScore: 0.88 }];
      const execute = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows });
      const transaction = vi.fn().mockImplementation(async (cb: (tx: { execute: typeof execute }) => Promise<unknown>) => cb({ execute }));
      const strategy = makeStrategy({ transaction });

      await expect(strategy.computeCandidatePairsForBatch([1, 3], 0.8)).resolves.toEqual(rows);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('browse', () => {
    it('queries count and items and returns mapped result', async () => {
      // First select call: the internal books subquery (select({id}).from(books).where(...))
      const subqueryWhere = vi.fn().mockReturnValue({ _isSubquery: true });
      const subqueryFrom = vi.fn().mockReturnValue({ where: subqueryWhere });
      const subquerySelect = { from: subqueryFrom };

      const relationWhere = vi.fn().mockReturnValue({ _isRelationSubquery: true });
      const relationFrom = vi.fn().mockReturnValue({ where: relationWhere });
      const relationSelect = { from: relationFrom };

      // Fourth select call: count query
      const countWhere = vi.fn().mockResolvedValue([{ total: 1 }]);
      const countFrom = vi.fn().mockReturnValue({ where: countWhere });
      const countSelect = { from: countFrom };

      // Fifth select call: items query
      const offset = vi.fn().mockResolvedValue([{ id: 5, name: 'Fantasy', bookCount: 12 }]);
      const limit = vi.fn().mockReturnValue({ offset });
      const orderBy = vi.fn().mockReturnValue({ limit });
      const dynamic = { having: vi.fn(), orderBy, ...thenableRows([{ id: 5, name: 'Fantasy', bookCount: 12 }]) };
      const groupBy = vi.fn().mockReturnValue({ $dynamic: vi.fn().mockReturnValue(dynamic) });
      const itemWhere = vi.fn().mockReturnValue({ groupBy });
      const itemLeftJoin = vi.fn().mockReturnValue({ where: itemWhere });
      const itemFrom = vi.fn().mockReturnValue({ leftJoin: itemLeftJoin });
      const itemSelect = { from: itemFrom };

      const select = vi
        .fn()
        .mockReturnValueOnce(subquerySelect)
        .mockReturnValueOnce(relationSelect)
        .mockReturnValueOnce(relationSelect)
        .mockReturnValueOnce(countSelect)
        .mockReturnValueOnce(itemSelect);
      const strategy = makeStrategy({ select });

      const result = await strategy.browse({ libraryIds: [1], page: 1, pageSize: 25, sortBy: 'bookCount', sortOrder: 'desc', bookCount: 'any' });

      expect(result).toEqual({ items: [{ id: 5, name: 'Fantasy', bookCount: 12 }], total: 1 });
      expect(select).toHaveBeenCalledTimes(5);
      expect(itemLeftJoin).toHaveBeenCalledTimes(1);
    });

    it('returns 0 total when count row is missing', async () => {
      const subqueryWhere = vi.fn().mockReturnValue({ _isSubquery: true });
      const subqueryFrom = vi.fn().mockReturnValue({ where: subqueryWhere });
      const subquerySelect = { from: subqueryFrom };

      const relationWhere = vi.fn().mockReturnValue({ _isRelationSubquery: true });
      const relationFrom = vi.fn().mockReturnValue({ where: relationWhere });
      const relationSelect = { from: relationFrom };

      const countWhere = vi.fn().mockResolvedValue([]);
      const countFrom = vi.fn().mockReturnValue({ where: countWhere });
      const countSelect = { from: countFrom };

      const offset = vi.fn().mockResolvedValue([]);
      const limit = vi.fn().mockReturnValue({ offset });
      const orderBy = vi.fn().mockReturnValue({ limit });
      const dynamic = { having: vi.fn(), orderBy, ...thenableRows([]) };
      const groupBy = vi.fn().mockReturnValue({ $dynamic: vi.fn().mockReturnValue(dynamic) });
      const itemWhere = vi.fn().mockReturnValue({ groupBy });
      const itemLeftJoin = vi.fn().mockReturnValue({ where: itemWhere });
      const itemFrom = vi.fn().mockReturnValue({ leftJoin: itemLeftJoin });
      const itemSelect = { from: itemFrom };

      const select = vi
        .fn()
        .mockReturnValueOnce(subquerySelect)
        .mockReturnValueOnce(relationSelect)
        .mockReturnValueOnce(relationSelect)
        .mockReturnValueOnce(countSelect)
        .mockReturnValueOnce(itemSelect);
      const strategy = makeStrategy({ select });

      const result = await strategy.browse({ libraryIds: [1], page: 1, pageSize: 25, sortBy: 'name', sortOrder: 'asc', bookCount: 'any' });

      expect(result.total).toBe(0);
    });
  });

  describe('merge', () => {
    it('rejects merging entities that are used outside the accessible libraries', async () => {
      const execute = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
      const strategy = makeStrategy({ execute });
      vi.spyOn(strategy, 'findEntityById');

      await expect(strategy.merge({ targetId: 5, sourceIds: [1], userId: 1, libraryIds: [2] })).rejects.toBeInstanceOf(ForbiddenException);

      expect(strategy.findEntityById).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when target entity is not found', async () => {
      const { select } = makeSelectChain([]);
      const strategy = makeStrategy({ select });
      vi.spyOn(strategy, 'findEntityById').mockResolvedValue(null);

      await expect(strategy.merge({ targetId: 99, sourceIds: [1, 2], userId: 1 })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('inserts junction rows for target and deletes sources inside a transaction', async () => {
      const { transaction, tx, insert, insertValues, insertOnConflict, deleteFrom, deleteWhere } = makeTransactionMock();

      const selectDistinctWhere = vi.fn().mockResolvedValue([{ bookId: 10 }, { bookId: 20 }]);
      const selectDistinctFrom = vi.fn().mockReturnValue({ where: selectDistinctWhere });
      tx.selectDistinct = vi.fn().mockReturnValue({ from: selectDistinctFrom });

      const strategy = makeStrategy({ transaction });
      vi.spyOn(strategy, 'findEntityById').mockResolvedValue({ id: 5, name: 'Fantasy' });
      vi.spyOn(strategy, 'findAffectedBookIds').mockResolvedValue([10, 20]);

      const result = await strategy.merge({ targetId: 5, sourceIds: [1, 2], userId: 1 });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(insertValues).toHaveBeenCalledTimes(1);
      expect(insertOnConflict).toHaveBeenCalledTimes(1);
      expect(deleteFrom).toHaveBeenCalledTimes(2);
      expect(deleteWhere).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ affectedBookIds: [10, 20] });
    });

    it('skips insert when source has no junction rows', async () => {
      const { transaction, tx, insert, deleteFrom } = makeTransactionMock();

      const selectDistinctWhere = vi.fn().mockResolvedValue([]);
      const selectDistinctFrom = vi.fn().mockReturnValue({ where: selectDistinctWhere });
      tx.selectDistinct = vi.fn().mockReturnValue({ from: selectDistinctFrom });

      const strategy = makeStrategy({ transaction });
      vi.spyOn(strategy, 'findEntityById').mockResolvedValue({ id: 5, name: 'Fantasy' });
      vi.spyOn(strategy, 'findAffectedBookIds').mockResolvedValue([]);

      await strategy.merge({ targetId: 5, sourceIds: [1], userId: 1 });

      expect(insert).not.toHaveBeenCalled();
      expect(deleteFrom).toHaveBeenCalledTimes(2);
    });
  });

  describe('rename', () => {
    it('throws NotFoundException when entity is not found', async () => {
      const limit = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });
      const strategy = makeStrategy({ select });

      await expect(strategy.rename({ entityId: 99, newName: 'New', userId: 1, libraryIds: [1] })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when new name is blank', async () => {
      const limit = vi.fn().mockResolvedValue([{ name: 'Old' }]);
      const where = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });
      const strategy = makeStrategy({ select });

      await expect(strategy.rename({ entityId: 1, newName: '  ', userId: 1, libraryIds: [1] })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('performs implicit merge when another entity with the same name exists', async () => {
      const findEntityLimit = vi.fn().mockResolvedValueOnce([{ name: 'Old' }]);
      const existingLimit = vi.fn().mockResolvedValueOnce([{ id: 7 }]);
      const where = vi.fn().mockReturnValueOnce({ limit: findEntityLimit }).mockReturnValueOnce({ limit: existingLimit });
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });

      const strategy = makeStrategy({ select });
      vi.spyOn(strategy, 'merge').mockResolvedValue({ affectedBookIds: [10, 20] });

      const result = await strategy.rename({ entityId: 1, newName: 'Existing', userId: 1, libraryIds: [1] });

      expect(strategy.merge).toHaveBeenCalledTimes(1);
      expect(result.wasImplicitMerge).toBe(true);
      expect(result.mergedEntityId).toBe(7);
      expect(result.affectedBookIds).toEqual([10, 20]);
    });

    it('performs a simple rename when no conflicting name exists', async () => {
      const findEntityLimit = vi.fn().mockResolvedValueOnce([{ name: 'Old' }]);
      const existingLimit = vi.fn().mockResolvedValueOnce([]);
      const where = vi.fn().mockReturnValueOnce({ limit: findEntityLimit }).mockReturnValueOnce({ limit: existingLimit });
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      const update = vi.fn().mockReturnValue({ set: updateSet });

      const strategy = makeStrategy({ select, update });
      vi.spyOn(strategy, 'findAffectedBookIds').mockResolvedValue([5]);

      const result = await strategy.rename({ entityId: 1, newName: 'New', userId: 1, libraryIds: [1] });

      expect(update).toHaveBeenCalledTimes(1);
      expect(result.wasImplicitMerge).toBe(false);
      expect(result.oldName).toBe('Old');
      expect(result.affectedBookIds).toEqual([5]);
    });
  });

  describe('deleteEntity', () => {
    it('throws NotFoundException when entity is not found', async () => {
      const limit = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });
      const strategy = makeStrategy({ select });

      await expect(strategy.deleteEntity({ entityId: 99, mode: 'hard', libraryIds: [1] })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft mode deletes only junction rows', async () => {
      const limit = vi.fn().mockResolvedValue([{ name: 'Fantasy' }]);
      const where = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });

      const deleteWhere = vi.fn().mockResolvedValue(undefined);
      const deleteFrom = vi.fn().mockReturnValue({ where: deleteWhere });

      const strategy = makeStrategy({ select, delete: deleteFrom });
      vi.spyOn(strategy, 'findAffectedBookIds').mockResolvedValue([10]);

      const result = await strategy.deleteEntity({ entityId: 1, mode: 'soft', libraryIds: [1] });

      expect(deleteFrom).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ name: 'Fantasy', affectedBookIds: [10] });
    });

    it('hard mode with hasCascade=true deletes entity table directly (no transaction)', async () => {
      const limit = vi.fn().mockResolvedValue([{ name: 'Fantasy' }]);
      const where = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });

      const deleteWhere = vi.fn().mockResolvedValue(undefined);
      const deleteFrom = vi.fn().mockReturnValue({ where: deleteWhere });
      const transaction = vi.fn();

      const strategy = makeStrategy({ select, delete: deleteFrom, transaction });
      vi.spyOn(strategy, 'findAffectedBookIds').mockResolvedValue([10]);

      const result = await strategy.deleteEntity({ entityId: 1, mode: 'hard', libraryIds: [1] });

      expect(transaction).not.toHaveBeenCalled();
      expect(deleteFrom).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ name: 'Fantasy', affectedBookIds: [10] });
    });
  });

  describe('split', () => {
    it('throws NotFoundException when entity is not found', async () => {
      const limit = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });
      const strategy = makeStrategy({ select });

      await expect(strategy.split({ entityId: 99, newNames: ['A', 'B'] })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('inserts new entities and assigns junction rows inside a transaction', async () => {
      const findEntityLimit = vi.fn().mockResolvedValue([{ name: 'OldTag' }]);
      const findEntityWhere = vi.fn().mockReturnValue({ limit: findEntityLimit });
      const findEntityFrom = vi.fn().mockReturnValue({ where: findEntityWhere });
      const select = vi.fn().mockReturnValue({ from: findEntityFrom });

      const { transaction, tx } = makeTransactionMock();

      const txSelectLimit = vi.fn().mockResolvedValue([]);
      const txSelectWhere = vi.fn().mockReturnValue({ limit: txSelectLimit });
      const txSelectFrom = vi.fn().mockReturnValue({ where: txSelectWhere });
      tx.select = vi.fn().mockReturnValue({ from: txSelectFrom });

      const txInsertReturning = vi.fn().mockResolvedValue([{ id: 10 }]);
      const txInsertOnConflict = vi.fn().mockResolvedValue(undefined);
      const txInsertValues = vi.fn().mockReturnValue({
        returning: txInsertReturning,
        onConflictDoNothing: txInsertOnConflict,
      });
      tx.insert = vi.fn().mockReturnValue({ values: txInsertValues });

      const txSelectDistinctWhere = vi.fn().mockResolvedValue([{ bookId: 5 }]);
      const txSelectDistinctFrom = vi.fn().mockReturnValue({ where: txSelectDistinctWhere });
      tx.selectDistinct = vi.fn().mockReturnValue({ from: txSelectDistinctFrom });

      const strategy = makeStrategy({ select, transaction });
      vi.spyOn(strategy, 'findAffectedBookIds').mockResolvedValue([5]);

      const result = await strategy.split({ entityId: 1, newNames: ['TagA'] });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(result.originalName).toBe('OldTag');
      expect(result.affectedBookIds).toEqual([5]);
    });
  });

  describe('findAffectedBookIds', () => {
    it('returns empty array without calling select when ids is empty', async () => {
      const selectDistinct = vi.fn();
      const strategy = makeStrategy({ selectDistinct });

      await expect(strategy.findAffectedBookIds([])).resolves.toEqual([]);

      expect(selectDistinct).not.toHaveBeenCalled();
    });

    it('calls selectDistinct and returns mapped book ids', async () => {
      const where = vi.fn().mockResolvedValue([{ bookId: 3 }, { bookId: 7 }]);
      const from = vi.fn().mockReturnValue({ where });
      const selectDistinct = vi.fn().mockReturnValue({ from });
      const strategy = makeStrategy({ selectDistinct });

      await expect(strategy.findAffectedBookIds([1, 2])).resolves.toEqual([3, 7]);

      expect(selectDistinct).toHaveBeenCalledTimes(1);
    });
  });

  describe('getBookCount', () => {
    it('returns count from select chain', async () => {
      const where = vi.fn().mockResolvedValue([{ count: 8 }]);
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });
      const strategy = makeStrategy({ select });

      await expect(strategy.getBookCount(1)).resolves.toBe(8);
    });

    it('returns 0 when no row is found', async () => {
      const where = vi.fn().mockResolvedValue([]);
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });
      const strategy = makeStrategy({ select });

      await expect(strategy.getBookCount(99)).resolves.toBe(0);
    });
  });

  describe('getBookTitles', () => {
    it('returns titles from the join-select chain', async () => {
      const limit = vi.fn().mockResolvedValue([{ title: 'Dune' }, { title: 'Foundation' }]);
      const orderBy = vi.fn().mockReturnValue({ limit });
      const where = vi.fn().mockReturnValue({ orderBy });
      const leftJoin = vi.fn().mockReturnValue({ where });
      const innerJoin = vi.fn().mockReturnValue({ leftJoin });
      const from = vi.fn().mockReturnValue({ innerJoin });
      const select = vi.fn().mockReturnValue({ from });
      const strategy = makeStrategy({ select });

      await expect(strategy.getBookTitles(1, 5)).resolves.toEqual(['Dune', 'Foundation']);
    });
  });

  describe('findEntityById', () => {
    it('returns {id, name} when a row is found', async () => {
      const limit = vi.fn().mockResolvedValue([{ id: 5, name: 'Fantasy' }]);
      const where = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });
      const strategy = makeStrategy({ select });

      await expect(strategy.findEntityById(5)).resolves.toEqual({ id: 5, name: 'Fantasy' });
    });

    it('returns null when no row is found', async () => {
      const limit = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });
      const strategy = makeStrategy({ select });

      await expect(strategy.findEntityById(99)).resolves.toBeNull();
    });
  });
});
