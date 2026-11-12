import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { AiJobRow } from '../../db/schema';
import { AiFeatureRegistry } from './ai-feature.registry';
import { AiJobActivityService } from './ai-job-activity.service';
import { AiJobNotifier } from './ai-job-notifier.service';
import { AiJobRepository } from './ai-job.repository';
import { AiJobRunner, type AiRunOutcome, type AiStepTiming } from './ai-job-runner.service';
import { AI_JOBS_DISPATCH_INTERVAL_MS, AI_JOBS_LEASE_MS, AI_JOBS_RENEW_MS } from './ai-jobs.constants';
import { AI_JOBS_PORTS, type AiJobsPorts } from './ai-jobs.ports';
import { AiStepRates } from './ai-step-rates.service';

const MAX_BUILDS_AT_ONCE = 3;

/**
 * Claims due jobs and runs them, each under a lease it renews while it works. Every claim gets its
 * own lease owner, so a run that lost its lease cannot write over the run that took the job next,
 * even on the same server.
 */
@Injectable()
export class AiJobWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(AiJobWorker.name);
  private readonly instance = `${hostname().slice(0, 30)}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly running = new Map<string, { owner: string; controller: AbortController; done: Promise<void> }>();
  private dispatching = false;
  private stopped = false;

  constructor(
    private readonly registry: AiFeatureRegistry,
    private readonly jobs: AiJobRepository,
    private readonly runner: AiJobRunner,
    private readonly activity: AiJobActivityService,
    private readonly notifier: AiJobNotifier,
    private readonly rates: AiStepRates,
    @Inject(AI_JOBS_PORTS) private readonly ports: AiJobsPorts,
  ) {}

  /** Jobs this server is running now. */
  get runningJobIds(): string[] {
    return [...this.running.keys()];
  }

  @Interval(AI_JOBS_DISPATCH_INTERVAL_MS)
  async tick(): Promise<void> {
    if (this.dispatching || this.stopped) return;
    this.dispatching = true;
    try {
      for (const feature of this.registry.list()) {
        const settings = await this.ports.settings.get(feature.id);
        const limit = Math.min(MAX_BUILDS_AT_ONCE, Math.max(1, Math.floor(settings.buildsAtOnce)));
        for (;;) {
          const owner = `${this.instance}:${randomUUID().slice(0, 8)}`;
          const row = await this.jobs.claimNext(feature.id, owner, AI_JOBS_LEASE_MS, limit);
          if (!row) break;
          this.start(row, owner);
        }
      }
    } catch (error) {
      this.logger.warn(
        `[ai_jobs.dispatch] [fail] errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - AI jobs dispatch tick failed`,
      );
    } finally {
      this.dispatching = false;
    }
  }

  /** Ends this server's run of a job at once instead of at its next request. */
  stop(jobId: string): void {
    this.running.get(jobId)?.controller.abort();
  }

  /** Waits for every run this server started to finish. */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.running.values()].map((run) => run.done));
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    for (const run of this.running.values()) run.controller.abort();
    await this.idle();
  }

  private start(row: AiJobRow, owner: string): void {
    const controller = new AbortController();
    const done = this.process(row, owner, controller)
      .catch((error: unknown) => this.logUnhandled(row, error))
      .finally(() => this.running.delete(row.id));
    this.running.set(row.id, { owner, controller, done });
  }

  private async process(row: AiJobRow, owner: string, controller: AbortController): Promise<void> {
    const event = 'ai_jobs.run';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] jobId=${row.id} feature=${row.feature} kind=${row.kind} attempt=${row.attempts} - AI job started`);
    const renew = setInterval(() => {
      void this.jobs
        .renewLease(row.id, owner, AI_JOBS_LEASE_MS)
        .then((kept) => {
          if (!kept) controller.abort();
        })
        // A database blip is not a lost lease; the next renewal or recovery decides.
        .catch(() => undefined);
    }, AI_JOBS_RENEW_MS);
    try {
      await this.activity.record(row.id, 'info', null, 'claimed', { attempt: row.attempts, generation: row.generation });
      const outcome = await this.runner.run(row, owner, controller);
      await this.record(row, owner, outcome);
      this.logger.log(
        `[${event}] [end] jobId=${row.id} feature=${row.feature} durationMs=${Date.now() - startedAt} outcome=${outcome.kind}${
          'reason' in outcome ? ` reason=${outcome.reason}` : ''
        } - AI job run ended`,
      );
    } finally {
      clearInterval(renew);
    }
  }

  /** Writes the outcome. A null row means the job left this owner first; whoever moved it owns the rest. */
  private async record(row: AiJobRow, owner: string, outcome: AiRunOutcome): Promise<void> {
    switch (outcome.kind) {
      case 'completed': {
        const done = await this.jobs.complete(row.id, owner, outcome.artifact);
        if (!done) return;
        await this.activity.record(row.id, 'info', null, 'completed', { coverage: Math.round(outcome.artifact.coverage * 1000) / 1000 });
        await this.learn(row, outcome.timings);
        await this.ports.budget.release(row.id).catch(() => undefined);
        await this.notifier.notify(done, 'completed');
        return;
      }
      case 'paused': {
        const paused = await this.jobs.pause(row.id, owner, outcome.reason);
        if (paused) await this.activity.record(row.id, 'warn', null, 'paused', { reason: outcome.reason });
        return;
      }
      case 'failed': {
        const failed = await this.jobs.fail(row.id, owner, outcome.reason);
        if (!failed) return;
        // Anyone who can open the log sees this, and a raw message can carry SQL or server paths.
        await this.activity.record(row.id, 'error', outcome.step, 'failed', {
          reason: outcome.reason,
          ...(outcome.reason === 'error' ? {} : { detail: outcome.detail }),
        });
        if (outcome.reason === 'error') {
          this.logger.warn(
            `[ai_jobs.run] [fail] jobId=${row.id} feature=${row.feature} step=${outcome.step ?? 'none'} error="${sanitizeLogValue(outcome.detail ?? '')}" - AI job failed`,
          );
        }
        await this.ports.budget.release(row.id).catch(() => undefined);
        await this.notifier.notify(failed, 'failed');
        return;
      }
      case 'stopped':
        return;
    }
  }

  /** Estimates only get better from this, so a failure to save it never fails the job. */
  private async learn(row: AiJobRow, timings: readonly AiStepTiming[]): Promise<void> {
    try {
      await this.rates.learn(timings);
    } catch (error) {
      this.logger.warn(
        `[ai_jobs.timings] [fail] jobId=${row.id} feature=${row.feature} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(
          error instanceof Error ? error.message : String(error),
        )}" - step timings not saved`,
      );
    }
  }

  /** Recording the outcome itself failed (usually the database); the lapsed lease requeues the job. */
  private logUnhandled(row: AiJobRow, error: unknown): void {
    this.logger.error(
      `[ai_jobs.run] [fail] jobId=${row.id} feature=${row.feature} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(
        error instanceof Error ? error.message : String(error),
      )}" - AI job outcome could not be recorded; lease recovery will requeue it`,
    );
  }
}
