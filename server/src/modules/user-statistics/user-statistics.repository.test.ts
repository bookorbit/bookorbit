import { UserStatisticsRepository } from './user-statistics.repository';

function makeChain(result: unknown, fields?: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  for (const key of Object.keys(fields ?? {})) {
    chain[key] = { key };
  }

  const methods = ['from', 'innerJoin', 'leftJoin', 'where', 'groupBy', 'orderBy', 'limit', 'offset', 'as'] as const;
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);

  return chain;
}

function makeDb(selectQueue: unknown[] = [], executeQueue: unknown[] = []) {
  const selects = [...selectQueue];
  const executes = [...executeQueue];

  return {
    select: vi.fn((fields?: Record<string, unknown>) => makeChain(selects.shift() ?? [], fields)),
    execute: vi.fn(() => {
      const next = executes.shift();
      if (next && typeof next === 'object' && 'rows' in (next as Record<string, unknown>)) {
        return Promise.resolve(next);
      }
      return Promise.resolve({ rows: next ?? [] });
    }),
    transaction: vi.fn(async (callback: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<unknown>) =>
      callback({
        execute: vi.fn().mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rowCount: 0 }),
      }),
    ),
  };
}

describe('UserStatisticsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles library scope helper methods and day helpers', async () => {
    const db = makeDb([[{ libraryId: 1 }, { libraryId: 3 }]]);
    const repo = new UserStatisticsRepository(db as never);

    await expect((repo as any).getAccessibleLibraryIds(9, true)).resolves.toBeNull();
    await expect((repo as any).getAccessibleLibraryIds(9, false)).resolves.toEqual([1, 3]);

    expect((repo as any).intersectLibraryIds(null, undefined)).toBeNull();
    expect((repo as any).intersectLibraryIds(null, [4, 5])).toEqual([4, 5]);
    expect((repo as any).intersectLibraryIds([1, 2, 3], [2, 9])).toEqual([2]);

    expect((repo as any).libraryFilter(null)).toBeUndefined();
    expect((repo as any).libraryFilter([])).toBeDefined();
    expect((repo as any).dailyStatsLibraryFilter([2])).toBeDefined();
    expect((repo as any).formatDayKey(new Date('2026-04-15T00:00:00.000Z'))).toBe('2026-04-15');
    expect((repo as any).sinceDateForDays(3).toISOString()).toBe('2026-04-13T00:00:00.000Z');
  });

  it('returns summary defaults when aggregate rows are missing', async () => {
    const db = makeDb([[], [], []]);
    const repo = new UserStatisticsRepository(db as never);
    vi.spyOn(repo as any, 'getAccessibleLibraryIds').mockResolvedValue([1]);

    await expect(repo.getSummary(5, false, [1])).resolves.toEqual({
      trackedBooks: 0,
      startedBooks: 0,
      inProgressBooks: 0,
      completedBooks: 0,
      meanProgressPercent: 0,
    });
  });

  it('returns daily/peak/favorite aggregates and monthly completion timeline', async () => {
    const db = makeDb([
      [{ day: '2026-04-15', readingSeconds: 120, progressDelta: 1.5, eventsCount: 2 }],
      [{ hour: 9, format: 'EPUB', source: 'koreader', readingSeconds: 500, eventsCount: 3 }],
      [{ dayOfWeek: 2, source: 'manual', format: 'EPUB', readingSeconds: 900, eventsCount: 4 }],
      [],
      [{ year: 2026, month: 4, count: 2 }],
      [],
      [{ year: 2026, month: 4, count: 2 }],
    ]);
    const repo = new UserStatisticsRepository(db as never);
    vi.spyOn(repo as any, 'getAccessibleLibraryIds').mockResolvedValue([1, 2]);

    await expect(repo.getDailyReadingStats(5, false, [2], 30)).resolves.toEqual([
      { day: '2026-04-15', readingSeconds: 120, progressDelta: 1.5, eventsCount: 2 },
    ]);
    await expect(repo.getPeakReadingHours(5, false, [2], 30)).resolves.toEqual([
      { hour: 9, format: 'EPUB', source: 'koreader', readingSeconds: 500, eventsCount: 3 },
    ]);
    await expect(repo.getFavoriteReadingDays(5, false, [2], 30)).resolves.toEqual([
      { dayOfWeek: 2, source: 'manual', format: 'EPUB', readingSeconds: 900, eventsCount: 4 },
    ]);
    await expect(repo.getCompletionTimeline(5, false, [2], 365)).resolves.toEqual([{ year: 2026, month: 4, count: 2 }]);
    await expect(repo.getMonthlyCompletions(5, false, [2], 365)).resolves.toEqual([{ year: 2026, month: 4, count: 2 }]);
  });

  it('returns per-source daily reading seconds for the heatmap tooltip', async () => {
    const db = makeDb([
      [
        { day: '2026-04-15', source: 'web', readingSeconds: 120 },
        { day: '2026-04-15', source: 'kobo', readingSeconds: 60 },
      ],
    ]);
    const repo = new UserStatisticsRepository(db as never);
    vi.spyOn(repo as any, 'getAccessibleLibraryIds').mockResolvedValue([2]);

    await expect(repo.getDailyReadingSecondsBySource(5, false, [2], 30)).resolves.toEqual([
      { day: '2026-04-15', source: 'web', readingSeconds: 120 },
      { day: '2026-04-15', source: 'kobo', readingSeconds: 60 },
    ]);
  });

  it('returns timeline items and timeline session by id', async () => {
    const timelineRow = {
      sessionId: 10,
      bookId: 4,
      bookTitle: 'Dune',
      bookFormat: 'EPUB',
      source: 'koreader',
      startedAt: new Date('2026-04-15T10:00:00.000Z'),
      endedAt: new Date('2026-04-15T10:30:00.000Z'),
      durationSeconds: 1800,
    };
    const sessionRow = {
      ...timelineRow,
      libraryId: 3,
    };
    const db = makeDb([[timelineRow], [sessionRow]]);
    const repo = new UserStatisticsRepository(db as never);
    vi.spyOn(repo as any, 'getAccessibleLibraryIds').mockResolvedValue([3]);

    await expect(
      repo.getSessionTimelineItems(5, false, [3], new Date('2026-04-15T00:00:00.000Z'), new Date('2026-04-16T00:00:00.000Z'), 100),
    ).resolves.toEqual([
      {
        sessionId: 10,
        bookId: 4,
        bookTitle: 'Dune',
        bookFormat: 'EPUB',
        source: 'koreader',
        startedAt: new Date('2026-04-15T10:00:00.000Z'),
        endedAt: new Date('2026-04-15T10:30:00.000Z'),
        durationSeconds: 1800,
      },
    ]);
    await expect(repo.getSessionTimelineSessionById(5, false, [3], 10)).resolves.toEqual(sessionRow);
  });

  it('returns conflict when moving timeline sessions into an overlap', async () => {
    const txSelectQueue = [[{ sessionId: 88, startedAt: new Date('2026-04-15T10:10:00.000Z'), endedAt: new Date('2026-04-15T10:40:00.000Z') }]];
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn((fields?: Record<string, unknown>) => makeChain(txSelectQueue.shift() ?? [], fields)),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const db = {
      transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const repo = new UserStatisticsRepository(db as never);

    const result = await repo.moveSessionTimelineSessionAtomic(
      5,
      10,
      3,
      new Date('2026-04-15T09:00:00.000Z'),
      new Date('2026-04-15T09:30:00.000Z'),
      new Date('2026-04-15T10:20:00.000Z'),
      new Date('2026-04-15T10:50:00.000Z'),
      1800,
    );

    expect(result.updated).toBeNull();
    expect(result.conflict).toEqual({
      sessionId: 88,
      startedAt: new Date('2026-04-15T10:10:00.000Z'),
      endedAt: new Date('2026-04-15T10:40:00.000Z'),
    });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('returns null updated session when touched row disappears before update', async () => {
    const txSelectQueue = [[]];
    const returning = vi.fn().mockResolvedValue([]);
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn((fields?: Record<string, unknown>) => makeChain(txSelectQueue.shift() ?? [], fields)),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning,
          }),
        }),
      }),
      delete: vi.fn(),
    };
    const db = {
      transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const repo = new UserStatisticsRepository(db as never);

    const result = await repo.moveSessionTimelineSessionAtomic(
      5,
      10,
      3,
      new Date('2026-04-15T09:00:00.000Z'),
      new Date('2026-04-15T09:30:00.000Z'),
      new Date('2026-04-15T10:00:00.000Z'),
      new Date('2026-04-15T10:30:00.000Z'),
      1800,
    );

    expect(result).toEqual({ updated: null, conflict: null });
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it('moves session atomically, refreshes affected daily stats, and returns updated row', async () => {
    const updatedRow = {
      sessionId: 10,
      libraryId: 3,
      bookId: 4,
      bookTitle: 'Dune',
      bookFormat: 'EPUB',
      source: 'web',
      startedAt: new Date('2026-04-15T11:00:00.000Z'),
      endedAt: new Date('2026-04-15T11:30:00.000Z'),
      durationSeconds: 1800,
    };
    const txSelectQueue = [
      [],
      [{ startedAt: new Date('2026-04-15T11:00:00.000Z'), endedAt: new Date('2026-04-15T11:30:00.000Z'), durationSeconds: 1800, progressDelta: 3 }],
      [updatedRow],
    ];
    const returning = vi.fn().mockResolvedValue([{ id: 10 }]);
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const dailyValues = vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) });
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn((fields?: Record<string, unknown>) => makeChain(txSelectQueue.shift() ?? [], fields)),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning,
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: deleteWhere,
      }),
      insert: vi.fn().mockReturnValue({
        values: dailyValues,
      }),
    };
    const db = {
      transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const repo = new UserStatisticsRepository(db as never);

    const result = await repo.moveSessionTimelineSessionAtomic(
      5,
      10,
      3,
      new Date('2026-04-14T09:00:00.000Z'),
      new Date('2026-04-14T09:30:00.000Z'),
      new Date('2026-04-15T11:00:00.000Z'),
      new Date('2026-04-15T11:30:00.000Z'),
      1800,
    );

    expect(result).toEqual({ updated: updatedRow, conflict: null });
    expect(deleteWhere).toHaveBeenCalledOnce();
    expect(dailyValues).toHaveBeenCalledWith([
      expect.objectContaining({ day: '2026-04-15', readingSeconds: 1800, progressDelta: 3, sessionsCount: 1 }),
    ]);
  });

  it('returns progress funnel values and defaults when aggregate row is missing', async () => {
    const db = makeDb([[], [{ started: 5, reached25: 4, reached50: 3, reached75: 2, completed: 1 }], [], []]);
    const repo = new UserStatisticsRepository(db as never);
    vi.spyOn(repo as any, 'getAccessibleLibraryIds').mockResolvedValue([1]);

    await expect(
      repo.getProgressFunnelInRange(5, false, [1], new Date('2026-04-01T00:00:00.000Z'), new Date('2026-05-01T00:00:00.000Z')),
    ).resolves.toEqual({
      started: 5,
      reached25: 4,
      reached50: 3,
      reached75: 2,
      completed: 1,
    });

    await expect(repo.getProgressFunnelInRange(5, false, [1], new Date('2026-04-01T00:00:00.000Z'))).resolves.toEqual({
      started: 0,
      reached25: 0,
      reached50: 0,
      reached75: 0,
      completed: 0,
    });
  });

  it('normalizes completion latency, reading pace, survival, race, and archetype points', async () => {
    const db = makeDb([
      [],
      [],
      [{ days: '3.5' }, { days: -1 }, { days: 'not-a-number' }, { days: 7 }],
      [{ durationSeconds: 300, progressDelta: 1.25, source: 'kobo', format: 'PDF' }],
      [],
      [{ maxProgress: 50 }, { maxProgress: 'bad' }],
      [{ bookId: 1 }],
      [
        { bookId: 1, title: 'Dune', startedAt: new Date('2026-04-01T10:00:00.000Z'), endProgress: 40 },
        { bookId: 1, title: 'Dune', startedAt: new Date('2026-04-02T10:00:00.000Z'), endProgress: 70 },
      ],
      [{ hour: '9.5', durationMinutes: '15', dayOfWeek: '2' }],
      [{ genre: 'Sci-Fi', source: 'web', readingSeconds: 1200 }],
    ]);
    const repo = new UserStatisticsRepository(db as never);
    vi.spyOn(repo as any, 'getAccessibleLibraryIds').mockResolvedValue([1]);

    await expect(repo.getCompletionLatencyDays(5, false, [1], 365)).resolves.toEqual([3.5, 7]);
    await expect(repo.getReadingPacePoints(5, false, [1], 365)).resolves.toEqual([
      { durationSeconds: 300, progressDelta: 1.25, bucket: 'kobo', format: 'PDF' },
    ]);
    await expect(repo.getReadingSurvivalMaxProgress(5, false, [1], 365)).resolves.toEqual([50]);
    await expect(repo.getCompletionRaceRawSessions(5, false, [1], 365, 15)).resolves.toEqual([
      { bookId: 1, title: 'Dune', startedAt: new Date('2026-04-01T10:00:00.000Z'), endProgress: 40 },
      { bookId: 1, title: 'Dune', startedAt: new Date('2026-04-02T10:00:00.000Z'), endProgress: 70 },
    ]);
    await expect(repo.getSessionArchetypePoints(5, false, [1], 365)).resolves.toEqual([{ hour: 9.5, durationMinutes: 15, dayOfWeek: 2 }]);
    await expect(repo.getGenreReadingTime(5, false, [1], 365)).resolves.toEqual([{ genre: 'Sci-Fi', source: 'web', readingSeconds: 1200 }]);
  });

  it('returns empty completion race when no top books exist', async () => {
    const db = makeDb([[]]);
    const repo = new UserStatisticsRepository(db as never);
    vi.spyOn(repo as any, 'getAccessibleLibraryIds').mockResolvedValue([1]);

    await expect(repo.getCompletionRaceRawSessions(5, false, [1], 365, 15)).resolves.toEqual([]);
  });

  it('builds chord diagram nodes/links and returns empty chord when no rows exist', async () => {
    const emptyDb = makeDb([], [{ rows: [] }]);
    const emptyRepo = new UserStatisticsRepository(emptyDb as never);
    vi.spyOn(emptyRepo as any, 'getAccessibleLibraryIds').mockResolvedValue([1]);
    await expect(emptyRepo.getAuthorGenreChord(5, false, [1], 365)).resolves.toEqual({ nodes: [], links: [] });

    const filledDb = makeDb([], [{ rows: [{ author: 'Author A', genre: 'Sci-Fi', reading_seconds: 600 }] }]);
    const filledRepo = new UserStatisticsRepository(filledDb as never);
    vi.spyOn(filledRepo as any, 'getAccessibleLibraryIds').mockResolvedValue([1]);
    await expect(filledRepo.getAuthorGenreChord(5, false, [1], 365)).resolves.toEqual({
      nodes: [{ name: 'Author A' }, { name: 'Sci-Fi' }],
      links: [{ source: 'Author A', target: 'Sci-Fi', value: 600 }],
    });
  });

  it('recomputes recent daily stats with timezone-aware day segments inside a transaction', async () => {
    const dailyValues = vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) });
    const txSelectQueue = [
      [],
      [{ userId: 5, libraryId: 3, settings: { timezone: 'Asia/Kolkata' } }],
      [
        {
          startedAt: new Date('2026-04-13T19:00:00.000Z'),
          endedAt: new Date('2026-04-13T20:00:00.000Z'),
          durationSeconds: 3600,
          progressDelta: 2,
        },
      ],
    ];
    const tx = {
      execute: vi.fn().mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rowCount: 4 }),
      select: vi.fn((fields?: Record<string, unknown>) => makeChain(txSelectQueue.shift() ?? [], fields)),
      insert: vi.fn().mockReturnValue({ values: dailyValues }),
    };
    const db = {
      transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const repo = new UserStatisticsRepository(db as never);

    await expect(repo.recomputeRecentDailyStats(2)).resolves.toEqual({
      deleted: 4,
      inserted: 1,
      since: '2026-04-14',
    });
    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(dailyValues).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 5,
        libraryId: 3,
        day: '2026-04-14',
        readingSeconds: 3600,
        progressDelta: 2,
        sessionsCount: 1,
      }),
    ]);
  });
});
