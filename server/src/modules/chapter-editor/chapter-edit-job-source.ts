import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { Permission, type JobActionKind, type JobCounts, type JobStatus, type JobSubject } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookJobSubjects } from '../book/book-job-subjects.service';
import type { JobAccess, JobSource, JobViewer, SourceActionResult, SourceCountQuery, SourceListQuery, SourceRow } from '../jobs/job-source';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import { CHAPTER_JOB_RETENTION_MS, ChapterJobRepository, type ChapterJobPageRow, type ChapterJobRow } from './chapter-job.repository';
import { ChapterJobService } from './chapter-job.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ChapterEditJobRow extends SourceRow {
  job: ChapterJobPageRow;
}

type ActionableJob = Pick<ChapterJobRow, 'userId' | 'status'>;

function mayEdit(user: RequestUser): boolean {
  return user.active && (user.isSuperuser || user.permissions.includes(Permission.LibraryEditMetadata));
}

function manages(user: RequestUser): boolean {
  return user.active && (user.isSuperuser || user.permissions.includes(Permission.ManageAppSettings));
}

function status(row: Pick<ChapterJobRow, 'status'>): JobStatus {
  switch (row.status) {
    case 'processing':
      return 'running';
    case 'success':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'queued';
  }
}

/**
 * Retry runs the job again in place, keyed by its requester; anyone else starting it would make a
 * separate job of their own, so only the requester is offered it.
 */
function viewerMay(user: RequestUser, row: ActionableJob): boolean {
  return mayEdit(user) && row.userId === user.id;
}

/**
 * Chapter file writes, reads and reverts in the Jobs area. One worker claims them oldest first, so
 * queued jobs carry their place in that one lane. Finished jobs are kept for seven days.
 */
@Injectable()
export class ChapterEditJobSource implements JobSource<ChapterEditJobRow>, OnModuleInit {
  readonly type = 'chapter-edit' as const;
  readonly failedWindowMs = CHAPTER_JOB_RETENTION_MS;
  private readonly logger = new Logger(ChapterEditJobSource.name);

  constructor(
    private readonly registry: JobSourceRegistry,
    private readonly jobs: ChapterJobRepository,
    private readonly service: ChapterJobService,
    private readonly subjects: BookJobSubjects,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  access(user: RequestUser): JobAccess {
    return { own: mayEdit(user), all: manages(user) };
  }

  async list(query: SourceListQuery): Promise<ChapterEditJobRow[]> {
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
        kind: job.kind,
        shape: 'job',
        status: status(job),
        reason: job.status === 'failed' ? (job.errorCode ?? 'error') : null,
        phase: null,
        done: job.status === 'processing' && job.filesTotal > 0 ? job.filesWritten : null,
        // Unknown until the job has counted the files it touches.
        total: job.status === 'processing' && job.filesTotal > 0 ? job.filesTotal : null,
        percent: null,
        position: job.status === 'queued' && job.rank > 0 ? job.rank : null,
        requester: { id: job.userId, name: job.requesterName ?? '' },
        cost: null,
        createdAt: job.createdAt.toISOString(),
        startedAt: null,
        pausedAt: null,
        finishedAt: job.status === 'success' || job.status === 'failed' ? job.updatedAt.toISOString() : null,
        extra: null,
      },
    }));
  }

  async counts(query: SourceCountQuery): Promise<JobCounts> {
    return await this.jobs.countForJobs(query.owner, query.cutoffAt);
  }

  async describe(rows: ChapterEditJobRow[], viewer: JobViewer): Promise<Map<string, JobSubject>> {
    const books = await this.subjects.describe(
      rows.map((row) => row.job.bookId),
      { user: viewer.user, manages: viewer.access.all },
    );
    const subjects = new Map<string, JobSubject>();
    for (const row of rows) {
      const book = books.get(row.job.bookId);
      if (book) subjects.set(row.nativeId, book);
    }
    return subjects;
  }

  actions(row: ChapterEditJobRow, viewer: JobViewer): { actions: JobActionKind[]; note: string | null } {
    if (row.job.status !== 'failed') return { actions: [], note: null };
    return viewerMay(viewer.user, row.job) ? { actions: ['retry'], note: null } : { actions: [], note: 'chapter-edit-requester' };
  }

  async act(action: JobActionKind, nativeIds: string[], viewer: JobViewer): Promise<SourceActionResult[]> {
    const startedAt = Date.now();
    const unique = [...new Set(nativeIds)];
    const rows = new Map((await this.jobs.findByIds(unique.filter((id) => UUID.test(id)))).map((row) => [row.id, row]));
    const results = new Map<string, SourceActionResult>();
    for (const id of unique) results.set(id, await this.actOn(action, id, rows.get(id) ?? null, viewer));
    const done = [...results.values()].filter((result) => result.outcome === 'done').length;
    this.logger.log(
      `[chapter_edit.jobs_action] [end] userId=${viewer.user.id} action=${action} jobs=${unique.length} done=${done} durationMs=${Date.now() - startedAt} - chapter job action taken`,
    );
    return nativeIds.map((id) => results.get(id)!);
  }

  private async actOn(action: JobActionKind, id: string, row: ChapterJobRow | null, viewer: JobViewer): Promise<SourceActionResult> {
    // A viewer who neither manages the type nor asked for the job cannot tell it from a missing one.
    if (!row || !(viewer.access.all || row.userId === viewer.user.id)) return { id, outcome: 'not-found', status: null };
    const result = (outcome: SourceActionResult['outcome'], current: Pick<ChapterJobRow, 'status'> = row): SourceActionResult => ({
      id,
      outcome,
      status: status(current),
    });
    if (action !== 'retry' || row.status !== 'failed') return result('skipped');
    if (!viewerMay(viewer.user, row)) return result('refused');
    try {
      const job = await this.service.start(row.bookId, row.kind, row.baseRevision, viewer.user, true);
      return job.id === row.id && job.status === 'queued' ? result('done', job) : result('skipped', job);
    } catch (error) {
      if (error instanceof NotFoundException) return { id, outcome: 'not-found', status: null };
      // Forbidden: no longer an editor of the book. Conflict: too many chapter jobs are waiting.
      if (error instanceof ForbiddenException || error instanceof ConflictException) return result('refused');
      this.logger.warn(
        `[chapter_edit.jobs_action] [fail] jobId=${id} action=${action} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - chapter job action failed`,
      );
      return result('error');
    }
  }
}
