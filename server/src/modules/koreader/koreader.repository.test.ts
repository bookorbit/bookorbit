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
      const file = { id: 10, bookId: 20, libraryId: 1 };
      db.select.mockReturnValue(makeQueryChain([file]));

      const result = await repo.resolveBookFileByHash('abc123', null);

      expect(result).toEqual(file);
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('falls back to hash history when current hash lookup returns nothing', async () => {
      const file = { id: 10, bookId: 20, libraryId: 1 };
      db.select.mockReturnValueOnce(makeQueryChain([])).mockReturnValueOnce(makeQueryChain([file]));

      const result = await repo.resolveBookFileByHash('oldhash', null);

      expect(result).toEqual(file);
      expect(db.select).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolveBookFilesByHashes', () => {
    it('returns an empty map when no hashes are provided', async () => {
      const result = await repo.resolveBookFilesByHashes([], null);

      expect(result.size).toBe(0);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('returns an empty map when the user has no accessible libraries', async () => {
      const result = await repo.resolveBookFilesByHashes(['hash'], []);

      expect(result.size).toBe(0);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('resolves direct hashes first and falls back to hash history for missing hashes', async () => {
      db.select
        .mockReturnValueOnce(
          makeQueryChain([
            { hash: 'current', bookFileId: 11, bookId: 21, libraryId: 31 },
            { hash: null, bookFileId: 12, bookId: 22, libraryId: 32 },
          ]),
        )
        .mockReturnValueOnce(makeQueryChain([{ hash: 'old', bookFileId: 13, bookId: 23, libraryId: 33 }]));

      const result = await repo.resolveBookFilesByHashes(['current', 'old'], [31, 33]);

      expect(result.get('current')).toEqual({ bookFileId: 11, bookId: 21, libraryId: 31 });
      expect(result.get('old')).toEqual({ bookFileId: 13, bookId: 23, libraryId: 33 });
      expect(result.size).toBe(2);
      expect(db.select).toHaveBeenCalledTimes(2);
    });

    it('skips hash history lookup when all hashes resolve directly', async () => {
      db.select.mockReturnValueOnce(makeQueryChain([{ hash: 'current', bookFileId: 11, bookId: 21, libraryId: 31 }]));

      const result = await repo.resolveBookFilesByHashes(['current'], null);

      expect(result.get('current')).toEqual({ bookFileId: 11, bookId: 21, libraryId: 31 });
      expect(db.select).toHaveBeenCalledTimes(1);
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

  describe('koreader user records', () => {
    it('finds a koreader user by app user id', async () => {
      const row = { userId: 42, username: 'reader' };
      db.query.koreaderUsers.findFirst.mockResolvedValue(row);

      await expect(repo.findKoreaderUser(42)).resolves.toBe(row);
      expect(db.query.koreaderUsers.findFirst).toHaveBeenCalledTimes(1);
    });

    it('finds a koreader user by username', async () => {
      const row = { userId: 42, username: 'reader' };
      db.query.koreaderUsers.findFirst.mockResolvedValue(row);

      await expect(repo.findKoreaderUserByUsername('reader')).resolves.toBe(row);
      expect(db.query.koreaderUsers.findFirst).toHaveBeenCalledTimes(1);
    });

    it('creates a koreader user and returns the inserted row', async () => {
      const data = { userId: 42, username: 'reader', passwordHash: 'hash', passwordMd5: 'md5' };
      const returning = vi.fn().mockResolvedValue([data]);
      const values = vi.fn().mockReturnValue({ returning });
      db.insert.mockReturnValue({ values });

      await expect(repo.createKoreaderUser(data)).resolves.toEqual(data);
      expect(values).toHaveBeenCalledWith(data);
      expect(returning).toHaveBeenCalledTimes(1);
    });

    it('updates a koreader user', async () => {
      const where = vi.fn().mockResolvedValue(undefined);
      const set = vi.fn().mockReturnValue({ where });
      db.update.mockReturnValue({ set });

      await repo.updateKoreaderUser(42, { syncEnabled: false });

      expect(db.update).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith({ syncEnabled: false });
      expect(where).toHaveBeenCalledTimes(1);
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

  describe('device progress records', () => {
    it('upserts device progress as non-orphaned progress', async () => {
      const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
      const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
      db.insert.mockReturnValue({ values });

      await repo.upsertDeviceProgress({
        bookFileId: 10,
        userId: 42,
        device: 'Kobo',
        deviceId: 'device-1',
        percentage: 57.5,
        progress: '/body/1',
        chapterIndex: 2,
        syncTimestamp: 12345,
      });

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          bookFileId: 10,
          userId: 42,
          device: 'Kobo',
          deviceId: 'device-1',
          percentage: 57.5,
          orphaned: false,
          orphanedHash: null,
        }),
      );
      expect(onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(Array),
          targetWhere: expect.any(Object),
          set: expect.objectContaining({
            percentage: 57.5,
            progress: '/body/1',
            chapterIndex: 2,
            syncTimestamp: 12345,
            updatedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('returns the latest device progress row or null', async () => {
      const row = { id: 1, bookFileId: 10, userId: 42 };
      db.select.mockReturnValueOnce(makeQueryChain([row])).mockReturnValueOnce(makeQueryChain([]));

      await expect(repo.getLatestDeviceProgress(10, 42)).resolves.toBe(row);
      await expect(repo.getLatestDeviceProgress(10, 42)).resolves.toBeNull();
    });

    it('returns all device progress rows ordered by update time', async () => {
      const rows = [{ id: 1 }, { id: 2 }];
      db.select.mockReturnValue(makeQueryChain(rows));

      await expect(repo.getAllDeviceProgress(10, 42)).resolves.toBe(rows);
    });

    it('maps device list rows from raw SQL results', async () => {
      const lastSync = new Date('2026-01-01T00:00:00.000Z');
      db.execute.mockResolvedValue({
        rows: [
          { device: 'Kobo', device_id: 'device-1', last_sync_at: lastSync, last_book_title: 'Book' },
          { device: 'Phone', device_id: 'device-2', last_sync_at: lastSync, last_book_title: null },
        ],
      });

      await expect(repo.getDevicesList(42)).resolves.toEqual([
        { device: 'Kobo', deviceId: 'device-1', lastSyncAt: lastSync, lastBookTitle: 'Book' },
        { device: 'Phone', deviceId: 'device-2', lastSyncAt: lastSync, lastBookTitle: null },
      ]);
    });

    it('counts total synced books and defaults missing results to zero', async () => {
      db.select.mockReturnValueOnce(makeQueryChain([{ count: '3' }])).mockReturnValueOnce(makeQueryChain([]));

      await expect(repo.getTotalSyncedBooks(42)).resolves.toBe(3);
      await expect(repo.getTotalSyncedBooks(42)).resolves.toBe(0);
    });
  });

  describe('reading progress records', () => {
    it('returns reading progress or null', async () => {
      const row = { id: 1, bookFileId: 10, userId: 42 };
      db.select.mockReturnValueOnce(makeQueryChain([row])).mockReturnValueOnce(makeQueryChain([]));

      await expect(repo.getReadingProgress(10, 42)).resolves.toBe(row);
      await expect(repo.getReadingProgress(10, 42)).resolves.toBeNull();
    });

    it('combines device and web reading progress for the dashboard', async () => {
      const deviceProgress = [{ id: 1 }];
      const readingProgress = { id: 2 };
      const getAllDeviceProgress = vi.spyOn(repo, 'getAllDeviceProgress').mockResolvedValue(deviceProgress as never);
      const getReadingProgress = vi.spyOn(repo, 'getReadingProgress').mockResolvedValue(readingProgress as never);

      await expect(repo.getBookProgressForDashboard(10, 42)).resolves.toEqual({ deviceProgress, readingProgress });
      expect(getAllDeviceProgress).toHaveBeenCalledWith(10, 42);
      expect(getReadingProgress).toHaveBeenCalledWith(10, 42);
    });
  });

  describe('chapters', () => {
    it('returns chapters ordered by chapter index', async () => {
      const rows = [{ chapterIndex: 1 }, { chapterIndex: 2 }];
      db.select.mockReturnValue(makeQueryChain(rows));

      await expect(repo.getChapters(10)).resolves.toBe(rows);
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
            koreaderProgress: null,
          }),
        }),
      );

      const conflictArg = onConflictDoUpdate.mock.calls[0]?.[0] as { set?: Record<string, unknown> } | undefined;
      expect(conflictArg?.set?.['updatedAt']).toBeDefined();
    });
  });
});
