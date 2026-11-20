import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';

import type { RequestUser } from '../../common/types/request-user';
import { IdlePoll } from '../../common/utils/idle-poll';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { bulkRunsConfig } from '../../config/config';
import type { BulkRunRow } from '../../db/schema';
import { JobChangesService } from '../jobs/job-changes.service';
import { BulkRunActorService, BulkRunStopped } from './bulk-run-actor.service';
import type { BulkItemOutcome, BulkRunEnd, BulkRunHandler } from './bulk-run-handler';
import { BulkRunHandlerRegistry } from './bulk-run-handler.registry';
import { BulkRunNotifier } from './bulk-run-notifier.service';
import { BulkRunStreams } from './bulk-run-streams.service';
import { BulkRunsRepository } from './bulk-runs.repository';

export const BULK_RUN_TICK_MS = 2_000;
const HOUSEKEEPING_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** An interrupted run nobody continued leaves Failed after this. */
export const BULK_RUN_INTERRUPTED_KEPT_MS = 30 * DAY_MS;
/** Ended runs are deleted after this. */
export const BULK_RUN_FINISHED_KEPT_MS = 90 * DAY_MS;
/** The account a run acts as is checked again at least this often, and every `ACTOR_CHECK_ITEMS` items. */
const ACTOR_CHECK_MS = 30_000;
const ACTOR_CHECK_ITEMS = 100;
const SHUTDOWN_WAIT_MS = 10_000;
const FAILURE_MESSAGE_MAX = 300;
/** A cancel retries this often when the run moves between waiting and claimed under it. */
const CANCEL_ATTEMPTS = 3;

interface ActiveRun {
  cancel: boolean;
  done: Promise<void>;
}

interface PendingSettle {
  run: BulkRunRow;
  end: BulkRunEnd;
  failure?: { code: string; error: string | null };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starts waiting bulk runs and works them one item at a time. Each account has one run going at
 * once, accounts take turns by their oldest waiting run, and the server runs at most
 * `BULK_RUNS_MAX_CONCURRENT` together. A run goes on whether or not anyone follows its stream.
 */
@Injectable()
export class BulkRunDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BulkRunDispatcher.name);
  private readonly idlePoll = new IdlePoll();
  private readonly active = new Map<string, ActiveRun>();
  /** Runs whose end could not be saved; each tick tries again, since an unsaved run blocks its account's line. */
  private readonly unsettled = new Map<string, PendingSettle>();
  private ready = false;
  private ticking = false;
  private stopping = false;
  private wakeQueued = false;

  constructor(
    private readonly repo: BulkRunsRepository,
    private readonly handlers: BulkRunHandlerRegistry,
    private readonly streams: BulkRunStreams,
    private readonly actors: BulkRunActorService,
    private readonly jobChanges: JobChangesService,
    private readonly notifier: BulkRunNotifier,
    @Inject(bulkRunsConfig.KEY) private readonly config: ConfigType<typeof bulkRunsConfig>,
  ) {}

  /** Nothing runs before boot, so a run still marked running was cut short by the last stop. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const interrupted = await this.repo.interruptRunning();
      if (interrupted.length > 0) {
        this.logger.warn(`[bulk_run.boot] [end] interrupted=${interrupted.length} - bulk runs cut short by the last stop can continue from Jobs`);
        for (const owner of new Set(interrupted.map((run) => run.requestedBy))) {
          this.jobChanges.notify({ type: 'bulk-run', ownerId: owner, state: true });
        }
        void this.notifier.interrupted(interrupted);
      }
    } catch (error) {
      this.logger.error(
        `[bulk_run.boot] [fail] errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(messageOf(error))}" - could not mark interrupted bulk runs`,
      );
    }
    this.ready = true;
    this.wake();
  }

  /**
   * Stops before the HTTP server closes: no new work, every open stream ended so the server can
   * close, and each run given until its next item to stop. The next boot marks them interrupted.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.streams.closeAll();
    const runs = [...this.active.values()].map((run) => run.done);
    if (runs.length === 0) return;
    await Promise.race([Promise.allSettled(runs), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_WAIT_MS).unref())]);
  }

  /** Runs this server is working now. */
  get activeRunIds(): string[] {
    return [...this.active.keys()];
  }

  /** Waits for every run this server is working to stop. */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.active.values()].map((run) => run.done));
  }

  /** Looks for work now instead of at the next tick. */
  wake(): void {
    this.idlePoll.wake();
    if (this.wakeQueued) return;
    this.wakeQueued = true;
    setImmediate(() => {
      this.wakeQueued = false;
      void this.tick();
    });
  }

  @Interval(BULK_RUN_TICK_MS)
  async tick(): Promise<void> {
    if (!this.ready || this.ticking || this.stopping) return;
    const deferIfIdle = this.idlePoll.begin();
    if (!deferIfIdle) return;
    this.ticking = true;
    try {
      await this.retryUnsettled();
      const busy: string[] = [];
      while (!this.stopping && this.active.size < this.config.maxConcurrent) {
        const claim = await this.repo.claimNext([...busy, ...this.active.keys()]);
        if (!claim) {
          if (this.active.size === 0 && this.unsettled.size === 0 && busy.length === 0) deferIfIdle();
          break;
        }
        if ((await this.start(claim.run, claim.firstStart)) === 'busy') busy.push(claim.run.id);
      }
    } catch (error) {
      this.logger.warn(
        `[bulk_run.dispatch] [fail] errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(messageOf(error))}" - bulk run dispatch tick failed`,
      );
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Cancels a waiting run at once, or asks a running one to stop before its next item. A run can
   * move between the two while this runs, such as a move put back in line while its library is
   * busy, so each step is tried again. Null when the run already ended.
   */
  async cancel(runId: string): Promise<BulkRunRow | null> {
    for (let attempt = 0; attempt < CANCEL_ATTEMPTS; attempt++) {
      const cancelled = await this.repo.cancelQueued(runId);
      if (cancelled) {
        await this.closeCancelled(cancelled, 'waiting bulk run cancelled');
        return cancelled;
      }
      const flagged = await this.repo.requestCancel(runId);
      if (flagged) {
        const active = this.active.get(runId);
        if (active) active.cancel = true;
        return flagged;
      }
      const current = await this.repo.findById(runId);
      if (!current || (current.status !== 'queued' && current.status !== 'running')) return null;
    }
    return null;
  }

  /** A run that ended cancelled before it started: its handler tidies up and its followers hear the end. */
  private async closeCancelled(cancelled: BulkRunRow, message: string): Promise<void> {
    const handler = this.handlers.get(cancelled.kind);
    if (handler) await this.finishQuietly(handler, cancelled, null, 'cancelled');
    this.streams.close(cancelled.id, handler ? handler.doneEvent(cancelled) : null);
    this.jobChanges.notify({ type: 'bulk-run', ownerId: cancelled.requestedBy, state: true });
    this.logger.log(`[bulk_run.cancel] [end] runId=${cancelled.id} kind=${cancelled.kind} processed=${cancelled.processed} - ${message}`);
  }

  @Interval(HOUSEKEEPING_MS)
  async housekeeping(): Promise<void> {
    const now = Date.now();
    try {
      const dismissed = await this.repo.autoDismissInterrupted(new Date(now - BULK_RUN_INTERRUPTED_KEPT_MS));
      const deleted = await this.repo.deleteFinished(new Date(now - BULK_RUN_FINISHED_KEPT_MS));
      if (dismissed > 0 || deleted > 0) {
        this.logger.log(
          `[bulk_run.housekeeping] [end] dismissed=${dismissed} deleted=${deleted} durationMs=${Date.now() - now} - old bulk runs cleared`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `[bulk_run.housekeeping] [fail] durationMs=${Date.now() - now} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(messageOf(error))}" - bulk run housekeeping failed`,
      );
    }
  }

  /**
   * Prepares a claimed run and works it in the background; `busy` puts it back in line. The run is
   * registered before it prepares, so a cancel asked for meanwhile reaches it.
   */
  private async start(run: BulkRunRow, firstStart: boolean): Promise<'started' | 'busy' | 'ended'> {
    const handler = this.handlers.get(run.kind);
    if (!handler) {
      await this.end(run, null, null, 'failed', { code: 'unknown-kind', error: null });
      return 'ended';
    }
    const entry: ActiveRun = { cancel: run.cancelRequested, done: Promise.resolve() };
    this.active.set(run.id, entry);
    let actor: RequestUser;
    let state: unknown;
    try {
      actor = await this.actors.resolve(run);
      const prepared = await this.actors.as(actor, () => handler.prepare(run, actor));
      if (prepared === 'busy') {
        this.active.delete(run.id);
        const released = await this.repo.releaseClaim(run.id, firstStart);
        if (released?.status !== 'cancelled') return 'busy';
        await this.closeCancelled(released, 'bulk run cancelled while it waited to start');
        return 'ended';
      }
      state = prepared.state;
    } catch (error) {
      this.active.delete(run.id);
      const failure =
        error instanceof BulkRunStopped
          ? { code: error.code, error: null }
          : { code: 'error', error: sanitizeLogValue(messageOf(error), FAILURE_MESSAGE_MAX) };
      this.logger.warn(
        `[bulk_run.run] [fail] runId=${run.id} kind=${run.kind} code=${failure.code} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(messageOf(error))}" - bulk run could not start`,
      );
      await this.end(run, handler, null, 'failed', failure);
      return 'ended';
    }
    entry.done = this.work(run, handler, actor, state, entry)
      .catch((error: unknown) => {
        this.logger.error(
          `[bulk_run.run] [fail] runId=${run.id} kind=${run.kind} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(messageOf(error))}" - bulk run ended unexpectedly`,
        );
      })
      .finally(() => {
        this.active.delete(run.id);
        if (!this.stopping) this.wake();
      });
    return 'started';
  }

  private async work(run: BulkRunRow, handler: BulkRunHandler, initialActor: RequestUser, state: unknown, control: ActiveRun): Promise<void> {
    const startedAt = Date.now();
    this.logger.log(
      `[bulk_run.run] [start] runId=${run.id} kind=${run.kind} userId=${run.requestedBy ?? 'none'} total=${run.total} from=${run.processed} - bulk run started`,
    );
    this.jobChanges.notify({ type: 'bulk-run', ownerId: run.requestedBy, state: true });

    let actor = initialActor;
    let checkedAt = Date.now();
    let sinceCheck = 0;
    let end: BulkRunEnd = 'completed';
    let failure: { code: string; error: string | null } | undefined;
    let index = run.processed;
    // Left running on purpose: the next boot marks it interrupted, and Continue resumes at `index`.
    const leaveForContinue = () => {
      this.streams.close(run.id, null);
      this.logger.log(
        `[bulk_run.run] [end] runId=${run.id} kind=${run.kind} processed=${index} durationMs=${Date.now() - startedAt} outcome=stopped - server stopping`,
      );
    };
    try {
      const startEvent = handler.startEvent?.(run, state) ?? null;
      if (startEvent) this.streams.emit(run.id, startEvent);
      // A cancel saved between the claim and the run's registration reached only the database.
      if (!control.cancel && (await this.repo.cancelRequested(run.id))) control.cancel = true;
      for (; index < run.subjectIds.length; index++) {
        if (this.stopping) return leaveForContinue();
        if (control.cancel) {
          end = 'cancelled';
          break;
        }
        if (Date.now() - checkedAt >= ACTOR_CHECK_MS || sinceCheck >= ACTOR_CHECK_ITEMS) {
          actor = await this.actors.resolve(run);
          checkedAt = Date.now();
          sinceCheck = 0;
        }
        const id = run.subjectIds[index]!;
        const outcome = await this.item(handler, id, run, actor, state);
        // An item that failed while the server shut down may have failed because of it; Continue retries it.
        if (this.stopping && outcome.outcome === 'failed') return leaveForContinue();
        sinceCheck += 1;
        const cancelAsked = await this.repo.recordItem(run.id, {
          outcome: outcome.outcome,
          stats: outcome.stats,
          failure:
            outcome.outcome === 'failed'
              ? { id, code: outcome.code ?? 'error', message: outcome.message ? sanitizeLogValue(outcome.message, FAILURE_MESSAGE_MAX) : null }
              : undefined,
        });
        if (cancelAsked) control.cancel = true;
        if (outcome.event) this.streams.emit(run.id, outcome.event);
        this.jobChanges.notify({ type: 'bulk-run', ownerId: run.requestedBy, state: false });
      }
    } catch (error) {
      if (this.stopping && !(error instanceof BulkRunStopped)) return leaveForContinue();
      end = 'failed';
      failure =
        error instanceof BulkRunStopped
          ? { code: error.code, error: null }
          : { code: 'error', error: sanitizeLogValue(messageOf(error), FAILURE_MESSAGE_MAX) };
    }
    const settled = await this.end(run, handler, state, end, failure);
    this.logger.log(
      `[bulk_run.run] [end] runId=${run.id} kind=${run.kind} durationMs=${Date.now() - startedAt} outcome=${end}${failure ? ` code=${failure.code}` : ''} processed=${settled?.processed ?? 'unknown'} succeeded=${settled?.succeeded ?? 'unknown'} failed=${settled?.failed ?? 'unknown'} skipped=${settled?.skipped ?? 'unknown'} - bulk run ended`,
    );
  }

  /** One item; a throw counts as a failed item unless it says the run itself must stop. */
  private async item(handler: BulkRunHandler, id: number, run: BulkRunRow, actor: RequestUser, state: unknown): Promise<BulkItemOutcome> {
    try {
      return await this.actors.as(actor, () => handler.processItem(id, { run, actor, state }));
    } catch (error) {
      if (error instanceof BulkRunStopped) throw error;
      return { outcome: 'failed', code: 'error', message: messageOf(error) };
    }
  }

  /**
   * Settles the run, lets the handler tidy up and sends the final event to whoever follows it. A run
   * whose end cannot be saved is tried again on each tick until it is.
   */
  private async end(
    run: BulkRunRow,
    handler: BulkRunHandler | null,
    state: unknown,
    end: BulkRunEnd,
    failure?: { code: string; error: string | null },
  ): Promise<BulkRunRow | null> {
    let settled: BulkRunRow | null = null;
    try {
      settled = await this.repo.settle(run.id, end, failure);
    } catch (error) {
      this.unsettled.set(run.id, { run, end, failure });
      this.logger.error(
        `[bulk_run.settle] [fail] runId=${run.id} kind=${run.kind} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(messageOf(error))}" - could not settle bulk run, will retry`,
      );
    }
    if (handler) await this.finishQuietly(handler, settled ?? run, state, end);
    const watched = this.streams.following(run.id);
    this.streams.close(run.id, handler && settled && end !== 'failed' ? handler.doneEvent(settled) : null);
    this.jobChanges.notify({ type: 'bulk-run', ownerId: run.requestedBy, state: true });
    if (settled) void this.notifier.ended(settled, { watched, completionHandled: handler?.notifiesCompletion === true });
    return settled;
  }

  private async retryUnsettled(): Promise<void> {
    for (const [id, pending] of this.unsettled) {
      try {
        const settled = await this.repo.settle(id, pending.end, pending.failure);
        this.unsettled.delete(id);
        this.jobChanges.notify({ type: 'bulk-run', ownerId: pending.run.requestedBy, state: true });
        // Its streams closed when it first tried to settle, so nobody watched it end.
        if (settled) {
          const completionHandled = this.handlers.get(settled.kind)?.notifiesCompletion === true;
          void this.notifier.ended(settled, { watched: false, completionHandled });
        }
        this.logger.log(`[bulk_run.settle] [end] runId=${id} kind=${pending.run.kind} outcome=${pending.end} - bulk run settled on retry`);
      } catch {
        // Still failing; the next tick tries again, and a restart marks it interrupted.
        return;
      }
    }
  }

  private async finishQuietly(handler: BulkRunHandler, run: BulkRunRow, state: unknown, end: BulkRunEnd): Promise<void> {
    try {
      await handler.finish(run, state ?? null, end);
    } catch (error) {
      this.logger.warn(
        `[bulk_run.finish] [fail] runId=${run.id} kind=${run.kind} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(messageOf(error))}" - bulk run teardown failed`,
      );
    }
  }
}
