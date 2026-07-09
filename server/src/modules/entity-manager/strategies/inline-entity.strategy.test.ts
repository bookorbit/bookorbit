import { BadRequestException } from '@nestjs/common';

import { InlineEntityStrategy } from './inline-entity.strategy';

class TestInlineStrategy extends InlineEntityStrategy {
  readonly entityType = 'narrator' as const;
  protected readonly fieldName = 'narrator';
  protected readonly rawFieldName = 'narrator';
}

function makeStrategy(db: Record<string, unknown> = {}) {
  return new TestInlineStrategy(db as never);
}

function makeSelectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where, orderBy, limit };
}

describe('InlineEntityStrategy', () => {
  describe('findCandidatePairs', () => {
    it('runs inside a transaction and returns rows', async () => {
      const rows = [{ idA: 'Alice', idB: 'Alicia', nameA: 'Alice', nameB: 'Alicia', simScore: 0.85 }];
      const execute = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows });
      const transaction = vi.fn().mockImplementation(async (cb: (tx: { execute: typeof execute }) => Promise<unknown>) => cb({ execute }));
      const strategy = makeStrategy({ transaction });

      await expect(strategy.findCandidatePairs([1, 2], 0.7)).resolves.toEqual(rows);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledTimes(2);
    });

    it('includes no library filter when libraryIds is empty', async () => {
      const rows: unknown[] = [];
      const execute = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows });
      const transaction = vi.fn().mockImplementation(async (cb: (tx: { execute: typeof execute }) => Promise<unknown>) => cb({ execute }));
      const strategy = makeStrategy({ transaction });

      await expect(strategy.findCandidatePairs([], 0.5)).resolves.toEqual(rows);

      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('clamps similarity above 1 down to 1', async () => {
      let capturedThreshold: string | undefined;
      const execute = vi.fn().mockImplementation((sqlObj: unknown) => {
        const chunks: unknown[] = (sqlObj as any).queryChunks ?? [];
        const stringParam = chunks.find((c) => typeof c === 'string');
        if (typeof stringParam === 'string') {
          capturedThreshold = stringParam;
          return undefined;
        }
        return { rows: [] };
      });
      const transaction = vi.fn().mockImplementation(async (cb: (tx: { execute: typeof execute }) => Promise<unknown>) => cb({ execute }));
      const strategy = makeStrategy({ transaction });

      await strategy.findCandidatePairs([1], 5);

      expect(Number(capturedThreshold)).toBe(1);
    });
  });

  describe('browse', () => {
    it('calls execute twice (count and items) and returns mapped result', async () => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ total: 2 }] })
        .mockResolvedValueOnce({ rows: [{ name: 'Alice', bookCount: 3 }] });
      const strategy = makeStrategy({ execute });

      const result = await strategy.browse({ libraryIds: [1], page: 1, pageSize: 25, sortBy: 'name', sortOrder: 'asc', bookCount: 'any' });

      expect(execute).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ items: [{ id: 'Alice', name: 'Alice', bookCount: 3 }], total: 2 });
    });

    it('uses 0 as total when count row is missing', async () => {
      const execute = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
      const strategy = makeStrategy({ execute });

      const result = await strategy.browse({ libraryIds: [1], page: 1, pageSize: 25, sortBy: 'name', sortOrder: 'asc', bookCount: 'any' });

      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
    });
  });

  describe('merge', () => {
    it('calls execute once per source value and returns affected book ids', async () => {
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      const strategy = makeStrategy({ execute });
      vi.spyOn(strategy, 'findAffectedBookIds').mockResolvedValue([10, 20]);

      const result = await strategy.merge({ targetId: 'Alice', sourceIds: ['Alicia', 'Ali'], userId: 1 });

      expect(execute).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ affectedBookIds: [10, 20] });
    });

    it('does nothing when sourceIds is empty', async () => {
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      const strategy = makeStrategy({ execute });
      vi.spyOn(strategy, 'findAffectedBookIds').mockResolvedValue([]);

      await strategy.merge({ targetId: 'Alice', sourceIds: [], userId: 1 });

      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('throws BadRequestException when new name is blank', async () => {
      const strategy = makeStrategy({});

      await expect(strategy.rename({ entityId: 'Alice', newName: '   ', userId: 1, libraryIds: [1] })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sets wasImplicitMerge=true when another value already exists', async () => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ cnt: 3 }] })
        .mockResolvedValueOnce({ rows: [{ bookId: 5 }, { bookId: 6 }] });
      const strategy = makeStrategy({ execute });

      const result = await strategy.rename({ entityId: 'Alice', newName: 'Alicia', userId: 1, libraryIds: [1] });

      expect(result.wasImplicitMerge).toBe(true);
      expect(result.mergedEntityId).toBe('Alicia');
      expect(result.affectedBookIds).toEqual([5, 6]);
    });

    it('sets wasImplicitMerge=false when no existing value conflicts', async () => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
        .mockResolvedValueOnce({ rows: [{ bookId: 7 }] });
      const strategy = makeStrategy({ execute });

      const result = await strategy.rename({ entityId: 'Alice', newName: 'Alicia', userId: 1, libraryIds: [1] });

      expect(result.wasImplicitMerge).toBe(false);
      expect(result.mergedEntityId).toBeUndefined();
    });

    it('sets wasImplicitMerge=false when renaming to same value (same identity)', async () => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
        .mockResolvedValueOnce({ rows: [{ bookId: 7 }] });
      const strategy = makeStrategy({ execute });

      const result = await strategy.rename({ entityId: 'Alice', newName: 'Alice', userId: 1, libraryIds: [1] });

      expect(result.wasImplicitMerge).toBe(false);
    });

    it('returns affected book ids from execute rows', async () => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ cnt: 0 }] })
        .mockResolvedValueOnce({ rows: [{ bookId: 1 }, { bookId: 2 }, { bookId: 3 }] });
      const strategy = makeStrategy({ execute });

      const result = await strategy.rename({ entityId: 'X', newName: 'Y', userId: 1, libraryIds: [1] });

      expect(result.affectedBookIds).toEqual([1, 2, 3]);
      expect(result.oldName).toBe('X');
    });
  });

  describe('deleteEntity', () => {
    it('returns name and affected book ids from execute rows', async () => {
      const execute = vi.fn().mockResolvedValueOnce({ rows: [{ bookId: 10 }, { bookId: 11 }] });
      const strategy = makeStrategy({ execute });

      const result = await strategy.deleteEntity({ entityId: 'Alice', mode: 'inline', libraryIds: [1] });

      expect(result).toEqual({ name: 'Alice', affectedBookIds: [10, 11] });
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it('returns empty affectedBookIds when no rows are updated', async () => {
      const execute = vi.fn().mockResolvedValueOnce({ rows: [] });
      const strategy = makeStrategy({ execute });

      const result = await strategy.deleteEntity({ entityId: 'Nobody', mode: 'inline', libraryIds: [1] });

      expect(result).toEqual({ name: 'Nobody', affectedBookIds: [] });
    });
  });

  describe('split', () => {
    it('throws BadRequestException', () => {
      const strategy = makeStrategy({});

      expect(() => strategy.split({ entityId: 1, newNames: ['A', 'B'] })).toThrow(BadRequestException);
    });
  });

  describe('findAffectedBookIds', () => {
    it('returns empty array without calling execute when ids is empty', async () => {
      const execute = vi.fn();
      const strategy = makeStrategy({ execute });

      await expect(strategy.findAffectedBookIds([])).resolves.toEqual([]);

      expect(execute).not.toHaveBeenCalled();
    });

    it('calls execute and returns mapped book ids', async () => {
      const execute = vi.fn().mockResolvedValueOnce({ rows: [{ bookId: 3 }, { bookId: 7 }] });
      const strategy = makeStrategy({ execute });

      await expect(strategy.findAffectedBookIds(['Alice', 'Bob'])).resolves.toEqual([3, 7]);

      expect(execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('getBookCount', () => {
    it('returns the count from the select chain', async () => {
      const where = vi.fn().mockResolvedValue([{ count: 5 }]);
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });
      const strategy = makeStrategy({ select });

      await expect(strategy.getBookCount('Alice')).resolves.toBe(5);
    });

    it('returns 0 when no row is found', async () => {
      const where = vi.fn().mockResolvedValue([]);
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });
      const strategy = makeStrategy({ select });

      await expect(strategy.getBookCount('Unknown')).resolves.toBe(0);
    });
  });

  describe('getBookTitles', () => {
    it('returns titles from the select chain', async () => {
      const limit = vi.fn().mockResolvedValue([{ title: 'Dune' }, { title: 'Foundation' }]);
      const orderBy = vi.fn().mockReturnValue({ limit });
      const where = vi.fn().mockReturnValue({ orderBy });
      const from = vi.fn().mockReturnValue({ where });
      const select = vi.fn().mockReturnValue({ from });
      const strategy = makeStrategy({ select });

      await expect(strategy.getBookTitles('Alice', 10)).resolves.toEqual(['Dune', 'Foundation']);
    });
  });

  describe('findEntityById', () => {
    it('returns {id, name} when a row is found', async () => {
      const { select } = makeSelectChain([{ name: 'Alice' }]);
      const strategy = makeStrategy({ select });

      await expect(strategy.findEntityById('Alice')).resolves.toEqual({ id: 'Alice', name: 'Alice' });
    });

    it('returns null when no row is found', async () => {
      const { select } = makeSelectChain([]);
      const strategy = makeStrategy({ select });

      await expect(strategy.findEntityById('Unknown')).resolves.toBeNull();
    });
  });
});
