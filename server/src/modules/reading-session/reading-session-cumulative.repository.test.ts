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
    measured?: boolean;
    file?: { bookId: number; libraryId: number } | null;
    inserted?: boolean;
  } = {},
) {
  const cursorChain = makeLimitChain(options.cursor ? [options.cursor] : []);
  const measuredChain = makeLimitChain(options.measured ? [{ id: 88 }] : []);
  const fileChain = makeLimitChain(options.file === null ? [] : [options.file ?? { bookId: 46, libraryId: 9 }]);

  const select = vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: unknown) => {
      if (table === readingSessionSyncCursors) return { where: cursorChain.where };
      if (table === readingSessions) return { where: measuredChain.where };
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

  return { repo, tx, transaction, cursorInsertValues, cursorUpdateSet, sessionValues, dailyValues };
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

  it('advances without an estimate when overlapping measured analytics already exist', async () => {
    const { repo, cursorUpdateSet, sessionValues } = makeHarness({
      cursor: { counter: 800, generation: 0, lastModified: new Date('2026-08-19T10:00:00.000Z') },
      measured: true,
    });

    await expect(repo.recordCumulativeSyncedSession(params())).resolves.toEqual({
      kind: 'skipped',
      reason: 'measured_session_present',
    });

    expect(cursorUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ counter: 860 }));
    expect(sessionValues).not.toHaveBeenCalled();
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
  it('stores the device key and removes an overlapping estimate in the same transaction', async () => {
    const outerLimit = vi.fn().mockResolvedValue([{ bookId: 46, libraryId: 9 }]);
    const outerSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: outerLimit }) }) }),
    });

    const estimate = {
      id: 20,
      startedAt: new Date('2026-08-20T18:30:00.000Z'),
      endedAt: new Date('2026-08-20T19:30:00.000Z'),
      durationSeconds: 3600,
      progressDelta: 7,
    };
    const estimateSelect = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([estimate]) }) }),
      }),
    };
    const survivingSelect = {
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              startedAt: new Date('2026-08-20T19:20:00.000Z'),
              endedAt: new Date('2026-08-20T19:30:00.000Z'),
              durationSeconds: 600,
              progressDelta: 2,
            },
          ]),
        }),
      }),
    };
    const txSelect = vi.fn().mockReturnValueOnce(estimateSelect).mockReturnValueOnce(survivingSelect);

    const sessionValues = vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 21 }]) }),
    });
    const dailyValues = vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) });
    const insert = vi.fn().mockImplementation((table: unknown) => {
      if (table === readingSessions) return { values: sessionValues };
      if (table === userReadingDailyStats) return { values: dailyValues };
      throw new Error('Unexpected table in insert');
    });
    const deleteFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const tx = { execute: vi.fn().mockResolvedValue(undefined), insert, select: txSelect, delete: deleteFn };
    const transaction = vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));
    const repo = new ReadingSessionRepository({ select: outerSelect, transaction } as never);

    await expect(
      repo.saveSession(
        7,
        53,
        'measured-event',
        new Date('2026-08-20T19:20:00.000Z'),
        new Date('2026-08-20T19:30:00.000Z'),
        600,
        2,
        29,
        'kobo',
        'UTC',
        { sourceDeviceKey: '30', estimateSessionIdPrefix: 'kst:30:' },
      ),
    ).resolves.toEqual({ kind: 'saved' });

    expect(transaction).toHaveBeenCalledOnce();
    expect(sessionValues).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'measured-event', sourceDeviceKey: '30' }));
    expect(deleteFn).toHaveBeenCalledWith(readingSessions);
    expect(dailyValues).toHaveBeenLastCalledWith([
      expect.objectContaining({ day: '2026-08-20', readingSeconds: 600, progressDelta: 2, sessionsCount: 1 }),
    ]);
  });
});
