import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { ReadAloudActivityService } from './read-aloud-activity.service';
import { errorMessage } from './read-aloud-errors';
import { ReadAloudJobRepository } from './read-aloud-job.repository';
import { ReadAloudNotifier } from './read-aloud-notifier.service';
import { ReadAloudWorkerClientService } from './read-aloud-worker-client.service';
import { ReadAloudWorkspace } from './read-aloud-workspace.service';
import { READ_ALOUD_FAILED_WORK_TTL_MS, READ_ALOUD_MAX_ATTEMPTS, READ_ALOUD_REVIEW_REMINDER_BEFORE_MS } from './read-aloud.constants';

const RECOVERY_INTERVAL_MS = 60_000;
const SWEEP_INTERVAL_MS = 60 * 60_000;

/**
 * Housekeeping that no request triggers: jobs whose server died, reviews nobody finished, and work
 * folders nothing points at any more (deleted books, expired retry windows, crashed runs).
 */
@Injectable()
export class ReadAloudLifecycleService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReadAloudLifecycleService.name);
  private sweeping = false;

  constructor(
    private readonly jobs: ReadAloudJobRepository,
    private readonly workspace: ReadAloudWorkspace,
    private readonly worker: ReadAloudWorkerClientService,
    private readonly activity: ReadAloudActivityService,
    private readonly notifier: ReadAloudNotifier,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.workspace.ensureRoot().catch((error: unknown) => this.fail('ensure_root', error));
    await this.recoverExpiredJobs();
    void this.sweep();
  }

  @Interval(RECOVERY_INTERVAL_MS)
  async recoverExpiredJobs(): Promise<void> {
    try {
      const { cancelledIds, requeuedIds, failed } = await this.jobs.recoverExpiredLeases(
        READ_ALOUD_MAX_ATTEMPTS,
        new Date(Date.now() + READ_ALOUD_FAILED_WORK_TTL_MS),
      );
      for (const jobId of cancelledIds) {
        // Nothing was polling these, so the worker may still be running one of them.
        await this.worker.cancel(jobId).catch(() => undefined);
        await this.workspace.remove(jobId);
        await this.activity.record(jobId, 'info', null, 'cancelled', 'Cancelled after the server restarted');
      }
      for (const row of failed) {
        await this.worker.cancel(row.id).catch(() => undefined);
        await this.activity.record(row.id, 'error', null, 'unknown', 'The server stopped during this job too many times');
        await this.notifier.pushUpdate(row);
        await this.notifier.notify(row, 'failed');
      }
      for (const jobId of requeuedIds) {
        await this.activity.record(jobId, 'warn', 'queued', 'recovered', 'The server restarted during this job; it will resume');
      }
      if (cancelledIds.length + failed.length + requeuedIds.length > 0) {
        this.logger.warn(
          `[read_aloud.jobs_recover] [end] cancelled=${cancelledIds.length} failed=${failed.length} requeued=${requeuedIds.length} - expired read-aloud jobs recovered`,
        );
      }
    } catch (error) {
      this.fail('recover', error);
    }
  }

  @Interval(SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    const startedAt = Date.now();
    try {
      const now = new Date();
      const reminded = await this.remindReviews(now);
      const expired = await this.expireReviews(now);
      await this.jobs.clearExpiredWorkWindows(now);
      const removed = await this.removeOrphanFolders(now);
      if (reminded + expired + removed > 0) {
        this.logger.log(
          `[read_aloud.sweep] [end] reminded=${reminded} expired=${expired} foldersRemoved=${removed} durationMs=${Date.now() - startedAt} - read-aloud housekeeping finished`,
        );
      }
    } catch (error) {
      this.fail('sweep', error);
    } finally {
      this.sweeping = false;
    }
  }

  private async remindReviews(now: Date): Promise<number> {
    const due = await this.jobs.findReviewsToRemind(now, READ_ALOUD_REVIEW_REMINDER_BEFORE_MS);
    for (const row of due) {
      await this.jobs.markReminded(row.id);
      await this.activity.record(row.id, 'info', 'awaiting_review', 'review_reminder_sent');
      await this.notifier.notify(row, 'review_expiring');
    }
    return due.length;
  }

  private async expireReviews(now: Date): Promise<number> {
    const expired = await this.jobs.expireReviews(now);
    for (const row of expired) {
      await this.workspace.remove(row.id);
      await this.activity.record(row.id, 'warn', null, 'review_expired', 'Discarded after waiting 14 days for review');
      await this.notifier.pushUpdate(row);
    }
    return expired.length;
  }

  private async removeOrphanFolders(now: Date): Promise<number> {
    const keep = await this.jobs.findJobIdsKeepingWork(now);
    let removed = 0;
    for (const jobId of await this.workspace.listJobIds()) {
      if (keep.has(jobId)) continue;
      await this.workspace.remove(jobId);
      removed++;
    }
    return removed;
  }

  private fail(action: string, error: unknown): void {
    this.logger.warn(
      `[read_aloud.lifecycle] [fail] action=${action} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(errorMessage(error))}" - read-aloud housekeeping failed`,
    );
  }
}
