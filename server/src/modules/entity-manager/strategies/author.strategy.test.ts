import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';

import { AuthorStrategy } from './author.strategy';

vi.mock('../../../db/book-author-sort-key', () => ({
  refreshPrimaryAuthorSortNamesForBooks: vi.fn().mockResolvedValue(undefined),
}));

import { refreshPrimaryAuthorSortNamesForBooks } from '../../../db/book-author-sort-key';

function makeStrategy(db: Record<string, unknown> = {}, deps: Record<string, unknown> = {}) {
  const authorsRepo = {
    updateAuthorById: vi.fn().mockResolvedValue(undefined),
    mergeAuthors: vi.fn().mockResolvedValue(undefined),
    deleteAuthors: vi.fn().mockResolvedValue(undefined),
    ...(deps.authorsRepo as object | undefined),
  };
  const authorImageStorage = {
    promoteImage: vi.fn().mockResolvedValue(false),
    deleteAuthorDir: vi.fn().mockResolvedValue(undefined),
    ...(deps.authorImageStorage as object | undefined),
  };
  const enrichmentOrchestrator = {
    schedule: vi.fn().mockResolvedValue(undefined),
    ...(deps.enrichmentOrchestrator as object | undefined),
  };
  return new AuthorStrategy(db as never, authorsRepo as never, authorImageStorage as never, enrichmentOrchestrator as never);
}

function makeSelectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where, limit };
}

describe('AuthorStrategy', () => {
  function thenableRows(rows: unknown[]) {
    const promise = Promise.resolve(rows);
    return { then: promise.then.bind(promise) };
  }

  describe('findCandidatePairs', () => {
    it('runs two executes inside a transaction', async () => {
      const rows = [{ idA: 1, idB: 2, nameA: 'Tolkien', nameB: 'Tolkein', simScore: 0.9 }];
      const execute = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows });
      const transaction = vi.fn().mockImplementation(async (cb: (tx: { execute: typeof execute }) => Promise<unknown>) => cb({ execute }));
      const strategy = makeStrategy({ transaction });

      await expect(strategy.findCandidatePairs([], 0.5)).resolves.toEqual(rows);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it('includes a library filter fragment when libraryIds are provided', async () => {
      const execute = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows: [] });
      const transaction = vi.fn().mockImplementation(async (cb: (tx: { execute: typeof execute }) => Promise<unknown>) => cb({ execute }));
      const strategy = makeStrategy({ transaction });

      await strategy.findCandidatePairs([10, 20], 0.6);

      const querySql = execute.mock.calls[1]![0];
      const flat = flattenSql(querySql).replace(/\s+/g, ' ');
      expect(flat).toContain('library_id IN');
    });

    it('runs without a library filter when libraryIds is empty', async () => {
      const execute = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows: [] });
      const transaction = vi.fn().mockImplementation(async (cb: (tx: { execute: typeof execute }) => Promise<unknown>) => cb({ execute }));
      const strategy = makeStrategy({ transaction });

      await strategy.findCandidatePairs([], 0.5);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it('clamps similarity threshold to [0.1, 1]', async () => {
      const execute = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows: [] });
      const transaction = vi.fn().mockImplementation(async (cb: (tx: { execute: typeof execute }) => Promise<unknown>) => cb({ execute }));
      const strategy = makeStrategy({ transaction });

      await strategy.findCandidatePairs([], 5);

      const setConfigSql = execute.mock.calls[0]![0];
      const params = extractSqlParams(setConfigSql);
      expect(params).toContain('1');
    });
  });

  describe('getAllEntityIds', () => {
    it('returns ids from rows', async () => {
      const execute = vi.fn().mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
      const strategy = makeStrategy({ execute });

      await expect(strategy.getAllEntityIds()).resolves.toEqual([1, 2]);
    });

    it('returns empty array when no authors exist', async () => {
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      const strategy = makeStrategy({ execute });

      await expect(strategy.getAllEntityIds()).resolves.toEqual([]);
    });
  });

  describe('computeCandidatePairsForBatch', () => {
    it('runs two executes inside a transaction for a non-empty batch', async () => {
      const rows = [{ idA: 3, idB: 5, nameA: 'A', nameB: 'B', simScore: 0.8 }];
      const execute = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows });
      const transaction = vi.fn().mockImplementation(async (cb: (tx: { execute: typeof execute }) => Promise<unknown>) => cb({ execute }));
      const strategy = makeStrategy({ transaction });

      await expect(strategy.computeCandidatePairsForBatch([3, 5], 0.7)).resolves.toEqual(rows);

      expect(execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('browse', () => {
    function makeBrowseDb(countRows: unknown[], itemRows: unknown[], hasLibraryIds = false) {
      const countWhere = vi.fn().mockResolvedValue(countRows);
      const countFrom = vi.fn().mockReturnValue({ where: countWhere });

      const itemOffset = vi.fn().mockResolvedValue(itemRows);
      const itemLimit = vi.fn().mockReturnValue({ offset: itemOffset });
      const itemOrderBy = vi.fn().mockReturnValue({ limit: itemLimit });
      const itemDynamic = { having: vi.fn(), orderBy: itemOrderBy, ...thenableRows(itemRows) };
      const itemDynamicFactory = vi.fn().mockReturnValue(itemDynamic);
      const itemGroupBy = vi.fn().mockReturnValue({ $dynamic: itemDynamicFactory });
      const itemWhere = vi.fn().mockReturnValue({ groupBy: itemGroupBy });
      const itemLeftJoin = vi.fn().mockReturnValue({ where: itemWhere });
      const itemFrom = vi.fn().mockReturnValue({ leftJoin: itemLeftJoin, where: itemWhere });

      const subqueryWhere = vi.fn().mockReturnValue('SUBQUERY_PLACEHOLDER');
      const subqueryFrom = vi.fn().mockReturnValue({ where: subqueryWhere });

      const relationWhere = vi.fn().mockReturnValue({ _isRelationSubquery: true });
      const relationFrom = vi.fn().mockReturnValue({ where: relationWhere });

      let callCount = 0;
      const select = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1 && hasLibraryIds) return { from: subqueryFrom };
        if ((hasLibraryIds && (callCount === 2 || callCount === 3)) || (!hasLibraryIds && callCount === 1)) {
          return { from: relationFrom };
        }
        if ((callCount === 2 && !hasLibraryIds) || (callCount === 4 && hasLibraryIds)) return { from: countFrom };
        return { from: itemFrom };
      });

      return { select, countWhere, itemWhere, itemLeftJoin };
    }

    it('returns items and total from two parallel selects', async () => {
      const itemRows = [
        { id: 1, name: 'Tolkien', sortName: 'Tolkien, J.R.R.', hasPhoto: true, bookCount: 5 },
        { id: 2, name: 'Lewis', sortName: null, hasPhoto: false, bookCount: 3 },
      ];
      const { select } = makeBrowseDb([{ total: 2 }], itemRows, false);
      const strategy = makeStrategy({ select });

      const result = await strategy.browse({ libraryIds: [], page: 1, pageSize: 25, sortBy: 'name', sortOrder: 'asc', bookCount: 'any' });

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({ id: 1, name: 'Tolkien', bookCount: 5 });
      expect(select).toHaveBeenCalledTimes(3);
    });

    it('uses a subquery leftJoin condition when libraryIds are provided', async () => {
      const { select, itemLeftJoin } = makeBrowseDb([{ total: 0 }], [], true);
      const strategy = makeStrategy({ select });

      await strategy.browse({ libraryIds: [5], page: 1, pageSize: 10, sortBy: 'name', sortOrder: 'asc', bookCount: 'any' });

      expect(itemLeftJoin).toHaveBeenCalledTimes(1);
      expect(select).toHaveBeenCalledTimes(5);
    });

    it('joins without a subquery filter when libraryIds is empty', async () => {
      const { select, itemLeftJoin } = makeBrowseDb([{ total: 0 }], [], false);
      const strategy = makeStrategy({ select });

      await strategy.browse({ libraryIds: [], page: 1, pageSize: 10, sortBy: 'name', sortOrder: 'asc', bookCount: 'any' });

      expect(itemLeftJoin).toHaveBeenCalledTimes(1);
      expect(select).toHaveBeenCalledTimes(3);
    });

    it('returns zero total when countResult is empty', async () => {
      const { select } = makeBrowseDb([], [], false);
      const strategy = makeStrategy({ select });

      const result = await strategy.browse({ libraryIds: [], page: 1, pageSize: 10, sortBy: 'name', sortOrder: 'asc', bookCount: 'any' });

      expect(result.total).toBe(0);
    });
  });

  describe('merge', () => {
    function makeSelectForMerge(targetAuthor: unknown, sourceAuthors: unknown[], affectedBookIds: { bookId: number }[] = []) {
      const affectedWhere = vi.fn().mockResolvedValue(affectedBookIds);
      const affectedFrom = vi.fn().mockReturnValue({ where: affectedWhere });
      const selectDistinct = vi.fn().mockReturnValue({ from: affectedFrom });

      const targetLimit = vi.fn().mockResolvedValue(targetAuthor ? [targetAuthor] : []);
      const targetWhere = vi.fn().mockReturnValue({ limit: targetLimit });
      const targetFrom = vi.fn().mockReturnValue({ where: targetWhere });

      const sourceFroms = sourceAuthors.map((src) => {
        const lim = vi.fn().mockResolvedValue(src ? [src] : []);
        const wh = vi.fn().mockReturnValue({ limit: lim });
        const fr = vi.fn().mockReturnValue({ where: wh });
        return fr;
      });

      let selectCallIdx = 0;
      const select = vi.fn().mockImplementation(() => {
        const idx = selectCallIdx++;
        if (idx === 0) return { from: targetFrom };
        const srcIdx = idx - 1;
        if (srcIdx < sourceFroms.length) return { from: sourceFroms[srcIdx]! };
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
      });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      const update = vi.fn().mockReturnValue({ set: updateSet });

      return { select, selectDistinct, update };
    }

    it('throws NotFoundException when target author does not exist', async () => {
      const limit = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });

      const strategy = makeStrategy({ select });

      await expect(strategy.merge({ targetId: 99, sourceIds: [1], userId: 1 })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resolves sortName from source when target is missing it', async () => {
      const { select, selectDistinct, update } = makeSelectForMerge({ id: 1, sortName: null, description: null, hasPhoto: false }, [
        { sortName: 'Tolkien, J.R.R.', description: null },
      ]);

      const authorsRepo = { updateAuthorById: vi.fn().mockResolvedValue(undefined), mergeAuthors: vi.fn().mockResolvedValue(undefined) };
      const authorImageStorage = { promoteImage: vi.fn().mockResolvedValue(false), deleteAuthorDir: vi.fn().mockResolvedValue(undefined) };
      const enrichmentOrchestrator = { schedule: vi.fn().mockResolvedValue(undefined) };

      const strategy = makeStrategy({ select, selectDistinct, update }, { authorsRepo, authorImageStorage, enrichmentOrchestrator });

      const result = await strategy.merge({ targetId: 1, sourceIds: [2], userId: 5 });

      expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(1, expect.objectContaining({ sortName: 'Tolkien, J.R.R.' }));
      expect(result.fieldsResolved).toContain('sortName');
    });

    it('resolves description from source when target is missing it', async () => {
      const { select, selectDistinct, update } = makeSelectForMerge({ id: 1, sortName: 'Already Set', description: null, hasPhoto: false }, [
        { sortName: null, description: 'A great author' },
      ]);

      const authorsRepo = { updateAuthorById: vi.fn().mockResolvedValue(undefined), mergeAuthors: vi.fn().mockResolvedValue(undefined) };
      const authorImageStorage = { promoteImage: vi.fn().mockResolvedValue(false), deleteAuthorDir: vi.fn().mockResolvedValue(undefined) };
      const enrichmentOrchestrator = { schedule: vi.fn().mockResolvedValue(undefined) };

      const strategy = makeStrategy({ select, selectDistinct, update }, { authorsRepo, authorImageStorage, enrichmentOrchestrator });

      const result = await strategy.merge({ targetId: 1, sourceIds: [2], userId: 5 });

      expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(1, expect.objectContaining({ description: 'A great author' }));
      expect(result.fieldsResolved).toContain('description');
    });

    it('does not call updateAuthorById when target already has all fields', async () => {
      const { select, selectDistinct, update } = makeSelectForMerge({ id: 1, sortName: 'Tolkien, J.R.R.', description: 'Author', hasPhoto: true }, [
        { sortName: 'Other', description: 'Other desc' },
      ]);

      const authorsRepo = { updateAuthorById: vi.fn().mockResolvedValue(undefined), mergeAuthors: vi.fn().mockResolvedValue(undefined) };
      const authorImageStorage = { promoteImage: vi.fn().mockResolvedValue(false), deleteAuthorDir: vi.fn().mockResolvedValue(undefined) };
      const enrichmentOrchestrator = { schedule: vi.fn().mockResolvedValue(undefined) };

      const strategy = makeStrategy({ select, selectDistinct, update }, { authorsRepo, authorImageStorage, enrichmentOrchestrator });

      await strategy.merge({ targetId: 1, sourceIds: [2], userId: 5 });

      expect(authorsRepo.updateAuthorById).not.toHaveBeenCalled();
    });

    it('promotes image and sets hasPhoto when target lacks a photo and promotion succeeds', async () => {
      const { select, selectDistinct, update } = makeSelectForMerge({ id: 1, sortName: null, description: null, hasPhoto: false }, [
        { sortName: null, description: null },
      ]);

      const authorsRepo = { updateAuthorById: vi.fn().mockResolvedValue(undefined), mergeAuthors: vi.fn().mockResolvedValue(undefined) };
      const authorImageStorage = { promoteImage: vi.fn().mockResolvedValue(true), deleteAuthorDir: vi.fn().mockResolvedValue(undefined) };
      const enrichmentOrchestrator = { schedule: vi.fn().mockResolvedValue(undefined) };

      const strategy = makeStrategy({ select, selectDistinct, update }, { authorsRepo, authorImageStorage, enrichmentOrchestrator });

      const result = await strategy.merge({ targetId: 1, sourceIds: [2], userId: 5 });

      expect(authorImageStorage.promoteImage).toHaveBeenCalledWith(2, 1);
      expect(update).toHaveBeenCalled();
      expect(result.imagePromoted).toBe(true);
      expect(result.fieldsResolved).toContain('photo');
    });

    it('does not promote image when target already has a photo', async () => {
      const { select, selectDistinct, update } = makeSelectForMerge({ id: 1, sortName: null, description: null, hasPhoto: true }, [
        { sortName: null, description: null },
      ]);

      const authorImageStorage = { promoteImage: vi.fn().mockResolvedValue(true), deleteAuthorDir: vi.fn().mockResolvedValue(undefined) };
      const authorsRepo = { updateAuthorById: vi.fn().mockResolvedValue(undefined), mergeAuthors: vi.fn().mockResolvedValue(undefined) };
      const enrichmentOrchestrator = { schedule: vi.fn().mockResolvedValue(undefined) };

      const strategy = makeStrategy({ select, selectDistinct, update }, { authorsRepo, authorImageStorage, enrichmentOrchestrator });

      await strategy.merge({ targetId: 1, sourceIds: [2], userId: 5 });

      expect(authorImageStorage.promoteImage).not.toHaveBeenCalled();
    });

    it('calls mergeAuthors, deletes source dirs, and schedules enrichment', async () => {
      const { select, selectDistinct, update } = makeSelectForMerge({ id: 1, sortName: null, description: null, hasPhoto: false }, [
        { sortName: null, description: null },
        { sortName: null, description: null },
      ]);

      const authorsRepo = { updateAuthorById: vi.fn().mockResolvedValue(undefined), mergeAuthors: vi.fn().mockResolvedValue(undefined) };
      const authorImageStorage = { promoteImage: vi.fn().mockResolvedValue(false), deleteAuthorDir: vi.fn().mockResolvedValue(undefined) };
      const enrichmentOrchestrator = { schedule: vi.fn().mockResolvedValue(undefined) };

      const strategy = makeStrategy({ select, selectDistinct, update }, { authorsRepo, authorImageStorage, enrichmentOrchestrator });

      await strategy.merge({ targetId: 1, sourceIds: [2, 3], userId: 5 });

      expect(authorsRepo.mergeAuthors).toHaveBeenCalledWith(1, [2, 3]);
      expect(authorImageStorage.deleteAuthorDir).toHaveBeenCalledWith(2);
      expect(authorImageStorage.deleteAuthorDir).toHaveBeenCalledWith(3);
      expect(enrichmentOrchestrator.schedule).toHaveBeenCalledWith(1, 'author_merge_target');
    });

    it('returns affectedBookIds, imagePromoted, and fieldsResolved', async () => {
      const { select, selectDistinct, update } = makeSelectForMerge(
        { id: 1, sortName: null, description: null, hasPhoto: false },
        [{ sortName: 'X', description: null }],
        [{ bookId: 10 }, { bookId: 20 }],
      );

      const authorsRepo = { updateAuthorById: vi.fn().mockResolvedValue(undefined), mergeAuthors: vi.fn().mockResolvedValue(undefined) };
      const authorImageStorage = { promoteImage: vi.fn().mockResolvedValue(false), deleteAuthorDir: vi.fn().mockResolvedValue(undefined) };
      const enrichmentOrchestrator = { schedule: vi.fn().mockResolvedValue(undefined) };

      const strategy = makeStrategy({ select, selectDistinct, update }, { authorsRepo, authorImageStorage, enrichmentOrchestrator });

      const result = await strategy.merge({ targetId: 1, sourceIds: [2], userId: 5 });

      expect(result.affectedBookIds).toEqual([10, 20]);
      expect(result.imagePromoted).toBe(false);
      expect(result.fieldsResolved).toContain('sortName');
    });
  });

  describe('rename', () => {
    it('throws NotFoundException when entity does not exist', async () => {
      const { select } = makeSelectChain([]);
      const strategy = makeStrategy({ select });

      await expect(strategy.rename({ entityId: 1, newName: 'New Name', userId: 1, libraryIds: [] })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException for empty name', async () => {
      const { select } = makeSelectChain([{ name: 'Old Name' }]);
      const strategy = makeStrategy({ select });

      await expect(strategy.rename({ entityId: 1, newName: '   ', userId: 1, libraryIds: [] })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException for whitespace-only name', async () => {
      const { select } = makeSelectChain([{ name: 'Old Name' }]);
      const strategy = makeStrategy({ select });

      await expect(strategy.rename({ entityId: 1, newName: '\t\n', userId: 1, libraryIds: [] })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('triggers implicit merge when another author with the same normalized name exists', async () => {
      const existingAuthorWhere = vi.fn().mockResolvedValue([{ id: 99, name: 'New Name' }]);
      const existingAuthorFrom = vi.fn().mockReturnValue({ where: existingAuthorWhere });

      const entityLimit = vi.fn().mockResolvedValue([{ name: 'Old Name' }]);
      const entityWhere = vi.fn().mockReturnValue({ limit: entityLimit });
      const entityFrom = vi.fn().mockReturnValue({ where: entityWhere });

      const sourceForMergeLimit = vi.fn().mockResolvedValue([{ id: 99, sortName: null, description: null, hasPhoto: false }]);
      const sourceForMergeWhere = vi.fn().mockReturnValue({ limit: sourceForMergeLimit });
      const sourceForMergeFrom = vi.fn().mockReturnValue({ where: sourceForMergeWhere });

      const sourceFieldsLimit = vi.fn().mockResolvedValue([{ sortName: null, description: null }]);
      const sourceFieldsWhere = vi.fn().mockReturnValue({ limit: sourceFieldsLimit });
      const sourceFieldsFrom = vi.fn().mockReturnValue({ where: sourceFieldsWhere });

      const affectedWhere = vi.fn().mockResolvedValue([{ bookId: 5 }]);
      const affectedFrom = vi.fn().mockReturnValue({ where: affectedWhere });
      const selectDistinct = vi.fn().mockReturnValue({ from: affectedFrom });

      let callIdx = 0;
      const select = vi.fn().mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return { from: entityFrom };
        if (callIdx === 2) return { from: existingAuthorFrom };
        if (callIdx === 3) return { from: sourceForMergeFrom };
        return { from: sourceFieldsFrom };
      });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      const update = vi.fn().mockReturnValue({ set: updateSet });

      const authorsRepo = { updateAuthorById: vi.fn().mockResolvedValue(undefined), mergeAuthors: vi.fn().mockResolvedValue(undefined) };
      const authorImageStorage = { promoteImage: vi.fn().mockResolvedValue(false), deleteAuthorDir: vi.fn().mockResolvedValue(undefined) };
      const enrichmentOrchestrator = { schedule: vi.fn().mockResolvedValue(undefined) };

      const strategy = makeStrategy({ select, selectDistinct, update }, { authorsRepo, authorImageStorage, enrichmentOrchestrator });

      const result = await strategy.rename({ entityId: 1, newName: 'New   Name', userId: 5, libraryIds: [] });

      expect(result.wasImplicitMerge).toBe(true);
      expect(result.mergedEntityId).toBe(99);
      expect(result.oldName).toBe('Old Name');
    });

    it('chooses a non-current merge target when normalized lookup returns the current author first', async () => {
      const existingAuthorWhere = vi.fn().mockResolvedValue([
        { id: 1, name: 'New  Name' },
        { id: 99, name: 'New Name' },
      ]);
      const existingAuthorFrom = vi.fn().mockReturnValue({ where: existingAuthorWhere });

      const entityLimit = vi.fn().mockResolvedValue([{ name: 'Old Name' }]);
      const entityWhere = vi.fn().mockReturnValue({ limit: entityLimit });
      const entityFrom = vi.fn().mockReturnValue({ where: entityWhere });

      const sourceForMergeLimit = vi.fn().mockResolvedValue([{ id: 99, sortName: null, description: null, hasPhoto: false }]);
      const sourceForMergeWhere = vi.fn().mockReturnValue({ limit: sourceForMergeLimit });
      const sourceForMergeFrom = vi.fn().mockReturnValue({ where: sourceForMergeWhere });

      const sourceFieldsLimit = vi.fn().mockResolvedValue([{ sortName: null, description: null }]);
      const sourceFieldsWhere = vi.fn().mockReturnValue({ limit: sourceFieldsLimit });
      const sourceFieldsFrom = vi.fn().mockReturnValue({ where: sourceFieldsWhere });

      const affectedWhere = vi.fn().mockResolvedValue([{ bookId: 5 }]);
      const affectedFrom = vi.fn().mockReturnValue({ where: affectedWhere });
      const selectDistinct = vi.fn().mockReturnValue({ from: affectedFrom });

      let callIdx = 0;
      const select = vi.fn().mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return { from: entityFrom };
        if (callIdx === 2) return { from: existingAuthorFrom };
        if (callIdx === 3) return { from: sourceForMergeFrom };
        return { from: sourceFieldsFrom };
      });

      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      const update = vi.fn().mockReturnValue({ set: updateSet });

      const authorsRepo = { updateAuthorById: vi.fn().mockResolvedValue(undefined), mergeAuthors: vi.fn().mockResolvedValue(undefined) };
      const authorImageStorage = { promoteImage: vi.fn().mockResolvedValue(false), deleteAuthorDir: vi.fn().mockResolvedValue(undefined) };
      const enrichmentOrchestrator = { schedule: vi.fn().mockResolvedValue(undefined) };

      const strategy = makeStrategy({ select, selectDistinct, update }, { authorsRepo, authorImageStorage, enrichmentOrchestrator });

      const result = await strategy.rename({ entityId: 1, newName: 'New Name', userId: 5, libraryIds: [] });

      expect(authorsRepo.updateAuthorById).not.toHaveBeenCalledWith(1, { name: 'New Name' });
      expect(result.wasImplicitMerge).toBe(true);
      expect(result.mergedEntityId).toBe(99);
    });

    it('updates author name and returns wasImplicitMerge false when no conflict', async () => {
      const entityLimit = vi.fn().mockResolvedValue([{ name: 'Old Name' }]);
      const entityWhere = vi.fn().mockReturnValue({ limit: entityLimit });
      const entityFrom = vi.fn().mockReturnValue({ where: entityWhere });

      const noExistingWhere = vi.fn().mockResolvedValue([]);
      const noExistingFrom = vi.fn().mockReturnValue({ where: noExistingWhere });

      const affectedWhere = vi.fn().mockResolvedValue([{ bookId: 7 }]);
      const affectedFrom = vi.fn().mockReturnValue({ where: affectedWhere });
      const selectDistinct = vi.fn().mockReturnValue({ from: affectedFrom });

      let callIdx = 0;
      const select = vi.fn().mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return { from: entityFrom };
        return { from: noExistingFrom };
      });

      const authorsRepo = { updateAuthorById: vi.fn().mockResolvedValue(undefined), mergeAuthors: vi.fn().mockResolvedValue(undefined) };
      const authorImageStorage = { promoteImage: vi.fn().mockResolvedValue(false), deleteAuthorDir: vi.fn().mockResolvedValue(undefined) };
      const enrichmentOrchestrator = { schedule: vi.fn().mockResolvedValue(undefined) };

      const strategy = makeStrategy({ select, selectDistinct }, { authorsRepo, authorImageStorage, enrichmentOrchestrator });

      const result = await strategy.rename({ entityId: 1, newName: ' New   Name ', userId: 5, libraryIds: [] });

      expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(1, { name: 'New Name' });
      expect(result.oldName).toBe('Old Name');
      expect(result.wasImplicitMerge).toBe(false);
      expect(result.affectedBookIds).toEqual([7]);
    });
  });

  describe('deleteEntity', () => {
    it('throws NotFoundException when entity does not exist', async () => {
      const { select } = makeSelectChain([]);
      const strategy = makeStrategy({ select });

      await expect(strategy.deleteEntity({ entityId: 1, mode: 'soft', libraryIds: [] })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('soft mode: deletes from bookAuthors and refreshes sort names', async () => {
      const entityLimit = vi.fn().mockResolvedValue([{ name: 'Tolkien' }]);
      const entityWhere = vi.fn().mockReturnValue({ limit: entityLimit });
      const entityFrom = vi.fn().mockReturnValue({ where: entityWhere });

      const affectedWhere = vi.fn().mockResolvedValue([{ bookId: 10 }, { bookId: 20 }]);
      const affectedFrom = vi.fn().mockReturnValue({ where: affectedWhere });
      const selectDistinct = vi.fn().mockReturnValue({ from: affectedFrom });

      const deleteWhere = vi.fn().mockResolvedValue(undefined);
      const deleteFrom = vi.fn().mockReturnValue({ where: deleteWhere });

      let callIdx = 0;
      const select = vi.fn().mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return { from: entityFrom };
        return { from: affectedFrom };
      });

      const authorsRepo = { updateAuthorById: vi.fn(), mergeAuthors: vi.fn(), deleteAuthors: vi.fn() };
      const authorImageStorage = { promoteImage: vi.fn(), deleteAuthorDir: vi.fn() };

      const strategy = makeStrategy({ select, selectDistinct, delete: deleteFrom }, { authorsRepo, authorImageStorage });

      const result = await strategy.deleteEntity({ entityId: 1, mode: 'soft', libraryIds: [] });

      expect(deleteFrom).toHaveBeenCalledTimes(1);
      expect(refreshPrimaryAuthorSortNamesForBooks).toHaveBeenCalledWith(expect.anything(), [10, 20]);
      expect(authorsRepo.deleteAuthors).not.toHaveBeenCalled();
      expect(result).toEqual({ name: 'Tolkien', affectedBookIds: [10, 20] });
    });

    it('hard mode: calls deleteAuthors and deleteAuthorDir', async () => {
      const entityLimit = vi.fn().mockResolvedValue([{ name: 'Lewis' }]);
      const entityWhere = vi.fn().mockReturnValue({ limit: entityLimit });
      const entityFrom = vi.fn().mockReturnValue({ where: entityWhere });

      const affectedWhere = vi.fn().mockResolvedValue([{ bookId: 30 }]);
      const affectedFrom = vi.fn().mockReturnValue({ where: affectedWhere });
      const selectDistinct = vi.fn().mockReturnValue({ from: affectedFrom });

      let callIdx = 0;
      const select = vi.fn().mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return { from: entityFrom };
        return { from: affectedFrom };
      });

      const authorsRepo = { updateAuthorById: vi.fn(), mergeAuthors: vi.fn(), deleteAuthors: vi.fn().mockResolvedValue(undefined) };
      const authorImageStorage = { promoteImage: vi.fn(), deleteAuthorDir: vi.fn().mockResolvedValue(undefined) };

      const strategy = makeStrategy({ select, selectDistinct }, { authorsRepo, authorImageStorage });

      const result = await strategy.deleteEntity({ entityId: 2, mode: 'hard', libraryIds: [] });

      expect(authorsRepo.deleteAuthors).toHaveBeenCalledWith([2]);
      expect(authorImageStorage.deleteAuthorDir).toHaveBeenCalledWith(2);
      expect(result).toEqual({ name: 'Lewis', affectedBookIds: [30] });
    });
  });

  describe('split', () => {
    it('throws NotFoundException when entity does not exist', async () => {
      const { select } = makeSelectChain([]);
      const strategy = makeStrategy({ select });

      await expect(strategy.split({ entityId: 1, newNames: ['A', 'B'] })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates new authors, assigns bookAuthors rows, removes old rows, and deletes image dir', async () => {
      const entityLimit = vi.fn().mockResolvedValue([{ name: 'Old Author' }]);
      const entityWhere = vi.fn().mockReturnValue({ limit: entityLimit });
      const entityFrom = vi.fn().mockReturnValue({ where: entityWhere });

      const affectedWhere = vi.fn().mockResolvedValue([{ bookId: 5 }]);
      const affectedFrom = vi.fn().mockReturnValue({ where: affectedWhere });
      const selectDistinct = vi.fn().mockReturnValue({ from: affectedFrom });

      let outerSelectIdx = 0;
      const select = vi.fn().mockImplementation(() => {
        outerSelectIdx++;
        if (outerSelectIdx === 1) return { from: entityFrom };
        return { from: affectedFrom };
      });

      const txInsertReturning = vi.fn().mockResolvedValue([{ id: 100 }]);
      const txInsertOnConflict = vi.fn().mockReturnValue({ returning: txInsertReturning });
      const txInsertValues = vi.fn().mockReturnValue({ onConflictDoNothing: txInsertOnConflict, returning: txInsertReturning });
      const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });

      const txExistingWhere = vi.fn().mockResolvedValue([]);
      const txSelectFrom = vi.fn().mockReturnValue({ where: txExistingWhere });
      const txSelect = vi.fn().mockReturnValue({ from: txSelectFrom });

      const txBookRowsWhere = vi.fn().mockResolvedValue([{ bookId: 5, displayOrder: 0 }]);
      const txBookRowsFrom = vi.fn().mockReturnValue({ where: txBookRowsWhere });

      let txSelectIdx = 0;
      txSelect.mockImplementation(() => {
        txSelectIdx++;
        if (txSelectIdx <= 2) return { from: txSelectFrom };
        return { from: txBookRowsFrom };
      });

      const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
      const txDeleteFrom = vi.fn().mockReturnValue({ where: txDeleteWhere });

      const tx = {
        select: txSelect,
        insert: txInsert,
        delete: txDeleteFrom,
      };

      const transaction = vi.fn().mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

      const authorImageStorage = { promoteImage: vi.fn(), deleteAuthorDir: vi.fn().mockResolvedValue(undefined) };
      const authorsRepo = { updateAuthorById: vi.fn(), mergeAuthors: vi.fn(), deleteAuthors: vi.fn() };

      const strategy = makeStrategy({ select, selectDistinct, transaction }, { authorsRepo, authorImageStorage });

      const result = await strategy.split({ entityId: 1, newNames: [' New   A ', 'New\tB'] });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(txInsertValues).toHaveBeenNthCalledWith(1, { name: 'New A' });
      expect(txInsertValues).toHaveBeenNthCalledWith(2, { name: 'New B' });
      expect(txDeleteWhere).toHaveBeenCalledTimes(2);
      expect(authorImageStorage.deleteAuthorDir).toHaveBeenCalledWith(1);
      expect(result.originalName).toBe('Old Author');
      expect(result.affectedBookIds).toEqual([5]);
    });

    it('reuses existing author when name already exists during split', async () => {
      const entityLimit = vi.fn().mockResolvedValue([{ name: 'Shared Author' }]);
      const entityWhere = vi.fn().mockReturnValue({ limit: entityLimit });
      const entityFrom = vi.fn().mockReturnValue({ where: entityWhere });

      const affectedWhere = vi.fn().mockResolvedValue([]);
      const affectedFrom = vi.fn().mockReturnValue({ where: affectedWhere });
      const selectDistinct = vi.fn().mockReturnValue({ from: affectedFrom });

      let outerIdx = 0;
      const select = vi.fn().mockImplementation(() => {
        outerIdx++;
        if (outerIdx === 1) return { from: entityFrom };
        return { from: affectedFrom };
      });

      const existingAuthorWhere = vi.fn().mockResolvedValue([{ id: 55, name: 'Existing Author' }]);
      const existingAuthorFrom = vi.fn().mockReturnValue({ where: existingAuthorWhere });

      const bookRowsWhere = vi.fn().mockResolvedValue([]);
      const bookRowsFrom = vi.fn().mockReturnValue({ where: bookRowsWhere });

      let txIdx = 0;
      const txSelect = vi.fn().mockImplementation(() => {
        txIdx++;
        if (txIdx === 1) return { from: existingAuthorFrom };
        return { from: bookRowsFrom };
      });

      const txInsert = vi.fn();
      const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
      const txDeleteFrom = vi.fn().mockReturnValue({ where: txDeleteWhere });

      const tx = { select: txSelect, insert: txInsert, delete: txDeleteFrom };
      const transaction = vi.fn().mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

      const authorImageStorage = { deleteAuthorDir: vi.fn().mockResolvedValue(undefined) };
      const authorsRepo = { updateAuthorById: vi.fn(), mergeAuthors: vi.fn(), deleteAuthors: vi.fn() };

      const strategy = makeStrategy({ select, selectDistinct, transaction }, { authorsRepo, authorImageStorage });

      const result = await strategy.split({ entityId: 1, newNames: ['Existing   Author'] });

      expect(txInsert).not.toHaveBeenCalled();
      expect(result.newEntities[0]).toMatchObject({ id: 55, name: 'Existing Author' });
    });

    it('does not reuse the source author as a normalized split target', async () => {
      const entityLimit = vi.fn().mockResolvedValue([{ name: 'Old  Author' }]);
      const entityWhere = vi.fn().mockReturnValue({ limit: entityLimit });
      const entityFrom = vi.fn().mockReturnValue({ where: entityWhere });

      const affectedWhere = vi.fn().mockResolvedValue([]);
      const affectedFrom = vi.fn().mockReturnValue({ where: affectedWhere });
      const selectDistinct = vi.fn().mockReturnValue({ from: affectedFrom });

      let outerIdx = 0;
      const select = vi.fn().mockImplementation(() => {
        outerIdx++;
        if (outerIdx === 1) return { from: entityFrom };
        return { from: affectedFrom };
      });

      const existingAuthorWhere = vi.fn().mockResolvedValue([{ id: 1, name: 'Old  Author' }]);
      const existingAuthorFrom = vi.fn().mockReturnValue({ where: existingAuthorWhere });

      const bookRowsWhere = vi.fn().mockResolvedValue([]);
      const bookRowsFrom = vi.fn().mockReturnValue({ where: bookRowsWhere });

      let txIdx = 0;
      const txSelect = vi.fn().mockImplementation(() => {
        txIdx++;
        if (txIdx === 1) return { from: existingAuthorFrom };
        return { from: bookRowsFrom };
      });

      const txInsertReturning = vi.fn().mockResolvedValue([{ id: 56 }]);
      const txInsertValues = vi.fn().mockReturnValue({ returning: txInsertReturning });
      const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });
      const txDeleteWhere = vi.fn().mockResolvedValue(undefined);
      const txDeleteFrom = vi.fn().mockReturnValue({ where: txDeleteWhere });

      const tx = { select: txSelect, insert: txInsert, delete: txDeleteFrom };
      const transaction = vi.fn().mockImplementation(async (cb: (tx: typeof tx) => Promise<unknown>) => cb(tx));

      const authorImageStorage = { deleteAuthorDir: vi.fn().mockResolvedValue(undefined) };
      const authorsRepo = { updateAuthorById: vi.fn(), mergeAuthors: vi.fn(), deleteAuthors: vi.fn() };

      const strategy = makeStrategy({ select, selectDistinct, transaction }, { authorsRepo, authorImageStorage });

      const result = await strategy.split({ entityId: 1, newNames: ['Old Author'] });

      expect(txInsertValues).toHaveBeenCalledWith({ name: 'Old Author' });
      expect(result.newEntities[0]).toMatchObject({ id: 56, name: 'Old Author' });
    });
  });

  describe('findAffectedBookIds', () => {
    it('returns empty array for empty ids', async () => {
      const select = vi.fn();
      const strategy = makeStrategy({ select });

      await expect(strategy.findAffectedBookIds([])).resolves.toEqual([]);

      expect(select).not.toHaveBeenCalled();
    });

    it('queries selectDistinct and maps bookId', async () => {
      const where = vi.fn().mockResolvedValue([{ bookId: 10 }, { bookId: 20 }]);
      const from = vi.fn().mockReturnValue({ where });
      const selectDistinct = vi.fn().mockReturnValue({ from });

      const strategy = makeStrategy({ selectDistinct });

      await expect(strategy.findAffectedBookIds([1, 2])).resolves.toEqual([10, 20]);
    });
  });

  describe('getBookCount', () => {
    it('returns count from database', async () => {
      const where = vi.fn().mockResolvedValue([{ count: 7 }]);
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });

      const strategy = makeStrategy({ select });

      await expect(strategy.getBookCount(1)).resolves.toBe(7);
    });

    it('returns 0 when no row is returned', async () => {
      const where = vi.fn().mockResolvedValue([]);
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });

      const strategy = makeStrategy({ select });

      await expect(strategy.getBookCount(1)).resolves.toBe(0);
    });
  });

  describe('getBookTitles', () => {
    it('returns titles from joined query', async () => {
      const limit = vi.fn().mockResolvedValue([{ title: 'The Hobbit' }, { title: 'LOTR' }]);
      const orderBy = vi.fn().mockReturnValue({ limit });
      const where = vi.fn().mockReturnValue({ orderBy });
      const leftJoin = vi.fn().mockReturnValue({ where });
      const innerJoin = vi.fn().mockReturnValue({ leftJoin });
      const from = vi.fn().mockReturnValue({ innerJoin });
      const select = vi.fn().mockReturnValue({ from });

      const strategy = makeStrategy({ select });

      await expect(strategy.getBookTitles(1, 5)).resolves.toEqual(['The Hobbit', 'LOTR']);
    });
  });

  describe('findEntityById', () => {
    it('returns author when found', async () => {
      const { select } = makeSelectChain([{ id: 42, name: 'Tolkien' }]);
      const strategy = makeStrategy({ select });

      await expect(strategy.findEntityById(42)).resolves.toEqual({ id: 42, name: 'Tolkien' });
    });

    it('returns null when author is not found', async () => {
      const { select } = makeSelectChain([]);
      const strategy = makeStrategy({ select });

      await expect(strategy.findEntityById(99)).resolves.toBeNull();
    });
  });
});

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
