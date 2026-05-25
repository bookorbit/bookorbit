import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KoreaderRepository } from './koreader.repository';

function makeQueryChain(result: unknown) {
  const chain: Record<string, unknown> = {
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  chain.from = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.leftJoin = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(result);
  return chain;
}

function makeDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    query: {
      users: { findFirst: vi.fn() },
      koreaderUsers: { findFirst: vi.fn() },
    },
  };
}

describe('KoreaderRepository', () => {
  let db: ReturnType<typeof makeDb>;
  let repo: KoreaderRepository;

  beforeEach(() => {
    db = makeDb();
    repo = new KoreaderRepository(db as never);
  });

  describe('resolveBookFileByHash', () => {
    it('short-circuits when accessible libraries are empty', async () => {
      await expect(repo.resolveBookFileByHash('hash', [])).resolves.toBeNull();
      expect(db.select).not.toHaveBeenCalled();
    });

    it('returns null when accessible libraries is null and no file found', async () => {
      const emptyChain = makeQueryChain([]);
      db.select.mockReturnValue(emptyChain);

      const result = await repo.resolveBookFileByHash('hash', null);

      expect(result).toBeNull();
      expect(db.select).toHaveBeenCalledTimes(2);
    });

    it('returns the book file when found by current hash', async () => {
      const file = { id: 10, bookId: 20 };
      db.select.mockReturnValue(makeQueryChain([file]));

      const result = await repo.resolveBookFileByHash('abc123', null);

      expect(result).toEqual(file);
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('falls back to hash history when current hash lookup returns nothing', async () => {
      const file = { id: 10, bookId: 20 };
      db.select.mockReturnValueOnce(makeQueryChain([])).mockReturnValueOnce(makeQueryChain([file]));

      const result = await repo.resolveBookFileByHash('oldhash', null);

      expect(result).toEqual(file);
      expect(db.select).toHaveBeenCalledTimes(2);
    });
  });

  describe('getAccessibleLibraryIds', () => {
    it('returns null for superusers', async () => {
      db.query.users.findFirst.mockResolvedValue({ isSuperuser: true });

      const result = await repo.getAccessibleLibraryIds(1);

      expect(result).toBeNull();
    });

    it('returns an array of library IDs for regular users', async () => {
      db.query.users.findFirst.mockResolvedValue({ isSuperuser: false });
      db.select.mockReturnValue(makeQueryChain([{ libraryId: 3 }, { libraryId: 7 }]));

      const result = await repo.getAccessibleLibraryIds(1);

      expect(result).toEqual([3, 7]);
    });

    it('returns an empty array for regular users with no library access', async () => {
      db.query.users.findFirst.mockResolvedValue({ isSuperuser: false });
      db.select.mockReturnValue(makeQueryChain([]));

      const result = await repo.getAccessibleLibraryIds(1);

      expect(result).toEqual([]);
    });
  });

  describe('deleteKoreaderUser', () => {
    it('deletes the koreader user record for the given userId', async () => {
      const deleteChain = { where: vi.fn().mockResolvedValue(undefined) };
      db.delete.mockReturnValue(deleteChain);

      await repo.deleteKoreaderUser(42);

      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(deleteChain.where).toHaveBeenCalledTimes(1);
    });
  });

  describe('findBookFileIdByBookId', () => {
    it('returns the book file id when found', async () => {
      db.select.mockReturnValue(makeQueryChain([{ id: 5 }]));

      const result = await repo.findBookFileIdByBookId(10);

      expect(result).toBe(5);
    });

    it('returns null when no primary file exists for the book', async () => {
      db.select.mockReturnValue(makeQueryChain([]));

      const result = await repo.findBookFileIdByBookId(10);

      expect(result).toBeNull();
    });
  });

  describe('getLastFileWriteTime', () => {
    it('returns null when there are no write log entries', async () => {
      db.select.mockReturnValue(makeQueryChain([]));

      const result = await repo.getLastFileWriteTime(1);

      expect(result).toBeNull();
    });

    it('returns the writtenAt date from the latest log entry', async () => {
      const date = new Date('2026-01-01T00:00:00.000Z');
      db.select.mockReturnValue(makeQueryChain([{ writtenAt: date }]));

      const result = await repo.getLastFileWriteTime(1);

      expect(result).toBe(date);
    });
  });

  describe('upsertReadingProgress', () => {
    it('upserts percentage and clears stale web locator fields on conflict', async () => {
      const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
      const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
      db.insert.mockReturnValue({ values });

      await repo.upsertReadingProgress(44, 12, 41.25);

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          bookFileId: 44,
          userId: 12,
          percentage: 41.25,
        }),
      );

      expect(onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(Array),
          set: expect.objectContaining({
            percentage: 41.25,
            cfi: null,
            pageNumber: null,
          }),
        }),
      );

      const conflictArg = onConflictDoUpdate.mock.calls[0]?.[0] as { set?: Record<string, unknown> } | undefined;
      expect(conflictArg?.set?.['updatedAt']).toBeDefined();
    });
  });
});
