import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  AI_JOB_ACTIONS,
  Permission,
  type AiJobActionResponse,
  type AiJobActionResult,
  type AiJobList,
  type AiJobListItem,
  type AiJobListScope,
  type AiJobListView,
  type AiJobQueueAction,
  type AiJobReason,
  type AiJobStatus,
  type AiJobSubjectRef,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { AiJobRow } from '../../db/schema';
import type { AiFeature, AiSubjectLabel } from './ai-feature';
import { AiFeatureRegistry } from './ai-feature.registry';
import { mayRun } from './ai-job-checks.service';
import { AiJobRepository, type AiJobListFilter, type AiJobListRow } from './ai-job.repository';
import { AI_JOBS_FAILED_VISIBLE_MS } from './ai-jobs.constants';
import { AiJobsService, failedAndShown } from './ai-jobs.service';

/** Subjects checked for reach at once while labelling a page. */
const REACH_CONCURRENCY = 8;

const NO_LABEL: AiSubjectLabel = { label: null, byline: null, url: null, image: null };

export interface AiJobListQuery {
  view: AiJobListView;
  scope: AiJobListScope;
  offset: number;
  limit: number;
}

/** What deciding a job's actions reads. */
type ActionableJob = Pick<AiJobRow, 'feature' | 'status' | 'dismissedAt' | 'finishedAt' | 'requestedBy'>;

/** What naming a job's subject reads. */
type DescribedJob = Pick<AiJobRow, 'id' | 'feature' | 'subjectRef'>;

/** Those who manage the server's settings see and act on every account's jobs. */
export function managesAiJobs(user: Pick<RequestUser, 'isSuperuser' | 'permissions'>): boolean {
  return user.isSuperuser || user.permissions.includes(Permission.ManageAppSettings);
}

/** Whether the job's status lets the action apply at all, whoever asks. */
function statusAllows(row: Pick<AiJobRow, 'status' | 'dismissedAt' | 'finishedAt'>, action: AiJobQueueAction, now: number): boolean {
  switch (action) {
    case 'cancel':
      return row.status === 'queued' || row.status === 'running' || row.status === 'paused';
    case 'pause':
      return row.status === 'queued' || row.status === 'running';
    case 'resume':
      return row.status === 'paused';
    case 'retry':
    case 'dismiss':
      return failedAndShown(row, now);
    case 'prioritize':
      return row.status === 'queued';
  }
}

interface Viewer {
  user: RequestUser;
  manages: boolean;
}

/**
 * Whether this viewer may take the action on a job they can see. Resume and Retry hand the job to
 * whoever asks, so they need the feature's own permission; moving a job ahead of other accounts'
 * jobs is for those who manage the server.
 */
function viewerMay(viewer: Viewer, row: Pick<AiJobRow, 'requestedBy'>, feature: AiFeature | null, action: AiJobQueueAction): boolean {
  if (!feature) return false;
  const runs = mayRun(viewer.user, feature);
  const own = row.requestedBy === viewer.user.id;
  switch (action) {
    case 'cancel':
    case 'pause':
    case 'dismiss':
      return viewer.manages || (own && runs);
    case 'resume':
    case 'retry':
      return runs && (viewer.manages || own);
    case 'prioritize':
      return viewer.manages;
  }
}

/** The AI area: every AI job a person can see, across features, and acting on many at once. */
@Injectable()
export class AiJobQueueService {
  private readonly logger = new Logger(AiJobQueueService.name);

  constructor(
    private readonly registry: AiFeatureRegistry,
    private readonly jobs: AiJobRepository,
    private readonly service: AiJobsService,
  ) {}

  async list(user: RequestUser, query: AiJobListQuery): Promise<AiJobList> {
    const viewer = this.viewer(user, query.scope);
    const now = Date.now();
    const filter: AiJobListFilter = {
      features: this.registry.list().map((feature) => feature.id),
      requestedBy: query.scope === 'all' ? null : user.id,
      shownAfter: new Date(now - AI_JOBS_FAILED_VISIBLE_MS),
    };
    const [{ rows, total }, counts] = await Promise.all([
      this.jobs.list(filter, query.view, query.offset, query.limit),
      this.jobs.countViews(filter),
    ]);
    const [positions, labels] = await Promise.all([
      this.jobs.queuePositions(rows.filter((row) => row.status === 'queued').map((row) => row.id)),
      this.labels(rows, viewer),
    ]);
    return {
      items: rows.map((row) => this.item(row, viewer, positions.get(row.id) ?? null, labels.get(row.id) ?? NO_LABEL, now)),
      total,
      counts,
    };
  }

  /** What this viewer may do to the job now. */
  allowedActions(row: ActionableJob, user: RequestUser, now: number): AiJobQueueAction[] {
    return this.actionsFor(row, { user, manages: managesAiJobs(user) }, now);
  }

  /** Names each job's subject as this viewer may see it; a job whose subject they cannot reach is left out. */
  async describe(rows: readonly DescribedJob[], user: RequestUser): Promise<Map<string, AiSubjectLabel>> {
    return await this.labels(rows, { user, manages: managesAiJobs(user) });
  }

  /**
   * Takes one action on each job, one job at a time, and says what happened to each. A job the
   * viewer cannot see answers `not-found`, the same as one that does not exist, and so does a job
   * of another feature when `feature` limits the request to one.
   */
  async act(user: RequestUser, action: AiJobQueueAction, ids: readonly string[], feature?: string): Promise<AiJobActionResponse> {
    const startedAt = Date.now();
    const viewer: Viewer = { user, manages: managesAiJobs(user) };
    const unique = [...new Set(ids)];
    const rows = new Map((await this.jobs.findByIds(unique)).map((row) => [row.id, row]));
    const results: AiJobActionResult[] = [];
    for (const id of unique) {
      const row = rows.get(id);
      if (!row || (feature !== undefined && row.feature !== feature) || !(viewer.manages || row.requestedBy === user.id)) {
        results.push({ id, outcome: 'not-found', status: null, reason: null });
        continue;
      }
      results.push(await this.actOn(viewer, row, action));
    }
    const done = results.filter((result) => result.outcome === 'done').length;
    this.logger.log(
      `[ai_jobs.action] [end] userId=${user.id} action=${action} jobs=${unique.length} done=${done} durationMs=${Date.now() - startedAt} - AI job action taken`,
    );
    return { results };
  }

  private async actOn(viewer: Viewer, row: AiJobRow, action: AiJobQueueAction): Promise<AiJobActionResult> {
    const result = (outcome: AiJobActionResult['outcome'], job: Pick<AiJobRow, 'status' | 'reason'> | null = row): AiJobActionResult => ({
      id: row.id,
      outcome,
      status: (job?.status ?? null) as AiJobStatus | null,
      reason: (job?.reason ?? null) as AiJobReason | null,
    });
    if (!statusAllows(row, action, Date.now())) return result('skipped');
    if (!viewerMay(viewer, row, this.registry.get(row.feature), action)) return result('refused');
    try {
      switch (action) {
        case 'cancel': {
          const cancelled = await this.service.cancelJob(row.id, viewer.user);
          return cancelled.kind === 'cancelled' ? result('done', cancelled.job) : result('skipped', cancelled.job);
        }
        case 'pause':
          return await this.changed(row, await this.service.pauseJob(row.id, viewer.user), result);
        case 'dismiss':
          return await this.changed(row, await this.service.dismissJob(row.id, viewer.user), result);
        case 'prioritize':
          return await this.changed(row, await this.service.prioritizeJob(row.id, viewer.user), result);
        case 'resume':
        case 'retry': {
          const retried = await this.service.retryJob(row.id, viewer.user);
          switch (retried.kind) {
            case 'resumed':
              return result('done', retried.job);
            case 'still-paused':
              return result('still-paused', retried.job);
            case 'conflict':
              return result('conflict');
            case 'refused':
              return result('refused');
            case 'none':
              return result('skipped', retried.job);
          }
        }
      }
    } catch (error) {
      if (error instanceof ForbiddenException) return result('refused');
      this.logger.warn(
        `[ai_jobs.action] [fail] jobId=${row.id} action=${action} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(
          error instanceof Error ? error.message : String(error),
        )}" - AI job action failed`,
      );
      return result('error');
    }
  }

  /** `done` with the changed row, else `skipped` with the row as it is now. */
  private async changed(
    row: AiJobRow,
    changed: AiJobRow | null,
    result: (outcome: AiJobActionResult['outcome'], job?: Pick<AiJobRow, 'status' | 'reason'> | null) => AiJobActionResult,
  ): Promise<AiJobActionResult> {
    return changed ? result('done', changed) : result('skipped', await this.jobs.findById(row.id));
  }

  private viewer(user: RequestUser, scope: AiJobListScope): Viewer {
    const manages = managesAiJobs(user);
    if (scope === 'all' && !manages) throw new ForbiddenException("Only those who manage the server settings see every account's AI jobs");
    return { user, manages };
  }

  private actionsFor(row: ActionableJob, viewer: Viewer, now: number): AiJobQueueAction[] {
    const feature = this.registry.get(row.feature);
    return AI_JOB_ACTIONS.filter((action) => statusAllows(row, action, now) && viewerMay(viewer, row, feature, action));
  }

  private item(row: AiJobListRow, viewer: Viewer, position: number | null, subject: AiSubjectLabel, now: number): AiJobListItem {
    return {
      id: row.id,
      feature: row.feature,
      kind: row.kind as AiJobListItem['kind'],
      status: row.status as AiJobStatus,
      reason: row.reason as AiJobReason | null,
      phase: row.phase,
      done: row.done,
      total: row.total,
      position: row.status === 'queued' ? position : null,
      subject,
      requester: row.requestedBy === null ? null : { id: row.requestedBy, name: row.requesterName ?? '' },
      cost: viewer.manages && row.costMicros !== null ? row.costMicros / 1_000_000 : null,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      pausedAt: row.pausedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      actions: this.actionsFor(row, viewer, now),
    };
  }

  /**
   * Each feature names its own subjects in one read. Someone who does not manage the server sees a
   * name only while they can still reach the subject, so losing access to a library also hides
   * what their old jobs built.
   */
  private async labels(rows: readonly DescribedJob[], viewer: Viewer): Promise<Map<string, AiSubjectLabel>> {
    const byFeature = new Map<string, Map<string, AiJobSubjectRef>>();
    for (const row of rows) {
      const refs = byFeature.get(row.feature) ?? new Map<string, AiJobSubjectRef>();
      refs.set(row.id, row.subjectRef);
      byFeature.set(row.feature, refs);
    }
    const labels = new Map<string, AiSubjectLabel>();
    for (const [featureId, refs] of byFeature) {
      const feature = this.registry.get(featureId);
      if (!feature) continue;
      const described = await feature.describe(refs);
      const reachable = viewer.manages ? null : await this.reachable(feature, viewer.user, refs);
      for (const [jobId, label] of described) {
        if (!reachable || reachable.has(JSON.stringify(refs.get(jobId)))) labels.set(jobId, label);
      }
    }
    return labels;
  }

  private async reachable(feature: AiFeature, user: RequestUser, refs: ReadonlyMap<string, AiJobSubjectRef>): Promise<Set<string>> {
    const distinct = new Map([...refs.values()].map((ref) => [JSON.stringify(ref), ref]));
    const reached = await mapWithConcurrency([...distinct], REACH_CONCURRENCY, async ([key, ref]) =>
      (await feature.canReach(user, ref)) ? key : null,
    );
    return new Set(reached.filter((key): key is string => key !== null));
  }
}
