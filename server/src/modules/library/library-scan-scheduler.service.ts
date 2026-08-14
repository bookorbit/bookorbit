import { ConflictException, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { ScannerService } from '../scanner/scanner.service';
import { LibraryRepository } from './library.repository';

const LIBRARY_SCAN_JOB_PREFIX = 'library-auto-scan:';

@Injectable()
export class LibraryScanSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LibraryScanSchedulerService.name);
  private readonly registeredJobNames = new Set<string>();
  private readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  constructor(
    private readonly libraryRepo: LibraryRepository,
    private readonly scannerService: ScannerService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const event = 'library.auto_scan.bootstrap';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] - scheduled scan registration started`);

    try {
      const schedules = await this.libraryRepo.findAutoScanSchedules();
      let registeredCount = 0;
      let failedCount = 0;

      for (const schedule of schedules) {
        if (this.syncSchedule(schedule.id, schedule.autoScanCronExpression)) registeredCount++;
        else failedCount++;
      }

      this.logger.log(
        `[${event}] [end] durationMs=${Date.now() - startedAt} scheduleCount=${schedules.length} registeredCount=${registeredCount} failedCount=${failedCount} - scheduled scan registration completed`,
      );
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.error(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - scheduled scan registration failed`,
      );
      throw err;
    }
  }

  onModuleDestroy(): void {
    for (const jobName of this.registeredJobNames) {
      if (this.schedulerRegistry.doesExist('cron', jobName)) this.schedulerRegistry.deleteCronJob(jobName);
    }
    this.registeredJobNames.clear();
  }

  syncSchedule(libraryId: number, expression: string | null): boolean {
    const event = 'library.auto_scan.schedule';
    const startedAt = Date.now();
    const jobName = this.getJobName(libraryId);

    try {
      if (expression === null) {
        if (this.deleteJob(jobName)) {
          this.logger.log(`[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} enabled=false - scheduled scan disabled`);
        }
        return true;
      }

      const job = CronJob.from({
        cronTime: expression,
        onTick: () => this.runScheduledScan(libraryId),
        start: false,
      });

      this.deleteJob(jobName);
      this.schedulerRegistry.addCronJob(jobName, job);
      this.registeredJobNames.add(jobName);
      job.start();

      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} enabled=true timeZone=${this.timeZone} nextRunAt=${job.nextDate().toISO()} - scheduled scan registered`,
      );
      return true;
    } catch (err) {
      this.deleteJob(jobName);
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.error(
        `[${event}] [fail] libraryId=${libraryId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - scheduled scan registration failed`,
      );
      return false;
    }
  }

  removeSchedule(libraryId: number): void {
    this.deleteJob(this.getJobName(libraryId));
  }

  private async runScheduledScan(libraryId: number): Promise<void> {
    const event = 'library.auto_scan.run';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] libraryId=${libraryId} - scheduled scan started`);

    try {
      const { jobId } = await this.scannerService.startScan(libraryId, 'schedule');
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} outcome=accepted jobId=${jobId} - scheduled scan accepted`,
      );
    } catch (err) {
      if (err instanceof ConflictException) {
        this.logger.log(
          `[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} outcome=skipped reason=scan_in_progress - scheduled scan skipped`,
        );
        return;
      }

      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.error(
        `[${event}] [fail] libraryId=${libraryId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - scheduled scan failed`,
      );
    }
  }

  private deleteJob(jobName: string): boolean {
    const exists = this.schedulerRegistry.doesExist('cron', jobName);
    if (exists) this.schedulerRegistry.deleteCronJob(jobName);
    const tracked = this.registeredJobNames.delete(jobName);
    return exists || tracked;
  }

  private getJobName(libraryId: number): string {
    return `${LIBRARY_SCAN_JOB_PREFIX}${libraryId}`;
  }
}
