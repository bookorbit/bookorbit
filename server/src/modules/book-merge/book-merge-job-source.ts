import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Permission, type JobActionKind, type JobCounts, type JobStatus, type JobSubject } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { BookJobSubjects } from '../book/book-job-subjects.service';
import type { JobAccess, JobSource, JobViewer, SourceActionResult, SourceCountQuery, SourceListQuery, SourceRow } from '../jobs/job-source';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import { BookMergeRepository, type MergeJobPageRow } from './book-merge.repository';

/** A failed merge with moves left behind needs an operator; it leaves Failed after a week either way. */
export const BOOK_MERGE_FAILED_VISIBLE_MS = 7 * 24 * 60 * 60 * 1000;

const JOB_ID = /^[1-9][0-9]{0,15}$/;
const RUNNING = new Set(['moving', 'committing', 'committed']);

export interface BookMergeJobRow extends SourceRow {
  job: MergeJobPageRow;
}

function statusOf(status: string): JobStatus {
  if (status === 'planned') return 'queued';
  if (RUNNING.has(status)) return 'running';
  if (status === 'done') return 'completed';
  return 'failed';
}

function reasonOf(row: Pick<MergeJobPageRow, 'status' | 'errorCode'>): string | null {
  if (row.status === 'failed' || row.status === 'rolled_back') return row.errorCode ?? (row.status === 'rolled_back' ? 'rolled-back' : null);
  return null;
}

/**
 * Book merges in the Jobs area. Two run at once across the server and the rest wait for a slot, so
 * planned merges form one lane. No actions yet: a merge cannot be stopped safely once it moves files,
 * and a failed one with files left behind needs an operator.
 */
@Injectable()
export class BookMergeJobSource implements JobSource<BookMergeJobRow>, OnModuleInit {
  readonly type = 'book-merge' as const;
  readonly failedWindowMs = BOOK_MERGE_FAILED_VISIBLE_MS;

  constructor(
    private readonly registry: JobSourceRegistry,
    private readonly jobs: BookMergeRepository,
    private readonly subjects: BookJobSubjects,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  access(user: RequestUser): JobAccess {
    return {
      own: user.active && (user.isSuperuser || user.permissions.includes(Permission.LibraryMergeBooks)),
      all: user.active && (user.isSuperuser || user.permissions.includes(Permission.ManageAppSettings)),
    };
  }

  async list(query: SourceListQuery): Promise<BookMergeJobRow[]> {
    const rows = await this.jobs.pageForJobs({
      view: query.view,
      owner: query.owner,
      cutoffAt: query.cutoffAt,
      after: query.after,
      typeIndex: query.typeIndex,
      limit: query.limit,
    });
    return rows.map((job) => {
      const status = statusOf(job.status);
      return {
        nativeId: String(job.id),
        key: job.key,
        job,
        item: {
          kind: null,
          shape: 'job',
          status,
          reason: reasonOf(job),
          phase: status === 'running' ? job.status : null,
          done: job.processed,
          total: job.total > 0 ? job.total : null,
          percent: null,
          position: status === 'queued' && job.rank > 0 ? job.rank : null,
          requester: job.requestedByUserId === null ? null : { id: job.requestedByUserId, name: job.requesterName ?? '' },
          cost: null,
          createdAt: job.createdAt.toISOString(),
          // No separate start time is kept; a merge starts as soon as it has a run slot, almost always at once.
          startedAt: status === 'running' ? job.createdAt.toISOString() : null,
          pausedAt: null,
          finishedAt: status === 'completed' || status === 'failed' ? (job.finishedAt ?? job.updatedAt).toISOString() : null,
          extra: null,
        },
      };
    });
  }

  async counts(query: SourceCountQuery): Promise<JobCounts> {
    const counts = await this.jobs.countForJobs(query.owner, query.cutoffAt);
    return { queue: counts.queue, needsYou: 0, failed: counts.failed, running: counts.running, queued: counts.queued, paused: 0 };
  }

  /** The book the others were merged into. One merged away since, or deleted, is left out. */
  async describe(rows: BookMergeJobRow[], viewer: JobViewer): Promise<Map<string, JobSubject>> {
    const books = await this.subjects.describe(
      rows.map((row) => row.job.targetBookId),
      { user: viewer.user, manages: viewer.access.all },
    );
    const subjects = new Map<string, JobSubject>();
    for (const row of rows) {
      const book = books.get(row.job.targetBookId);
      if (book) subjects.set(row.nativeId, book);
    }
    return subjects;
  }

  actions(): { actions: JobActionKind[]; note: string | null } {
    return { actions: [], note: null };
  }

  async act(_action: JobActionKind, nativeIds: string[], viewer: JobViewer): Promise<SourceActionResult[]> {
    const ids = [...new Set(nativeIds.filter((id) => JOB_ID.test(id)).map(Number))];
    const rows = new Map((await this.jobs.findJobStatuses(ids)).map((row) => [String(row.id), row]));
    return nativeIds.map((id) => {
      const row = rows.get(id);
      // Another account's merge reads the same as a missing one to a viewer who does not manage merges.
      if (!row || !(viewer.access.all || (row.requestedByUserId !== null && row.requestedByUserId === viewer.user.id))) {
        return { id, outcome: 'not-found', status: null };
      }
      return { id, outcome: 'refused', status: statusOf(row.status) };
    });
  }
}
