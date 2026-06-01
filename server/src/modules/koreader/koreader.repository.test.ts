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
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.offset = vi.fn().mockResolvedValue(result);
  return chain;
}

function makeInsertChain() {
  const chain: Record<string, unknown> = {};
  chain.returning = vi.fn().mockResolvedValue([]);
  chain.onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  chain.onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  chain.values = vi.fn().mockReturnValue(chain);
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

function getSqlTextFromExecuteCall(arg: unknown): string {
  if (!arg || typeof arg !== 'object' || !('queryChunks' in arg)) return '';
  const queryChunks = (arg as { queryChunks?: unknown }).queryChunks;
  if (!Array.isArray(queryChunks)) return '';

  return queryChunks
    .map((chunk) => {
      if (chunk && typeof chunk === 'object' && 'value' in chunk) {
        const value = (chunk as { value?: unknown }).value;
        return Array.isArray(value) ? value.join('') : '';
      }

      return '?';
    })
    .join('');
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

  describe('credential CRUD helpers', () => {
    it('findKoreaderUser delegates to query.koreaderUsers', async () => {
      const row = { userId: 7, username: 'reader' };
      db.query.koreaderUsers.findFirst.mockResolvedValue(row);

      const result = await repo.findKoreaderUser(7);

      expect(db.query.koreaderUsers.findFirst).toHaveBeenCalledTimes(1);
      expect(result).toBe(row);
    });

    it('findKoreaderUserByUsername delegates to query.koreaderUsers', async () => {
      const row = { userId: 7, username: 'reader' };
      db.query.koreaderUsers.findFirst.mockResolvedValue(row);

      const result = await repo.findKoreaderUserByUsername('reader');

      expect(db.query.koreaderUsers.findFirst).toHaveBeenCalledTimes(1);
      expect(result).toBe(row);
    });

    it('createKoreaderUser returns first inserted row', async () => {
      const row = { userId: 7, username: 'reader' };
      const insertChain = makeInsertChain();
      insertChain.returning = vi.fn().mockResolvedValue([row]);
      db.insert.mockReturnValue(insertChain);

      const result = await repo.createKoreaderUser({
        userId: 7,
        username: 'reader',
        passwordHash: 'hash',
        passwordMd5: 'md5',
      });

      expect(insertChain.values).toHaveBeenCalledTimes(1);
      expect(result).toEqual(row);
    });

    it('updateKoreaderUser issues update with where clause', async () => {
      const where = vi.fn().mockResolvedValue(undefined);
      const set = vi.fn().mockReturnValue({ where });
      db.update.mockReturnValue({ set });

      await repo.updateKoreaderUser(7, { syncEnabled: false });

      expect(set).toHaveBeenCalledWith({ syncEnabled: false });
      expect(where).toHaveBeenCalledTimes(1);
    });
  });

  describe('progress helpers', () => {
    it('upsertDeviceProgress writes row and conflict update clause', async () => {
      const insertChain = makeInsertChain();
      db.insert.mockReturnValue(insertChain);

      await repo.upsertDeviceProgress({
        bookFileId: 44,
        userId: 12,
        device: 'Kobo',
        deviceId: 'device-1',
        percentage: 55.5,
        progress: '/body/DocFragment[1]/body',
        chapterIndex: 0,
        syncTimestamp: 1_700_000_000,
      });

      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          bookFileId: 44,
          userId: 12,
          orphaned: false,
          orphanedHash: null,
        }),
      );
      expect(insertChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    });

    it('getLatestDeviceProgress returns first row or null', async () => {
      db.select.mockReturnValueOnce(makeQueryChain([{ id: 9 }])).mockReturnValueOnce(makeQueryChain([]));

      await expect(repo.getLatestDeviceProgress(44, 12)).resolves.toEqual({ id: 9 });
      await expect(repo.getLatestDeviceProgress(44, 12)).resolves.toBeNull();
    });

    it('getReadingProgress returns first row or null', async () => {
      db.select.mockReturnValueOnce(makeQueryChain([{ id: 3 }])).mockReturnValueOnce(makeQueryChain([]));

      await expect(repo.getReadingProgress(44, 12)).resolves.toEqual({ id: 3 });
      await expect(repo.getReadingProgress(44, 12)).resolves.toBeNull();
    });

    it('getAllDeviceProgress returns ordered rows', async () => {
      const rows = [{ id: 2 }, { id: 1 }];
      db.select.mockReturnValue(makeQueryChain(rows));

      const result = await repo.getAllDeviceProgress(44, 12);

      expect(result).toEqual(rows);
    });

    it('getBookProgressForDashboard combines device and reading progress lookups', async () => {
      db.select.mockReturnValueOnce(makeQueryChain([{ id: 2 }])).mockReturnValueOnce(makeQueryChain([{ id: 1 }]));

      const result = await repo.getBookProgressForDashboard(44, 12);

      expect(result).toEqual({
        deviceProgress: [{ id: 2 }],
        readingProgress: { id: 1 },
      });
    });
  });

  describe('device/list aggregation helpers', () => {
    it('getDevicesList maps raw rows into API shape', async () => {
      db.execute.mockResolvedValue({
        rows: [
          {
            device: 'Kobo Libra',
            device_id: 'device-1',
            last_sync_at: new Date('2026-01-01T00:00:00.000Z'),
            last_book_title: 'Project Hail Mary',
          },
        ],
      });

      const result = await repo.getDevicesList(7);

      expect(result).toEqual([
        {
          device: 'Kobo Libra',
          deviceId: 'device-1',
          lastSyncAt: new Date('2026-01-01T00:00:00.000Z'),
          lastBookTitle: 'Project Hail Mary',
        },
      ]);
    });

    it('getTotalSyncedBooks returns numeric distinct count', async () => {
      db.select.mockReturnValue(makeQueryChain([{ count: '8' }]));

      const result = await repo.getTotalSyncedBooks(7);

      expect(result).toBe(8);
    });
  });

  describe('chapter/session utility queries', () => {
    it('getChapters returns ordered chapter rows', async () => {
      const rows = [{ chapterIndex: 0, title: 'Chapter 1' }];
      db.select.mockReturnValue(makeQueryChain(rows));

      const result = await repo.getChapters(44);

      expect(result).toEqual(rows);
    });

    it('hasKoreaderBookStats returns true when row exists', async () => {
      db.select.mockReturnValueOnce(makeQueryChain([{ id: 1 }])).mockReturnValueOnce(makeQueryChain([]));

      await expect(repo.hasKoreaderBookStats(44, 12)).resolves.toBe(true);
      await expect(repo.hasKoreaderBookStats(44, 12)).resolves.toBe(false);
    });

    it('getKoreaderSessionsDailySummary maps day aggregates', async () => {
      db.execute.mockResolvedValue({
        rows: [{ day: '2026-01-01', duration_seconds: '900' }],
      });

      const result = await repo.getKoreaderSessionsDailySummary(44, 12);

      expect(result).toEqual([{ day: '2026-01-01', durationSeconds: 900 }]);
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

  describe('upsertKoreaderBookStats', () => {
    it('inserts and configures conflict handling', async () => {
      const insertChain = makeInsertChain();
      db.insert.mockReturnValue(insertChain);

      await repo.upsertKoreaderBookStats({
        bookFileId: 44,
        userId: 12,
        totalReadSecs: 3600,
        totalReadPages: 100,
        highlightsCount: 3,
        notesCount: 1,
        lastOpenAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          bookFileId: 44,
          userId: 12,
          totalReadSecs: 3600,
        }),
      );
      expect(insertChain.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('bulkInsertKoreaderReadingSessions', () => {
    it('skips inserts for empty arrays', async () => {
      await repo.bulkInsertKoreaderReadingSessions([]);

      expect(db.insert).not.toHaveBeenCalled();
    });

    it('inserts non-empty session arrays', async () => {
      const insertChain = makeInsertChain();
      db.insert.mockReturnValue(insertChain);
      const sessions = [
        {
          bookFileId: 44,
          userId: 12,
          sessionHash: 'hash',
          page: 5,
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          durationSeconds: 120,
          totalPages: 300,
        },
      ];

      await repo.bulkInsertKoreaderReadingSessions(sessions);

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(insertChain.values).toHaveBeenCalledWith(sessions);
      expect(insertChain.onConflictDoNothing).toHaveBeenCalledTimes(1);
    });
  });

  describe('getKoreaderBookStats', () => {
    it('returns null when no row exists', async () => {
      db.select.mockReturnValue(makeQueryChain([]));

      const result = await repo.getKoreaderBookStats(44, 12);

      expect(result).toBeNull();
    });

    it('returns the row when found', async () => {
      const row = { id: 1, bookFileId: 44, userId: 12, totalReadSecs: 3600 };
      db.select.mockReturnValue(makeQueryChain([row]));

      const result = await repo.getKoreaderBookStats(44, 12);

      expect(result).toBe(row);
    });
  });

  describe('getKoreaderReadingSessions', () => {
    it('returns paginated rows and total count', async () => {
      const countChain = makeQueryChain([{ count: '2' }]);
      const rowsChain = makeQueryChain([
        { id: 2, page: 7, startedAt: new Date('2026-01-02T00:00:00.000Z') },
        { id: 1, page: 5, startedAt: new Date('2026-01-01T00:00:00.000Z') },
      ]);
      db.select.mockReturnValueOnce(countChain).mockReturnValueOnce(rowsChain);

      const result = await repo.getKoreaderReadingSessions(44, 12, 2, 5);

      expect(result.total).toBe(2);
      expect(result.rows).toHaveLength(2);
      expect(rowsChain.limit).toHaveBeenCalledWith(5);
      expect(rowsChain.offset).toHaveBeenCalledWith(5);
    });
  });

  describe('getKoreaderAggregateStats', () => {
    it('converts aggregate results to numbers', async () => {
      db.select.mockReturnValue(makeQueryChain([{ booksWithStats: '3', totalReadingSeconds: '7200' }]));

      const result = await repo.getKoreaderAggregateStats(12);

      expect(result).toEqual({ booksWithStats: 3, totalReadingSeconds: 7200 });
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

  describe('KOReader statistics queries', () => {
    it('getKoreaderStatsActiveDates returns ordered day strings', async () => {
      db.execute.mockResolvedValue({
        rows: [{ day: '2026-01-01' }, { day: '2026-01-03' }],
      });

      const result = await repo.getKoreaderStatsActiveDates(7);

      expect(db.execute).toHaveBeenCalledTimes(1);
      expect(result).toEqual(['2026-01-01', '2026-01-03']);
    });

    it('getKoreaderStatsTotals normalizes numeric aggregates', async () => {
      db.execute
        .mockResolvedValueOnce({
          rows: [{ total_sessions: '5', total_duration_secs: '3600' }],
        })
        .mockResolvedValueOnce({
          rows: [{ total_highlights: '7', total_notes: '3', books_with_stats: '2' }],
        });

      const result = await repo.getKoreaderStatsTotals(7);

      expect(db.execute).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        totalSessions: 5,
        totalDurationSecs: 3600,
        totalHighlights: 7,
        totalNotes: 3,
        booksWithStats: 2,
      });
    });

    it('getKoreaderActivityHeatmap maps rows to typed points', async () => {
      db.execute.mockResolvedValue({
        rows: [{ date: '2026-02-01', duration_seconds: '1800' }],
      });

      const result = await repo.getKoreaderActivityHeatmap(7);

      expect(result).toEqual([{ date: '2026-02-01', durationSeconds: 1800 }]);
    });

    it('getKoreaderMonthlyReading maps month aggregates', async () => {
      db.execute.mockResolvedValue({
        rows: [
          { year: '2026', month: '1', duration_seconds: '1200' },
          { year: '2026', month: '2', duration_seconds: '0' },
        ],
      });

      const result = await repo.getKoreaderMonthlyReading(7);

      expect(result).toEqual([
        { year: 2026, month: 1, durationSeconds: 1200 },
        { year: 2026, month: 2, durationSeconds: 0 },
      ]);
    });

    it('getKoreaderTimeOfDay maps hour aggregates', async () => {
      db.execute.mockResolvedValue({
        rows: [{ hour: '9', duration_seconds: '600' }],
      });

      const result = await repo.getKoreaderTimeOfDay(7);

      expect(result).toEqual([{ hour: 9, durationSeconds: 600 }]);
    });

    it('getKoreaderSessionLengths maps bins and preserves open-ended max', async () => {
      db.execute.mockResolvedValue({
        rows: [
          { label: '0-5m', min_secs: '0', max_secs: '300', count: '4' },
          { label: '2h+', min_secs: '7200', max_secs: null, count: '1' },
        ],
      });

      const result = await repo.getKoreaderSessionLengths(7);

      expect(result).toEqual([
        { label: '0-5m', minSecs: 0, maxSecs: 300, count: 4 },
        { label: '2h+', minSecs: 7200, maxSecs: null, count: 1 },
      ]);
    });

    it('getKoreaderTopBooks maps top-book rows', async () => {
      db.execute.mockResolvedValue({
        rows: [{ book_id: '11', title: 'Book A', total_read_secs: '5400' }],
      });

      const result = await repo.getKoreaderTopBooks(7);
      const sqlText = getSqlTextFromExecuteCall(db.execute.mock.calls[0]?.[0]);

      expect(result).toEqual([{ bookId: 11, title: 'Book A', totalReadSecs: 5400 }]);
      expect(sqlText).toContain('LEFT JOIN book_metadata bm ON bm.book_id = b.id');
      expect(sqlText).toContain("coalesce(nullif(bm.title, ''), 'Unknown Book') AS title");
      expect(sqlText).toContain('GROUP BY b.id, bm.title');
      expect(sqlText).not.toContain('coalesce(b.title');
      expect(sqlText).not.toContain('GROUP BY b.id, b.title');
    });

    it('getKoreaderTopAnnotated maps annotation aggregates', async () => {
      db.execute.mockResolvedValue({
        rows: [{ book_id: '11', title: 'Book A', highlights_count: '12', notes_count: '2' }],
      });

      const result = await repo.getKoreaderTopAnnotated(7);
      const sqlText = getSqlTextFromExecuteCall(db.execute.mock.calls[0]?.[0]);

      expect(result).toEqual([{ bookId: 11, title: 'Book A', highlightsCount: 12, notesCount: 2 }]);
      expect(sqlText).toContain('LEFT JOIN book_metadata bm ON bm.book_id = b.id');
      expect(sqlText).toContain("coalesce(nullif(bm.title, ''), 'Unknown Book') AS title");
      expect(sqlText).toContain('GROUP BY b.id, bm.title');
      expect(sqlText).not.toContain('coalesce(b.title');
      expect(sqlText).not.toContain('GROUP BY b.id, b.title');
    });

    it('getKoreaderWeeklyRhythm maps weekday aggregates', async () => {
      db.execute.mockResolvedValue({
        rows: [{ dow: '1', duration_seconds: '900' }],
      });

      const result = await repo.getKoreaderWeeklyRhythm(7);

      expect(result).toEqual([{ dow: 1, durationSeconds: 900 }]);
    });

    it('getKoreaderDevices maps device aggregation rows', async () => {
      db.execute.mockResolvedValue({
        rows: [{ device: 'Kobo Libra', books_tracked: '3' }],
      });

      const result = await repo.getKoreaderDevices(7);

      expect(result).toEqual([{ device: 'Kobo Libra', booksTracked: 3 }]);
    });
  });
});
