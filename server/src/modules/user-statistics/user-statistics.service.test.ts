import { UserStatisticsService } from './user-statistics.service';

describe('UserStatisticsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rounds mean progress to two decimals', async () => {
    const repo = {
      getSummary: vi.fn().mockResolvedValue({
        trackedBooks: 5,
        startedBooks: 4,
        inProgressBooks: 3,
        completedBooks: 1,
        meanProgressPercent: 42.34567,
      }),
    };

    const service = new UserStatisticsService(repo as any);

    const result = await service.getSummary({ id: 123, isSuperuser: false } as any, { libraryIds: [1, 2] });

    expect(repo.getSummary).toHaveBeenCalledWith(123, false, [1, 2]);
    expect(result).toEqual({
      trackedBooks: 5,
      startedBooks: 4,
      inProgressBooks: 3,
      completedBooks: 1,
      meanProgressPercent: 42.35,
    });
  });

  it('returns a contiguous daily heatmap window with zero-filled days', async () => {
    const repo = {
      getDailyReadingStats: vi.fn().mockResolvedValue([{ day: '2026-04-06', readingSeconds: 120, progressDelta: 1.23456, eventsCount: 2 }]),
      getDailyReadingSecondsBySource: vi.fn().mockResolvedValue([
        { day: '2026-04-06', source: 'web', readingSeconds: 90 },
        { day: '2026-04-06', source: 'kobo', readingSeconds: 30 },
      ]),
    };

    const service = new UserStatisticsService(repo as any);
    const result = await service.getReadingHeatmap({ id: 123, isSuperuser: false } as any, { days: 3, libraryIds: [] });

    expect(repo.getDailyReadingStats).toHaveBeenCalledWith(123, false, [], 3);
    expect(repo.getDailyReadingSecondsBySource).toHaveBeenCalledWith(123, false, [], 3);
    expect(result).toEqual([
      { day: '2026-04-06', readingSeconds: 120, progressDelta: 1.2346, eventsCount: 2, bySource: { bookorbit: 90, koreader: 0, kobo: 30 } },
      { day: '2026-04-07', readingSeconds: 0, progressDelta: 0, eventsCount: 0, bySource: { bookorbit: 0, koreader: 0, kobo: 0 } },
      { day: '2026-04-08', readingSeconds: 0, progressDelta: 0, eventsCount: 0, bySource: { bookorbit: 0, koreader: 0, kobo: 0 } },
    ]);
  });

  it('buckets the reading-source distribution and excludes empty buckets', async () => {
    const repo = {
      getDailyReadingSecondsBySource: vi.fn().mockResolvedValue([
        { day: '2026-04-06', source: 'web', readingSeconds: 100 },
        { day: '2026-04-06', source: 'manual', readingSeconds: 50 },
        { day: '2026-04-07', source: null, readingSeconds: 30 },
        { day: '2026-04-06', source: 'kobo', readingSeconds: 200 },
      ]),
    };

    const service = new UserStatisticsService(repo as any);
    const result = await service.getReadingSourceDistribution({ id: 123, isSuperuser: false } as any, { libraryIds: [] });

    expect(repo.getDailyReadingSecondsBySource).toHaveBeenCalledWith(123, false, [], 365);
    // web + manual + null collapse into bookorbit; koreader has no activity and is omitted.
    expect(result).toEqual({
      totalSeconds: 380,
      slices: [
        { bucket: 'bookorbit', readingSeconds: 180 },
        { bucket: 'kobo', readingSeconds: 200 },
      ],
    });
  });

  it('returns an empty source distribution and honours the days override', async () => {
    const repo = { getDailyReadingSecondsBySource: vi.fn().mockResolvedValue([]) };
    const service = new UserStatisticsService(repo as any);

    const result = await service.getReadingSourceDistribution({ id: 7, isSuperuser: true } as any, { days: 30, libraryIds: [1] });

    expect(repo.getDailyReadingSecondsBySource).toHaveBeenCalledWith(7, true, [1], 30);
    expect(result).toEqual({ totalSeconds: 0, slices: [] });
  });

  it('returns all 24 hour buckets for peak reading hours', async () => {
    const repo = {
      getPeakReadingHours: vi.fn().mockResolvedValue([
        { hour: 8, format: 'EPUB', source: 'web', readingSeconds: 400, eventsCount: 2 },
        { hour: 8, format: 'EPUB', source: 'kobo', readingSeconds: 200, eventsCount: 1 },
        { hour: 21, format: 'EPUB', source: 'koreader', readingSeconds: 900, eventsCount: 4 },
      ]),
    };

    const service = new UserStatisticsService(repo as any);
    const result = await service.getPeakReadingHours({ id: 123, isSuperuser: false } as any, { libraryIds: [] });

    expect(repo.getPeakReadingHours).toHaveBeenCalledWith(123, false, [], 365);
    expect(result).toHaveLength(24);
    expect(result[8]).toEqual(
      expect.objectContaining({ hour: 8, readingSeconds: 600, eventsCount: 3, bySource: { bookorbit: 400, koreader: 0, kobo: 200 } }),
    );
    expect(result[21]).toEqual(
      expect.objectContaining({ hour: 21, readingSeconds: 900, eventsCount: 4, bySource: { bookorbit: 0, koreader: 900, kobo: 0 } }),
    );
    expect(result[0]).toEqual(
      expect.objectContaining({ hour: 0, readingSeconds: 0, eventsCount: 0, bySource: { bookorbit: 0, koreader: 0, kobo: 0 } }),
    );
  });

  it('returns all weekday buckets for favorite reading days', async () => {
    const repo = {
      getFavoriteReadingDays: vi.fn().mockResolvedValue([
        { dayOfWeek: 1, source: 'koreader', format: 'EPUB', readingSeconds: 1200, eventsCount: 4 },
        { dayOfWeek: 1, source: 'web', format: 'PDF', readingSeconds: 600, eventsCount: 2 },
      ]),
    };

    const service = new UserStatisticsService(repo as any);
    const result = await service.getFavoriteReadingDays({ id: 123, isSuperuser: false } as any, { libraryIds: [] });

    expect(repo.getFavoriteReadingDays).toHaveBeenCalledWith(123, false, [], 365);
    expect(result).toHaveLength(7);
    expect(result[1]).toEqual({
      dayOfWeek: 1,
      readingSeconds: 1800,
      eventsCount: 6,
      byFormat: { EPUB: 1200, PDF: 600 },
      bySource: { bookorbit: 600, koreader: 1200, kobo: 0 },
    });
    expect(result[0]).toEqual({
      dayOfWeek: 0,
      readingSeconds: 0,
      eventsCount: 0,
      byFormat: {},
      bySource: { bookorbit: 0, koreader: 0, kobo: 0 },
    });
  });

  it('returns a contiguous monthly completion timeline', async () => {
    const repo = {
      getCompletionTimeline: vi.fn().mockResolvedValue([
        { year: 2026, month: 1, count: 2 },
        { year: 2026, month: 3, count: 1 },
      ]),
    };

    const service = new UserStatisticsService(repo as any);
    const result = await service.getCompletionTimeline({ id: 123, isSuperuser: false } as any, { days: 120, libraryIds: [] });

    expect(repo.getCompletionTimeline).toHaveBeenCalledWith(123, false, [], 120);
    expect(result).toEqual([
      { year: 2025, month: 12, count: 0 },
      { year: 2026, month: 1, count: 2 },
      { year: 2026, month: 2, count: 0 },
      { year: 2026, month: 3, count: 1 },
      { year: 2026, month: 4, count: 0 },
    ]);
  });

  it('builds goal trajectory with cumulative actual and target lines', async () => {
    const repo = {
      getMonthlyCompletions: vi.fn().mockResolvedValue([
        { year: 2026, month: 1, count: 1 },
        { year: 2026, month: 3, count: 2 },
      ]),
    };

    const service = new UserStatisticsService(repo as any);
    const result = await service.getGoalTrajectory({ id: 123, isSuperuser: false } as any, { days: 120, goalBooks: 12, libraryIds: [] });

    expect(repo.getMonthlyCompletions).toHaveBeenCalledWith(123, false, [], 120);
    expect(result.goalBooks).toBe(12);
    expect(result.points).toEqual([
      { year: 2025, month: 12, actualCumulative: 0, targetCumulative: 1 },
      { year: 2026, month: 1, actualCumulative: 1, targetCumulative: 2 },
      { year: 2026, month: 2, actualCumulative: 1, targetCumulative: 3 },
      { year: 2026, month: 3, actualCumulative: 3, targetCumulative: 4 },
      { year: 2026, month: 4, actualCumulative: 3, targetCumulative: 5 },
    ]);
  });

  it('passes progress funnel query to repository with defaults', async () => {
    const repo = {
      getProgressFunnelInRange: vi.fn().mockResolvedValue({
        started: 20,
        reached25: 16,
        reached50: 12,
        reached75: 8,
        completed: 4,
      }),
    };

    const service = new UserStatisticsService(repo as any);
    const result = await service.getProgressFunnel({ id: 123, isSuperuser: false } as any, { libraryIds: [] });

    expect(repo.getProgressFunnelInRange).toHaveBeenCalledTimes(1);
    expect(result.days).toBe(365);
    expect(result.current.completed).toBe(4);
    expect(result.previous).toBeNull();
  });

  it('caches repeated progress funnel queries for the same key', async () => {
    const repo = {
      getProgressFunnelInRange: vi.fn().mockResolvedValue({
        started: 10,
        reached25: 8,
        reached50: 6,
        reached75: 4,
        completed: 2,
      }),
    };

    const service = new UserStatisticsService(repo as any);
    const user = { id: 7, isSuperuser: false } as any;
    const query = { libraryIds: [2, 1], days: 365 };

    const first = await service.getProgressFunnel(user, query);
    const second = await service.getProgressFunnel(user, { libraryIds: [1, 2], days: 365 });

    expect(first).toEqual(second);
    expect(repo.getProgressFunnelInRange).toHaveBeenCalledTimes(1);
  });

  it('computes completion latency buckets and percentiles', async () => {
    const repo = {
      getCompletionLatencyDays: vi.fn().mockResolvedValue([2, 10, 20, 60, 120, 400]),
    };

    const service = new UserStatisticsService(repo as any);
    const result = await service.getCompletionLatency({ id: 123, isSuperuser: false } as any, { libraryIds: [] });

    expect(repo.getCompletionLatencyDays).toHaveBeenCalledWith(123, false, [], 1825);
    expect(result.totalCompletions).toBe(6);
    expect(result.medianDays).toBe(40);
    expect(result.percentile75Days).toBe(105);
    expect(result.percentile90Days).toBe(260);
    expect(result.buckets).toEqual([
      { label: '0-7d', minDays: 0, maxDays: 7, count: 1 },
      { label: '8-30d', minDays: 8, maxDays: 30, count: 2 },
      { label: '31-90d', minDays: 31, maxDays: 90, count: 1 },
      { label: '91-180d', minDays: 91, maxDays: 180, count: 1 },
      { label: '181-365d', minDays: 181, maxDays: 365, count: 0 },
      { label: '366-730d', minDays: 366, maxDays: 730, count: 1 },
      { label: '731d+', minDays: 731, maxDays: null, count: 0 },
    ]);
  });

  it('clears cached query results after recomputeRecentDailyStats', async () => {
    const repo = {
      getProgressFunnelInRange: vi
        .fn()
        .mockResolvedValueOnce({ started: 10, reached25: 8, reached50: 6, reached75: 4, completed: 2 })
        .mockResolvedValueOnce({ started: 11, reached25: 9, reached50: 7, reached75: 5, completed: 3 }),
      recomputeRecentDailyStats: vi.fn().mockResolvedValue({ deleted: 1, inserted: 2, since: '2026-04-07' }),
    };

    const service = new UserStatisticsService(repo as any);
    const user = { id: 9, isSuperuser: false } as any;
    const query = { libraryIds: [1], days: 365 };

    const before = await service.getProgressFunnel(user, query);
    await service.recomputeRecentDailyStats(2);
    const after = await service.getProgressFunnel(user, query);

    expect(repo.getProgressFunnelInRange).toHaveBeenCalledTimes(2);
    expect(repo.recomputeRecentDailyStats).toHaveBeenCalledWith(2);
    expect(before.current.completed).toBe(2);
    expect(after.current.completed).toBe(3);
  });

  it('returns previous-window funnel when comparePrevious is true', async () => {
    const repo = {
      getProgressFunnelInRange: vi
        .fn()
        .mockResolvedValueOnce({ started: 20, reached25: 15, reached50: 10, reached75: 8, completed: 5 })
        .mockResolvedValueOnce({ started: 18, reached25: 13, reached50: 9, reached75: 6, completed: 4 }),
    };

    const service = new UserStatisticsService(repo as any);
    const result = await service.getProgressFunnel({ id: 123, isSuperuser: false } as any, { libraryIds: [1], days: 365, comparePrevious: true });

    expect(repo.getProgressFunnelInRange).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      days: 365,
      current: { started: 20, reached25: 15, reached50: 10, reached75: 8, completed: 5 },
      previous: { started: 18, reached25: 13, reached50: 9, reached75: 6, completed: 4 },
    });
  });

  it('returns weekly session timeline with ISO week defaults', async () => {
    const repo = {
      getSessionTimelineItems: vi.fn().mockResolvedValue([
        {
          sessionId: 100,
          bookId: 55,
          bookTitle: 'Deep Work',
          bookFormat: 'EPUB',
          source: 'kobo',
          startedAt: new Date('2026-04-07T02:30:00.000Z'),
          endedAt: new Date('2026-04-07T03:00:00.000Z'),
          durationSeconds: 1800,
        },
      ]),
    };

    const service = new UserStatisticsService(repo as any);
    const result = await service.getSessionTimeline({ id: 123, isSuperuser: false } as any, { libraryIds: [1] });

    expect(result.year).toBe(2026);
    expect(result.week).toBe(15);
    expect(result.weekStart).toBe('2026-04-06');
    expect(result.weekEnd).toBe('2026-04-12');
    expect(result.items[0]).toEqual({
      sessionId: 100,
      bookId: 55,
      bookTitle: 'Deep Work',
      bookFormat: 'EPUB',
      bookSource: 'kobo',
      startedAt: '2026-04-07T02:30:00.000Z',
      endedAt: '2026-04-07T03:00:00.000Z',
      durationSeconds: 1800,
    });

    expect(repo.getSessionTimelineItems).toHaveBeenCalledTimes(1);
    const [, , , since, until, limit] = repo.getSessionTimelineItems.mock.calls[0];
    expect(since.toISOString()).toBe('2026-04-06T00:00:00.000Z');
    expect(until.toISOString()).toBe('2026-04-13T00:00:00.000Z');
    expect(limit).toBe(3000);
  });

  it('updates a timeline session atomically', async () => {
    const existing = {
      sessionId: 101,
      libraryId: 4,
      bookId: 44,
      bookTitle: 'Atomic Habits',
      bookFormat: 'EPUB',
      startedAt: new Date('2026-04-07T08:00:00.000Z'),
      endedAt: new Date('2026-04-07T08:30:00.000Z'),
      durationSeconds: 1800,
    };
    const updated = {
      ...existing,
      startedAt: new Date('2026-04-08T09:00:00.000Z'),
      endedAt: new Date('2026-04-08T09:30:00.000Z'),
    };

    const repo = {
      getSessionTimelineSessionById: vi.fn().mockResolvedValue(existing),
      moveSessionTimelineSessionAtomic: vi.fn().mockResolvedValue({
        updated,
        conflict: null,
      }),
    };

    const service = new UserStatisticsService(repo as any);
    const result = await service.updateSessionTimelineSession(
      { id: 123, isSuperuser: false } as any,
      101,
      {
        startedAt: '2026-04-08T09:00:00.000Z',
        endedAt: '2026-04-08T09:30:00.000Z',
      },
      { libraryIds: [4] },
    );

    expect(repo.moveSessionTimelineSessionAtomic).toHaveBeenCalledWith(
      123,
      101,
      4,
      new Date('2026-04-07T08:00:00.000Z'),
      new Date('2026-04-07T08:30:00.000Z'),
      new Date('2026-04-08T09:00:00.000Z'),
      new Date('2026-04-08T09:30:00.000Z'),
      1800,
      'UTC',
    );
    expect(result.startedAt).toBe('2026-04-08T09:00:00.000Z');
    expect(result.endedAt).toBe('2026-04-08T09:30:00.000Z');
  });

  it('rejects session moves that overlap another session', async () => {
    const existing = {
      sessionId: 42,
      libraryId: 3,
      bookId: 77,
      bookTitle: 'Flow',
      bookFormat: 'PDF',
      startedAt: new Date('2026-04-07T10:00:00.000Z'),
      endedAt: new Date('2026-04-07T10:30:00.000Z'),
      durationSeconds: 1800,
    };
    const repo = {
      getSessionTimelineSessionById: vi.fn().mockResolvedValue(existing),
      moveSessionTimelineSessionAtomic: vi.fn().mockResolvedValue({
        updated: null,
        conflict: {
          sessionId: 88,
          startedAt: new Date('2026-04-07T10:10:00.000Z'),
          endedAt: new Date('2026-04-07T10:40:00.000Z'),
        },
      }),
    };

    const service = new UserStatisticsService(repo as any);
    await expect(
      service.updateSessionTimelineSession(
        { id: 123, isSuperuser: false } as any,
        42,
        {
          startedAt: '2026-04-07T10:05:00.000Z',
          endedAt: '2026-04-07T10:35:00.000Z',
        },
        { libraryIds: [3] },
      ),
    ).rejects.toThrow('overlaps with #88');
  });

  it('rejects session moves that change duration', async () => {
    const existing = {
      sessionId: 52,
      libraryId: 5,
      bookId: 90,
      bookTitle: 'Ultralearning',
      bookFormat: 'EPUB',
      startedAt: new Date('2026-04-07T10:00:00.000Z'),
      endedAt: new Date('2026-04-07T10:30:00.000Z'),
      durationSeconds: 1800,
    };

    const repo = {
      getSessionTimelineSessionById: vi.fn().mockResolvedValue(existing),
      moveSessionTimelineSessionAtomic: vi.fn(),
    };

    const service = new UserStatisticsService(repo as any);
    await expect(
      service.updateSessionTimelineSession(
        { id: 123, isSuperuser: false } as any,
        52,
        {
          startedAt: '2026-04-07T10:05:00.000Z',
          endedAt: '2026-04-07T10:36:00.000Z',
        },
        { libraryIds: [5] },
      ),
    ).rejects.toThrow('duration cannot change');
    expect(repo.moveSessionTimelineSessionAtomic).not.toHaveBeenCalled();
  });

  it('rejects invalid session timestamp payloads and missing sessions', async () => {
    const repo = {
      getSessionTimelineSessionById: vi.fn().mockResolvedValue(null),
      moveSessionTimelineSessionAtomic: vi.fn(),
    };

    const service = new UserStatisticsService(repo as any);
    await expect(
      service.updateSessionTimelineSession(
        { id: 123, isSuperuser: false } as any,
        52,
        {
          startedAt: 'not-a-date',
          endedAt: '2026-04-07T10:36:00.000Z',
        },
        { libraryIds: [5] },
      ),
    ).rejects.toThrow('Invalid session timestamps');

    await expect(
      service.updateSessionTimelineSession(
        { id: 123, isSuperuser: false } as any,
        52,
        {
          startedAt: '2026-04-07T10:36:00.000Z',
          endedAt: '2026-04-07T10:35:00.000Z',
        },
        { libraryIds: [5] },
      ),
    ).rejects.toThrow('must be after start time');

    await expect(
      service.updateSessionTimelineSession(
        { id: 123, isSuperuser: false } as any,
        52,
        {
          startedAt: '2026-04-07T10:00:00.000Z',
          endedAt: '2026-04-07T10:30:00.000Z',
        },
        { libraryIds: [5] },
      ),
    ).rejects.toThrow('Reading session not found');
  });

  it('rejects when atomic move reports missing updated row', async () => {
    const existing = {
      sessionId: 91,
      libraryId: 5,
      bookId: 90,
      bookTitle: 'Ultralearning',
      bookFormat: 'EPUB',
      startedAt: new Date('2026-04-07T10:00:00.000Z'),
      endedAt: new Date('2026-04-07T10:30:00.000Z'),
      durationSeconds: 1800,
    };
    const repo = {
      getSessionTimelineSessionById: vi.fn().mockResolvedValue(existing),
      moveSessionTimelineSessionAtomic: vi.fn().mockResolvedValue({
        updated: null,
        conflict: null,
      }),
    };

    const service = new UserStatisticsService(repo as any);
    await expect(
      service.updateSessionTimelineSession(
        { id: 123, isSuperuser: false } as any,
        91,
        {
          startedAt: '2026-04-08T10:00:00.000Z',
          endedAt: '2026-04-08T10:30:00.000Z',
        },
        { libraryIds: [5] },
      ),
    ).rejects.toThrow('Reading session not found');
  });

  it('rounds progress deltas in daily reading and returns empty latency stats when no data', async () => {
    const repo = {
      getDailyReadingStats: vi.fn().mockResolvedValue([{ day: '2026-04-08', readingSeconds: 10, progressDelta: 1.234567, eventsCount: 1 }]),
      getCompletionLatencyDays: vi.fn().mockResolvedValue([]),
    };
    const service = new UserStatisticsService(repo as any);

    await expect(service.getDailyReading({ id: 11, isSuperuser: false } as any, { days: 1, libraryIds: [] })).resolves.toEqual([
      { day: '2026-04-08', readingSeconds: 10, progressDelta: 1.2346, eventsCount: 1 },
    ]);
    await expect(service.getCompletionLatency({ id: 11, isSuperuser: false } as any, { days: 30, libraryIds: [] })).resolves.toEqual(
      expect.objectContaining({
        totalCompletions: 0,
        medianDays: null,
        percentile75Days: null,
        percentile90Days: null,
      }),
    );
  });

  it('computes reading survival percentages and completion race trajectories', async () => {
    const repo = {
      getReadingSurvivalMaxProgress: vi.fn().mockResolvedValue([100, 65, 30]),
      getCompletionRaceRawSessions: vi.fn().mockResolvedValue([
        {
          bookId: 1,
          title: 'A Very Long Book Title That Should Be Truncated For The Chart',
          startedAt: new Date('2026-04-01T00:00:00.000Z'),
          endProgress: 5.25,
        },
        {
          bookId: 1,
          title: 'A Very Long Book Title That Should Be Truncated For The Chart',
          startedAt: new Date('2026-04-03T00:00:00.000Z'),
          endProgress: 45.51,
        },
        { bookId: 2, title: 'Single Session', startedAt: new Date('2026-04-02T00:00:00.000Z'), endProgress: 90 },
      ]),
    };
    const service = new UserStatisticsService(repo as any);

    const survival = await service.getReadingSurvival({ id: 11, isSuperuser: false } as any, { days: 365, libraryIds: [] });
    expect(survival.find((point) => point.threshold === 50)).toEqual({
      threshold: 50,
      survivedCount: 2,
      survivedPct: 66.7,
    });

    const race = await service.getCompletionRace({ id: 11, isSuperuser: false } as any, { days: 365, libraryIds: [] });
    expect(race).toHaveLength(1);
    expect(race[0]).toEqual({
      bookId: 1,
      title: 'A Very Long Book Title That Should Be...',
      points: [
        { daysSinceStart: 0, progress: 5.3 },
        { daysSinceStart: 2, progress: 45.5 },
      ],
    });
  });

  it('delegates and caches archetype/genre/pace/chord queries', async () => {
    const repo = {
      getSessionArchetypePoints: vi.fn().mockResolvedValue([{ hour: 9, durationMinutes: 20, dayOfWeek: 2 }]),
      getGenreReadingTime: vi.fn().mockResolvedValue([
        { genre: 'Sci-Fi', source: 'web', readingSeconds: 200 },
        { genre: 'Sci-Fi', source: 'kobo', readingSeconds: 100 },
      ]),
      getReadingPacePoints: vi.fn().mockResolvedValue([{ durationSeconds: 240, progressDelta: 1.4, bucket: 'bookorbit', format: 'EPUB' }]),
      getAuthorGenreChord: vi.fn().mockResolvedValue({ nodes: [{ name: 'A' }, { name: 'G' }], links: [{ source: 'A', target: 'G', value: 10 }] }),
    };
    const service = new UserStatisticsService(repo as any);
    const user = { id: 9, isSuperuser: false } as any;

    await expect(service.getSessionArchetypes(user, { libraryIds: [1] })).resolves.toEqual([{ hour: 9, durationMinutes: 20, dayOfWeek: 2 }]);
    await expect(service.getGenreReadingTime(user, { libraryIds: [1] })).resolves.toEqual([
      { genre: 'Sci-Fi', readingSeconds: 300, bySource: { bookorbit: 200, koreader: 0, kobo: 100 } },
    ]);
    await expect(service.getReadingPace(user, { libraryIds: [1] })).resolves.toEqual([
      { durationSeconds: 240, progressDelta: 1.4, bucket: 'bookorbit', format: 'EPUB' },
    ]);
    await expect(service.getAuthorGenreChord(user, { libraryIds: [1] })).resolves.toEqual({
      nodes: [{ name: 'A' }, { name: 'G' }],
      links: [{ source: 'A', target: 'G', value: 10 }],
    });

    await service.getSessionArchetypes(user, { libraryIds: [1] });
    await service.getGenreReadingTime(user, { libraryIds: [1] });
    await service.getReadingPace(user, { libraryIds: [1] });
    await service.getAuthorGenreChord(user, { libraryIds: [1] });

    expect(repo.getSessionArchetypePoints).toHaveBeenCalledTimes(1);
    expect(repo.getGenreReadingTime).toHaveBeenCalledTimes(1);
    expect(repo.getReadingPacePoints).toHaveBeenCalledTimes(1);
    expect(repo.getAuthorGenreChord).toHaveBeenCalledTimes(1);
  });

  it('updateSessionTimelineSession clears only the requesting user cache, not other users', async () => {
    const existing = {
      sessionId: 1,
      libraryId: 1,
      bookId: 1,
      bookTitle: 'Book',
      bookFormat: 'EPUB',
      startedAt: new Date('2026-04-07T08:00:00.000Z'),
      endedAt: new Date('2026-04-07T08:30:00.000Z'),
      durationSeconds: 1800,
    };
    const updated = {
      ...existing,
      startedAt: new Date('2026-04-08T09:00:00.000Z'),
      endedAt: new Date('2026-04-08T09:30:00.000Z'),
    };
    const repo = {
      getProgressFunnelInRange: vi.fn().mockResolvedValue({ started: 5, reached25: 4, reached50: 3, reached75: 2, completed: 1 }),
      getSessionTimelineSessionById: vi.fn().mockResolvedValue(existing),
      moveSessionTimelineSessionAtomic: vi.fn().mockResolvedValue({ updated, conflict: null }),
    };
    const service = new UserStatisticsService(repo as any);
    const userA = { id: 10, isSuperuser: false } as any;
    const userB = { id: 20, isSuperuser: false } as any;
    const query = { libraryIds: [1] };

    await service.getProgressFunnel(userA, query);
    await service.getProgressFunnel(userB, query);
    expect(repo.getProgressFunnelInRange).toHaveBeenCalledTimes(2);

    await service.updateSessionTimelineSession(
      userA,
      1,
      { startedAt: '2026-04-08T09:00:00.000Z', endedAt: '2026-04-08T09:30:00.000Z' },
      { libraryIds: [1] },
    );

    await service.getProgressFunnel(userA, query);
    expect(repo.getProgressFunnelInRange).toHaveBeenCalledTimes(3);

    await service.getProgressFunnel(userB, query);
    expect(repo.getProgressFunnelInRange).toHaveBeenCalledTimes(3);
  });
});
