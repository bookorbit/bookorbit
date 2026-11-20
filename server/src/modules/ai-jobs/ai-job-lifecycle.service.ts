import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { AiJobRow } from '../../db/schema';
import { AiFeatureRegistry } from './ai-feature.registry';
import { AiJobActivityService } from './ai-job-activity.service';
import { AiJobNotifier } from './ai-job-notifier.service';
import { AiJobPauses } from './ai-job-pauses.service';
import { AiJobRepository } from './ai-job.repository';
import { AiJobStepRepository } from './ai-job-step.repository';
import {
  AI_JOBS_HOUSEKEEPING_INTERVAL_MS,
  AI_JOBS_MAX_ATTEMPTS,
  AI_JOBS_PROVIDER_DOWN_GIVE_UP_MS,
  AI_JOBS_RECOVERY_INTERVAL_MS,
  AI_JOBS_STEP_CACHE_TTL_MS,
  AI_JOBS_SWEEP_INTERVAL_MS,
} from './ai-jobs.constants';
import { AI_JOBS_PORTS, type AiJobsPorts } from './ai-jobs.ports';

/** Rows removed per statement, and statements per sweep, so one sweep never holds the table long. */
const SWEEP_BATCH = 5_000;
const SWEEP_ROUNDS = 20;

/** Paused jobs looked at per pass. */
const RESUME_BATCH = 200;

/**
 * Housekeeping no request triggers: jobs whose server stopped, paused jobs whose cause cleared, and
 * cached units nothing can use.
 */
@Injectable()
export class AiJobLifecycle implements OnApplicationBootstrap {
  private readonly logger = new Logger(AiJobLifecycle.name);
  private resuming = false;

  constructor(
    private readonly registry: AiFeatureRegistry,
    private readonly jobs: AiJobRepository,
    private readonly steps: AiJobStepRepository,
    private readonly pauses: AiJobPauses,
    private readonly activity: AiJobActivityService,
    private readonly notifier: AiJobNotifier,
    @Inject(AI_JOBS_PORTS) private readonly ports: AiJobsPorts,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.recoverExpired();
  }

  /** Jobs whose lease lapsed go back to the queue and resume from the step cache. */
  @Interval(AI_JOBS_RECOVERY_INTERVAL_MS)
  async recoverExpired(): Promise<void> {
    try {
      const { requeued, failed } = await this.jobs.recoverExpiredLeases(AI_JOBS_MAX_ATTEMPTS);
      for (const row of requeued) {
        await this.activity.record(row.id, 'warn', row.phase, 'recovered', { attempt: row.attempts });
      }
      for (const row of failed) {
        await this.activity.record(row.id, 'error', row.phase, 'failed', {
          reason: 'error',
          detail: `The server stopped during this job ${row.attempts} times`,
        });
        await this.ports.budget.release(row.id).catch(() => undefined);
        await this.notifier.notify(row, 'failed');
      }
      if (requeued.length + failed.length > 0) {
        this.logger.warn(`[ai_jobs.recover] [end] requeued=${requeued.length} failed=${failed.length} - AI jobs with a lapsed lease recovered`);
      }
    } catch (error) {
      this.fail('recover', error);
    }
  }

  /**
   * Paused jobs whose cause cleared go back to the queue: the switch on, a slot filled, a connection
   * passing again, budget left. Over-estimate waits for Continue, and a provider unreachable for a
   * day fails the job. Runs every minute; the AI connection may also call it when a connection, a
   * slot, the budget or a switch changes, so jobs resume without waiting.
   */
  @Interval(AI_JOBS_HOUSEKEEPING_INTERVAL_MS)
  async resumePaused(): Promise<void> {
    if (this.resuming) return;
    this.resuming = true;
    try {
      const giveUpBefore = Date.now() - AI_JOBS_PROVIDER_DOWN_GIVE_UP_MS;
      let resumed = 0;
      const features = this.registry.list().map((feature) => feature.id);
      for (const row of await this.jobs.listResumable(features, RESUME_BATCH)) {
        try {
          if (row.reason === 'provider-down' && row.pausedAt && row.pausedAt.getTime() <= giveUpBefore) {
            await this.giveUp(row);
            continue;
          }
          const feature = this.registry.get(row.feature);
          if (!feature || (await this.pauses.blocker(row, feature, false))) continue;
          if (await this.jobs.resumePaused(row.id)) {
            resumed++;
            await this.activity.record(row.id, 'info', null, 'resumed', { reason: row.reason, by: 'auto' });
          }
        } catch (error) {
          this.fail('resume', error, row.id);
        }
      }
      if (resumed > 0) this.logger.log(`[ai_jobs.resume] [end] resumed=${resumed} - paused AI jobs whose cause cleared resumed`);
    } catch (error) {
      this.fail('resume', error);
    } finally {
      this.resuming = false;
    }
  }

  private async giveUp(row: AiJobRow): Promise<void> {
    const failed = await this.jobs.failPaused(row.id, 'provider-down');
    if (!failed) return;
    await this.activity.record(row.id, 'error', null, 'failed', {
      reason: 'provider-down',
      detail: 'The provider stayed unreachable for 24 hours',
    });
    await this.ports.budget.release(row.id).catch(() => undefined);
    await this.notifier.notify(failed, 'failed');
  }

  /**
   * Cached units unused for 30 days that neither the subject's current artifact (same generation)
   * nor an unfinished job of the subject can use. A Rebuild leaves the old generation's units here
   * until then.
   */
  @Interval(AI_JOBS_SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    try {
      const before = new Date(Date.now() - AI_JOBS_STEP_CACHE_TTL_MS);
      let removed = 0;
      for (let round = 0; round < SWEEP_ROUNDS; round++) {
        const count = await this.steps.removeUnused(before, SWEEP_BATCH);
        removed += count;
        if (count < SWEEP_BATCH) break;
      }
      if (removed > 0) this.logger.log(`[ai_jobs.sweep] [end] removed=${removed} - unused AI step cache entries removed`);
    } catch (error) {
      this.fail('sweep', error);
    }
  }

  private fail(action: string, error: unknown, jobId?: string): void {
    this.logger.warn(
      `[ai_jobs.lifecycle] [fail] action=${action}${jobId ? ` jobId=${jobId}` : ''} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - AI jobs housekeeping failed`,
    );
  }
}
