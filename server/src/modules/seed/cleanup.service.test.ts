import { Logger } from '@nestjs/common';

import * as schema from '../../db/schema';
import { CleanupService } from './cleanup.service';

function makeDb(options?: {
  refreshDeleteResult?: { rowCount?: number };
  resetDeleteResult?: { rowCount?: number };
  oidcDeleteResult?: { rowCount?: number };
  notificationDeleteResult?: { rowCount?: number };
  authStateTablesPresent?: boolean;
  notificationsTablePresent?: boolean;
}) {
  const refreshDeleteBuilder = {
    where: vi.fn().mockResolvedValue(options?.refreshDeleteResult ?? { rowCount: 2 }),
  };
  const resetDeleteBuilder = {
    where: vi.fn().mockResolvedValue(options?.resetDeleteResult ?? { rowCount: 1 }),
  };
  const oidcDeleteBuilder = {
    where: vi.fn().mockResolvedValue(options?.oidcDeleteResult ?? { rowCount: 3 }),
  };
  const notificationDeleteBuilder = {
    where: vi.fn().mockResolvedValue(options?.notificationDeleteResult ?? { rowCount: 5 }),
  };

  const authTablesResult = {
    rows:
      (options?.authStateTablesPresent ?? true)
        ? [{ table_name: 'refresh_tokens' }, { table_name: 'password_reset_tokens' }, { table_name: 'oidc_sessions' }]
        : [],
  };
  const notificationsTableResult = {
    rows: (options?.notificationsTablePresent ?? true) ? [{ table_name: 'notifications' }] : [],
  };

  return {
    execute: vi.fn().mockResolvedValueOnce(authTablesResult).mockResolvedValueOnce(notificationsTableResult),
    delete: vi
      .fn()
      .mockReturnValueOnce(refreshDeleteBuilder)
      .mockReturnValueOnce(resetDeleteBuilder)
      .mockReturnValueOnce(oidcDeleteBuilder)
      .mockReturnValueOnce(notificationDeleteBuilder),
    __refreshDeleteBuilder: refreshDeleteBuilder,
    __resetDeleteBuilder: resetDeleteBuilder,
    __oidcDeleteBuilder: oidcDeleteBuilder,
    __notificationDeleteBuilder: notificationDeleteBuilder,
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

  it('deletes expired or invalid auth state from all three tables and logs completion', async () => {
    const db = makeDb();
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const service = new CleanupService(db as never);

    await service.cleanup();

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.delete).toHaveBeenNthCalledWith(1, schema.refreshTokens);
    expect(db.delete).toHaveBeenNthCalledWith(2, schema.passwordResetTokens);
    expect(db.delete).toHaveBeenNthCalledWith(3, schema.oidcSessions);
    expect(db.delete).toHaveBeenNthCalledWith(4, schema.notifications);
    expect(db.__refreshDeleteBuilder.where).toHaveBeenCalledTimes(1);
    expect(db.__resetDeleteBuilder.where).toHaveBeenCalledTimes(1);
    expect(db.__oidcDeleteBuilder.where).toHaveBeenCalledTimes(1);
    expect(db.__notificationDeleteBuilder.where).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[seed.cleanup_auth_state] [start]'));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[seed.cleanup_auth_state] [end] refreshDeleted=2 resetDeleted=1 oidcDeleted=3 notificationsDeleted=5'),
    );
  });

  it('skips cleanup when auth state tables are missing', async () => {
    const db = makeDb({ authStateTablesPresent: false });
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const service = new CleanupService(db as never);

    await service.cleanup();

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.delete).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[seed.cleanup_auth_state] [end] skipped=true reason=auth_tables_missing'));
  });

  it('logs failure and rethrows on cleanup errors', async () => {
    const db = makeDb();
    const err = new Error('delete failed');
    db.__refreshDeleteBuilder.where.mockRejectedValue(err);
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = new CleanupService(db as never);

    await expect(service.cleanup()).rejects.toThrow('delete failed');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[seed.cleanup_auth_state] [fail]'));
  });
});
