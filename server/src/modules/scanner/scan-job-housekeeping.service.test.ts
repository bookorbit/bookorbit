import { Logger } from '@nestjs/common';

import {
  SCAN_JOB_RETENTION_MS,
  SCAN_JOB_SWEEP_BATCH_SIZE,
  SCAN_JOB_SWEEP_MAX_BATCHES,
  ScanJobHousekeepingService,
} from './scan-job-housekeeping.service';

const NOW = Date.parse('2026-11-15T12:00:00.000Z');

function makeService(deleted: number[] | Error) {
  const scans = {
    deleteFinishedScanJobsBefore: vi.fn((): Promise<number> => Promise.resolve(0)),
  };
  if (deleted instanceof Error) scans.deleteFinishedScanJobsBefore.mockRejectedValue(deleted);
  else for (const count of deleted) scans.deleteFinishedScanJobsBefore.mockResolvedValueOnce(count);
  const jobChanges = { notify: vi.fn() };
  const service = new ScanJobHousekeepingService(scans as never, jobChanges as never);
  return { service, scans, jobChanges };
}

describe('ScanJobHousekeepingService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps 90 days of finished scans', () => {
    expect(SCAN_JOB_RETENTION_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it('deletes in batches until one comes back short, then tells the Jobs area once', async () => {
    const { service, scans, jobChanges } = makeService([SCAN_JOB_SWEEP_BATCH_SIZE, SCAN_JOB_SWEEP_BATCH_SIZE, 12]);

    await expect(service.sweep()).resolves.toBe(2 * SCAN_JOB_SWEEP_BATCH_SIZE + 12);

    expect(scans.deleteFinishedScanJobsBefore).toHaveBeenCalledTimes(3);
    expect(scans.deleteFinishedScanJobsBefore).toHaveBeenCalledWith(new Date(NOW - SCAN_JOB_RETENTION_MS), SCAN_JOB_SWEEP_BATCH_SIZE);
    expect(jobChanges.notify).toHaveBeenCalledTimes(1);
    expect(jobChanges.notify).toHaveBeenCalledWith({ type: 'library-scan', ownerId: null, state: true });
    expect(Logger.prototype.log).toHaveBeenCalledWith(expect.stringContaining('[scanner.scan_job_sweep] [end] removed=2012 batches=3'));
  });

  it('stays quiet when nothing is old enough', async () => {
    const { service, scans, jobChanges } = makeService([0]);

    await expect(service.sweep()).resolves.toBe(0);

    expect(scans.deleteFinishedScanJobsBefore).toHaveBeenCalledTimes(1);
    expect(jobChanges.notify).not.toHaveBeenCalled();
    expect(Logger.prototype.log).not.toHaveBeenCalled();
  });

  it('stops after the batch limit and leaves the rest to the next run', async () => {
    const { service, scans } = makeService(Array.from({ length: SCAN_JOB_SWEEP_MAX_BATCHES + 5 }, () => SCAN_JOB_SWEEP_BATCH_SIZE));

    await expect(service.sweep()).resolves.toBe(SCAN_JOB_SWEEP_MAX_BATCHES * SCAN_JOB_SWEEP_BATCH_SIZE);

    expect(scans.deleteFinishedScanJobsBefore).toHaveBeenCalledTimes(SCAN_JOB_SWEEP_MAX_BATCHES);
  });

  it('logs a failure without throwing, and still reports rows already removed', async () => {
    const { service, scans, jobChanges } = makeService([SCAN_JOB_SWEEP_BATCH_SIZE]);
    scans.deleteFinishedScanJobsBefore.mockRejectedValueOnce(new Error('connection reset'));

    await expect(service.sweep()).resolves.toBe(SCAN_JOB_SWEEP_BATCH_SIZE);

    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('[scanner.scan_job_sweep] [fail] removed=1000 batches=1'));
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('error="connection reset"'));
    expect(jobChanges.notify).toHaveBeenCalledTimes(1);
  });

  it('does not tell the Jobs area when the first batch fails', async () => {
    const { service, jobChanges } = makeService(new Error('connection reset'));

    await expect(service.sweep()).resolves.toBe(0);

    expect(jobChanges.notify).not.toHaveBeenCalled();
  });

  it('skips a run that starts while the previous one is still sweeping', async () => {
    const { service, scans } = makeService([]);
    let finish: (count: number) => void = () => undefined;
    scans.deleteFinishedScanJobsBefore.mockImplementationOnce(() => new Promise<number>((resolve) => (finish = resolve)));

    const first = service.sweep();
    await expect(service.sweep()).resolves.toBe(0);
    finish(3);

    await expect(first).resolves.toBe(3);
    expect(scans.deleteFinishedScanJobsBefore).toHaveBeenCalledTimes(1);
  });
});
