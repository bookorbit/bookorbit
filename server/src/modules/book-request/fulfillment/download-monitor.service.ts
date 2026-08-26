import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES } from '@bookorbit/types';
import type { BookRequestDownloadStatus, BookRequestStatus } from '@bookorbit/types';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { BookRequestDownloadRow } from '../../../db/schema';
import { BookRequestGateway } from '../book-request.gateway';
import { BookRequestRepository } from '../book-request.repository';
import { DownloadClientConfigService } from '../download-clients/download-client-config.service';
import { DownloadClientRegistry } from '../download-clients/download-client-registry';
import type { DownloadStatus } from '../download-clients/download-client-adapter';
import { BookRequestDownloadRepository } from './book-request-download.repository';
import { DirectDownloadService } from './direct-download.service';
import { RequestFulfillmentService } from './request-fulfillment.service';
import { RequestImportQueue } from './request-import-queue';

import { RequestImportService } from './request-import.service';

/**
 * A torrent the client has never heard of is usually one it has not indexed yet. Only treat it
 * as gone once it has had time to appear.
 */
const MISSING_TORRENT_GRACE_MS = 2 * 60 * 1000;

/**
 * A tracker that is briefly down is indistinguishable from one that is refusing us, and only the
 * second is worth failing a request over. Short enough to beat the watchdog's twelve hours by a
 * wide margin, long enough that a tracker restart does not cost anybody their download.
 */
const TRACKER_ERROR_GRACE_MS = 5 * 60 * 1000;
const DIRECT_PROGRESS_INTERVAL_MS = 1_000;
const TORRENT_PROGRESS_INTERVAL_MS = 5_000;
/**
 * The resume sweep is a scan for downloads nothing else will look at again, not a progress read,
 * so it keeps its own slower cadence rather than following the poll interval down.
 */
const RESUME_SWEEP_INTERVAL_MS = 15_000;

/**
 * How often the queue tells the database that its members are still being worked on.
 *
 * Comfortably inside the watchdog's one-hour import timeout, and cheap: one statement per minute
 * touching however many downloads are queued or extracting, which is at most a handful.
 */
const IMPORT_HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * One import at a time, which is what the tick already did by awaiting them. Two large extractions
 * competing for the same disk finish no sooner than one after the other, and the point of the
 * queue is to get them off the poll loop rather than to run more of them at once.
 */
const IMPORT_CONCURRENCY = 1;

/**
 * The request states a live transfer may move to `downloading` from. Narrow on purpose: anything
 * else has either not been grabbed yet or has already moved past the transfer, and a poll that
 * started before a person settled the request must not drag it back.
 */
const DOWNLOADING_FROM: readonly BookRequestStatus[] = ['grabbed', 'downloading'];

/** A client id, or the built-in downloader, which has no id because it has no row. */
const DIRECT = 'direct' as const;
type PollTarget = number | typeof DIRECT;

@Injectable()
export class DownloadMonitorService implements OnModuleDestroy {
  private readonly logger = new Logger(DownloadMonitorService.name);
  private running = false;
  private lastResumeAt = 0;
  private lastHeartbeatAt = 0;
  private readonly lastClientPollAt = new Map<PollTarget, number>();
  /** Targets whose previous poll has not come back yet, so a slow one is skipped rather than queued. */
  private readonly pollsInFlight = new Map<PollTarget, Promise<void>>();
  private readonly importQueue = new RequestImportQueue(
    IMPORT_CONCURRENCY,
    (downloadId) => this.runImport(downloadId),
    (downloadId, error) => this.logImportFailure(downloadId, error),
  );

  constructor(
    private readonly downloads: BookRequestDownloadRepository,
    private readonly requests: BookRequestRepository,
    private readonly clients: DownloadClientConfigService,
    private readonly registry: DownloadClientRegistry,
    private readonly direct: DirectDownloadService,
    private readonly imports: RequestImportService,
    private readonly fulfillment: RequestFulfillmentService,
    private readonly gateway: BookRequestGateway,
  ) {}

  onModuleDestroy(): void {
    this.importQueue.stop();
  }

  /** Direct transfers report once a second; external torrent clients are polled every five. */
  @Cron('* * * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.poll();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[book_request.monitor] [fail] error="${sanitizeLogValue(message)}" - download poll tick failed`);
    } finally {
      this.running = false;
    }
  }

  private async poll(): Promise<void> {
    const now = Date.now();
    if (now - this.lastResumeAt >= RESUME_SWEEP_INTERVAL_MS) {
      this.lastResumeAt = now;
      await this.resumeUnimported();
    }

    if (now - this.lastHeartbeatAt >= IMPORT_HEARTBEAT_INTERVAL_MS) {
      this.lastHeartbeatAt = now;
      await this.heartbeatImports();
    }

    const active = await this.downloads.findActive();
    if (active.length === 0) return;

    const byTarget = new Map<PollTarget, BookRequestDownloadRow[]>();
    for (const row of active) {
      const target = pollTargetFor(row);
      if (target === null) continue;
      const bucket = byTarget.get(target) ?? [];

      bucket.push(row);
      byTarget.set(target, bucket);
    }

    for (const [target, rows] of byTarget) {
      const interval = target === DIRECT ? DIRECT_PROGRESS_INTERVAL_MS : TORRENT_PROGRESS_INTERVAL_MS;
      const lastPolledAt = this.lastClientPollAt.get(target) ?? 0;
      if (now - lastPolledAt < interval) continue;
      // A target that has not answered its previous poll is not one to ask again. One unreachable
      // client burns a twenty-second timeout per read, and queueing the next read behind it is
      // what turned one dead client into a monitor that stopped reporting direct-download
      // progress, other clients' progress and completions along with it.
      if (this.pollsInFlight.has(target)) continue;
      this.lastClientPollAt.set(target, now);
      // Dispatched rather than awaited, for the same reason. The tick's guard covers deciding what
      // to poll, not waiting on it; `pollsInFlight` is what keeps one target's reads serial.
      const poll = this.pollTarget(target, rows)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`[book_request.monitor] [fail] clientId=${target} error="${sanitizeLogValue(message)}" - handling a download poll failed`);
        })
        .finally(() => this.pollsInFlight.delete(target));
      this.pollsInFlight.set(target, poll);
    }
  }

  /** For tests, which are the only callers that need a dispatched poll to have finished writing. */
  async whenPollsSettle(): Promise<void> {
    while (this.pollsInFlight.size > 0) {
      await Promise.allSettled([...this.pollsInFlight.values()]);
    }
  }

  /**
   * A download that finished but whose import never ran - the process died between the two, or the
   * import threw before it could claim a Book Dock row. Nothing else would ever look at it again:
   * `findActive()` stops at `downloading`, so it would sit untouched until the watchdog failed it
   * an hour later with the bytes already on disk.
   *
   * A download stays `completed` for the whole extraction, so this keeps finding the one already
   * being imported. The queue is what recognises it rather than starting it a second time.
   */
  private async resumeUnimported(): Promise<void> {
    const rows = await this.downloads.findCompletedAwaitingImport();
    for (const row of rows) {
      if (!this.importQueue.enqueue(row.id)) continue;
      this.logger.log(`[book_request.monitor] [start] requestId=${row.requestId} downloadId=${row.id} - resuming an import that never ran`);
    }
  }

  /**
   * Keeps the watchdog off the imports this process is actually working on.
   *
   * `findActive()` stops at `downloading`, so nothing else writes to a download once it is queued
   * for import: with concurrency of one, a row can sit at `completed` for as long as everything
   * ahead of it takes, and a large extraction writes nothing for its whole run. The watchdog ages
   * both by `updatedAt` and fails them after an hour, so queue depth alone used to fail healthy
   * imports and a genuinely slow one was failed while it was still running.
   */
  private async heartbeatImports(): Promise<void> {
    const members = this.importQueue.members();
    if (members.length === 0) return;
    const touched = await this.downloads.touch(members);
    if (touched === 0) return;
    this.logger.debug(
      `[book_request.monitor] [end] queued=${members.length} touched=${touched} - kept queued and running imports out of the watchdog`,
    );
  }

  /**
   * Re-read rather than handed the row the poll saw: an import can wait behind another one for as
   * long as that one takes, and a cancellation or a manual fulfilment landing in between makes the
   * row that was queued a description of something that is no longer true.
   */
  private async runImport(downloadId: number): Promise<void> {
    const row = await this.downloads.findById(downloadId);
    if (!row || row.status !== 'completed' || row.bookDockFileId !== null) return;
    await this.imports.importDownload(row);
  }

  /**
   * `importDownload` fails the attempt itself, so anything reaching here threw on the way to doing
   * that. The watchdog is what settles a download this leaves behind.
   */
  private logImportFailure(downloadId: number, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      `[book_request.monitor] [fail] downloadId=${downloadId} errorClass="${sanitizeLogValue(error instanceof Error ? error.name : typeof error)}" error="${sanitizeLogValue(message)}" - import failed outside its own error handling`,
    );
  }

  private async pollTarget(target: PollTarget, rows: BookRequestDownloadRow[]): Promise<void> {
    // A refused attempt is a record of having asked, with nothing handed to anything: there is no
    // hash to ask about, and it is never in a status this polls for anyway.
    const polled = rows.filter((row): row is BookRequestDownloadRow & { clientHash: string } => row.clientHash !== null);
    if (polled.length === 0) return;
    const hashes = polled.map((row) => row.clientHash);

    let statuses: DownloadStatus[];
    try {
      if (target === DIRECT) {
        statuses = await this.direct.status(hashes);
      } else {
        const config = await this.clients.resolveConfig(target);
        const adapter = this.registry.require(config.adapterType);
        statuses = await adapter.status(hashes, config);
      }
    } catch (error) {
      // A client that is down, misconfigured or mid-restart must not fail every download it
      // holds. The watchdog is what eventually gives up on a download that never moves again.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[book_request.monitor] [fail] clientId=${target} active=${rows.length} error="${sanitizeLogValue(message)}" - could not read download status`,
      );
      return;
    }

    const byHash = new Map(statuses.map((status) => [status.infoHash.toLowerCase(), status]));
    // Once for the batch rather than once per progress tick: the audience of a tick is the same
    // set the request list is scoped by, and reading it per download would add a round trip per
    // active transfer per poll.
    const viewers = await this.requests.findRequestViewerIds([...new Set(polled.map((row) => row.requestId))]);
    for (const row of polled) {
      const status = byHash.get(row.clientHash.toLowerCase());
      if (!status) {
        await this.handleMissing(row);
        continue;
      }
      await this.applyStatus(row, status, viewers.get(row.requestId) ?? []);
    }
  }

  /**
   * A hash the target did not report. For a torrent that is usually a client that has not indexed
   * it yet, so it gets a grace period; for a direct transfer it means this process has no record of
   * it, which after the grace can only be a restart, and there is nothing to resume.
   */
  private async handleMissing(row: BookRequestDownloadRow): Promise<void> {
    if (!this.olderThan(row, MISSING_TORRENT_GRACE_MS)) return;
    await this.fulfillment.failDownload(
      row,
      row.source === 'direct_url'
        ? 'The download was interrupted before it finished and cannot be resumed'
        : 'The download client no longer has this torrent',
    );
  }

  private olderThan(row: BookRequestDownloadRow, graceMs: number): boolean {
    return Date.now() - (row.grabbedAt ?? row.createdAt).getTime() >= graceMs;
  }

  private async applyStatus(row: BookRequestDownloadRow, status: DownloadStatus, viewerUserIds: readonly number[]): Promise<void> {
    if (status.state === 'failed') {
      await this.fulfillment.failDownload(row, status.errorMessage ?? 'The download client reported an error');
      return;
    }

    // A refused announce is not a client-level error, so the torrent sits in an ordinary stalled
    // state that reads as a healthy download. Left alone it would occupy the queue until the
    // watchdog gave up on it half a day later, with nothing on the request saying why.
    if (status.trackerError && status.downloadedBytes === 0 && this.olderThan(row, TRACKER_ERROR_GRACE_MS)) {
      await this.fulfillment.failDownload(row, `The tracker rejected this download: ${status.trackerError}`);
      return;
    }

    // `unknown` is a state this adapter has no mapping for, not an idle one: a torrent the client
    // is working on must not read as queued, so it keeps the in-flight spelling.
    const nextStatus: BookRequestDownloadStatus = status.state === 'completed' ? 'completed' : status.state === 'queued' ? 'queued' : 'downloading';

    const movedBytes = status.downloadedBytes > row.downloadedBytes;
    // Conditional on the attempt still being active, because this row was read before a poll that
    // can take twenty seconds to answer. A cancellation that landed inside that window has already
    // taken the attempt out of the active set, and writing this back would undo it: the request
    // would return to `downloading`, and a completed transfer would go on to be imported for a
    // request nobody wants any more. Nothing is skipped by doing so - the next tick reads a fresh
    // row, or there is no next tick because the attempt is over.
    const updated = await this.downloads.updateIf(row.id, ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES, {
      status: nextStatus,
      progressPercent: status.progressPercent,
      downloadedBytes: status.downloadedBytes,
      totalBytes: status.totalBytes,
      contentPath: status.contentPath ?? row.contentPath,
      ...(movedBytes ? { lastProgressAt: new Date() } : {}),
      ...(status.state === 'completed' ? { completedAt: row.completedAt ?? new Date() } : {}),
    });
    if (!updated) return;

    if (row.status === 'queued' && status.state !== 'queued') {
      await this.requests.updateIf(row.requestId, DOWNLOADING_FROM, { status: 'downloading' });
    }

    this.gateway.emitProgress(
      {
        requestId: updated.requestId,
        downloadId: updated.id,
        status: nextStatus,
        progressPercent: updated.progressPercent,
        downloadedBytes: updated.downloadedBytes,
        totalBytes: updated.totalBytes,
      },
      viewerUserIds,
    );

    // Handed off rather than awaited: extracting a release takes minutes, and this runs inside the
    // tick's process-wide guard, so awaiting it would stop progress polling for every other
    // download until it finished.
    if (status.state === 'completed') this.importQueue.enqueue(updated.id);
  }
}

/**
 * A direct file is ours to report on; anything else belongs to the client it was handed to. Null
 * is a torrent whose client row has been deleted, which nothing can report on any more: the
 * watchdog is what eventually gives up on it.
 */
function pollTargetFor(row: BookRequestDownloadRow): PollTarget | null {
  return row.source === 'direct_url' ? DIRECT : row.downloadClientId;
}
