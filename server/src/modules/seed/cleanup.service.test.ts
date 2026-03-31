import { Logger } from '@nestjs/common';

import * as schema from '../../db/schema';
import { CleanupService } from './cleanup.service';

function makeDb(options?: { refreshDeleteResult?: { rowCount?: number }; resetDeleteResult?: { rowCount?: number } }) {
  const refreshDeleteBuilder = {
    where: vi.fn().mockResolvedValue(options?.refreshDeleteResult ?? { rowCount: 2 }),
  };
  const resetDeleteBuilder = {
    where: vi.fn().mockResolvedValue(options?.resetDeleteResult ?? { rowCount: 1 }),
  };

  return {
    delete: vi.fn().mockReturnValueOnce(refreshDeleteBuilder).mockReturnValueOnce(resetDeleteBuilder),
    __refreshDeleteBuilder: refreshDeleteBuilder,
    __resetDeleteBuilder: resetDeleteBuilder,
  };
}

describe('CleanupService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs cleanup on application bootstrap', async () => {
    const db = makeDb();
    const service = new CleanupService(db as never);
    const cleanupSpy = vi.spyOn(service, 'cleanup').mockResolvedValue(undefined);

    await service.onApplicationBootstrap();

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it('deletes expired or invalid tokens from both tables and logs completion', async () => {
    const db = makeDb();
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const service = new CleanupService(db as never);

    await service.cleanup();

    expect(db.delete).toHaveBeenNthCalledWith(1, schema.refreshTokens);
    expect(db.delete).toHaveBeenNthCalledWith(2, schema.passwordResetTokens);
    expect(db.__refreshDeleteBuilder.where).toHaveBeenCalledTimes(1);
    expect(db.__resetDeleteBuilder.where).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[seed.cleanup_tokens] [start]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[seed.cleanup_tokens] [end] refreshDeleted=2 resetDeleted=1'));
  });

  it('logs failure and rethrows on cleanup errors', async () => {
    const db = makeDb();
    const err = new Error('delete failed');
    db.__refreshDeleteBuilder.where.mockRejectedValue(err);
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = new CleanupService(db as never);

    await expect(service.cleanup()).rejects.toThrow('delete failed');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[seed.cleanup_tokens] [fail]'));
  });
});
