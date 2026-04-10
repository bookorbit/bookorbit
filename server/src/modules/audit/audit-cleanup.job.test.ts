import { AuditCleanupJob } from './audit-cleanup.job';

describe('AuditCleanupJob', () => {
  it('runs retention cleanup through audit service', async () => {
    const auditService = {
      runRetentionCleanup: vi.fn().mockResolvedValue(undefined),
    };
    const job = new AuditCleanupJob(auditService as never);

    await job.runCleanup();

    expect(auditService.runRetentionCleanup).toHaveBeenCalledTimes(1);
  });

  it('swallows thrown errors from service cleanup', async () => {
    const auditService = {
      runRetentionCleanup: vi.fn().mockRejectedValue(new Error('cleanup failed')),
    };
    const job = new AuditCleanupJob(auditService as never);

    await expect(job.runCleanup()).resolves.toBeUndefined();
    expect(auditService.runRetentionCleanup).toHaveBeenCalledTimes(1);
  });
});
