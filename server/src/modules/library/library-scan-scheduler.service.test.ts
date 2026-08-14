import { ConflictException, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { LibraryScanSchedulerService } from './library-scan-scheduler.service';

describe('LibraryScanSchedulerService', () => {
  const libraryRepo = {
    findAutoScanSchedules: vi.fn(),
  };
  const scannerService = {
    startScan: vi.fn(),
  };

  let schedulerRegistry: SchedulerRegistry;
  let service: LibraryScanSchedulerService;

  beforeEach(() => {
    vi.resetAllMocks();
    schedulerRegistry = new SchedulerRegistry();
    service = new LibraryScanSchedulerService(libraryRepo as never, scannerService as never, schedulerRegistry);
  });

  afterEach(() => {
    service.onModuleDestroy();
    vi.restoreAllMocks();
  });

  it('registers persisted schedules on bootstrap while isolating invalid expressions', async () => {
    libraryRepo.findAutoScanSchedules.mockResolvedValue([
      { id: 4, autoScanCronExpression: '0 4 * * *' },
      { id: 5, autoScanCronExpression: 'not a cron' },
    ]);
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await service.onApplicationBootstrap();

    expect(schedulerRegistry.doesExist('cron', 'library-auto-scan:4')).toBe(true);
    expect(schedulerRegistry.doesExist('cron', 'library-auto-scan:5')).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('scheduleCount=2 registeredCount=1 failedCount=1'));
  });

  it('starts a scan with the schedule trigger when a registered job fires', async () => {
    scannerService.startScan.mockResolvedValue({ jobId: 91 });
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    expect(service.syncSchedule(7, '0 4 * * *')).toBe(true);
    const job = schedulerRegistry.getCronJob('library-auto-scan:7');
    expect(job.nextDate().zoneName).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    await job.fireOnTick();

    expect(scannerService.startScan).toHaveBeenCalledWith(7, 'schedule');
  });

  it('replaces an existing job and removes it when the schedule is disabled', () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    service.syncSchedule(8, '0 4 * * *');
    const originalJob = schedulerRegistry.getCronJob('library-auto-scan:8');

    service.syncSchedule(8, '0 6 * * *');

    expect(originalJob.isActive).toBe(false);
    expect(schedulerRegistry.getCronJob('library-auto-scan:8')).not.toBe(originalJob);

    service.syncSchedule(8, null);

    expect(schedulerRegistry.doesExist('cron', 'library-auto-scan:8')).toBe(false);
  });

  it('skips an occurrence when another scan is already running', async () => {
    scannerService.startScan.mockRejectedValue(new ConflictException('scan running'));
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    service.syncSchedule(9, '0 4 * * *');
    await schedulerRegistry.getCronJob('library-auto-scan:9').fireOnTick();

    expect(scannerService.startScan).toHaveBeenCalledWith(9, 'schedule');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('outcome=skipped reason=scan_in_progress'));
  });

  it('logs and contains scan failures so future occurrences remain registered', async () => {
    scannerService.startScan.mockRejectedValue(new Error('database\nunavailable'));
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    service.syncSchedule(10, '0 4 * * *');
    await schedulerRegistry.getCronJob('library-auto-scan:10').fireOnTick();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('error="database unavailable"'));
    expect(schedulerRegistry.doesExist('cron', 'library-auto-scan:10')).toBe(true);
  });

  it('fails bootstrap when schedules cannot be loaded', async () => {
    libraryRepo.findAutoScanSchedules.mockRejectedValue(new Error('database unavailable'));
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(service.onApplicationBootstrap()).rejects.toThrow('database unavailable');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[library.auto_scan.bootstrap] [fail]'));
  });

  it('unregisters jobs when the module is destroyed', () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    service.syncSchedule(11, '0 4 * * *');
    service.syncSchedule(12, '0 6 * * *');

    service.onModuleDestroy();

    expect(schedulerRegistry.doesExist('cron', 'library-auto-scan:11')).toBe(false);
    expect(schedulerRegistry.doesExist('cron', 'library-auto-scan:12')).toBe(false);
  });
});
