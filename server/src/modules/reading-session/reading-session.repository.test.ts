import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readingSessions, userReadingDailyStats } from '../../db/schema';
import { ReadingSessionRepository } from './reading-session.repository';

function makeDbHarness(options?: { fileRow?: { bookId: number; libraryId: number } | null; insertedIds?: Array<{ id: number }> }) {
  const fileRow = options?.fileRow === undefined ? { bookId: 7, libraryId: 11 } : options.fileRow;
  const insertedIds = options?.insertedIds ?? [{ id: 1 }];

  const limit = vi.fn().mockResolvedValue(fileRow == null ? [] : [fileRow]);
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
    execute: vi.fn().mockResolvedValue(undefined),
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
    tx,
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
    const { repo, transaction } = makeDbHarness({ fileRow: null });

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

  it('persists session with bookId and explicit source, then upserts daily stats', async () => {
    const { repo, sessionValues, sessionConflict, dailyValues, dailyConflictUpdate, tx } = makeDbHarness({
      fileRow: { bookId: 9, libraryId: 3 },
      insertedIds: [{ id: 99 }],
    });

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
        bookId: 9,
        sessionId: 'new-session',
        durationSeconds: 60,
        progressDelta: null,
        endProgress: 42.5,
        source: 'kobo',
      }),
    );
    expect(sessionConflict).toHaveBeenCalledWith({ target: [readingSessions.userId, readingSessions.sessionId] });
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(dailyValues).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 2,
        libraryId: 3,
        day: '2026-04-15',
        readingSeconds: 60,
        progressDelta: 0,
        sessionsCount: 1,
        updatedAt: expect.any(Date),
      }),
    ]);
    expect(dailyConflictUpdate).toHaveBeenCalledOnce();
  });

  it('persists the provided source (e.g. kobo) instead of the web default', async () => {
    const { repo, sessionValues } = makeDbHarness({ fileRow: { bookId: 9, libraryId: 3 }, insertedIds: [{ id: 100 }] });

    const result = await repo.saveSession(
      2,
      4,
      'kobo-session',
      new Date('2026-04-15T10:00:00.000Z'),
      new Date('2026-04-15T10:01:00.000Z'),
      60,
      null,
      null,
      'kobo',
    );

    expect(result).toEqual({ kind: 'saved' });
    expect(sessionValues).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'kobo-session', source: 'kobo' }));
  });
});

describe('ReadingSessionRepository - insertManualSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeManualHarness() {
    const sessionReturning = vi.fn().mockResolvedValue([{ id: 321 }]);
    const sessionValues = vi.fn().mockReturnValue({ returning: sessionReturning });

    const dailyConflictUpdate = vi.fn().mockResolvedValue(undefined);
    const dailyValues = vi.fn().mockReturnValue({ onConflictDoUpdate: dailyConflictUpdate });

    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn((table: unknown) => {
        if (table === readingSessions) return { values: sessionValues };
        if (table === userReadingDailyStats) return { values: dailyValues };
        throw new Error('Unexpected table in insert');
      }),
    };

    const transaction = vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));
    const db = { transaction };
    const repo = new ReadingSessionRepository(db as never);

    return { repo, sessionValues, dailyValues, dailyConflictUpdate, tx };
  }

  it('inserts with manual source and upserts daily stats in one transaction', async () => {
    const { repo, sessionValues, dailyValues, dailyConflictUpdate, tx } = makeManualHarness();

    const result = await repo.insertManualSession({
      userId: 5,
      bookId: 10,
      libraryId: 3,
      bookFileId: null,
      sessionId: 'manual:abc',
      startedAt: new Date('2026-04-15T10:00:00.000Z'),
      endedAt: new Date('2026-04-15T10:30:00.000Z'),
      durationSeconds: 1800,
      progressDelta: 12.5,
      endProgress: 60,
      timeZone: 'UTC',
    });

    expect(result).toEqual({ id: 321 });
    expect(sessionValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 5,
        bookId: 10,
        bookFileId: null,
        sessionId: 'manual:abc',
        source: 'manual',
        durationSeconds: 1800,
        progressDelta: 12.5,
        endProgress: 60,
      }),
    );
    expect(dailyValues).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 5, libraryId: 3, day: '2026-04-15', readingSeconds: 1800, progressDelta: 12.5, sessionsCount: 1 }),
    ]);
    expect(tx.execute).toHaveBeenCalledOnce();
    expect(dailyConflictUpdate).toHaveBeenCalledOnce();
  });
});

describe('ReadingSessionRepository - findLatestEndProgressBefore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeLookupHarness(rows: Array<{ endProgress: number | null }>) {
    const limit = vi.fn().mockResolvedValue(rows);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select };
    return new ReadingSessionRepository(db as never);
  }

  it('returns the latest end progress when present', async () => {
    const repo = makeLookupHarness([{ endProgress: 42.5 }]);
    await expect(repo.findLatestEndProgressBefore(1, 2, new Date())).resolves.toBe(42.5);
  });

  it('returns null when no prior session exists', async () => {
    const repo = makeLookupHarness([]);
    await expect(repo.findLatestEndProgressBefore(1, 2, new Date())).resolves.toBeNull();
  });
});

describe('ReadingSessionRepository - findBookContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns libraryId and files for an existing book', async () => {
    const bookLimit = vi.fn().mockResolvedValue([{ libraryId: 3 }]);
    const bookWhere = vi.fn().mockReturnValue({ limit: bookLimit });
    const filesWhere = vi.fn().mockResolvedValue([{ id: 42, format: 'epub' }]);
    const from = vi.fn().mockReturnValueOnce({ where: bookWhere }).mockReturnValueOnce({ where: filesWhere });
    const select = vi.fn().mockReturnValue({ from });
    const repo = new ReadingSessionRepository({ select } as never);

    const result = await repo.findBookContext(10);

    expect(result).toEqual({ libraryId: 3, files: [{ id: 42, format: 'epub' }] });
  });

  it('returns null when the book does not exist', async () => {
    const bookLimit = vi.fn().mockResolvedValue([]);
    const bookWhere = vi.fn().mockReturnValue({ limit: bookLimit });
    const from = vi.fn().mockReturnValue({ where: bookWhere });
    const select = vi.fn().mockReturnValue({ from });
    const repo = new ReadingSessionRepository({ select } as never);

    await expect(repo.findBookContext(10)).resolves.toBeNull();
  });
});

describe('ReadingSessionRepository - listByBook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeQueryChain(result: unknown) {
    const self: Record<string, unknown> = {};
    const terminal = Promise.resolve(result);
    for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'offset', 'groupBy']) {
      self[m] = vi.fn().mockReturnValue(self);
    }
    self['then'] = (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) => terminal.then(onFulfilled, onRejected);
    self['catch'] = (onRejected: (e: unknown) => unknown) => terminal.catch(onRejected);
    return self;
  }

  function makeListDb(results: { rows?: unknown[]; count?: unknown[]; stats?: unknown[]; summary?: unknown[]; bySource?: unknown[] }) {
    const select = vi
      .fn()
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain(results.rows ?? [])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain(results.count ?? [])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain(results.stats ?? [])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain(results.summary ?? [])) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue(makeQueryChain(results.bySource ?? [])) });
    return { db: { select }, select };
  }

  it('returns items, total, and stats with correct structure', async () => {
    const now = new Date('2026-04-15T10:00:00.000Z');
    const later = new Date('2026-04-15T10:30:00.000Z');

    const { db } = makeListDb({
      rows: [{ id: 1, startedAt: now, endedAt: later, durationSeconds: 1800, progressDelta: 5, endProgress: 50, format: 'epub', source: 'web' }],
      count: [{ total: 1 }],
      stats: [
        {
          totalSessions: 1,
          totalSeconds: 1800,
          avgDurationSeconds: 1800,
          firstSessionAt: now,
          lastSessionAt: now,
          paceProgressDelta: 5,
          paceDurationSeconds: 1800,
        },
      ],
      summary: [{ startedAt: now, endedAt: later, durationSeconds: 1800, progressDelta: 5, endProgress: 50 }],
    });
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc');

    expect(result.total).toBe(1);
    expect(result.stats.totalSessions).toBe(1);
    expect(result.stats.dailySummary).toEqual([{ day: '2026-04-15', totalMinutes: 30 }]);
    expect(result.stats.paceProgressDelta).toBe(5);
    expect(result.stats.paceDurationSeconds).toBe(1800);
    expect(result.stats.progressSummary).toEqual([{ day: '2026-04-15', endProgress: 50 }]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.startedAt).toBe(now.toISOString());
    expect(result.items[0]?.source).toBe('web');
  });

  it('fires five select queries', async () => {
    const { db, select } = makeListDb({});
    const repo = new ReadingSessionRepository(db as never);

    await repo.listByBook(1, 2, 2, 25, 'startedAt', 'desc');

    expect(select).toHaveBeenCalledTimes(5);
  });

  it('splits per-book daily summaries across local midnight', async () => {
    const startedAt = new Date('2026-04-16T03:00:00.000Z');
    const endedAt = new Date('2026-04-16T04:30:00.000Z');
    const { db } = makeListDb({
      count: [{ total: 1 }],
      stats: [{ totalSessions: 1, totalSeconds: 5400, avgDurationSeconds: 5400, firstSessionAt: startedAt, lastSessionAt: startedAt }],
      summary: [{ startedAt, endedAt, durationSeconds: 5400, progressDelta: 9, endProgress: 12 }],
    });
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc', undefined, undefined, undefined, 'America/New_York');

    expect(result.stats.dailySummary).toEqual([
      { day: '2026-04-15', totalMinutes: 60 },
      { day: '2026-04-16', totalMinutes: 30 },
    ]);
    expect(result.stats.progressSummary).toEqual([{ day: '2026-04-16', endProgress: 12 }]);
  });

  it('returns empty items and zero stats when no data', async () => {
    const { db } = makeListDb({});
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc');

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.stats.totalSessions).toBe(0);
    expect(result.stats.dailySummary).toEqual([]);
    expect(result.stats.paceProgressDelta).toBe(0);
    expect(result.stats.paceDurationSeconds).toBe(0);
    expect(result.stats.progressSummary).toEqual([]);
  });

  it('handles null statsRow gracefully', async () => {
    const { db } = makeListDb({});
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc');

    expect(result.stats.totalSessions).toBe(0);
    expect(result.stats.firstSessionAt).toBeNull();
    expect(result.stats.lastSessionAt).toBeNull();
  });

  it('converts Date stats fields to ISO strings', async () => {
    const now = new Date('2026-04-15T10:00:00.000Z');
    const { db } = makeListDb({
      count: [{ total: 1 }],
      stats: [{ totalSessions: 1, totalSeconds: 60, avgDurationSeconds: 60, firstSessionAt: now, lastSessionAt: now }],
    });
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc');

    expect(result.stats.firstSessionAt).toBe(now.toISOString());
    expect(result.stats.lastSessionAt).toBe(now.toISOString());
  });

  it('maps null format and null source to null in items', async () => {
    const now = new Date('2026-04-15T10:00:00.000Z');
    const { db } = makeListDb({
      rows: [{ id: 1, startedAt: now, endedAt: now, durationSeconds: 60, progressDelta: null, endProgress: null, format: null, source: null }],
      count: [{ total: 1 }],
      stats: [{ totalSessions: 1, totalSeconds: 60, avgDurationSeconds: 60, firstSessionAt: null, lastSessionAt: null }],
    });
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc');

    expect(result.items[0]?.format).toBeNull();
    expect(result.items[0]?.source).toBeNull();
  });

  it('applies dateFrom and dateTo when provided', async () => {
    const { db } = makeListDb({});
    const repo = new ReadingSessionRepository(db as never);

    await expect(repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc', '2026-01-01', '2026-12-31')).resolves.toBeDefined();
  });

  it('supports asc sort direction', async () => {
    const { db } = makeListDb({});
    const repo = new ReadingSessionRepository(db as never);

    await expect(repo.listByBook(1, 2, 1, 25, 'startedAt', 'asc')).resolves.toBeDefined();
  });

  it('folds sessions into the 3 display buckets, ordered and excluding empty buckets', async () => {
    const { db } = makeListDb({
      count: [{ total: 5 }],
      stats: [{ totalSessions: 5, totalSeconds: 380, avgDurationSeconds: 76, firstSessionAt: null, lastSessionAt: null }],
      bySource: [
        { source: 'web', totalSeconds: 100, totalSessions: 1 },
        { source: 'manual', totalSeconds: 50, totalSessions: 1 },
        { source: null, totalSeconds: 30, totalSessions: 1 },
        { source: 'kobo', totalSeconds: 200, totalSessions: 2 },
      ],
    });
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc');

    // web + manual + null collapse into bookorbit; koreader has no rows and is omitted.
    expect(result.stats.bySource).toEqual([
      { bucket: 'bookorbit', totalSeconds: 180, totalSessions: 3 },
      { bucket: 'kobo', totalSeconds: 200, totalSessions: 2 },
    ]);
  });

  it('returns an empty bySource when there are no sessions', async () => {
    const { db } = makeListDb({});
    const repo = new ReadingSessionRepository(db as never);

    const result = await repo.listByBook(1, 2, 1, 25, 'startedAt', 'desc');

    expect(result.stats.bySource).toEqual([]);
  });
});

describe('ReadingSessionRepository - deleteSessionByBook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeDeleteHarness(
    sessionRow: { id: number; startedAt: Date; endedAt: Date; durationSeconds: number; progressDelta: number | null; libraryId: number } | null,
    recomputeRows: Array<{ startedAt: Date; endedAt: Date; durationSeconds: number; progressDelta: number | null }> = [],
  ) {
    const limit = vi.fn().mockResolvedValue(sessionRow ? [sessionRow] : []);
    const lookupWhere = vi.fn().mockReturnValue({ limit });
    const lookupInnerJoin = vi.fn().mockReturnValue({ where: lookupWhere });
    const lookupFrom = vi.fn().mockReturnValue({ innerJoin: lookupInnerJoin });

    const recomputeWhere = vi.fn().mockResolvedValue(recomputeRows);
    const recomputeInnerJoin = vi.fn().mockReturnValue({ where: recomputeWhere });
    const recomputeFrom = vi.fn().mockReturnValue({ innerJoin: recomputeInnerJoin });
    const select = vi.fn().mockReturnValueOnce({ from: lookupFrom }).mockReturnValue({ from: recomputeFrom });

    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });
    const dailyConflictUpdate = vi.fn().mockResolvedValue(undefined);
    const dailyValues = vi.fn().mockReturnValue({ onConflictDoUpdate: dailyConflictUpdate });
    const insert = vi.fn((table: unknown) => {
      if (table === userReadingDailyStats) return { values: dailyValues };
      throw new Error('Unexpected table in insert');
    });

    const tx = { execute: vi.fn().mockResolvedValue(undefined), select, delete: deleteFn, insert };
    const transaction = vi.fn(async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx));
    const db = { transaction };
    const repo = new ReadingSessionRepository(db as never);

    return { repo, innerJoin: lookupInnerJoin, deleteFn, dailyValues, transaction, tx };
  }

  it('returns { found: false } when session not found', async () => {
    const { repo } = makeDeleteHarness(null);

    const result = await repo.deleteSessionByBook(1, 2, 99);

    expect(result).toEqual({ found: false });
  });

  it('looks up the session with a single books join', async () => {
    const { repo, innerJoin } = makeDeleteHarness(null);

    await repo.deleteSessionByBook(1, 2, 99);

    expect(innerJoin).toHaveBeenCalledOnce();
  });

  it('returns { found: true } and deletes when session found', async () => {
    const { repo, deleteFn, tx } = makeDeleteHarness({
      id: 5,
      startedAt: new Date('2026-04-15T10:00:00.000Z'),
      endedAt: new Date('2026-04-15T10:30:00.000Z'),
      durationSeconds: 1800,
      progressDelta: null,
      libraryId: 3,
    });

    const result = await repo.deleteSessionByBook(1, 2, 5);

    expect(result).toEqual({ found: true });
    expect(deleteFn).toHaveBeenCalledWith(readingSessions);
    expect(tx.execute).toHaveBeenCalledOnce();
  });

  it('re-inserts re-aggregated daily stats after deletion when other sessions remain', async () => {
    const { repo, dailyValues } = makeDeleteHarness(
      {
        id: 5,
        startedAt: new Date('2026-04-15T10:00:00.000Z'),
        endedAt: new Date('2026-04-15T10:30:00.000Z'),
        durationSeconds: 1800,
        progressDelta: null,
        libraryId: 3,
      },
      [
        {
          startedAt: new Date('2026-04-15T11:00:00.000Z'),
          endedAt: new Date('2026-04-15T11:20:00.000Z'),
          durationSeconds: 1200,
          progressDelta: 2,
        },
      ],
    );

    await repo.deleteSessionByBook(1, 2, 5);

    expect(dailyValues).toHaveBeenCalledWith([
      expect.objectContaining({ day: '2026-04-15', readingSeconds: 1200, progressDelta: 2, sessionsCount: 1 }),
    ]);
  });

  it('deletes the userReadingDailyStats row for the session day', async () => {
    const { repo, deleteFn } = makeDeleteHarness({
      id: 5,
      startedAt: new Date('2026-04-15T10:00:00.000Z'),
      endedAt: new Date('2026-04-15T10:30:00.000Z'),
      durationSeconds: 1800,
      progressDelta: null,
      libraryId: 3,
    });

    await repo.deleteSessionByBook(1, 2, 5);

    expect(deleteFn).toHaveBeenCalledWith(userReadingDailyStats);
    expect(deleteFn).toHaveBeenCalledTimes(2);
  });

  it('uses a transaction for the entire delete', async () => {
    const { repo, transaction } = makeDeleteHarness(null);

    await repo.deleteSessionByBook(1, 2, 99);

    expect(transaction).toHaveBeenCalledOnce();
  });
});
