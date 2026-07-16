import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sqlChunkText } from '../../common/test-utils/sql-chunk-text';
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
  chain.returning = vi.fn().mockResolvedValue(result);
  return chain;
}

function makeDb() {
  return {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
    query: {
      users: { findFirst: vi.fn() },
      koreaderUsers: { findFirst: vi.fn() },
      koreaderUserSettings: { findFirst: vi.fn() },
      koreaderDeviceSettings: { findFirst: vi.fn() },
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

    it('falls back to a user-scoped manual link after direct and history lookups miss', async () => {
      const file = { id: 10, bookId: 20, libraryId: 1 };
      db.select
        .mockReturnValueOnce(makeQueryChain([]))
        .mockReturnValueOnce(makeQueryChain([]))
        .mockReturnValueOnce(makeQueryChain([file]));

      const result = await repo.resolveBookFileByHash('manualhash', [1], 7);

      expect(result).toEqual(file);
      expect(db.select).toHaveBeenCalledTimes(3);
    });

    it('returns null when a user-scoped manual link lookup also misses', async () => {
      db.select.mockReturnValueOnce(makeQueryChain([])).mockReturnValueOnce(makeQueryChain([])).mockReturnValueOnce(makeQueryChain([]));

      const result = await repo.resolveBookFileByHash('manualhash', [1], 7);

      expect(result).toBeNull();
      expect(db.select).toHaveBeenCalledTimes(3);
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

    it('resolves remaining hashes from user-scoped manual links', async () => {
      db.select
        .mockReturnValueOnce(makeQueryChain([{ hash: 'current', bookFileId: 11, bookId: 21, libraryId: 31 }]))
        .mockReturnValueOnce(makeQueryChain([]))
        .mockReturnValueOnce(makeQueryChain([{ hash: 'manual', bookFileId: 12, bookId: 22, libraryId: 32 }]));

      const result = await repo.resolveBookFilesByHashes(['current', 'manual'], [31, 32], 7);

      expect(result.get('current')).toEqual({ bookFileId: 11, bookId: 21, libraryId: 31 });
      expect(result.get('manual')).toEqual({ bookFileId: 12, bookId: 22, libraryId: 32 });
      expect(db.select).toHaveBeenCalledTimes(3);
    });
  });

  describe('unmatched books and manual hash links', () => {
    it('upserts unmatched candidates with trimmed nullable metadata and no device association when deviceId is omitted', async () => {
      const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
      const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
      const txInsert = vi.fn().mockReturnValue({ values });
      const tx = { insert: txInsert };
      db.transaction.mockImplementation(async (handler: (client: typeof tx) => Promise<void>) => handler(tx));

      await repo.upsertUnmatchedBooks(7, [
        { hash: 'a'.repeat(32), title: '  Title  ', authors: '  Author  ', lastOpen: 100, source: 'file', metadataAmbiguous: true },
      ]);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(txInsert).toHaveBeenCalledTimes(1);
      expect(values).toHaveBeenCalledWith([
        expect.objectContaining({
          userId: 7,
          hash: 'a'.repeat(32),
          title: 'Title',
          authors: 'Author',
          lastOpen: 100,
          source: 'file',
          metadataAmbiguous: true,
          lastSeenAt: expect.any(Date),
        }),
      ]);
      expect(onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(Array),
          set: expect.objectContaining({
            source: expect.anything(),
            metadataAmbiguous: expect.anything(),
            lastSeenAt: expect.any(Date),
          }),
        }),
      );
      const conflictSet = onConflictDoUpdate.mock.calls[0]![0].set as Record<string, unknown>;
      expect(sqlChunkText(conflictSet.source)).toContain("case excluded.source when 'current_file' then 2 when 'file' then 1 else 0 end");
      expect(sqlChunkText(conflictSet.source)).toContain('>=');
      expect(sqlChunkText(conflictSet.source)).toContain('excluded.source');
      expect(sqlChunkText(conflictSet.metadataAmbiguous)).toContain('excluded.metadata_ambiguous');
      expect(sqlChunkText(conflictSet.title)).toContain('coalesce');
    });

    it('also upserts a device association when a deviceId is provided', async () => {
      const booksOnConflict = vi.fn().mockResolvedValue(undefined);
      const booksValues = vi.fn().mockReturnValue({ onConflictDoUpdate: booksOnConflict });
      const devicesOnConflict = vi.fn().mockResolvedValue(undefined);
      const devicesValues = vi.fn().mockReturnValue({ onConflictDoUpdate: devicesOnConflict });
      const txInsert = vi.fn().mockReturnValueOnce({ values: booksValues }).mockReturnValueOnce({ values: devicesValues });
      const tx = { insert: txInsert };
      db.transaction.mockImplementation(async (handler: (client: typeof tx) => Promise<void>) => handler(tx));

      await repo.upsertUnmatchedBooks(7, [{ hash: 'a'.repeat(32), source: 'statistics' }], 'device-1');

      expect(txInsert).toHaveBeenCalledTimes(2);
      expect(devicesValues).toHaveBeenCalledWith([{ userId: 7, hash: 'a'.repeat(32), deviceId: 'device-1', lastSeenAt: expect.any(Date) }]);
      expect(devicesOnConflict).toHaveBeenCalledWith(expect.objectContaining({ target: expect.any(Array), set: { lastSeenAt: expect.any(Date) } }));
    });

    it('does not touch device associations when no candidates are given', async () => {
      await repo.upsertUnmatchedBooks(7, [], 'device-1');

      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('clears unmatched books for a user and hash set', async () => {
      const where = vi.fn().mockResolvedValue(undefined);
      db.delete.mockReturnValue({ where });

      await repo.clearUnmatchedBooks(7, ['a'.repeat(32), 'b'.repeat(32)]);

      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
    });

    it('does not issue a delete query when clearing an empty hash set', async () => {
      await repo.clearUnmatchedBooks(7, []);

      expect(db.delete).not.toHaveBeenCalled();
    });

    it('dismisses and returns a user-scoped unmatched book', async () => {
      const chain = makeQueryChain([{ hash: 'a'.repeat(32) }]);
      db.delete.mockReturnValue(chain);

      await expect(repo.dismissUnmatchedBook(7, 'a'.repeat(32))).resolves.toEqual({ hash: 'a'.repeat(32) });
      expect(chain.returning).toHaveBeenCalledTimes(1);
    });

    it('returns null when dismissing an unmatched book that does not exist for the user', async () => {
      db.delete.mockReturnValue(makeQueryChain([]));

      await expect(repo.dismissUnmatchedBook(7, 'a'.repeat(32))).resolves.toBeNull();
    });

    it('dismisses all visible unmatched books for a user and returns the count', async () => {
      const chain = makeQueryChain([{ hash: 'a'.repeat(32) }, { hash: 'b'.repeat(32) }, { hash: 'c'.repeat(32) }]);
      db.delete.mockReturnValue(chain);

      await expect(repo.dismissAllUnmatchedBooks(7)).resolves.toBe(3);
      expect(chain.returning).toHaveBeenCalledTimes(1);
    });

    it('returns zero when there are no unmatched books to dismiss', async () => {
      db.delete.mockReturnValue(makeQueryChain([]));

      await expect(repo.dismissAllUnmatchedBooks(7)).resolves.toBe(0);
    });

    it('lists unmatched books newest first with the requested limit', async () => {
      const rows = [{ hash: 'a'.repeat(32), lastSeenAt: new Date() }];
      const chain = makeQueryChain(rows);
      db.select.mockReturnValue(chain);

      await expect(repo.listUnmatchedBooks(7, 25)).resolves.toBe(rows);
      expect(chain.orderBy).toHaveBeenCalledTimes(1);
      expect(chain.limit).toHaveBeenCalledWith(25);
    });

    it('returns one unmatched book for a user and hash', async () => {
      const row = { hash: 'a'.repeat(32), title: 'Stats title' };
      db.select.mockReturnValue(makeQueryChain([row]));

      await expect(repo.getUnmatchedBook(7, 'a'.repeat(32))).resolves.toBe(row);
    });

    it('returns null when no unmatched book exists for the user and hash', async () => {
      db.select.mockReturnValue(makeQueryChain([]));

      await expect(repo.getUnmatchedBook(7, 'a'.repeat(32))).resolves.toBeNull();
    });

    it('lists manual hash links with aggregated BookOrbit authors', async () => {
      const linkRows = [
        {
          hash: 'a'.repeat(32),
          bookFileId: 44,
          bookId: 55,
          bookTitle: 'BookOrbit Title',
          koreaderTitle: 'KOReader Title',
          koreaderAuthors: 'KOReader Author',
          koreaderLastOpen: 100,
          createdAt: new Date('2026-06-01T10:00:00.000Z'),
          updatedAt: new Date('2026-06-02T10:00:00.000Z'),
        },
      ];
      db.select.mockReturnValueOnce(makeQueryChain(linkRows)).mockReturnValueOnce(makeQueryChain([{ bookId: 55, name: 'BookOrbit Author' }]));

      await expect(repo.listBookHashLinks(7, 25, [1])).resolves.toEqual([{ ...linkRows[0], bookAuthors: ['BookOrbit Author'] }]);
      expect(db.select).toHaveBeenCalledTimes(2);
    });

    it('does not query manual hash links when accessible libraries are empty', async () => {
      await expect(repo.listBookHashLinks(7, 25, [])).resolves.toEqual([]);

      expect(db.select).not.toHaveBeenCalled();
    });

    it('upserts a user-scoped manual hash link with KOReader metadata', async () => {
      const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
      const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
      db.insert.mockReturnValue({ values });

      await repo.upsertBookHashLink(7, 'a'.repeat(32), 44, { title: '  KOReader Title  ', authors: '  Author  ', lastOpen: 100 });

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 7,
          hash: 'a'.repeat(32),
          bookFileId: 44,
          koreaderTitle: 'KOReader Title',
          koreaderAuthors: 'Author',
          koreaderLastOpen: 100,
          updatedAt: expect.any(Date),
        }),
      );
      expect(onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(Array),
          set: expect.objectContaining({ bookFileId: 44, updatedAt: expect.any(Date) }),
        }),
      );
    });

    it('upserts a manual hash link with null metadata when none is provided', async () => {
      const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
      const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
      db.insert.mockReturnValue({ values });

      await repo.upsertBookHashLink(7, 'a'.repeat(32), 44);

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          koreaderTitle: null,
          koreaderAuthors: null,
          koreaderLastOpen: null,
        }),
      );
    });

    it('returns an existing manual hash link for the user', async () => {
      db.select.mockReturnValue(makeQueryChain([{ bookFileId: 44 }]));

      await expect(repo.getBookHashLink(7, 'a'.repeat(32))).resolves.toEqual({ bookFileId: 44 });
    });

    it('returns null when no manual hash link exists for the user', async () => {
      db.select.mockReturnValue(makeQueryChain([]));

      await expect(repo.getBookHashLink(7, 'a'.repeat(32))).resolves.toBeNull();
    });

    it('deletes and returns a user-scoped manual hash link', async () => {
      const row = { hash: 'a'.repeat(32), bookFileId: 44, koreaderTitle: 'Title', koreaderAuthors: 'Author', koreaderLastOpen: 100 };
      const chain = makeQueryChain([row]);
      db.delete.mockReturnValue(chain);

      await expect(repo.deleteBookHashLink(7, 'a'.repeat(32))).resolves.toEqual(row);
      expect(chain.returning).toHaveBeenCalledTimes(1);
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

    it('removeDevice deletes progress/sweep/page-stat/unmatched-device-link rows and cleans up orphaned unmatched books, summing everything', async () => {
      const returning = vi
        .fn()
        .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]) // device progress
        .mockResolvedValueOnce([{ deviceId: 'device-1' }]) // device sweeps
        .mockResolvedValueOnce([{ id: 5 }]) // page stats
        .mockResolvedValueOnce([{ hash: 'a'.repeat(32) }]) // unmatched-book device links
        .mockResolvedValueOnce([]) // device settings
        .mockResolvedValueOnce([{ hash: 'a'.repeat(32) }]); // orphaned unmatched books cleanup
      const txDeleteBuilder = { where: vi.fn().mockReturnValue({ returning }) };
      const txSelectBuilder = { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue('SUBQUERY') }) };
      const tx = { delete: vi.fn().mockReturnValue(txDeleteBuilder), select: vi.fn().mockReturnValue(txSelectBuilder) };
      db.transaction.mockImplementation(async (handler: (client: typeof tx) => Promise<number>) => handler(tx));

      await expect(repo.removeDevice(42, 'device-1')).resolves.toBe(6);

      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(tx.delete).toHaveBeenCalledTimes(6);
      expect(txDeleteBuilder.where).toHaveBeenCalledTimes(6);
      expect(returning).toHaveBeenCalledTimes(6);
      expect(tx.select).toHaveBeenCalledTimes(1);
    });

    it('removeDevice skips the orphaned unmatched-book cleanup when the device had no unmatched-book links', async () => {
      const returning = vi
        .fn()
        .mockResolvedValueOnce([{ id: 1 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]) // no unmatched-book device links removed
        .mockResolvedValueOnce([]); // no device settings removed
      const txDeleteBuilder = { where: vi.fn().mockReturnValue({ returning }) };
      const tx = { delete: vi.fn().mockReturnValue(txDeleteBuilder), select: vi.fn() };
      db.transaction.mockImplementation(async (handler: (client: typeof tx) => Promise<number>) => handler(tx));

      await expect(repo.removeDevice(42, 'device-1')).resolves.toBe(1);

      expect(tx.delete).toHaveBeenCalledTimes(5);
      expect(tx.select).not.toHaveBeenCalled();
    });

    it('removeDevice returns zero when nothing matched the given user and device', async () => {
      const returning = vi.fn().mockResolvedValue([]);
      const txDeleteBuilder = { where: vi.fn().mockReturnValue({ returning }) };
      const tx = { delete: vi.fn().mockReturnValue(txDeleteBuilder), select: vi.fn() };
      db.transaction.mockImplementation(async (handler: (client: typeof tx) => Promise<number>) => handler(tx));

      await expect(repo.removeDevice(42, 'unknown-device')).resolves.toBe(0);
      expect(tx.select).not.toHaveBeenCalled();
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

  describe('file naming settings', () => {
    it('reads the saved account pattern and falls back to null', async () => {
      db.query.koreaderUserSettings.findFirst
        .mockResolvedValueOnce({ defaultFileNamingPattern: '{authors}/{title}' })
        .mockResolvedValueOnce(undefined);

      await expect(repo.getKoreaderUserDefaultPattern(7)).resolves.toBe('{authors}/{title}');
      await expect(repo.getKoreaderUserDefaultPattern(7)).resolves.toBeNull();
    });

    it('upserts the account-level pattern', async () => {
      const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
      const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
      db.insert.mockReturnValue({ values });

      await repo.setKoreaderUserDefaultPattern(7, '{title}');

      expect(values).toHaveBeenCalledWith({ userId: 7, defaultFileNamingPattern: '{title}' });
      expect(onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          set: expect.objectContaining({ defaultFileNamingPattern: '{title}', updatedAt: expect.any(Date) }),
        }),
      );
    });

    it('reads device settings and returns null when no override exists', async () => {
      const settings = {
        userId: 7,
        deviceId: 'device-1',
        fileNamingPattern: '{title}',
        seriesFileNamingPattern: '{series}/{title}',
        standaloneFileNamingPattern: 'Standalone/{title}',
      };
      db.select.mockReturnValue(makeQueryChain([settings]));
      db.query.koreaderDeviceSettings.findFirst.mockResolvedValueOnce(settings).mockResolvedValueOnce(undefined);

      await expect(repo.getDeviceFileNamingPatterns(7)).resolves.toEqual([settings]);
      await expect(repo.getDeviceFileNamingPattern(7, 'device-1')).resolves.toBe(settings);
      await expect(repo.getDeviceFileNamingPattern(7, 'missing')).resolves.toBeNull();
    });

    it('upserts and clears a device-specific override', async () => {
      const config = {
        fileNamingPattern: '{title}',
        seriesFileNamingPattern: '{series}/{title}',
        standaloneFileNamingPattern: 'Standalone/{title}',
      };
      const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
      const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
      db.insert.mockReturnValue({ values });
      const where = vi.fn().mockResolvedValue(undefined);
      db.delete.mockReturnValue({ where });

      await repo.setDeviceFileNamingPattern(7, 'device-1', config);
      await repo.clearDeviceFileNamingPattern(7, 'device-1');

      expect(values).toHaveBeenCalledWith({ userId: 7, deviceId: 'device-1', ...config });
      expect(onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ set: expect.objectContaining({ ...config, updatedAt: expect.any(Date) }) }),
      );
      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
    });
  });
});
