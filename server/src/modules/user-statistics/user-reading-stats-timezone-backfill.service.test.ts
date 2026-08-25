import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserReadingStatsTimeZoneBackfillService } from './user-reading-stats-timezone-backfill.service';

describe('UserReadingStatsTimeZoneBackfillService', () => {
  const userStatistics = {
    listUserIdsWithReadingHistory: vi.fn(),
    getUserTimeZone: vi.fn(),
    rebuildDailyStatsForUser: vi.fn(),
  };
  const appSettings = {
    getValue: vi.fn(),
    setValue: vi.fn(),
  };
  let service: UserReadingStatsTimeZoneBackfillService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    appSettings.getValue.mockResolvedValue(null);
    appSettings.setValue.mockResolvedValue(undefined);
    userStatistics.rebuildDailyStatsForUser.mockResolvedValue({ deleted: 0, inserted: 0, libraries: 0 });
    userStatistics.getUserTimeZone.mockResolvedValue('UTC');
    service = new UserReadingStatsTimeZoneBackfillService(userStatistics as never, appSettings as never);
  });

  it('rebuilds every reader in their own timezone', async () => {
    userStatistics.listUserIdsWithReadingHistory.mockResolvedValue([5, 8]);
    userStatistics.getUserTimeZone.mockResolvedValueOnce('America/Halifax').mockResolvedValueOnce('UTC');

    await expect(service.run()).resolves.toEqual({ skipped: false, users: 2, failed: 0 });

    expect(userStatistics.rebuildDailyStatsForUser).toHaveBeenCalledWith(5, 'America/Halifax');
    expect(userStatistics.rebuildDailyStatsForUser).toHaveBeenCalledWith(8, 'UTC');
  });

  it('reads each timezone at the moment of rebuilding, not from the roster it started with', async () => {
    userStatistics.listUserIdsWithReadingHistory.mockResolvedValue([5]);
    // The user corrects their own timezone while the pass is walking the roster.
    userStatistics.getUserTimeZone.mockResolvedValue('America/Halifax');

    await service.run();

    const listOrder = userStatistics.listUserIdsWithReadingHistory.mock.invocationCallOrder[0];
    const readOrder = userStatistics.getUserTimeZone.mock.invocationCallOrder[0];
    expect(listOrder).toBeLessThan(readOrder);
    expect(userStatistics.rebuildDailyStatsForUser).toHaveBeenCalledWith(5, 'America/Halifax');
  });

  it('skips a reader deleted between the listing and the rebuild', async () => {
    userStatistics.listUserIdsWithReadingHistory.mockResolvedValue([5]);
    userStatistics.getUserTimeZone.mockResolvedValue(null);

    await expect(service.run()).resolves.toEqual({ skipped: false, users: 1, failed: 0 });
    expect(userStatistics.rebuildDailyStatsForUser).not.toHaveBeenCalled();
  });

  it('records the repair so a restart does not redo it', async () => {
    userStatistics.listUserIdsWithReadingHistory.mockResolvedValue([5]);

    await service.run();

    expect(appSettings.setValue).toHaveBeenCalledWith('reading_stats_timezone_backfill_v1', expect.any(String));
  });

  it('does nothing on a later start, without listing readers at all', async () => {
    appSettings.getValue.mockResolvedValue('2026-08-25T00:00:00.000Z');

    await expect(service.run()).resolves.toEqual({ skipped: true, users: 0, failed: 0 });

    expect(userStatistics.listUserIdsWithReadingHistory).not.toHaveBeenCalled();
    expect(userStatistics.rebuildDailyStatsForUser).not.toHaveBeenCalled();
  });

  it('finishes the remaining readers when one of them fails', async () => {
    userStatistics.listUserIdsWithReadingHistory.mockResolvedValue([5, 8, 9]);
    userStatistics.rebuildDailyStatsForUser.mockRejectedValueOnce(new Error('deadlock detected'));

    await expect(service.run()).resolves.toEqual({ skipped: false, users: 3, failed: 1 });

    expect(userStatistics.rebuildDailyStatsForUser).toHaveBeenCalledTimes(3);
  });

  it('leaves a partial repair unrecorded, so the next start retries it', async () => {
    userStatistics.listUserIdsWithReadingHistory.mockResolvedValue([5]);
    userStatistics.rebuildDailyStatsForUser.mockRejectedValue(new Error('deadlock detected'));

    await service.run();

    expect(appSettings.setValue).not.toHaveBeenCalled();
  });

  it('does not delay startup or crash it when the pass fails outright', async () => {
    userStatistics.listUserIdsWithReadingHistory.mockRejectedValue(new Error('database unavailable'));

    expect(service.onApplicationBootstrap()).toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));

    expect(appSettings.setValue).not.toHaveBeenCalled();
  });

  it('measures a failed pass from when it started, not from when it failed', async () => {
    // The clock has to be read before run() is handed to catch(), or the failure log reports the
    // moment it failed minus itself and every outright failure looks instant.
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    userStatistics.listUserIdsWithReadingHistory.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      throw new Error('database unavailable');
    });

    service.onApplicationBootstrap();
    await new Promise((resolve) => setTimeout(resolve, 80));

    const message = String(error.mock.calls.at(-1)?.[0] ?? '');
    expect(message).toContain('[fail]');
    expect(Number(/durationMs=(\d+)/.exec(message)?.[1] ?? -1)).toBeGreaterThanOrEqual(20);
  });
});
