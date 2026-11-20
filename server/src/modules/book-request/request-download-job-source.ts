import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES,
  AuditAction,
  AuditResource,
  Permission,
  type BookRequestDownloadStatus,
  type JobActionKind,
  type JobCounts,
  type JobStatus,
  type JobSubject,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AUDIT_EVENT, AuditEventsService } from '../audit/audit-events.service';
import type { JobAccess, JobSource, JobViewer, SourceActionResult, SourceCountQuery, SourceListQuery, SourceRow } from '../jobs/job-source';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import { BookRequestService } from './book-request.service';
import {
  CANCELLED_DOWNLOAD_FAILURE_CODES,
  RequestDownloadJobRepository,
  type RequestDownloadActionRow,
  type RequestDownloadOwnerFilter,
  type RequestDownloadPageRow,
} from './request-download-job.repository';

const FAILED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const NATIVE_ID = /^[1-9][0-9]{0,14}$/;
const RUNNING = new Set<BookRequestDownloadStatus>(['downloading', 'completed', 'importing']);
const TERMINAL = new Set<BookRequestDownloadStatus>(['imported', 'failed']);
const PHASES: Partial<Record<BookRequestDownloadStatus, string>> = { downloading: 'downloading', completed: 'downloaded', importing: 'importing' };

type Drivers = Pick<RequestDownloadActionRow, 'userId' | 'fulfillerUserId'>;
type Attempt = Pick<RequestDownloadActionRow, 'status' | 'failureCode'>;

export interface RequestDownloadJobRow extends SourceRow {
  job: RequestDownloadPageRow;
}

/**
 * Every request route answers to `BookRequestAccess` first, and assigning either permission below
 * requires it, so both checks ask for it as well rather than trusting the assignment.
 */
function holds(user: RequestUser, permission: Permission): boolean {
  return user.active && (user.isSuperuser || (user.permissions.includes(Permission.BookRequestAccess) && user.permissions.includes(permission)));
}

function ownerOf(row: Drivers): number {
  return row.fulfillerUserId ?? row.userId;
}

function cancelledByPerson(failureCode: string | null): boolean {
  return failureCode !== null && (CANCELLED_DOWNLOAD_FAILURE_CODES as readonly string[]).includes(failureCode);
}

function status(row: Attempt): JobStatus {
  switch (row.status) {
    case 'queued':
      return 'queued';
    case 'downloading':
    case 'completed':
    case 'importing':
      return 'running';
    case 'needs_review':
      return 'needs-you';
    case 'imported':
      return 'completed';
    default:
      return cancelledByPerson(row.failureCode) ? 'cancelled' : 'failed';
  }
}

function reason(row: Attempt): string | null {
  if (row.status === 'needs_review') return 'review';
  if (row.status === 'failed') return row.failureCode;
  return null;
}

/** `cancelDownload`'s own rule: only a transfer that has not finished can be stopped. */
function cancellable(row: Attempt): boolean {
  return ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES.includes(row.status);
}

/**
 * Book request downloads in the Jobs area, one row per request: its newest attempt. Download clients
 * run their own queues, so queued attempts carry no place in a lane. Owned by whoever drives the
 * request, its fulfiller or else its requester, and seen in full only by moderators (decision 20).
 * Review and every other step stay on the request's own page; the only action here is cancel.
 */
@Injectable()
export class RequestDownloadJobSource implements JobSource<RequestDownloadJobRow>, OnModuleInit {
  readonly type = 'request-download' as const;
  readonly failedWindowMs = FAILED_WINDOW_MS;
  private readonly logger = new Logger(RequestDownloadJobSource.name);

  constructor(
    private readonly registry: JobSourceRegistry,
    private readonly jobs: RequestDownloadJobRepository,
    private readonly requests: BookRequestService,
    private readonly auditEvents: AuditEventsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  access(user: RequestUser): JobAccess {
    return { own: holds(user, Permission.BookRequestSelfFulfill), all: holds(user, Permission.ManageBookRequests) };
  }

  async list(query: SourceListQuery): Promise<RequestDownloadJobRow[]> {
    const rows = await this.jobs.pageForJobs({
      view: query.view,
      owner: this.owner(query.owner),
      cutoffAt: query.cutoffAt,
      after: query.after,
      typeIndex: query.typeIndex,
      limit: query.limit,
    });
    return rows.map((job) => ({
      nativeId: String(job.id),
      key: job.key,
      job,
      item: {
        kind: job.mediaKind,
        shape: 'job',
        status: status(job),
        reason: reason(job),
        phase: PHASES[job.status] ?? null,
        // Byte counts are not a count of work done, so only the percentage is shown.
        done: null,
        total: null,
        percent: job.status === 'downloading' ? job.progressPercent : null,
        position: null,
        requester: { id: ownerOf(job), name: job.ownerName ?? '' },
        cost: null,
        createdAt: job.createdAt.toISOString(),
        startedAt: RUNNING.has(job.status) ? (job.grabbedAt ?? job.createdAt).toISOString() : null,
        pausedAt: null,
        finishedAt: TERMINAL.has(job.status) ? (job.importedAt ?? job.updatedAt).toISOString() : null,
        extra: null,
      },
    }));
  }

  async counts(query: SourceCountQuery): Promise<JobCounts> {
    return await this.jobs.countForJobs(this.owner(query.owner), query.cutoffAt);
  }

  /**
   * Named from the request itself, which every viewer of the row can open: the owner drives it and
   * the everyone view is for moderators. The cover is the request's own external URL, which the
   * page loads as the requests page does; the server never fetches it.
   */
  describe(rows: RequestDownloadJobRow[]): Promise<Map<string, JobSubject>> {
    const subjects = new Map<string, JobSubject>(
      rows.map((row) => [
        row.nativeId,
        {
          label: row.job.title,
          byline: row.job.authors.length > 0 ? row.job.authors.join(', ') : null,
          url: `/requests/${row.job.requestId}`,
          image: row.job.coverUrl,
        },
      ]),
    );
    return Promise.resolve(subjects);
  }

  actions(row: RequestDownloadJobRow, viewer: JobViewer): { actions: JobActionKind[]; note: string | null } {
    if (!cancellable(row.job)) return { actions: [], note: null };
    if (this.mayDrive(viewer.user, row.job)) return { actions: ['cancel'], note: null };
    return { actions: [], note: 'request-download-driver' };
  }

  async act(action: JobActionKind, nativeIds: string[], viewer: JobViewer): Promise<SourceActionResult[]> {
    const startedAt = Date.now();
    const unique = [...new Set(nativeIds)];
    const ids = unique.filter((id) => NATIVE_ID.test(id)).map(Number);
    const rows = new Map((await this.jobs.findActionRows(ids)).map((row) => [String(row.id), row]));
    const results = new Map<string, SourceActionResult>();
    for (const id of unique) results.set(id, await this.actOn(action, id, rows.get(id) ?? null, viewer));
    const done = [...results.values()].filter((result) => result.outcome === 'done').length;
    this.logger.log(
      `[book_request.jobs_action] [end] userId=${viewer.user.id} action=${action} jobs=${unique.length} done=${done} durationMs=${Date.now() - startedAt} - request download job action taken`,
    );
    return nativeIds.map((id) => results.get(id)!);
  }

  private async actOn(action: JobActionKind, id: string, row: RequestDownloadActionRow | null, viewer: JobViewer): Promise<SourceActionResult> {
    // A viewer who neither moderates nor drives the request cannot tell it from a missing one.
    if (!row || !(viewer.access.all || ownerOf(row) === viewer.user.id)) return { id, outcome: 'not-found', status: null };
    const result = (outcome: SourceActionResult['outcome'], attempt: Attempt = row): SourceActionResult => ({ id, outcome, status: status(attempt) });
    if (action !== 'cancel' || !cancellable(row)) return result('skipped');
    if (!this.mayDrive(viewer.user, row)) return result('refused');
    try {
      await this.requests.cancelDownload(row.requestId, row.id, viewer.user);
      this.audit(row, viewer.user);
      return result('done', { status: 'failed', failureCode: 'removed' });
    } catch (error) {
      if (error instanceof ForbiddenException) return result('refused');
      if (error instanceof NotFoundException) return { id, outcome: 'not-found', status: null };
      // The transfer finished, failed or lost its client between the read and the cancel.
      if (error instanceof BadRequestException) {
        const [current] = await this.jobs.findActionRows([row.id]);
        return current ? result('skipped', current) : { id, outcome: 'not-found', status: null };
      }
      this.logger.warn(
        `[book_request.jobs_action] [fail] downloadId=${row.id} requestId=${row.requestId} action=${action} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - request download job action failed`,
      );
      return result('error');
    }
  }

  private mayDrive(user: RequestUser, row: Drivers): boolean {
    return user.active && (user.isSuperuser || user.permissions.includes(Permission.BookRequestAccess)) && this.requests.canDrive(row, user);
  }

  /** The request route records this through its `@Auditable` decorator, which a Jobs action never passes. */
  private audit(row: RequestDownloadActionRow, user: RequestUser): void {
    this.auditEvents.emit(AUDIT_EVENT, {
      userId: user.id,
      actorUsername: user.username,
      action: AuditAction.BookRequestRemoveDownload,
      resource: AuditResource.BookRequest,
      resourceId: row.requestId,
      description: 'Cancelled an active book request download',
      meta: { downloadId: row.id },
    });
  }

  private owner(owner: SourceListQuery['owner']): RequestDownloadOwnerFilter {
    return owner === null ? null : { id: owner.id };
  }
}
