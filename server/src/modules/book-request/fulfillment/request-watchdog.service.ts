import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditAction, AuditResource } from '@bookorbit/types';
import type { BookRequestDownloadStatus, BookRequestStatus } from '@bookorbit/types';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { AUDIT_EVENT, AuditEventsService } from '../../audit/audit-events.service';
import { BookRequestGateway } from '../book-request.gateway';
import { BookRequestRepository } from '../book-request.repository';
import { BookRequestDownloadRepository } from './book-request-download.repository';
import { DirectDownloadService } from './direct-download.service';
import { RequestFulfillmentService } from './request-fulfillment.service';

/**
 * A torrent with no seeders can sit at zero for a long time and still be worth waiting for, so
 * these are generous. They exist to stop a request sitting at "downloading" forever with nobody
 * told, not to enforce a service level.
 */
const STALL_TIMEOUT_MS = 12 * 60 * 60 * 1000;
/** Import is local filesystem work plus a metadata fetch. An hour is already pathological. */
const IMPORT_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * How long a self-serve request may sit with no release picked before it is swept.
 *
 * Long on purpose. Nothing marks a row as "the picker is open on it", so a short window would
 * cancel a request somebody is still reading through, and the cost of waiting is only that one
 * work stays claimed for the afternoon. Short enough that an abandoned search is gone the same day.
 */
const ABANDONED_SELF_SERVE_MS = 6 * 60 * 60 * 1000;

/** One sweep's worth. A backlog is worked off over several runs rather than in one long one. */
const ABANDONED_SWEEP_LIMIT = 50;

/**
 * How long a request may sit at `searching` before nothing is plausibly still searching for it.
 *
 * An automation pass is four search variants with a second or two between them, plus whatever
 * every enabled indexer takes to answer or time out, so it is minutes at its very worst. Half an
 * hour is far enough past that to be an accident rather than a slow tracker.
 */
const SEARCH_TIMEOUT_MS = 30 * 60 * 1000;

const STRANDED_SEARCH_SWEEP_LIMIT = 50;
/** A backstop, not a budget: rows a conditional write keeps refusing must not loop forever. */
const STRANDED_SEARCH_SWEEP_ROUNDS = 20;

const STALLABLE: BookRequestDownloadStatus[] = ['queued', 'downloading'];
const IMPORT_STUCK: BookRequestDownloadStatus[] = ['completed', 'importing'];
const SEARCHING_ONLY: readonly BookRequestStatus[] = ['searching'];

@Injectable()
export class RequestWatchdogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RequestWatchdogService.name);

  constructor(
    private readonly downloads: BookRequestDownloadRepository,
    private readonly fulfillment: RequestFulfillmentService,
    private readonly requests: BookRequestRepository,
    private readonly gateway: BookRequestGateway,
    private readonly auditEvents: AuditEventsService,
    private readonly direct: DirectDownloadService,
  ) {}

  /**
   * What the last process left behind. Both of these are in-memory state that a restart destroys
   * while its record on disk or in the database survives, so nothing else will ever look at them
   * again: no cutoff applies, because there is no version of "still working on it" here.
   *
   * Swallowed rather than thrown. Neither is worth refusing to start over.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.releaseStrandedSearches(new Date(), 'restart');
    } catch (error) {
      this.logFailure('stranded_search', error);
    }

    try {
      await this.reapStagedDownloads();
    } catch (error) {
      this.logFailure('staging_reap', error);
    }
  }

  /**
   * Every sweep here reads a batch of rows and then acts on each one in turn, so the last row is
   * acted on against a read that is several round trips old. That is safe because each write is
   * conditional at the repository: `failDownload` refuses an attempt or a request that settled in
   * the meantime, and `cancelAbandoned` refuses a row somebody picked a release for.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep(): Promise<void> {
    try {
      await this.failStalled();
      await this.failStuckImports();
      await this.cancelAbandonedSelfServe();
      await this.releaseStrandedSearches(new Date(Date.now() - SEARCH_TIMEOUT_MS), 'timeout');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[book_request.watchdog] [fail] error="${sanitizeLogValue(message)}" - watchdog sweep failed`);
    }
  }

  /**
   * Returns requests nothing is searching for to `approved`, which is where an approver picks a
   * release by hand.
   *
   * `searching` is claimed by a fire-and-forget automation task that lives only in this process.
   * Nothing clears it from outside that task, so a restart or a throw its own handler cannot reach
   * leaves the status behind without the work: the request holds the dedupe claim on its book
   * forever, and everybody who asks for that book afterwards is quietly subscribed to it.
   *
   * The write is conditional on the row still being at `searching`, so an automation pass that is
   * genuinely still running keeps whatever it decides; the worst the sweep can do to one is hand
   * back a request the pass then grabs a release for anyway.
   */
  private async releaseStrandedSearches(cutoff: Date, cause: 'restart' | 'timeout'): Promise<void> {
    let swept = 0;
    let released = 0;

    for (let round = 0; round < STRANDED_SEARCH_SWEEP_ROUNDS; round++) {
      const rows = await this.requests.findStrandedSearching(cutoff, STRANDED_SEARCH_SWEEP_LIMIT);
      if (rows.length === 0) break;
      swept += rows.length;

      for (const row of rows) {
        if (await this.requests.updateIf(row.id, SEARCHING_ONLY, { status: 'approved' })) released++;
      }
      if (rows.length < STRANDED_SEARCH_SWEEP_LIMIT) break;
    }

    if (released === 0) return;
    this.gateway.emitChanged();
    this.logger.warn(
      `[book_request.stranded_search] [end] cause=${cause} swept=${swept} released=${released} - returned requests nothing was searching for to approved`,
    );
  }

  /**
   * Staging directories with no attempt behind them any more.
   *
   * Direct-download progress lives in memory, so a transfer a restart interrupted leaves bytes
   * nothing will poll, import or remove - and each failed URL stages under its own hash, so this
   * accumulates rather than overwrites.
   */
  private async reapStagedDownloads(): Promise<void> {
    const live = new Set(await this.downloads.findLiveDirectHashes());
    const reaped = await this.direct.reapStaging(live);
    if (reaped === 0) return;

    this.logger.log(`[book_request.staging_reap] [end] live=${live.size} reaped=${reaped} - removed staging nothing was downloading any more`);
  }

  private logFailure(event: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `[book_request.${event}] [fail] errorClass=${(error as Error)?.constructor?.name ?? 'Error'} error="${sanitizeLogValue(message)}" - startup reconciliation failed`,
    );
  }

  private async failStalled(): Promise<void> {
    const rows = await this.downloads.findByStatusOlderThan(STALLABLE, new Date(Date.now() - STALL_TIMEOUT_MS), 'progress');
    for (const row of rows) {
      await this.fulfillment.failDownload(row, 'The download made no progress for 12 hours');
    }
  }

  /**
   * A self-serve request is created so the release search has a row to score against, and the
   * person who created it may never pick anything. Left alone it holds the dedupe claim on that
   * work, so the next person to ask for the same book is subscribed to a request nobody is
   * driving - which is the one failure mode creating the row up front introduces.
   *
   * Cancelled rather than deleted: `cancelled` falls outside the partial unique index, so the
   * claim is released, and the row stays as a record of what was searched for. Dismissed for its
   * owner at the same time, because a cancelled search they abandoned is not news to them.
   *
   * Audited through the event bus rather than the usual decorator: this is a cron, and the audit
   * interceptor only ever sees HTTP requests.
   */
  private async cancelAbandonedSelfServe(): Promise<void> {
    const rows = await this.requests.findAbandonedSelfServe(new Date(Date.now() - ABANDONED_SELF_SERVE_MS), ABANDONED_SWEEP_LIMIT);
    if (rows.length === 0) return;

    let cancelled = 0;
    for (const row of rows) {
      // Conditional, so a release picked between the read and the write wins over the sweep.
      if (!(await this.requests.cancelAbandoned(row.id, 'No release was picked, so this download was never started', 'ABANDONED'))) {
        continue;
      }
      cancelled++;
      await this.requests.dismiss(row.id, row.userId);

      this.auditEvents.emit(AUDIT_EVENT, {
        userId: null,
        actorUsername: 'system',
        action: AuditAction.BookRequestCancel,
        resource: AuditResource.BookRequest,
        resourceId: row.id,
        description: 'Cancelled a self-serve book request nobody picked a release for',
        meta: { requestId: row.id, ownerId: row.userId },
      });
    }

    if (cancelled === 0) return;
    this.gateway.emitChanged();
    this.logger.log(
      `[book_request.watchdog] [end] swept=${rows.length} cancelled=${cancelled} limit=${ABANDONED_SWEEP_LIMIT} - released the dedupe claim on abandoned self-serve requests`,
    );
  }

  /**
   * `needs_review` is deliberately not in this list: that download did complete and import, and a
   * human is expected to take as long as they like over it.
   *
   * An import this process is still queueing or running is kept out by the monitor's heartbeat,
   * which touches `updatedAt` for every member of the import queue once a minute. Without it, an
   * import concurrency of one means queue depth alone ages a healthy row past the hour.
   */
  private async failStuckImports(): Promise<void> {
    const rows = await this.downloads.findByStatusOlderThan(IMPORT_STUCK, new Date(Date.now() - IMPORT_TIMEOUT_MS), 'state-change');
    for (const row of rows) {
      await this.fulfillment.failDownload(row, 'The import did not finish within an hour');
    }
  }
}
