import { APP_SETTING_KEYS } from '../../common/constants/app-settings.constants';
import { AuditLabelBackfillService } from './audit-label-backfill.service';

function makeService(flag: string | null = null) {
  const auditRepository = { backfillTargetLabels: vi.fn().mockResolvedValue({ fromLive: 12, fromHistory: 3 }) };
  const appSettings = { getValue: vi.fn().mockResolvedValue(flag), setValue: vi.fn().mockResolvedValue(undefined) };
  const service = new AuditLabelBackfillService(auditRepository as never, appSettings as never);
  const logger = (service as unknown as { logger: { log: (m: string) => void; warn: (m: string) => void } }).logger;
  return {
    service,
    auditRepository,
    appSettings,
    log: vi.spyOn(logger, 'log').mockImplementation(() => undefined),
    warn: vi.spyOn(logger, 'warn').mockImplementation(() => undefined),
  };
}

describe('AuditLabelBackfillService', () => {
  it('names old rows once and records that it finished', async () => {
    const { service, auditRepository, appSettings, log } = makeService();

    await service.onApplicationBootstrap();

    expect(auditRepository.backfillTargetLabels).toHaveBeenCalledTimes(1);
    expect(appSettings.setValue).toHaveBeenCalledWith(APP_SETTING_KEYS.AUDIT_TARGET_LABELS_BACKFILLED, expect.any(String));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('fromLive=12 fromHistory=3'));
  });

  it('does nothing once the flag is set', async () => {
    const { service, auditRepository, appSettings } = makeService('2026-10-16T00:00:00.000Z');

    await service.onApplicationBootstrap();

    expect(auditRepository.backfillTargetLabels).not.toHaveBeenCalled();
    expect(appSettings.setValue).not.toHaveBeenCalled();
  });

  it('logs a failure without blocking startup, and leaves the flag unset so the next boot retries', async () => {
    const { service, auditRepository, appSettings, warn } = makeService();
    auditRepository.backfillTargetLabels.mockRejectedValue(new Error('statement timeout'));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(appSettings.setValue).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[audit.label_backfill] [fail]'));
  });
});
