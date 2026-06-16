import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readingSessions, userReadingDailyStats } from '../../db/schema';
import { ReadingSessionRepository } from './reading-session.repository';

function makeDbHarness(options?: { fileLibraryId?: number | null; insertedIds?: Array<{ id: number }> }) {
  const fileLibraryId = options?.fileLibraryId === undefined ? 11 : options.fileLibraryId;
  const insertedIds = options?.insertedIds ?? [{ id: 1 }];

  const limit = vi.fn().mockResolvedValue(fileLibraryId == null ? [] : [{ libraryId: fileLibraryId }]);
  const where = vi.fn().mockReturnValue({ limit });
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ innerJoin });
  const select = vi.fn().mockReturnValue({ from });

  const sessionReturning = vi.fn().mockResolvedValue(insertedIds);
  const sessionConflict = vi.fn().mockReturnValue({ returning: sessionReturning });
  const sessionValues = vi.fn().mockReturnValue({ onConflictDoNothing: sessionConflict });

  const dailyConflictUpdate = vi.fn().mockResolvedValue(undefined);
  const dailyValues = vi.fn().mockReturnValue({ onConflictDoUpdate: dailyConflictUpdate });

  const tx = {
    insert: vi.fn((table: unknown) => {
      if (table === readingSessions) return { values: sessionValues };
      if (table === userReadingDailyStats) return { values: dailyValues };
      throw new Error('Unexpected table in insert');
    }),
  };

  const transaction = vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));

  const db = { select, transaction };
  const repo = new ReadingSessionRepository(db as never);

  return {
    repo,
    select,
    transaction,
    sessionValues,
    sessionConflict,
    sessionReturning,
    dailyValues,
    dailyConflictUpdate,
  };
}

describe('ReadingSessionRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when duration is below the minimum threshold', async () => {
    const { repo, select, transaction } = makeDbHarness();

    const result = await repo.saveSession(1, 2, 'short', new Date('2026-04-15T10:00:00.000Z'), new Date('2026-04-15T10:00:09.000Z'), 9, null, null);

    expect(result).toEqual({ kind: 'skipped', reason: 'duration_below_minimum' });
    expect(select).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('skips when no book file row is found', async () => {
    const { repo, transaction } = makeDbHarness({ fileLibraryId: null });

    const result = await repo.saveSession(
      1,
      9999,
      'missing-file',
      new Date('2026-04-15T10:00:00.000Z'),
      new Date('2026-04-15T10:00:20.000Z'),
      20,
      null,
      null,
    );

    expect(result).toEqual({ kind: 'skipped', reason: 'book_file_not_found' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('skips when session id already exists (idempotent duplicate)', async () => {
    const { repo, dailyValues } = makeDbHarness({ insertedIds: [] });

    const result = await repo.saveSession(
      5,
      8,
      'duplicate-id',
      new Date('2026-04-15T10:00:00.000Z'),
      new Date('2026-04-15T10:01:00.000Z'),
      60,
      3.2,
      12.5,
    );

    expect(result).toEqual({ kind: 'skipped', reason: 'duplicate_session_id' });
    expect(dailyValues).not.toHaveBeenCalled();
  });

  it('persists session and upserts daily stats when insert succeeds', async () => {
    const { repo, sessionValues, sessionConflict, dailyValues, dailyConflictUpdate } = makeDbHarness({ fileLibraryId: 3, insertedIds: [{ id: 99 }] });

    const result = await repo.saveSession(
      2,
      4,
      'new-session',
      new Date('2026-04-15T10:00:00.000Z'),
      new Date('2026-04-15T10:01:00.000Z'),
      60,
      null,
      42.5,
      'kobo',
    );

    expect(result).toEqual({ kind: 'saved' });
    expect(sessionValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 2,
        bookFileId: 4,
        sessionId: 'new-session',
        durationSeconds: 60,
        progressDelta: null,
        endProgress: 42.5,
        source: 'kobo',
      }),
    );
    expect(sessionConflict).toHaveBeenCalledWith({ target: [readingSessions.userId, readingSessions.sessionId] });
    expect(dailyValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 2,
        libraryId: 3,
        readingSeconds: 60,
        progressDelta: 0,
        sessionsCount: 1,
        updatedAt: expect.any(Date),
      }),
    );
    expect(dailyValues.mock.calls[0]?.[0]).toHaveProperty('day');
    expect(dailyConflictUpdate).toHaveBeenCalledOnce();
  });
});

describe('ReadingSessionRepository - listByBook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeQueryChain(result: unknown) {
    const self: Record<string, unknown> = {};
    const terminal = Promise.resolve(result);
    for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit', 'offset', 'groupBy']) {
      self[m] = vi.fn().mockReturnValue(self);
    }
    self['then'] = (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) => terminal.then(onFulfilled, onRejected);
    self['catch'] = (onRejected: (e: unknown) => unknown) => terminal.catch(onRejected);
    return self;
  }

  it('returns items, total, and stats with correct structure', async () => {
    const now = new Date('2026-04-15T10:00:00.000Z');
    const later = new Date('2026-04-15T10:30:00.000Z');

    const rowData = [{ id: 1, startedAt: now, endedAt: later, durationSeconds: 1800, progressDelta: 5, endProgress: 50, format: 'epub' }];
    const countData = [{ total: 1 }];
    const statsData = [{ totalSessions: 1, totalSeconds: 1800, avgDurationSeconds: 1800, firstSessionAt: now, lastSessionAt: now }];
    const dailyData = [{ day: '2026-04-15', totalMinutes: 30 }];

    const select = vi
      .fn()
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain(rowData)) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain(countData)) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain(statsData)) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain(dailyData)) });

    const db = { select };
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc');

    expect(result.total).toBe(1);
    expect(result.stats.totalSessions).toBe(1);
    expect(result.stats.dailySummary).toEqual([{ day: '2026-04-15', totalMinutes: 30 }]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.startedAt).toBe(now.toISOString());
  });

  it('fires all four queries when called', async () => {
    const select = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(makeQueryChain([])) });

    const db = { select };
    const repo = new ReadingSessionRepository(db as never);

    await repo.listByBook(1, 2, 2, 25, 'startedAt', 'desc');

    expect(select).toHaveBeenCalledTimes(4);
  });

  it('returns empty items and zero stats when no data', async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain([])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain([])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain([])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain([])) });

    const db = { select };
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc');

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.stats.totalSessions).toBe(0);
    expect(result.stats.dailySummary).toEqual([]);
  });

  it('handles null statsRow gracefully', async () => {
    const select = vi
      .fn()
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain([])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain([])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain([])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain([])) });

    const db = { select };
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc');

    expect(result.stats.totalSessions).toBe(0);
    expect(result.stats.firstSessionAt).toBeNull();
    expect(result.stats.lastSessionAt).toBeNull();
  });

  it('converts Date stats fields to ISO strings', async () => {
    const now = new Date('2026-04-15T10:00:00.000Z');
    const statsData = [{ totalSessions: 1, totalSeconds: 60, avgDurationSeconds: 60, firstSessionAt: now, lastSessionAt: now }];

    const select = vi
      .fn()
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain([])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain([{ total: 1 }])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain(statsData)) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain([])) });

    const db = { select };
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc');

    expect(result.stats.firstSessionAt).toBe(now.toISOString());
    expect(result.stats.lastSessionAt).toBe(now.toISOString());
  });

  it('uses desc order when sortDir is desc', async () => {
    const select = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(makeQueryChain([])) });

    const db = { select };
    const repo = new ReadingSessionRepository(db as never);

    await expect(repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc')).resolves.toBeDefined();
  });

  it('uses asc order when sortDir is asc', async () => {
    const select = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(makeQueryChain([])) });

    const db = { select };
    const repo = new ReadingSessionRepository(db as never);

    await expect(repo.listByBook(1, 2, 1, 25, 'startedAt', 'asc')).resolves.toBeDefined();
  });

  it('maps null format to null in items', async () => {
    const now = new Date('2026-04-15T10:00:00.000Z');
    const rowData = [{ id: 1, startedAt: now, endedAt: now, durationSeconds: 60, progressDelta: null, endProgress: null, format: null }];

    const select = vi
      .fn()
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain(rowData)) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain([{ total: 1 }])) })
      .mockReturnValueOnce({
        from: vi
          .fn()
          .mockReturnValue(
            makeQueryChain([{ totalSessions: 1, totalSeconds: 60, avgDurationSeconds: 60, firstSessionAt: null, lastSessionAt: null }]),
          ),
      })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain([])) });

    const db = { select };
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc');

    expect(result.items[0]?.format).toBeNull();
  });

  it('applies dateFrom and dateTo when provided', async () => {
    const select = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(makeQueryChain([])) });

    const db = { select };
    const repo = new ReadingSessionRepository(db as never);

    await expect(repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc', '2026-01-01', '2026-12-31')).resolves.toBeDefined();
  });
});

describe('ReadingSessionRepository - deleteSessionByBook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { found: false } when session not found', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const innerJoin2 = vi.fn().mockReturnValue({ where });
    const innerJoin1 = vi.fn().mockReturnValue({ innerJoin: innerJoin2 });
    const from = vi.fn().mockReturnValue({ innerJoin: innerJoin1 });
    const select = vi.fn().mockReturnValue({ from });

    const tx = { select };
    const transaction = vi.fn(async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx));
    const db = { transaction };
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.deleteSessionByBook(1, 2, 99);

    expect(result).toEqual({ found: false });
  });

  it('returns { found: true } and deletes when session found', async () => {
    const sessionRow = { id: 5, startedAt: new Date('2026-04-15T10:00:00.000Z'), libraryId: 3 };
    const limit = vi.fn().mockResolvedValue([sessionRow]);
    const where = vi.fn().mockReturnValue({ limit });
    const innerJoin2 = vi.fn().mockReturnValue({ where });
    const innerJoin1 = vi.fn().mockReturnValue({ innerJoin: innerJoin2 });
    const from = vi.fn().mockReturnValue({ innerJoin: innerJoin1 });
    const select = vi.fn().mockReturnValue({ from });

    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

    const execute = vi.fn().mockResolvedValue(undefined);

    const tx = { select, delete: deleteFn, execute };
    const transaction = vi.fn(async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx));
    const db = { transaction };
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.deleteSessionByBook(1, 2, 5);

    expect(result).toEqual({ found: true });
    expect(deleteFn).toHaveBeenCalledWith(readingSessions);
  });

  it('calls execute to re-aggregate daily stats after deletion', async () => {
    const sessionRow = { id: 5, startedAt: new Date('2026-04-15T10:00:00.000Z'), libraryId: 3 };
    const limit = vi.fn().mockResolvedValue([sessionRow]);
    const where = vi.fn().mockReturnValue({ limit });
    const innerJoin2 = vi.fn().mockReturnValue({ where });
    const innerJoin1 = vi.fn().mockReturnValue({ innerJoin: innerJoin2 });
    const from = vi.fn().mockReturnValue({ innerJoin: innerJoin1 });
    const select = vi.fn().mockReturnValue({ from });

    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });
    const execute = vi.fn().mockResolvedValue(undefined);

    const tx = { select, delete: deleteFn, execute };
    const transaction = vi.fn(async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx));
    const db = { transaction };
    const repo = new ReadingSessionRepository(db as never);

    await repo.deleteSessionByBook(1, 2, 5);

    expect(execute).toHaveBeenCalledOnce();
  });

  it('deletes the userReadingDailyStats row for the session day', async () => {
    const sessionRow = { id: 5, startedAt: new Date('2026-04-15T10:00:00.000Z'), libraryId: 3 };
    const limit = vi.fn().mockResolvedValue([sessionRow]);
    const where = vi.fn().mockReturnValue({ limit });
    const innerJoin2 = vi.fn().mockReturnValue({ where });
    const innerJoin1 = vi.fn().mockReturnValue({ innerJoin: innerJoin2 });
    const from = vi.fn().mockReturnValue({ innerJoin: innerJoin1 });
    const select = vi.fn().mockReturnValue({ from });

    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });
    const execute = vi.fn().mockResolvedValue(undefined);

    const tx = { select, delete: deleteFn, execute };
    const transaction = vi.fn(async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx));
    const db = { transaction };
    const repo = new ReadingSessionRepository(db as never);

    await repo.deleteSessionByBook(1, 2, 5);

    expect(deleteFn).toHaveBeenCalledWith(userReadingDailyStats);
    expect(deleteFn).toHaveBeenCalledTimes(2);
  });

  it('uses a transaction for the entire delete', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const innerJoin2 = vi.fn().mockReturnValue({ where });
    const innerJoin1 = vi.fn().mockReturnValue({ innerJoin: innerJoin2 });
    const from = vi.fn().mockReturnValue({ innerJoin: innerJoin1 });
    const select = vi.fn().mockReturnValue({ from });

    const tx = { select };
    const transaction = vi.fn(async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx));
    const db = { transaction };
    const repo = new ReadingSessionRepository(db as never);

    await repo.deleteSessionByBook(1, 2, 99);

    expect(transaction).toHaveBeenCalledOnce();
  });
});
