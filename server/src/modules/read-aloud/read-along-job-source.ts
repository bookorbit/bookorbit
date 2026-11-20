import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { Permission, type JobActionKind, type JobCounts, type JobStatus, type JobSubject } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { ReadAloudJobRow } from '../../db/schema';
import { BookJobSubjects } from '../book/book-job-subjects.service';
import type { JobAccess, JobSource, JobViewer, SourceActionResult, SourceCountQuery, SourceListQuery, SourceRow } from '../jobs/job-source';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import { ReadAloudJobRepository, type ReadAloudPageRow } from './read-aloud-job.repository';
import { managesReadAlong, ReadAloudService } from './read-aloud.service';
import { READ_ALOUD_FAILED_WORK_TTL_MS } from './read-aloud.constants';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTIVE = new Set(['queued', 'processing', 'awaiting_review']);
const ACTIONS = new Set<JobActionKind>(['cancel', 'pause', 'resume', 'retry', 'dismiss', 'move-to-top', 'prioritize']);

type ActionableJob = Pick<
  ReadAloudJobRow,
  'requestedByUserId' | 'status' | 'stage' | 'cancelRequested' | 'publishApproved' | 'pausedAt' | 'dismissedAt' | 'workExpiresAt'
>;

export interface ReadAlongJobRow extends SourceRow {
  job: ReadAloudPageRow;
}

function mayGenerate(user: RequestUser): boolean {
  return user.active && (user.isSuperuser || user.permissions.includes(Permission.LibraryGenerateReadAloud));
}

/** Demo accounts may watch, as the book page lets them, but change nothing. */
function restricted(user: RequestUser): boolean {
  return !user.isSuperuser && user.permissions.includes(Permission.DemoRestricted);
}

function status(row: Pick<ReadAloudJobRow, 'status' | 'pausedAt'>): JobStatus {
  switch (row.status) {
    case 'queued':
      return row.pausedAt ? 'paused' : 'queued';
    case 'processing':
      return 'running';
    case 'awaiting_review':
      return 'needs-you';
    case 'completed':
    case 'completed_with_warnings':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'cancelled';
  }
}

function reason(row: ReadAloudPageRow): string | null {
  if (row.status === 'queued' && row.pausedAt) return 'user';
  if (row.status === 'awaiting_review') return 'review';
  if (row.status === 'completed_with_warnings') return 'warnings';
  if (row.status === 'failed' || row.status === 'cancelled') return row.errorCode;
  return null;
}

/** Whether the job's state lets the action apply at all, whoever asks. */
function statusAllows(row: ActionableJob, action: JobActionKind, now: number): boolean {
  const queued = row.status === 'queued' && !row.cancelRequested;
  switch (action) {
    case 'pause':
    case 'prioritize':
      return queued && !row.publishApproved && row.pausedAt === null;
    case 'resume':
      return row.status === 'queued' && row.pausedAt !== null;
    case 'move-to-top':
      return queued;
    // Review stays on the book page, so a job waiting on it is not cancelled from here.
    case 'cancel':
      return (row.status === 'queued' || row.status === 'processing') && !row.cancelRequested && row.stage !== 'publishing' && !row.publishApproved;
    case 'retry':
      return row.status === 'failed' && row.workExpiresAt !== null && row.workExpiresAt.getTime() > now;
    case 'dismiss':
      return row.status === 'failed' && row.dismissedAt === null;
    default:
      return false;
  }
}

/** Whether this viewer may take the action, the job's state aside. */
function viewerMay(user: RequestUser, row: ActionableJob, action: JobActionKind): boolean {
  if (restricted(user)) return false;
  if (action === 'prioritize') return managesReadAlong(user);
  return mayGenerate(user) && (user.isSuperuser || (row.requestedByUserId !== null && row.requestedByUserId === user.id));
}

/**
 * Read-along builds in the Jobs area. One worker, so every queued job has a place in one fair line
 * across requesters (decision 14). Review stays on the book page; the Needs you row links there.
 * The book page's own rule for who reads a job is wider and is unchanged.
 */
@Injectable()
export class ReadAlongJobSource implements JobSource<ReadAlongJobRow>, OnModuleInit {
  readonly type = 'read-along' as const;
  readonly failedWindowMs = READ_ALOUD_FAILED_WORK_TTL_MS;
  private readonly logger = new Logger(ReadAlongJobSource.name);

  constructor(
    private readonly registry: JobSourceRegistry,
    private readonly jobs: ReadAloudJobRepository,
    private readonly readAloud: ReadAloudService,
    private readonly subjects: BookJobSubjects,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  access(user: RequestUser): JobAccess {
    return { own: mayGenerate(user), all: user.active && managesReadAlong(user) };
  }

  async list(query: SourceListQuery): Promise<ReadAlongJobRow[]> {
    const rows = await this.jobs.pageForJobs({
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
        kind: null,
        shape: 'job',
        status: status(job),
        reason: reason(job),
        phase: job.status === 'processing' ? job.stage : null,
        // The stage counters restart every stage; the overall percentage is what the bar shows.
        done: null,
        total: null,
        percent: job.status === 'processing' ? job.progress : null,
        position: job.status === 'queued' && !job.pausedAt && job.rank > 0 ? job.rank : null,
        requester: job.requestedByUserId === null ? null : { id: job.requestedByUserId, name: job.requesterName ?? '' },
        cost: null,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.status === 'processing' ? (job.startedAt?.toISOString() ?? null) : null,
        pausedAt: job.status === 'queued' ? (job.pausedAt?.toISOString() ?? null) : null,
        finishedAt: ACTIVE.has(job.status) ? null : (job.completedAt ?? job.updatedAt).toISOString(),
        extra: job.status === 'awaiting_review' && job.expiresAt ? { expiresAt: job.expiresAt.toISOString() } : null,
      },
    }));
  }

  async counts(query: SourceCountQuery): Promise<JobCounts> {
    return await this.jobs.countForJobs(query.owner, query.cutoffAt);
  }

  async describe(rows: ReadAlongJobRow[], viewer: JobViewer): Promise<Map<string, JobSubject>> {
    const books = await this.subjects.describe(
      rows.map((row) => row.job.bookId),
      { user: viewer.user, manages: viewer.access.all },
    );
    const subjects = new Map<string, JobSubject>();
    for (const row of rows) {
      const book = books.get(row.job.bookId);
      // The job card, its review and its output all live on the book's Files tab.
      if (book) subjects.set(row.nativeId, { ...book, url: `${book.url}/files` });
    }
    return subjects;
  }

  actions(row: ReadAlongJobRow, viewer: JobViewer, now: number): { actions: JobActionKind[]; note: string | null } {
    const applicable = [...ACTIONS].filter((action) => statusAllows(row.job, action, now));
    const actions = applicable.filter((action) => viewerMay(viewer.user, row.job, action));
    if (actions.length > 0 || applicable.length === 0) return { actions, note: null };
    return { actions, note: restricted(viewer.user) ? 'demo' : 'read-along-requester' };
  }

  async act(action: JobActionKind, nativeIds: string[], viewer: JobViewer): Promise<SourceActionResult[]> {
    const startedAt = Date.now();
    const unique = [...new Set(nativeIds)];
    const rows = new Map((await this.jobs.findByIds(unique.filter((id) => UUID.test(id)))).map((row) => [row.id, row]));
    const results = new Map<string, SourceActionResult>();
    for (const id of unique) results.set(id, await this.actOn(action, id, rows.get(id) ?? null, viewer));
    const done = [...results.values()].filter((result) => result.outcome === 'done').length;
    this.logger.log(
      `[read_along.jobs_action] [end] userId=${viewer.user.id} action=${action} jobs=${unique.length} done=${done} durationMs=${Date.now() - startedAt} - read-along job action taken`,
    );
    return nativeIds.map((id) => results.get(id)!);
  }

  private async actOn(action: JobActionKind, id: string, row: ReadAloudJobRow | null, viewer: JobViewer): Promise<SourceActionResult> {
    // A viewer who neither manages the type nor asked for the job cannot tell it from a missing one.
    if (!row || !(viewer.access.all || (row.requestedByUserId !== null && row.requestedByUserId === viewer.user.id))) {
      return { id, outcome: 'not-found', status: null };
    }
    const result = (outcome: SourceActionResult['outcome'], job: ReadAloudJobRow = row): SourceActionResult => ({ id, outcome, status: status(job) });
    if (!ACTIONS.has(action) || !statusAllows(row, action, Date.now())) return result('skipped');
    if (!viewerMay(viewer.user, row, action)) return result('refused');
    try {
      const user = viewer.user;
      switch (action) {
        case 'cancel': {
          const updated = await this.readAloud.cancelJob(id, user);
          return result(updated.cancelRequested || updated.status === 'cancelled' ? 'done' : 'skipped', updated);
        }
        case 'pause':
          return result('done', await this.readAloud.pauseJob(id, user));
        case 'resume': {
          const updated = await this.readAloud.resumeJob(id, user);
          return result(updated.pausedAt === null ? 'done' : 'skipped', updated);
        }
        case 'retry':
          return result('done', await this.readAloud.retryJob(id, user));
        case 'dismiss':
          return result('done', await this.readAloud.dismissJob(id, user));
        case 'move-to-top':
          return result('done', await this.readAloud.moveToTop(id, user));
        case 'prioritize':
          return result('done', await this.readAloud.prioritize(id, user));
        default:
          return result('skipped');
      }
    } catch (error) {
      if (error instanceof ForbiddenException) return result('refused');
      if (error instanceof NotFoundException) return { id, outcome: 'not-found', status: null };
      // Retry collides with a newer job on the same book; anything else had already moved on.
      if (error instanceof ConflictException) return result(action === 'retry' ? 'conflict' : 'skipped', (await this.jobs.findById(id)) ?? row);
      this.logger.warn(
        `[read_along.jobs_action] [fail] jobId=${id} action=${action} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - read-along job action failed`,
      );
      return result('error');
    }
  }
}
