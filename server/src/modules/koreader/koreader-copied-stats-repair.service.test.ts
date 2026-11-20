import { Logger } from '@nestjs/common';

import { KoreaderCopiedStatsRepairService } from './koreader-copied-stats-repair.service';

describe('KoreaderCopiedStatsRepairService', () => {
  const pluginRepo = { repairCopiedStatsBatch: vi.fn() };
  const appSettings = { getValue: vi.fn(), setValue: vi.fn() };
  let service: KoreaderCopiedStatsRepairService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    appSettings.getValue.mockResolvedValue(null);
    appSettings.setValue.mockResolvedValue(undefined);
    service = new KoreaderCopiedStatsRepairService(pluginRepo as never, appSettings as never);
  });

  it('follows the cursor to the end before recording completion', async () => {
    pluginRepo.repairCopiedStatsBatch
      .mockResolvedValueOnce({ bookFiles: 2, removedSessions: 3, nextCursor: { userId: 7, bookFileId: 42 } })
      .mockResolvedValueOnce({ bookFiles: 1, removedSessions: 1, nextCursor: null });

    await expect(service.run()).resolves.toEqual({ skipped: false, bookFiles: 3, removedSessions: 4 });

    expect(pluginRepo.repairCopiedStatsBatch).toHaveBeenNthCalledWith(1, null, 200);
    expect(pluginRepo.repairCopiedStatsBatch).toHaveBeenNthCalledWith(2, { userId: 7, bookFileId: 42 }, 200);
    expect(appSettings.setValue).toHaveBeenCalledWith('koreader_copied_stats_repair_v1', expect.any(String));
  });

  it('records completion for an installation that has no copied events', async () => {
    pluginRepo.repairCopiedStatsBatch.mockResolvedValue({ bookFiles: 0, removedSessions: 0, nextCursor: null });

    await expect(service.run()).resolves.toEqual({ skipped: false, bookFiles: 0, removedSessions: 0 });

    expect(pluginRepo.repairCopiedStatsBatch).toHaveBeenCalledTimes(1);
    expect(appSettings.setValue).toHaveBeenCalledWith('koreader_copied_stats_repair_v1', expect.any(String));
  });

  it('does not repeat a completed repair', async () => {
    appSettings.getValue.mockResolvedValue('2026-11-17T00:00:00.000Z');

    await expect(service.run()).resolves.toEqual({ skipped: true, bookFiles: 0, removedSessions: 0 });

    expect(pluginRepo.repairCopiedStatsBatch).not.toHaveBeenCalled();
    expect(appSettings.setValue).not.toHaveBeenCalled();
  });

  it('leaves completion unrecorded when a batch fails so startup can retry', async () => {
    pluginRepo.repairCopiedStatsBatch
      .mockResolvedValueOnce({ bookFiles: 1, removedSessions: 1, nextCursor: { userId: 1, bookFileId: 1 } })
      .mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.run()).rejects.toThrow('database unavailable');

    expect(pluginRepo.repairCopiedStatsBatch).toHaveBeenCalledTimes(2);
    expect(appSettings.setValue).not.toHaveBeenCalled();
  });

  it('runs detached without failing application bootstrap', async () => {
    pluginRepo.repairCopiedStatsBatch.mockRejectedValue(new Error('database unavailable'));

    expect(service.onApplicationBootstrap()).toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));

    expect(appSettings.setValue).not.toHaveBeenCalled();
  });
});
