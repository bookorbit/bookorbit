import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { JobChangesService } from '../jobs/job-changes.service';
import { ScannerRepository } from './scanner.repository';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SCAN_JOB_RETENTION_MS = 90 * DAY_MS;
export const SCAN_JOB_SWEEP_BATCH_SIZE = 1_000;
/** Bounds one run; a larger backlog drains over the following runs. */
export const SCAN_JOB_SWEEP_MAX_BATCHES = 50;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Removes finished scans older than the retention, off the request path. A custom schedule can scan
 * a library every minute, so without this the scan history grows without bound.
 */
@Injectable()
export class ScanJobHousekeepingService {
  private readonly logger = new Logger(ScanJobHousekeepingService.name);
  private sweeping = false;

  constructor(
    private readonly scans: ScannerRepository,
    private readonly jobChanges: JobChangesService,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    const startedAt = Date.now();
    const before = new Date(startedAt - SCAN_JOB_RETENTION_MS);
    let removed = 0;
    let batches = 0;
    try {
      while (batches < SCAN_JOB_SWEEP_MAX_BATCHES) {
        const deleted = await this.scans.deleteFinishedScanJobsBefore(before, SCAN_JOB_SWEEP_BATCH_SIZE);
        batches++;
        removed += deleted;
        if (deleted < SCAN_JOB_SWEEP_BATCH_SIZE) break;
      }
      if (removed > 0) {
        this.logger.log(
          `[scanner.scan_job_sweep] [end] removed=${removed} batches=${batches} durationMs=${Date.now() - startedAt} - old scan jobs removed`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `[scanner.scan_job_sweep] [fail] removed=${removed} batches=${batches} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - old scan jobs not removed`,
      );
    } finally {
      this.sweeping = false;
    }
    if (removed > 0) this.jobChanges.notify({ type: 'library-scan', ownerId: null, state: true });
    return removed;
  }
}
