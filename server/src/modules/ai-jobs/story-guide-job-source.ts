import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  AI_JOB_ACTIONS,
  STORY_GUIDE_FEATURE,
  type AiJobQueueAction,
  type JobActionKind,
  type JobCounts,
  type JobStatus,
  type JobSubject,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { JobChangesService } from '../jobs/job-changes.service';
import type { JobAccess, JobSource, JobViewer, SourceActionResult, SourceCountQuery, SourceListQuery, SourceRow } from '../jobs/job-source';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import { AiFeatureRegistry } from './ai-feature.registry';
import { AI_JOB_CHANGED, AiJobChanges, type AiJobChange } from './ai-job-changes.service';
import { mayRun } from './ai-job-checks.service';
import { AiJobQueueService, managesAiJobs } from './ai-job-queue.service';
import { AiJobRepository, type AiJobPageRow } from './ai-job.repository';
import { AI_JOBS_FAILED_VISIBLE_MS } from './ai-jobs.constants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface StoryGuideJobRow extends SourceRow {
  job: AiJobPageRow;
}

function isAiAction(action: JobActionKind): action is AiJobQueueAction {
  return (AI_JOB_ACTIONS as readonly string[]).includes(action);
}

/**
 * Story-guide builds in the Jobs area: the `story-guides` feature's AI jobs, whose statuses map one
 * to one. One lane, so queued jobs carry their place in it. Actions are the AI area's own, under its
 * rules; a later AI feature that runs jobs gets its own type.
 */
@Injectable()
export class StoryGuideJobSource implements JobSource<StoryGuideJobRow>, OnModuleInit, OnModuleDestroy {
  readonly type = 'story-guide' as const;
  readonly failedWindowMs = AI_JOBS_FAILED_VISIBLE_MS;
  private readonly bridge = (change: AiJobChange): void => {
    if (change.feature !== STORY_GUIDE_FEATURE) return;
    this.changes.notify({ type: this.type, ownerId: change.requestedBy, state: change.kind === 'state' });
  };

  constructor(
    private readonly registry: JobSourceRegistry,
    private readonly changes: JobChangesService,
    private readonly aiChanges: AiJobChanges,
    private readonly features: AiFeatureRegistry,
    private readonly jobs: AiJobRepository,
    private readonly queue: AiJobQueueService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
    this.aiChanges.on(AI_JOB_CHANGED, this.bridge);
  }

  onModuleDestroy(): void {
    this.aiChanges.off(AI_JOB_CHANGED, this.bridge);
  }

  access(user: RequestUser): JobAccess {
    const feature = this.features.get(STORY_GUIDE_FEATURE);
    return { own: feature !== null && mayRun(user, feature), all: managesAiJobs(user) };
  }

  async list(query: SourceListQuery, viewer: JobViewer): Promise<StoryGuideJobRow[]> {
    if (query.view === 'needs-you') return [];
    const rows = await this.jobs.pageForJobs({
      feature: STORY_GUIDE_FEATURE,
      view: query.view,
      owner: query.owner,
      cutoffAt: query.cutoffAt,
      after: query.after,
      typeIndex: query.typeIndex,
      limit: query.limit,
    });
    return rows.map((job) => ({
      nativeId: job.id,
      key: job.key,
      job,
      item: {
        kind: job.kind,
        shape: 'job',
        status: job.status as JobStatus,
        reason: job.reason,
        phase: job.phase,
        done: job.done,
        // A build counts its work once it has planned it.
        total: job.total > 0 ? job.total : null,
        percent: null,
        position: job.status === 'queued' ? job.rank : null,
        requester: job.requestedBy === null ? null : { id: job.requestedBy, name: job.requesterName ?? '' },
        cost: viewer.access.all && job.costMicros !== null ? job.costMicros / 1_000_000 : null,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        pausedAt: job.pausedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
        extra: null,
      },
    }));
  }

  async counts(query: SourceCountQuery): Promise<JobCounts> {
    const counts = await this.jobs.countForJobs(STORY_GUIDE_FEATURE, query.owner, query.cutoffAt);
    return { queue: counts.queue, needsYou: 0, failed: counts.failed, running: counts.running, queued: counts.queued, paused: counts.paused };
  }

  async describe(rows: StoryGuideJobRow[], viewer: JobViewer): Promise<Map<string, JobSubject>> {
    return await this.queue.describe(
      rows.map((row) => row.job),
      viewer.user,
    );
  }

  actions(row: StoryGuideJobRow, viewer: JobViewer, now: number): { actions: JobActionKind[]; note: string | null } {
    return { actions: this.queue.allowedActions(row.job, viewer.user, now), note: null };
  }

  async act(action: JobActionKind, nativeIds: string[], viewer: JobViewer): Promise<SourceActionResult[]> {
    const valid = nativeIds.filter((id) => UUID.test(id));
    const results = new Map<string, SourceActionResult>(nativeIds.map((id) => [id, { id, outcome: 'not-found', status: null }]));
    if (valid.length > 0 && !isAiAction(action)) {
      for (const id of valid) results.set(id, { id, outcome: 'refused', status: null });
    } else if (valid.length > 0 && isAiAction(action)) {
      const response = await this.queue.act(viewer.user, action, valid, STORY_GUIDE_FEATURE);
      for (const result of response.results) results.set(result.id, { id: result.id, outcome: result.outcome, status: result.status });
    }
    return nativeIds.map((id) => results.get(id)!);
  }
}
