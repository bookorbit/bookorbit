import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { ReadAloudErrorCode, ReadAloudJobStage, ReadAloudWorkerJob, ReadAloudWorkerRequest } from '@bookorbit/types';
import { READ_ALOUD_ACTIVE_JOB_STATUSES } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { readAloudConfig } from '../../config/config';
import type { ReadAloudJobRow } from '../../db/schema';
import { ReadAloudActivityService } from './read-aloud-activity.service';
import {
  classifyReadAloudError,
  errorMessage,
  publicationErrorCode,
  ReadAloudCancelledError,
  ReadAloudJobError,
  ReadAloudWorkerLostError,
} from './read-aloud-errors';
import { ReadAloudJobRepository } from './read-aloud-job.repository';
import { ReadAloudNotifier } from './read-aloud-notifier.service';
import { ReadAloudPublisher } from './read-aloud-publisher.service';
import { ReadAloudService } from './read-aloud.service';
import {
  ReadAloudWorkerClientService,
  WorkerJobNotFoundError,
  WorkerRejectedError,
  WorkerUnreachableError,
} from './read-aloud-worker-client.service';
import { ReadAloudWorkspace } from './read-aloud-workspace.service';
import {
  READ_ALOUD_CANCEL_WAIT_MS,
  READ_ALOUD_DISPATCH_INTERVAL_MS,
  READ_ALOUD_FAILED_WORK_TTL_MS,
  READ_ALOUD_HEARTBEAT_MS,
  READ_ALOUD_MAX_ATTEMPTS,
  READ_ALOUD_MAX_RESUBMITS,
  READ_ALOUD_POLL_INTERVAL_MS,
  READ_ALOUD_REVIEW_TTL_MS,
  READ_ALOUD_UNREACHABLE_BACKOFF_MS,
  READ_ALOUD_UNREACHABLE_WINDOW_MS,
} from './read-aloud.constants';

const RUNNING = new Set<ReadAloudWorkerJob['status']>(['queued', 'running']);
const ACTIVE_STATUSES = new Set<string>(READ_ALOUD_ACTIVE_JOB_STATUSES);
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Failures a retry cannot fix; their work folder is removed instead of kept for the retry window. */
const NOT_RETRYABLE = new Set<ReadAloudErrorCode>([
  'source_missing',
  'source_changed',
  'invalid_source',
  'unsupported_language',
  'library_not_mounted',
]);

/**
 * The worker could not see a file the database still lists. On a network share that is usually a
 * mount that dropped for a moment, so the cached work stays for Retry instead of hours of it going.
 */
const WORKER_MOUNT_GAPS = new Set<ReadAloudErrorCode>(['source_missing', 'library_not_mounted']);

function isRetryable(error: unknown, code: ReadAloudErrorCode): boolean {
  if (!NOT_RETRYABLE.has(code)) return true;
  return error instanceof WorkerRejectedError && WORKER_MOUNT_GAPS.has(code);
}

/**
 * Runs one job at a time against the worker. A worker that is slow or briefly unreachable is
 * waited out rather than counted as a failure; a job only fails for what the worker reports or for
 * the worker staying away past the window.
 */
@Injectable()
export class ReadAloudWorkerService {
  private readonly logger = new Logger(ReadAloudWorkerService.name);
  private activeJobId: string | null = null;
  private dispatching = false;

  constructor(
    @Inject(readAloudConfig.KEY) private readonly config: ConfigType<typeof readAloudConfig>,
    private readonly jobs: ReadAloudJobRepository,
    private readonly worker: ReadAloudWorkerClientService,
    private readonly readAloud: ReadAloudService,
    private readonly publisher: ReadAloudPublisher,
    private readonly workspace: ReadAloudWorkspace,
    private readonly activity: ReadAloudActivityService,
    private readonly notifier: ReadAloudNotifier,
  ) {}

  get currentJobId(): string | null {
    return this.activeJobId;
  }

  @Interval(READ_ALOUD_DISPATCH_INTERVAL_MS)
  async tick(): Promise<void> {
    if (this.activeJobId || this.dispatching || !this.worker.configured) return;
    this.dispatching = true;
    try {
      const health = await this.worker.healthState();
      if (health.state !== 'ok') return;
      const running = health.health.activeJobId;
      const job = running ? await this.adoptRunning(running) : await this.jobs.claimNext();
      if (!job) return;
      this.activeJobId = job.id;
      void this.process(job, health.health.device)
        .catch((error: unknown) => this.logUnhandled(job, error))
        .finally(() => {
          this.activeJobId = null;
        });
    } catch (error) {
      this.logger.warn(
        `[read_aloud.dispatch] [fail] errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(errorMessage(error))}" - dispatch tick failed`,
      );
    } finally {
      this.dispatching = false;
    }
  }

  /**
   * The worker is still running a job this server lost track of, usually across a restart. Taking
   * that job back picks up its progress, where claiming another would only be refused as busy. One
   * still under a live lease is left alone until recovery requeues it, and one the database no
   * longer wants is stopped.
   */
  private async adoptRunning(jobId: string): Promise<ReadAloudJobRow | null> {
    if (!JOB_ID.test(jobId)) return null;
    const row = await this.jobs.findById(jobId);
    if (row?.status === 'queued') return await this.jobs.claimQueued(jobId);
    if (row && ACTIVE_STATUSES.has(row.status)) return null;
    // The cached health can predate the job ending, which is the usual case right after one finishes.
    const fresh = await this.worker.healthState(true);
    if (fresh.state !== 'ok') return null;
    if (fresh.health.activeJobId === jobId) {
      await this.worker.cancel(jobId).catch(() => undefined);
      return null;
    }
    return fresh.health.activeJobId ? null : await this.jobs.claimNext();
  }

  private async process(job: ReadAloudJobRow, device: string): Promise<void> {
    const event = 'read_aloud.process_job';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] jobId=${job.id} bookId=${job.bookId} userId=${job.requestedByUserId ?? 'deleted'} attempt=${job.attemptCount} resumeFrom=${job.resumeFrom ?? 'none'} - read-aloud job started`,
    );
    const heartbeat = setInterval(() => void this.jobs.heartbeat(job.id).catch(() => undefined), READ_ALOUD_HEARTBEAT_MS);
    try {
      await this.activity.record(job.id, 'info', job.stage as ReadAloudJobStage, 'claimed', null, { attempt: job.attemptCount, device });
      await this.notifier.pushUpdate(await this.jobs.updateProgress(job.id, { stage: job.stage as ReadAloudJobStage, progress: 0, device }));
      const context = await this.readAloud.resolveProcessingContext(job);
      await this.workspace.ensure(job.id);
      const request: ReadAloudWorkerRequest = { ...context.request, maxOutputBytes: this.config.maxOutputBytes };
      const finalState = await this.runOnWorker(job, request);
      if (finalState.status === 'cancelled') {
        // A worker that is shutting down cancels its running job itself. Only a cancel someone asked
        // for ends the job; otherwise it goes back to the queue and resumes from its cached work.
        if (await this.jobs.isCancellationRequested(job.id)) throw new ReadAloudCancelledError();
        throw new ReadAloudWorkerLostError('The worker stopped the job without being asked to, usually because it was shutting down');
      }
      if (finalState.status === 'failed') {
        throw new ReadAloudJobError(finalState.errorCode ?? 'unknown', finalState.error ?? 'The read-aloud worker reported a failure');
      }
      await this.finish(job, context.user, startedAt);
    } catch (error) {
      await this.handleFailure(job, error, startedAt);
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Submits the job and follows it until the worker reports a final state. */
  private async runOnWorker(job: ReadAloudJobRow, request: ReadAloudWorkerRequest): Promise<ReadAloudWorkerJob> {
    let state = await this.submit(job, request);
    // The worker numbers a job's events across runs (the counter lives in the work folder), so a
    // retry, re-sync or resume asks only for what this server has not stored yet.
    let afterSeq = job.workerEventSeq;
    let savedSeq = job.workerEventSeq;
    let unreachableSince: number | null = null;
    let resubmits = 0;
    let lastPushed = '';

    for (;;) {
      const fresh = state.events.filter((item) => item.seq > afterSeq);
      if (fresh.length > 0) {
        afterSeq = Math.max(...fresh.map((item) => item.seq));
        await this.activity.recordWorkerEvents(job.id, fresh);
      }
      if (!RUNNING.has(state.status)) {
        // While running, the progress update below saves the sequence; a final state skips it.
        if (afterSeq > savedSeq) await this.jobs.advanceWorkerEventSeq(job.id, afterSeq);
        return state;
      }

      const updated = await this.jobs.updateProgress(job.id, {
        stage: state.stage,
        progress: state.progress,
        stageDetail: state.stageDetail,
        workerEventSeq: afterSeq,
      });
      if (updated) savedSeq = afterSeq;
      const signature = `${state.stage}:${state.progress}:${state.stageDetail?.current ?? ''}`;
      if (updated && signature !== lastPushed) {
        lastPushed = signature;
        await this.notifier.pushUpdate(updated);
      }
      if (await this.jobs.isCancellationRequested(job.id)) return await this.cancelOnWorker(job.id, state);

      await sleep(unreachableSince ? this.backoff(Date.now() - unreachableSince) : READ_ALOUD_POLL_INTERVAL_MS);
      try {
        state = await this.worker.status(job.id, afterSeq);
        if (unreachableSince) {
          await this.activity.record(job.id, 'info', state.stage, 'worker_reachable_again', null, { waitedMs: Date.now() - unreachableSince });
          unreachableSince = null;
        }
      } catch (error) {
        if (error instanceof WorkerJobNotFoundError) {
          // A long CPU run can outlive several worker restarts (image updates, host reboots); each
          // resubmission resumes from the cached work. Past the limit the job is requeued, not failed.
          if (resubmits >= READ_ALOUD_MAX_RESUBMITS) throw new ReadAloudWorkerLostError('The worker kept losing the job');
          resubmits++;
          await this.activity.record(job.id, 'warn', state.stage, 'worker_lost_job', 'The worker restarted; resuming from its cached work');
          state = await this.submit(job, request);
          continue;
        }
        if (!(error instanceof WorkerUnreachableError)) throw error;
        if (!unreachableSince) {
          unreachableSince = Date.now();
          await this.activity.record(job.id, 'warn', state.stage, 'waiting_for_worker', 'The worker is not answering; waiting for it');
        }
        if (Date.now() - unreachableSince > READ_ALOUD_UNREACHABLE_WINDOW_MS) {
          throw new ReadAloudWorkerLostError('The worker stayed unreachable for too long');
        }
      }
    }
  }

  /** A busy or unreachable worker is waited out within the window; a rejection fails the job. */
  private async submit(job: ReadAloudJobRow, request: ReadAloudWorkerRequest): Promise<ReadAloudWorkerJob> {
    const waitingSince = Date.now();
    let announced = false;
    for (;;) {
      try {
        return await this.worker.start(request);
      } catch (error) {
        if (!(error instanceof WorkerUnreachableError)) throw error;
        if (await this.jobs.isCancellationRequested(job.id)) throw new ReadAloudCancelledError();
        if (Date.now() - waitingSince > READ_ALOUD_UNREACHABLE_WINDOW_MS)
          throw new ReadAloudWorkerLostError('The worker did not accept the job in time');
        if (!announced) {
          announced = true;
          await this.activity.record(job.id, 'warn', null, 'waiting_for_worker', 'The worker is busy or not answering; waiting for it');
        }
        await sleep(this.backoff(Date.now() - waitingSince));
      }
    }
  }

  private async cancelOnWorker(jobId: string, last: ReadAloudWorkerJob): Promise<ReadAloudWorkerJob> {
    const deadline = Date.now() + READ_ALOUD_CANCEL_WAIT_MS;
    let state = (await this.worker.cancel(jobId).catch(() => null)) ?? last;
    while (RUNNING.has(state.status) && Date.now() < deadline) {
      await sleep(READ_ALOUD_POLL_INTERVAL_MS);
      state = (await this.worker.status(jobId, Number.MAX_SAFE_INTEGER).catch(() => null)) ?? state;
    }
    return { ...state, status: 'cancelled', events: [] };
  }

  private async finish(job: ReadAloudJobRow, user: Parameters<ReadAloudPublisher['publish']>[1], startedAt: number): Promise<void> {
    const event = 'read_aloud.process_job';
    await this.notifier.pushUpdate(await this.jobs.updateProgress(job.id, { stage: 'validating', progress: 97, stageDetail: null }));
    const validation = await this.publisher.withHeartbeat(job.id, () => this.publisher.validate(job));
    await this.activity.record(job.id, validation.warnings.length > 0 ? 'warn' : 'info', 'validating', 'output_validated', null, {
      sentences: validation.report.sentences,
      matched: validation.report.matchedSentences,
      unmatched: validation.report.unmatchedSentences,
      outsideNarration: validation.coverage?.outsideSentences ?? null,
      outputBytes: validation.outputBytes,
    });
    // A job someone already chose to add despite the warnings (and that a restart put back in the
    // queue) goes straight to the library instead of asking for the same review again.
    if (validation.requiresReview && !job.publishApproved) {
      const row = await this.jobs.markAwaitingReview(
        job.id,
        validation.report,
        validation.warnings,
        validation.coverage,
        new Date(Date.now() + READ_ALOUD_REVIEW_TTL_MS),
      );
      if (!row) throw new ReadAloudCancelledError();
      await this.activity.record(job.id, 'warn', 'awaiting_review', 'needs_review', 'Part of the text did not match the audio');
      await this.notifier.pushUpdate(row);
      await this.notifier.notify(row, 'needs_review');
      this.logger.log(
        `[${event}] [end] jobId=${job.id} bookId=${job.bookId} status=awaiting_review durationMs=${Date.now() - startedAt} - read-aloud job needs review`,
      );
      return;
    }
    const publishing = await this.jobs.beginPublishing(job.id);
    if (!publishing) throw new ReadAloudCancelledError();
    await this.notifier.pushUpdate(publishing);
    let fileId: number;
    try {
      fileId = await this.publisher.withHeartbeat(job.id, () => this.publisher.publish(job, user));
    } catch (error) {
      throw new ReadAloudJobError(publicationErrorCode(error), errorMessage(error), { cause: error });
    }
    const completed = await this.jobs.complete(job.id, fileId, validation.report, validation.warnings, validation.coverage);
    await this.workspace.remove(job.id);
    await this.activity.record(job.id, 'info', 'completed', 'published', null, { fileId, durationMs: Date.now() - startedAt });
    if (completed) {
      await this.notifier.pushUpdate(completed);
      await this.notifier.notify(completed, 'ready');
    }
    this.logger.log(
      `[${event}] [end] jobId=${job.id} bookId=${job.bookId} status=${completed?.status ?? 'unknown'} fileId=${fileId} durationMs=${Date.now() - startedAt} - read-aloud job completed`,
    );
  }

  private async handleFailure(job: ReadAloudJobRow, error: unknown, startedAt: number): Promise<void> {
    const code = classifyReadAloudError(error);
    const message = errorMessage(error);
    const cancelled = error instanceof ReadAloudCancelledError || (await this.jobs.isCancellationRequested(job.id));
    const transient = !cancelled && error instanceof ReadAloudWorkerLostError && job.attemptCount < READ_ALOUD_MAX_ATTEMPTS;
    let row: ReadAloudJobRow | null;
    // A null row means the job had already left `processing` (lease recovery requeued or cancelled
    // it), so whoever moved it owns its work folder; removing it here could wipe a requeued run.
    if (cancelled) {
      row = await this.jobs.fail(job.id, 'cancelled', message, null);
      if (row) {
        await this.workspace.remove(job.id);
        await this.activity.record(job.id, 'info', null, 'cancelled');
      }
    } else if (transient) {
      const retryAt = new Date(Date.now() + 30_000 * 2 ** Math.max(0, job.attemptCount - 1));
      row = await this.jobs.requeue(job.id, retryAt, code, message);
      await this.activity.record(job.id, 'warn', null, 'requeued', 'The worker was unavailable; trying again later', {
        attempt: job.attemptCount,
        retryAt: retryAt.toISOString(),
      });
    } else {
      const retryable = isRetryable(error, code);
      row = await this.jobs.fail(job.id, code, message, retryable ? new Date(Date.now() + READ_ALOUD_FAILED_WORK_TTL_MS) : null);
      if (!retryable && row) await this.workspace.remove(job.id);
      // Anyone who can see the book reads the log, and the raw message can carry SQL or server paths.
      await this.activity.record(job.id, 'error', null, code);
      if (row?.status === 'failed') await this.notifier.notify(row, 'failed');
    }
    await this.notifier.pushUpdate(row);
    this.logger.warn(
      `[read_aloud.process_job] [fail] jobId=${job.id} bookId=${job.bookId} durationMs=${Date.now() - startedAt} code=${code} errorClass=${
        error instanceof Error ? error.name : 'Error'
      } error="${sanitizeLogValue(message)}" retry=${transient} - read-aloud job failed`,
    );
  }

  /** Failure handling itself failed (usually the database); the expired lease requeues the job later. */
  private logUnhandled(job: ReadAloudJobRow, error: unknown): void {
    this.logger.error(
      `[read_aloud.process_job] [fail] jobId=${job.id} bookId=${job.bookId} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(
        errorMessage(error),
      )}" - read-aloud job failure could not be recorded; lease recovery will requeue it`,
    );
  }

  private backoff(elapsedMs: number): number {
    const steps = READ_ALOUD_UNREACHABLE_BACKOFF_MS;
    const index = Math.min(steps.length - 1, Math.floor(elapsedMs / 60_000));
    return steps[index]!;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
