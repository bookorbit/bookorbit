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
    };

    const service = new UserStatisticsService(repo as any);
    const result = await service.getReadingHeatmap({ id: 123, isSuperuser: false } as any, { days: 3, libraryIds: [] });

    expect(repo.getDailyReadingStats).toHaveBeenCalledWith(123, false, [], 3);
    expect(result).toEqual([
      { day: '2026-04-06', readingSeconds: 120, progressDelta: 1.2346, eventsCount: 2 },
      { day: '2026-04-07', readingSeconds: 0, progressDelta: 0, eventsCount: 0 },
      { day: '2026-04-08', readingSeconds: 0, progressDelta: 0, eventsCount: 0 },
    ]);
  });

  it('returns all 24 hour buckets for peak reading hours', async () => {
    const repo = {
      getPeakReadingHours: vi.fn().mockResolvedValue([
        { hour: 8, readingSeconds: 600, eventsCount: 3 },
        { hour: 21, readingSeconds: 900, eventsCount: 4 },
      ]),
    };

    const service = new UserStatisticsService(repo as any);
    const result = await service.getPeakReadingHours({ id: 123, isSuperuser: false } as any, { libraryIds: [] });

    expect(repo.getPeakReadingHours).toHaveBeenCalledWith(123, false, [], 365);
    expect(result).toHaveLength(24);
    expect(result[8]).toEqual({ hour: 8, readingSeconds: 600, eventsCount: 3 });
    expect(result[21]).toEqual({ hour: 21, readingSeconds: 900, eventsCount: 4 });
    expect(result[0]).toEqual({ hour: 0, readingSeconds: 0, eventsCount: 0 });
  });

  it('returns all weekday buckets for favorite reading days', async () => {
    const repo = {
      getFavoriteReadingDays: vi.fn().mockResolvedValue([{ dayOfWeek: 1, readingSeconds: 1800, eventsCount: 6 }]),
    };

    const service = new UserStatisticsService(repo as any);
    const result = await service.getFavoriteReadingDays({ id: 123, isSuperuser: false } as any, { libraryIds: [] });

    expect(repo.getFavoriteReadingDays).toHaveBeenCalledWith(123, false, [], 365);
    expect(result).toHaveLength(7);
    expect(result[1]).toEqual({ dayOfWeek: 1, readingSeconds: 1800, eventsCount: 6 });
    expect(result[0]).toEqual({ dayOfWeek: 0, readingSeconds: 0, eventsCount: 0 });
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
      { label: '366d+', minDays: 366, maxDays: null, count: 1 },
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
});
