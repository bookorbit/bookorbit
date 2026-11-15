import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditAction, Permission, type JobActionKind, type JobCounts, type JobStatus, type JobSubject, type JobView } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AUDIT_EVENT, AuditEventsService } from '../audit/audit-events.service';
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
import { AuthorEnrichmentConfigService } from './author-enrichment-config.service';
import { AuthorEnrichmentOrchestratorService } from './author-enrichment-orchestrator.service';
import { AuthorEnrichmentSessionService } from './author-enrichment-session.service';
import { AuthorEnrichmentRepository, type AuthorEnrichmentJobCounts } from './author-enrichment.repository';

/** A failure summary leaves Failed once a week passes with no new failure; the settings page still lists them. */
export const AUTHOR_ENRICHMENT_FAILED_VISIBLE_MS = 7 * 24 * 60 * 60 * 1000;

/** Where both rows open: the page that lists the failures and holds the same controls. */
const SETTINGS_URL = '/settings/metadata/authors';

/** `queue`: waiting, running and rate-limited enrichments. `failed`: enrichments that gave up. */
export type AuthorEnrichmentBucket = 'queue' | 'failed';

const BUCKET_ACTIONS: Record<AuthorEnrichmentBucket, readonly JobActionKind[]> = {
  queue: ['pause', 'resume', 'cancel'],
  failed: ['retry'],
};

const AUDITED: Partial<Record<JobActionKind, { action: AuditAction; description: string }>> = {
  pause: { action: AuditAction.AuthorEnrichmentPause, description: 'Paused author enrichment' },
  resume: { action: AuditAction.AuthorEnrichmentResume, description: 'Resumed author enrichment' },
  cancel: { action: AuditAction.AuthorEnrichmentCancel, description: 'Cancelled pending author enrichment jobs' },
};

export interface AuthorEnrichmentQueueState {
  counts: AuthorEnrichmentJobCounts;
  paused: boolean;
}

export interface AuthorEnrichmentJobRow extends SourceRow {
  bucket: AuthorEnrichmentBucket;
  state: AuthorEnrichmentQueueState;
}

function isBucket(nativeId: string): nativeId is AuthorEnrichmentBucket {
  return nativeId === 'queue' || nativeId === 'failed';
}

function iso(microseconds: number): string {
  return new Date(Math.floor(microseconds / 1000)).toISOString();
}

/** The enrichment routes' own rule: managing app settings shows the queue but changes nothing. */
function mayAct(user: RequestUser): boolean {
  return user.active && (user.isSuperuser || user.permissions.includes(Permission.ManageMetadataConfig));
}

function remaining(counts: AuthorEnrichmentJobCounts): number {
  return counts.queued + counts.processing + counts.rateLimited;
}

/** The pause flag wins: a paused queue may still finish the one author it had started. */
function queueStatus(state: AuthorEnrichmentQueueState): JobStatus | null {
  if (remaining(state.counts) === 0) return null;
  if (state.paused) return 'paused';
  return state.counts.processing > 0 ? 'running' : 'queued';
}

function bucketStatus(bucket: AuthorEnrichmentBucket, state: AuthorEnrichmentQueueState): JobStatus | null {
  if (bucket === 'queue') return queueStatus(state);
  return state.counts.failed > 0 ? 'failed' : null;
}

function statusAllows(bucket: AuthorEnrichmentBucket, action: JobActionKind, state: AuthorEnrichmentQueueState): boolean {
  if (!BUCKET_ACTIONS[bucket].includes(action)) return false;
  const status = bucketStatus(bucket, state);
  switch (action) {
    case 'pause':
      return status !== null && status !== 'paused';
    case 'resume':
      return status === 'paused';
    // Cancel clears what waits; the author already running finishes either way.
    case 'cancel':
      return state.counts.queued + state.counts.rateLimited > 0;
    case 'retry':
      return status === 'failed';
    default:
      return false;
  }
}

/**
 * Author enrichment in the Jobs area. One background queue for the whole server, so it shows as up
 * to two ownerless summary rows that managers see: what waits or runs in Queue, and what gave up in
 * Failed. Silent `metadata_replace` entries are left out of the queue row, as the session leaves
 * them out of its counts; every failure counts, as retry requeues them all.
 */
@Injectable()
export class AuthorEnrichmentJobSource implements JobSource<AuthorEnrichmentJobRow>, OnModuleInit {
  readonly type = 'author-enrichment' as const;
  readonly failedWindowMs = AUTHOR_ENRICHMENT_FAILED_VISIBLE_MS;
  private readonly logger = new Logger(AuthorEnrichmentJobSource.name);

  constructor(
    private readonly registry: JobSourceRegistry,
    private readonly queueRepo: AuthorEnrichmentRepository,
    private readonly enrichmentConfig: AuthorEnrichmentConfigService,
    private readonly session: AuthorEnrichmentSessionService,
    private readonly orchestrator: AuthorEnrichmentOrchestratorService,
    private readonly auditEvents: AuditEventsService,
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

  async list(query: SourceListQuery): Promise<AuthorEnrichmentJobRow[]> {
    if (query.view === 'needs-you' || query.view === 'history' || !this.includesOwnerless(query.owner)) return [];
    const state = await this.readState();
    const row = this.row(query.view, state, query.cutoffAt.getTime() * 1000);
    if (!row) return [];
    if (query.after && compareJobPositions(query.view, { ...row.key, typeIndex: query.typeIndex }, query.after) <= 0) return [];
    return query.limit > 0 ? [row] : [];
  }

  /** A summary row counts once in its view, however many authors it stands for. */
  async counts(query: SourceCountQuery): Promise<JobCounts> {
    const counts: JobCounts = { queue: 0, needsYou: 0, failed: 0, running: 0, queued: 0, paused: 0 };
    if (!this.includesOwnerless(query.owner)) return counts;
    const state = await this.readState();
    const status = queueStatus(state);
    if (status !== null) {
      counts.queue = 1;
      if (status === 'running') counts.running = 1;
      else if (status === 'paused') counts.paused = 1;
      else counts.queued = 1;
    }
    if (this.failedVisible(state.counts, query.cutoffAt.getTime() * 1000)) counts.failed = 1;
    return counts;
  }

  describe(rows: AuthorEnrichmentJobRow[], viewer: JobViewer): Promise<Map<string, JobSubject>> {
    // The settings page reads routes only metadata managers may call.
    const subject: JobSubject = { label: null, byline: null, url: mayAct(viewer.user) ? SETTINGS_URL : null, image: null };
    return Promise.resolve(new Map(rows.map((row) => [row.nativeId, subject])));
  }

  actions(row: AuthorEnrichmentJobRow, viewer: JobViewer): { actions: JobActionKind[]; note: string | null } {
    const applicable = BUCKET_ACTIONS[row.bucket].filter((action) => statusAllows(row.bucket, action, row.state));
    if (mayAct(viewer.user)) return { actions: [...applicable], note: null };
    return { actions: [], note: applicable.length > 0 ? 'metadata-config' : null };
  }

  async act(action: JobActionKind, nativeIds: string[], viewer: JobViewer): Promise<SourceActionResult[]> {
    const startedAt = Date.now();
    const unique = [...new Set(nativeIds)];
    // Each action applies to one row only, so a single read serves both.
    const state = viewer.access.all && unique.some(isBucket) ? await this.readState() : null;
    const results = new Map<string, SourceActionResult>();
    for (const id of unique) {
      results.set(id, state && isBucket(id) ? await this.actOn(action, id, state, viewer) : { id, outcome: 'not-found', status: null });
    }
    const done = [...results.values()].filter((result) => result.outcome === 'done').length;
    this.logger.log(
      `[author_enrichment.jobs_action] [end] userId=${viewer.user.id} action=${action} rows=${unique.length} done=${done} durationMs=${Date.now() - startedAt} - author enrichment job action taken`,
    );
    return nativeIds.map((id) => results.get(id)!);
  }

  private async actOn(
    action: JobActionKind,
    bucket: AuthorEnrichmentBucket,
    state: AuthorEnrichmentQueueState,
    viewer: JobViewer,
  ): Promise<SourceActionResult> {
    const status = bucketStatus(bucket, state);
    if (!statusAllows(bucket, action, state)) return { id: bucket, outcome: 'skipped', status };
    if (!mayAct(viewer.user)) return { id: bucket, outcome: 'refused', status };
    try {
      switch (action) {
        case 'pause':
          await this.orchestrator.pause();
          this.audit(action, viewer.user);
          return { id: bucket, outcome: 'done', status: 'paused' };
        case 'resume':
          await this.orchestrator.resume();
          this.audit(action, viewer.user);
          return { id: bucket, outcome: 'done', status: state.counts.processing > 0 ? 'running' : 'queued' };
        case 'cancel':
          await this.orchestrator.cancelPending();
          this.audit(action, viewer.user);
          // Cancel also pauses, so an author still running keeps the row, paused, until it finishes.
          return { id: bucket, outcome: 'done', status: state.counts.processing > 0 ? 'paused' : null };
        case 'retry': {
          const requeued = await this.orchestrator.requeueFailed();
          return requeued > 0 ? { id: bucket, outcome: 'done', status: 'queued' } : { id: bucket, outcome: 'skipped', status: null };
        }
        default:
          return { id: bucket, outcome: 'skipped', status };
      }
    } catch (error) {
      this.logger.warn(
        `[author_enrichment.jobs_action] [fail] row=${bucket} action=${action} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - author enrichment job action failed`,
      );
      return { id: bucket, outcome: 'error', status: null };
    }
  }

  /** The same audit entries the enrichment routes write, so the log reads the same whichever page acted. */
  private audit(action: JobActionKind, user: RequestUser): void {
    const entry = AUDITED[action];
    if (!entry) return;
    this.auditEvents.emit(AUDIT_EVENT, { userId: user.id, actorUsername: user.username, action: entry.action, description: entry.description });
  }

  private async readState(): Promise<AuthorEnrichmentQueueState> {
    const [counts, paused] = await Promise.all([this.queueRepo.countForJobs(), this.enrichmentConfig.isPaused()]);
    return { counts, paused };
  }

  /** Every row is ownerless, so a read limited to one account's own rows finds none. */
  private includesOwnerless(owner: JobOwnerFilter): boolean {
    return owner === null || owner.ownerless;
  }

  private failedVisible(counts: AuthorEnrichmentJobCounts, cutoff: number): boolean {
    return counts.failed > 0 && counts.failedAt !== null && counts.failedAt > cutoff;
  }

  private row(view: JobView, state: AuthorEnrichmentQueueState, cutoff: number): AuthorEnrichmentJobRow | null {
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
    const { counts } = state;
    if (view === 'queue') {
      const status = queueStatus(state);
      if (status === null || counts.queueSince === null) return null;
      const group = status === 'running' ? [0, 0] : status === 'queued' ? [1, 1] : [2, 0];
      const key: JobKey = { prefix: group, suffix: [counts.queueSince], id: 'queue' };
      return {
        nativeId: 'queue',
        key,
        bucket: 'queue',
        state,
        item: {
          ...base,
          status,
          reason: this.queueReason(state),
          ...this.progress(counts),
          createdAt: iso(counts.queueSince),
          finishedAt: null,
          extra: { rateLimited: counts.rateLimited },
        },
      };
    }
    if (view !== 'failed' || !this.failedVisible(counts, cutoff)) return null;
    const failedAt = counts.failedAt!;
    const key: JobKey = { prefix: [failedAt], suffix: [], id: 'failed' };
    return {
      nativeId: 'failed',
      key,
      bucket: 'failed',
      state,
      item: {
        ...base,
        status: 'failed',
        reason: 'failed',
        done: null,
        total: null,
        createdAt: iso(failedAt),
        finishedAt: iso(failedAt),
        extra: { failed: counts.failed },
      },
    };
  }

  private queueReason(state: AuthorEnrichmentQueueState): string | null {
    if (state.paused) return 'user';
    const { queued, processing, rateLimited } = state.counts;
    return queued + processing === 0 && rateLimited > 0 ? 'rate-limited' : null;
  }

  /**
   * Done of total from the session while it accounts for exactly what waits. The session is kept in
   * memory, so a restart or a cancel resets it while entries remain; the row then shows how many
   * remain rather than a total that no longer adds up.
   */
  private progress(counts: AuthorEnrichmentJobCounts): { done: number | null; total: number } {
    const left = remaining(counts);
    const { sessionTotal, sessionDone } = this.session.getSnapshot();
    if (sessionTotal > 0 && sessionTotal - sessionDone === left) return { done: sessionDone, total: sessionTotal };
    return { done: null, total: left };
  }
}
