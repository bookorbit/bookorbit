import { Logger } from '@nestjs/common';

import { UserStatisticsAggregationJob } from './user-statistics-aggregation.job';

describe('UserStatisticsAggregationJob', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('recomputes on bootstrap and logs when rows changed', async () => {
    const service = {
      recomputeRecentDailyStats: vi.fn().mockResolvedValue({
        deleted: 2,
        inserted: 3,
        since: '2026-04-09',
      }),
    };
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const job = new UserStatisticsAggregationJob(service as never);
    await job.onApplicationBootstrap();

    expect(service.recomputeRecentDailyStats).toHaveBeenCalledWith(2);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('deleted=2, inserted=3'));
  });

  it('runs hourly without chatty logs when no rows changed', async () => {
    const service = {
      recomputeRecentDailyStats: vi.fn().mockResolvedValue({
        deleted: 0,
        inserted: 0,
        since: '2026-04-09',
      }),
    };
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const job = new UserStatisticsAggregationJob(service as never);
    await job.runHourlyAggregation();

    expect(service.recomputeRecentDailyStats).toHaveBeenCalledWith(2);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs failures with root cause details', async () => {
    const service = {
      recomputeRecentDailyStats: vi.fn().mockRejectedValue(new Error('aggregation failed', { cause: new Error('db timeout') })),
    };
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const job = new UserStatisticsAggregationJob(service as never);
    await job.runHourlyAggregation();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('db timeout'), expect.any(String));
  });
});
