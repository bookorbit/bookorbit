import { Logger } from '@nestjs/common';

import { KoreaderSyncEstimateCleanupService } from './koreader-sync-estimate-cleanup.service';

describe('KoreaderSyncEstimateCleanupService', () => {
  const readingSessions = { deleteLegacyKoreaderSyncEstimatesBatch: vi.fn() };
  const appSettings = { getValue: vi.fn(), setValue: vi.fn() };
  let service: KoreaderSyncEstimateCleanupService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    appSettings.getValue.mockResolvedValue(null);
    appSettings.setValue.mockResolvedValue(undefined);
    service = new KoreaderSyncEstimateCleanupService(readingSessions as never, appSettings as never);
  });

  it('deletes every bounded batch before recording completion', async () => {
    readingSessions.deleteLegacyKoreaderSyncEstimatesBatch.mockResolvedValueOnce({ deleted: 500 }).mockResolvedValueOnce({ deleted: 3 });

    await expect(service.run()).resolves.toEqual({ skipped: false, deleted: 503 });

    expect(readingSessions.deleteLegacyKoreaderSyncEstimatesBatch).toHaveBeenNthCalledWith(1, 500);
    expect(readingSessions.deleteLegacyKoreaderSyncEstimatesBatch).toHaveBeenNthCalledWith(2, 500);
    expect(appSettings.setValue).toHaveBeenCalledWith('koreader_sync_estimate_cleanup_v1', expect.any(String));
  });

  it('does not repeat a completed cleanup', async () => {
    appSettings.getValue.mockResolvedValue('2026-08-31T00:00:00.000Z');

    await expect(service.run()).resolves.toEqual({ skipped: true, deleted: 0 });

    expect(readingSessions.deleteLegacyKoreaderSyncEstimatesBatch).not.toHaveBeenCalled();
    expect(appSettings.setValue).not.toHaveBeenCalled();
  });

  it('leaves completion unrecorded when a batch fails so startup can retry', async () => {
    readingSessions.deleteLegacyKoreaderSyncEstimatesBatch
      .mockResolvedValueOnce({ deleted: 500 })
      .mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.run()).rejects.toThrow('database unavailable');

    expect(readingSessions.deleteLegacyKoreaderSyncEstimatesBatch).toHaveBeenCalledTimes(2);
    expect(appSettings.setValue).not.toHaveBeenCalled();
  });

  it('runs detached without failing application bootstrap', async () => {
    readingSessions.deleteLegacyKoreaderSyncEstimatesBatch.mockRejectedValue(new Error('database unavailable'));

    expect(service.onApplicationBootstrap()).toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));

    expect(appSettings.setValue).not.toHaveBeenCalled();
  });
});
