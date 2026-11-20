import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Permission, type JobActionKind, type JobCounts, type JobStatus, type JobSubject, type JobView } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { compareJobPositions, type JobKey } from '../jobs/job-keyset';
import type {
  JobAccess,
  JobOwnerFilter,
  JobSource,
  JobViewer,
  SourceActionResult,
  SourceCountQuery,
  SourceListQuery,
  SourceRow,
} from '../jobs/job-source';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import { BookMetadataFetchConfigService } from './book-metadata-fetch-config.service';
import { BookMetadataFetchOrchestratorService } from './book-metadata-fetch-orchestrator.service';
import { BookMetadataFetchQueueRepository, type BookMetadataFetchJobCounts } from './book-metadata-fetch-queue.repository';
import { BookMetadataFetchSessionService } from './book-metadata-fetch-session.service';
import { metadataFetchQueueStatus, type MetadataFetchQueueStatus } from './metadata-fetch-job-status';

/** The failed row leaves Failed once a week passes with no new failure; the settings page still lists and retries them. */
export const METADATA_FETCH_FAILED_VISIBLE_MS = 7 * 24 * 60 * 60 * 1000;

/** Where both rows open; only viewers who may change the metadata fetch settings can reach it. */
const SETTINGS_URL = '/settings/metadata/auto-fetch';

/** `queue`: queued and processing books. `failed`: books whose fetch gave up. */
export type MetadataFetchBucket = 'queue' | 'failed';

const BUCKET_ACTIONS: Record<MetadataFetchBucket, readonly JobActionKind[]> = {
  queue: ['pause', 'resume', 'cancel'],
  failed: ['retry'],
};

/** Running leads the Queue; queued sits in the first band, as a parallel lane does; paused goes last. */
const QUEUE_PREFIX: Record<MetadataFetchQueueStatus, [number, number]> = {
  running: [0, 0],
  queued: [1, 1],
  paused: [2, 0],
};

interface MetadataFetchState {
  counts: BookMetadataFetchJobCounts;
  paused: boolean;
}

export interface MetadataFetchJobRow extends SourceRow {
  bucket: MetadataFetchBucket;
  state: MetadataFetchState;
  /** The book being fetched as the row was read. */
  currentItemName: string | null;
}

function isBucket(nativeId: string): nativeId is MetadataFetchBucket {
  return nativeId === 'queue' || nativeId === 'failed';
}

/** The same rule the metadata fetch settings and their endpoints use. */
function configures(user: RequestUser): boolean {
  return user.active && (user.isSuperuser || user.permissions.includes(Permission.ManageMetadataConfig));
}

function iso(microseconds: number): string {
  return new Date(Math.floor(microseconds / 1000)).toISOString();
}

/** Ownerless rows reach a read only when it covers everyone or asks for the ownerless ones too. */
function coversOwnerless(owner: JobOwnerFilter): boolean {
  return owner === null || owner.ownerless;
}

function statusOf(bucket: MetadataFetchBucket, state: MetadataFetchState): JobStatus | null {
  if (bucket === 'queue') return metadataFetchQueueStatus(state.counts, state.paused);
  return state.counts.failed > 0 ? 'failed' : null;
}

/** Whether the row's state lets the action apply at all, whoever asks. */
function statusAllows(bucket: MetadataFetchBucket, action: JobActionKind, state: MetadataFetchState): boolean {
  const { counts, paused } = state;
  if (bucket === 'failed') return action === 'retry' && counts.failed > 0;
  switch (action) {
    case 'pause':
      return !paused && counts.queued + counts.processing > 0;
    case 'resume':
      return paused && counts.queued + counts.processing > 0;
    // Cancel clears what waits; the book being fetched finishes.
    case 'cancel':
      return counts.queued > 0;
    default:
      return false;
  }
}

/**
 * The book metadata fetch queue in the Jobs area. It runs for the whole server and its queue can
 * hold tens of thousands of books, which the settings page already lists, so it shows as two
 * summary rows: waiting and running books in Queue, failures in Failed. Success deletes a queue
 * entry, so nothing reaches History. Every number comes from one count-only read.
 */
@Injectable()
export class MetadataFetchJobSource implements JobSource<MetadataFetchJobRow>, OnModuleInit {
  readonly type = 'metadata-fetch' as const;
  readonly failedWindowMs = METADATA_FETCH_FAILED_VISIBLE_MS;
  private readonly logger = new Logger(MetadataFetchJobSource.name);

  constructor(
    private readonly registry: JobSourceRegistry,
    private readonly queueRepo: BookMetadataFetchQueueRepository,
    private readonly configService: BookMetadataFetchConfigService,
    private readonly session: BookMetadataFetchSessionService,
    private readonly orchestrator: BookMetadataFetchOrchestratorService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  access(user: RequestUser): JobAccess {
    return {
      own: false,
      all:
        user.active &&
        (user.isSuperuser || user.permissions.includes(Permission.ManageMetadataConfig) || user.permissions.includes(Permission.ManageAppSettings)),
    };
  }

  async list(query: SourceListQuery): Promise<MetadataFetchJobRow[]> {
    if ((query.view !== 'queue' && query.view !== 'failed') || !coversOwnerless(query.owner) || query.limit <= 0) return [];
    const row = this.row(query.view, await this.state(), query.cutoffAt.getTime() * 1000);
    if (!row) return [];
    if (query.after !== null && compareJobPositions(query.view, { ...row.key, typeIndex: query.typeIndex }, query.after) <= 0) return [];
    return [row];
  }

  /** Each summary row counts once in its view, however many books it stands for. */
  async counts(query: SourceCountQuery): Promise<JobCounts> {
    const counts: JobCounts = { queue: 0, needsYou: 0, failed: 0, running: 0, queued: 0, paused: 0 };
    if (!coversOwnerless(query.owner)) return counts;
    const state = await this.state();
    const status = metadataFetchQueueStatus(state.counts, state.paused);
    if (status !== null) {
      counts.queue = 1;
      counts[status] = 1;
    }
    if (this.failedVisible(state.counts, query.cutoffAt.getTime() * 1000)) counts.failed = 1;
    return counts;
  }

  /** Nothing to look up: the page names the rows by type, and the settings page is the only place they open. */
  describe(rows: MetadataFetchJobRow[], viewer: JobViewer): Promise<Map<string, JobSubject>> {
    const url = configures(viewer.user) ? SETTINGS_URL : null;
    return Promise.resolve(
      new Map(
        rows.map((row) => [
          row.nativeId,
          { label: null, byline: row.bucket === 'queue' && row.item.status === 'running' ? row.currentItemName : null, url, image: null },
        ]),
      ),
    );
  }

  actions(row: MetadataFetchJobRow, viewer: JobViewer): { actions: JobActionKind[]; note: string | null } {
    const applicable = BUCKET_ACTIONS[row.bucket].filter((action) => statusAllows(row.bucket, action, row.state));
    const actions = configures(viewer.user) ? applicable : [];
    if (actions.length > 0 || applicable.length === 0) return { actions, note: null };
    return { actions, note: 'metadata-config' };
  }

  async act(action: JobActionKind, nativeIds: string[], viewer: JobViewer): Promise<SourceActionResult[]> {
    const startedAt = Date.now();
    const unique = [...new Set(nativeIds)];
    const state = viewer.access.all && unique.some(isBucket) ? await this.state() : null;
    const results = new Map<string, SourceActionResult>();
    for (const id of unique) results.set(id, await this.actOn(action, id, state, viewer));
    const done = [...results.values()].filter((result) => result.outcome === 'done').length;
    this.logger.log(
      `[book.metadata_fetch.jobs_action] [end] userId=${viewer.user.id} action=${action} rows=${unique.length} done=${done} durationMs=${Date.now() - startedAt} - metadata fetch job action taken`,
    );
    return nativeIds.map((id) => results.get(id)!);
  }

  private async actOn(action: JobActionKind, id: string, state: MetadataFetchState | null, viewer: JobViewer): Promise<SourceActionResult> {
    if (!isBucket(id) || !viewer.access.all || state === null) return { id, outcome: 'not-found', status: null };
    const before = statusOf(id, state);
    if (before === null || !BUCKET_ACTIONS[id].includes(action) || !statusAllows(id, action, state))
      return { id, outcome: 'skipped', status: before };
    if (!configures(viewer.user)) return { id, outcome: 'refused', status: before };
    try {
      switch (action) {
        case 'pause':
          await this.orchestrator.pause();
          return { id, outcome: 'done', status: 'paused' };
        case 'resume':
          await this.orchestrator.resume();
          return { id, outcome: 'done', status: state.counts.processing > 0 ? 'running' : 'queued' };
        case 'cancel':
          // Cancel also pauses, so a book still being fetched leaves the row paused until it ends.
          await this.orchestrator.cancelPending();
          return { id, outcome: 'done', status: state.counts.processing > 0 ? 'paused' : 'cancelled' };
        case 'retry': {
          const requeued = await this.orchestrator.requeueFailed();
          // Retried failures are back in line; none left means another request retried them first.
          return requeued > 0 ? { id, outcome: 'done', status: 'queued' } : { id, outcome: 'skipped', status: null };
        }
        default:
          return { id, outcome: 'skipped', status: before };
      }
    } catch (error) {
      this.logger.warn(
        `[book.metadata_fetch.jobs_action] [fail] row=${id} action=${action} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - metadata fetch job action failed`,
      );
      return { id, outcome: 'error', status: null };
    }
  }

  private async state(): Promise<MetadataFetchState> {
    const [counts, paused] = await Promise.all([this.queueRepo.countForJobs(), this.configService.isPaused()]);
    return { counts, paused };
  }

  private failedVisible(counts: BookMetadataFetchJobCounts, cutoff: number): counts is BookMetadataFetchJobCounts & { failedAt: number } {
    return counts.failed > 0 && counts.failedAt !== null && counts.failedAt > cutoff;
  }

  private row(view: JobView, state: MetadataFetchState, cutoff: number): MetadataFetchJobRow | null {
    const { counts } = state;
    const base = {
      kind: null,
      shape: 'queue' as const,
      phase: null,
      percent: null,
      position: null,
      requester: null,
      cost: null,
      startedAt: null,
      pausedAt: null,
    };
    if (view === 'queue') {
      const status = metadataFetchQueueStatus(counts, state.paused);
      if (status === null || counts.queueSince === null) return null;
      const session = this.session.getSnapshot();
      // The session restarts when the queue empties, on cancel and on restart; the row then shows what remains.
      const tracked = session.sessionTotal > 0;
      const key: JobKey = { prefix: QUEUE_PREFIX[status], suffix: [counts.queueSince], id: 'queue' };
      return {
        nativeId: 'queue',
        key,
        bucket: 'queue',
        state,
        currentItemName: session.currentItemName,
        item: {
          ...base,
          status,
          reason: null,
          done: tracked ? session.sessionDone : null,
          total: tracked ? session.sessionTotal : counts.queued + counts.processing,
          createdAt: iso(counts.queueSince),
          finishedAt: null,
          extra: null,
        },
      };
    }
    if (!this.failedVisible(counts, cutoff)) return null;
    const key: JobKey = { prefix: [counts.failedAt], suffix: [], id: 'failed' };
    return {
      nativeId: 'failed',
      key,
      bucket: 'failed',
      state,
      currentItemName: null,
      item: {
        ...base,
        status: 'failed',
        reason: 'failed',
        done: null,
        total: null,
        createdAt: iso(counts.failedAt),
        finishedAt: iso(counts.failedAt),
        extra: { failed: counts.failed },
      },
    };
  }
}
