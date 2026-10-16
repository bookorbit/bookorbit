import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { bookFiles, readingSessionSyncCursors, readingSessions, userReadingDailyStats } from '../../db/schema';
import { ReadingSessionRepository, type RecordCumulativeReadingSessionParams } from './reading-session.repository';

function makeLimitChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  return { where, limit };
}

function makeHarness(
  options: {
    cursor?: { counter: number; generation: number; lastModified: Date } | null;
    measuredSeconds?: number;
    file?: { bookId: number; libraryId: number } | null;
    inserted?: boolean;
  } = {},
) {
  const cursorChain = makeLimitChain(options.cursor ? [options.cursor] : []);
  const measuredWhere = vi.fn().mockResolvedValue([{ seconds: options.measuredSeconds ?? 0 }]);
  const fileChain = makeLimitChain(options.file === null ? [] : [options.file ?? { bookId: 46, libraryId: 9 }]);

  const select = vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: unknown) => {
      if (table === readingSessionSyncCursors) return { where: cursorChain.where };
      if (table === readingSessions) return { where: measuredWhere };
      if (table === bookFiles) return { innerJoin: vi.fn().mockReturnValue({ where: fileChain.where }) };
      throw new Error('Unexpected table in select');
    }),
  }));

  const cursorInsertValues = vi.fn().mockResolvedValue(undefined);
  const sessionReturning = vi.fn().mockResolvedValue(options.inserted === false ? [] : [{ id: 101 }]);
  const sessionConflict = vi.fn().mockReturnValue({ returning: sessionReturning });
  const sessionValues = vi.fn().mockReturnValue({ onConflictDoNothing: sessionConflict });
  const dailyValues = vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) });
  const insert = vi.fn().mockImplementation((table: unknown) => {
    if (table === readingSessionSyncCursors) return { values: cursorInsertValues };
    if (table === readingSessions) return { values: sessionValues };
    if (table === userReadingDailyStats) return { values: dailyValues };
    throw new Error('Unexpected table in insert');
  });

  const cursorUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const cursorUpdateSet = vi.fn().mockReturnValue({ where: cursorUpdateWhere });
  const update = vi.fn().mockReturnValue({ set: cursorUpdateSet });
  const tx = { execute: vi.fn().mockResolvedValue(undefined), select, insert, update };
  const transaction = vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));
  const repo = new ReadingSessionRepository({ transaction } as never);

  return { repo, tx, transaction, cursorInsertValues, cursorUpdateSet, sessionValues, dailyValues, measuredWhere };
}

function boundParams(where: ReturnType<typeof vi.fn>): unknown[] {
  return new PgDialect().sqlToQuery(where.mock.calls[0]![0] as SQL).params;
}

const params = (overrides: Partial<RecordCumulativeReadingSessionParams> = {}): RecordCumulativeReadingSessionParams => ({
  userId: 7,
  bookId: 46,
  bookFileId: 53,
  cursorSource: 'kobo-statistics',
  sourceDeviceKey: '30',
  sessionIdPrefix: 'kst:30:',
  buildSessionId: (bookFileId, generation, counter) => `kst:30:${bookFileId}:${generation}:${counter}`,
  counter: 860,
  endedAt: new Date('2026-08-20T19:30:00.000Z'),
  progressDelta: 7,
  endProgress: 29,
  source: 'kobo',
  timeZone: 'Europe/Oslo',
  ...overrides,
});

describe('ReadingSessionRepository.recordCumulativeSyncedSession', () => {
  it('establishes an independent device baseline without creating a session', async () => {
    const { repo, cursorInsertValues, sessionValues } = makeHarness();

    await expect(repo.recordCumulativeSyncedSession(params())).resolves.toEqual({ kind: 'baseline' });

    expect(cursorInsertValues).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, bookId: 46, sourceDeviceKey: '30', counter: 860 }));
    expect(sessionValues).not.toHaveBeenCalled();
  });

  it('atomically stores the device delta and advances its cursor', async () => {
    const { repo, transaction, cursorUpdateSet, sessionValues, dailyValues } = makeHarness({
      cursor: { counter: 800, generation: 2, lastModified: new Date('2026-08-19T10:00:00.000Z') },
    });

    await expect(repo.recordCumulativeSyncedSession(params())).resolves.toEqual({
      kind: 'saved',
      durationSeconds: 3600,
      progressDelta: 7,
      sessionId: 'kst:30:53:2:860',
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(sessionValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        bookId: 46,
        bookFileId: 53,
        sourceDeviceKey: '30',
        sessionId: 'kst:30:53:2:860',
        durationSeconds: 3600,
        syncIntervalStartedAt: new Date('2026-08-19T10:00:00.000Z'),
      }),
    );
    expect(cursorUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ counter: 860, generation: 2 }));
    expect(dailyValues).toHaveBeenCalledOnce();
  });

  it('does not advance the cursor when the file is temporarily unavailable', async () => {
    const { repo, cursorUpdateSet, sessionValues } = makeHarness({
      cursor: { counter: 800, generation: 0, lastModified: new Date('2026-08-19T10:00:00.000Z') },
    });

    await expect(repo.recordCumulativeSyncedSession(params({ bookFileId: null }))).resolves.toEqual({
      kind: 'skipped',
      reason: 'book_file_not_found',
    });

    expect(cursorUpdateSet).not.toHaveBeenCalled();
    expect(sessionValues).not.toHaveBeenCalled();
  });

  it('advances without an estimate when measured analytics already cover the counter delta', async () => {
    const { repo, cursorUpdateSet, sessionValues } = makeHarness({
      cursor: { counter: 800, generation: 0, lastModified: new Date('2026-08-19T10:00:00.000Z') },
      measuredSeconds: 3590,
    });

    await expect(repo.recordCumulativeSyncedSession(params())).resolves.toEqual({
      kind: 'skipped',
      reason: 'measured_session_present',
    });

    expect(cursorUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ counter: 860 }));
    expect(sessionValues).not.toHaveBeenCalled();
  });

  it('keeps the part of the counter delta the device did not measure', async () => {
    const { repo, sessionValues, dailyValues } = makeHarness({
      cursor: { counter: 800, generation: 0, lastModified: new Date('2026-08-19T10:00:00.000Z') },
      measuredSeconds: 1500,
    });

    await expect(repo.recordCumulativeSyncedSession(params())).resolves.toEqual({
      kind: 'saved',
      durationSeconds: 2100,
      progressDelta: 4.08,
      sessionId: 'kst:30:53:0:860',
    });

    expect(sessionValues).toHaveBeenCalledWith(
      expect.objectContaining({
        startedAt: new Date('2026-08-20T18:55:00.000Z'),
        endedAt: new Date('2026-08-20T19:30:00.000Z'),
        durationSeconds: 2100,
        progressDelta: 4.08,
      }),
    );
    expect(dailyValues).toHaveBeenCalledWith([expect.objectContaining({ readingSeconds: 2100, progressDelta: 4.08 })]);
  });

  it('measures against the whole counter interval rather than the minutes before the push', async () => {
    const { repo, measuredWhere } = makeHarness({
      cursor: { counter: 800, generation: 0, lastModified: new Date('2026-08-19T10:00:00.000Z') },
    });

    await repo.recordCumulativeSyncedSession(params());

    expect(boundParams(measuredWhere)).toEqual(expect.arrayContaining(['2026-08-19T10:00:00.000Z', '2026-08-20T19:30:00.000Z']));
    expect(boundParams(measuredWhere)).not.toContain('2026-08-20T18:30:00.000Z');
  });

  it('starts a new generation when a newer device counter resets', async () => {
    const { repo, cursorUpdateSet, sessionValues } = makeHarness({
      cursor: { counter: 860, generation: 4, lastModified: new Date('2026-08-19T10:00:00.000Z') },
    });

    await expect(repo.recordCumulativeSyncedSession(params({ counter: 0 }))).resolves.toEqual({ kind: 'reset' });

    expect(cursorUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ counter: 0, generation: 5 }));
    expect(sessionValues).not.toHaveBeenCalled();
  });

  it('does not let an out-of-order push rewind a device cursor', async () => {
    const { repo, cursorUpdateSet } = makeHarness({
      cursor: { counter: 860, generation: 1, lastModified: new Date('2026-08-21T10:00:00.000Z') },
    });

    await expect(repo.recordCumulativeSyncedSession(params({ counter: 900 }))).resolves.toEqual({ kind: 'stale' });
    expect(cursorUpdateSet).not.toHaveBeenCalled();
  });

  it('advances the cursor after an idempotent duplicate', async () => {
    const { repo, cursorUpdateSet } = makeHarness({
      cursor: { counter: 800, generation: 0, lastModified: new Date('2026-08-19T10:00:00.000Z') },
      inserted: false,
    });

    await expect(repo.recordCumulativeSyncedSession(params())).resolves.toEqual({
      kind: 'skipped',
      reason: 'duplicate_session_id',
    });
    expect(cursorUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ counter: 860 }));
  });
});

describe('ReadingSessionRepository measured-session reconciliation', () => {
  type EstimateRow = { id: number; startedAt: Date; endedAt: Date; durationSeconds: number; progressDelta: number | null };
  type IntervalEstimateRow = EstimateRow & { syncIntervalStartedAt: Date };
  type SurvivingRow = Omit<EstimateRow, 'id'>;

  const estimateLookup = (rows: EstimateRow[]) => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }) }),
    }),
  });
  const intervalLookup = (rows: IntervalEstimateRow[]) => ({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue(rows) }) }),
  });
  const survivingLookup = (rows: SurvivingRow[]) => ({
    from: vi.fn().mockReturnValue({ innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rows) }) }),
  });
  const existingLookup = (rows: { id: number; durationSeconds: number; progressDelta: number | null }[]) => ({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }) }),
  });

  const measured = {
    startedAt: new Date('2026-08-20T19:20:00.000Z'),
    endedAt: new Date('2026-08-20T19:30:00.000Z'),
    durationSeconds: 600,
    progressDelta: 2,
  };

  function makeMeasuredHarness(selects: unknown[], options: { inserted?: boolean } = {}) {
    const outerLimit = vi.fn().mockResolvedValue([{ bookId: 46, libraryId: 9 }]);
    const outerSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: outerLimit }) }) }),
    });
    const txSelect = vi.fn();
    for (const select of selects) txSelect.mockReturnValueOnce(select);

    const sessionValues = vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(options.inserted === false ? [] : [{ id: 21 }]) }),
    });
    const dailyValues = vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) });
    const insert = vi.fn().mockImplementation((table: unknown) => {
      if (table === readingSessions) return { values: sessionValues };
      if (table === userReadingDailyStats) return { values: dailyValues };
      throw new Error('Unexpected table in insert');
    });
    const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const update = vi.fn().mockReturnValue({ set: updateSet });
    const deleteFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const tx = { execute: vi.fn().mockResolvedValue(undefined), insert, update, select: txSelect, delete: deleteFn };
    const transaction = vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));
    const repo = new ReadingSessionRepository({ select: outerSelect, transaction } as never);

    const saveMeasured = () =>
      repo.saveSession(7, 53, 'measured-event', measured.startedAt, measured.endedAt, measured.durationSeconds, 2, 29, 'kobo', 'UTC', {
        sourceDeviceKey: '30',
        estimateSessionIdPrefix: 'kst:30:',
      });

    return { saveMeasured, transaction, txSelect, sessionValues, dailyValues, updateSet, deleteFn };
  }

  it('stores the device key and removes an overlapping estimate that predates interval tracking', async () => {
    const legacyEstimate = {
      id: 20,
      startedAt: new Date('2026-08-20T18:30:00.000Z'),
      endedAt: new Date('2026-08-20T19:30:00.000Z'),
      durationSeconds: 3600,
      progressDelta: 7,
    };
    const { saveMeasured, transaction, sessionValues, dailyValues, updateSet, deleteFn } = makeMeasuredHarness([
      estimateLookup([legacyEstimate]),
      intervalLookup([]),
      survivingLookup([measured]),
    ]);

    await expect(saveMeasured()).resolves.toEqual({ kind: 'saved' });

    expect(transaction).toHaveBeenCalledOnce();
    expect(sessionValues).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'measured-event', sourceDeviceKey: '30' }));
    expect(deleteFn).toHaveBeenCalledWith(readingSessions);
    expect(updateSet).not.toHaveBeenCalled();
    expect(dailyValues).toHaveBeenLastCalledWith([
      expect.objectContaining({ day: '2026-08-20', readingSeconds: 600, progressDelta: 2, sessionsCount: 1 }),
    ]);
  });

  it('removes the estimate of a later push once the measured session covers its counter interval', async () => {
    const lateEstimate = {
      id: 20,
      startedAt: new Date('2026-08-21T06:50:00.000Z'),
      endedAt: new Date('2026-08-21T07:00:00.000Z'),
      durationSeconds: 600,
      progressDelta: 2,
      syncIntervalStartedAt: new Date('2026-08-20T07:00:00.000Z'),
    };
    const { saveMeasured, dailyValues, updateSet, deleteFn } = makeMeasuredHarness([
      estimateLookup([]),
      intervalLookup([lateEstimate]),
      survivingLookup([measured]),
    ]);

    await expect(saveMeasured()).resolves.toEqual({ kind: 'saved' });

    expect(deleteFn).toHaveBeenCalledWith(readingSessions);
    expect(deleteFn).toHaveBeenCalledWith(userReadingDailyStats);
    expect(updateSet).not.toHaveBeenCalled();
    expect(dailyValues).toHaveBeenLastCalledWith([
      expect.objectContaining({ day: '2026-08-20', readingSeconds: 600, progressDelta: 2, sessionsCount: 1 }),
    ]);
  });

  it('shortens an estimate the measured session covers only in part', async () => {
    const lateEstimate = {
      id: 20,
      startedAt: new Date('2026-08-21T06:00:00.000Z'),
      endedAt: new Date('2026-08-21T07:00:00.000Z'),
      durationSeconds: 3600,
      progressDelta: 6,
      syncIntervalStartedAt: new Date('2026-08-20T07:00:00.000Z'),
    };
    const shortened = {
      startedAt: new Date('2026-08-21T06:10:00.000Z'),
      endedAt: new Date('2026-08-21T07:00:00.000Z'),
      durationSeconds: 3000,
      progressDelta: 5,
    };
    const { saveMeasured, dailyValues, updateSet, deleteFn } = makeMeasuredHarness([
      estimateLookup([]),
      intervalLookup([lateEstimate]),
      survivingLookup([measured, shortened]),
    ]);

    await expect(saveMeasured()).resolves.toEqual({ kind: 'saved' });

    expect(updateSet).toHaveBeenCalledWith({ startedAt: shortened.startedAt, durationSeconds: 3000, progressDelta: 5 });
    expect(deleteFn).not.toHaveBeenCalledWith(readingSessions);
    expect(dailyValues).toHaveBeenLastCalledWith([
      expect.objectContaining({ day: '2026-08-21', readingSeconds: 3000, progressDelta: 5, sessionsCount: 1 }),
    ]);
  });

  it('splits a measured session across the estimates whose counter intervals it overlaps', async () => {
    const pushedMidSession = new Date('2026-08-20T19:25:00.000Z');
    const before = {
      id: 20,
      startedAt: new Date('2026-08-20T19:05:00.000Z'),
      endedAt: pushedMidSession,
      durationSeconds: 1200,
      progressDelta: null,
      syncIntervalStartedAt: new Date('2026-08-20T07:00:00.000Z'),
    };
    const after = {
      id: 22,
      startedAt: new Date('2026-08-21T06:40:00.000Z'),
      endedAt: new Date('2026-08-21T07:00:00.000Z'),
      durationSeconds: 1200,
      progressDelta: null,
      syncIntervalStartedAt: pushedMidSession,
    };
    const { saveMeasured, updateSet, deleteFn } = makeMeasuredHarness([
      estimateLookup([]),
      intervalLookup([before, after]),
      survivingLookup([measured]),
    ]);

    await expect(saveMeasured()).resolves.toEqual({ kind: 'saved' });

    expect(updateSet).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenNthCalledWith(1, { startedAt: new Date('2026-08-20T19:10:00.000Z'), durationSeconds: 900, progressDelta: null });
    expect(updateSet).toHaveBeenNthCalledWith(2, { startedAt: new Date('2026-08-21T06:45:00.000Z'), durationSeconds: 900, progressDelta: null });
    expect(deleteFn).not.toHaveBeenCalledWith(readingSessions);
  });

  it('takes nothing off an estimate when the measured session is a replay', async () => {
    const { saveMeasured, txSelect, updateSet, deleteFn } = makeMeasuredHarness(
      [existingLookup([{ id: 21, durationSeconds: 600, progressDelta: 2 }]), estimateLookup([])],
      { inserted: false },
    );

    await expect(saveMeasured()).resolves.toEqual({ kind: 'skipped', reason: 'duplicate_session_id' });

    expect(txSelect).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledWith({ sourceDeviceKey: '30' });
    expect(deleteFn).not.toHaveBeenCalled();
  });
});
