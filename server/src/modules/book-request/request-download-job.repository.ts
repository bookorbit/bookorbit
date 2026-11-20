import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { BookRequestDownloadStatus, JobCounts, JobView } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookRequestDownloads, bookRequests, users, type BookRequestDownloadRow, type BookRequestRow } from '../../db/schema';
import { afterPosition, keysetOrder, microseconds, type JobKey, type JobPosition, type KeysetColumns } from '../jobs/job-keyset';

type Db = NodePgDatabase<typeof schema>;

/** Failure codes a person caused: the attempt reads as cancelled rather than failed. */
export const CANCELLED_DOWNLOAD_FAILURE_CODES = ['removed', 'discarded'] as const;

const QUEUED: BookRequestDownloadStatus[] = ['queued'];
const RUNNING: BookRequestDownloadStatus[] = ['downloading', 'completed', 'importing'];
const IN_QUEUE: BookRequestDownloadStatus[] = [...QUEUED, ...RUNNING];
const TERMINAL: BookRequestDownloadStatus[] = ['imported', 'failed'];

const later = aliasedTable(bookRequestDownloads, 'later_attempt');
const ownerId = sql`coalesce(${bookRequests.fulfillerUserId}, ${bookRequests.userId})`;
/** Non-null for every terminal attempt: a failed one never reached `imported_at`. */
const FINISH = sql`coalesce(${bookRequestDownloads.importedAt}, ${bookRequestDownloads.updatedAt})`;
const CANCELLED = inArray(bookRequestDownloads.failureCode, [...CANCELLED_DOWNLOAD_FAILURE_CODES]);
const NEEDS_REVIEW = and(eq(bookRequestDownloads.status, 'needs_review'), eq(bookRequests.status, 'needs_review'))!;

const PAGE_COLUMNS = {
  id: bookRequestDownloads.id,
  requestId: bookRequestDownloads.requestId,
  status: bookRequestDownloads.status,
  progressPercent: bookRequestDownloads.progressPercent,
  failureCode: bookRequestDownloads.failureCode,
  createdAt: bookRequestDownloads.createdAt,
  grabbedAt: bookRequestDownloads.grabbedAt,
  importedAt: bookRequestDownloads.importedAt,
  updatedAt: bookRequestDownloads.updatedAt,
  userId: bookRequests.userId,
  fulfillerUserId: bookRequests.fulfillerUserId,
  ownerName: users.name,
  title: bookRequests.title,
  authors: bookRequests.authors,
  coverUrl: bookRequests.coverUrl,
  mediaKind: bookRequests.mediaKind,
};

export type RequestDownloadPageRow = Pick<
  BookRequestDownloadRow,
  'id' | 'requestId' | 'progressPercent' | 'failureCode' | 'createdAt' | 'grabbedAt' | 'importedAt' | 'updatedAt'
> &
  Pick<BookRequestRow, 'userId' | 'fulfillerUserId' | 'title' | 'authors' | 'coverUrl' | 'mediaKind'> & {
    status: BookRequestDownloadStatus;
    /** The name of whoever drives the request: its fulfiller, or the requester when nobody took it on. */
    ownerName: string | null;
    key: JobKey;
  };

/** What an action needs: the attempt's status and who may drive its request. */
export type RequestDownloadActionRow = Pick<BookRequestDownloadRow, 'id' | 'requestId' | 'failureCode'> &
  Pick<BookRequestRow, 'userId' | 'fulfillerUserId'> & { status: BookRequestDownloadStatus };

/** Null reads every account's attempts. Requests always have an owner, so there is nothing ownerless to add. */
export type RequestDownloadOwnerFilter = { id: number } | null;

export interface RequestDownloadPageQuery {
  view: JobView;
  owner: RequestDownloadOwnerFilter;
  cutoffAt: Date;
  after: JobPosition | null;
  typeIndex: number;
  limit: number;
}

/**
 * Book request downloads for the Jobs area, one row per request: its newest attempt. Older attempts
 * stay on the request's own page. Every read starts from the attempts in the view's statuses and
 * checks "no newer attempt" through `(request_id, id desc)`, so a page never walks every request.
 */
@Injectable()
export class RequestDownloadJobRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async pageForJobs(query: RequestDownloadPageQuery): Promise<RequestDownloadPageRow[]> {
    return query.view === 'queue' ? await this.queuePage(query) : await this.settledPage(query);
  }

  async countForJobs(owner: RequestDownloadOwnerFilter, cutoffAt: Date): Promise<JobCounts> {
    const [row] = await this.db
      .select({
        queue: sql<number>`count(*) filter (where ${inArray(bookRequestDownloads.status, IN_QUEUE)})`.mapWith(Number),
        needsYou: sql<number>`count(*) filter (where ${NEEDS_REVIEW})`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${this.failedShown(cutoffAt)})`.mapWith(Number),
        running: sql<number>`count(*) filter (where ${inArray(bookRequestDownloads.status, RUNNING)})`.mapWith(Number),
        queued: sql<number>`count(*) filter (where ${inArray(bookRequestDownloads.status, QUEUED)})`.mapWith(Number),
      })
      .from(bookRequestDownloads)
      .innerJoin(bookRequests, eq(bookRequests.id, bookRequestDownloads.requestId))
      .where(and(or(inArray(bookRequestDownloads.status, IN_QUEUE), NEEDS_REVIEW, this.failedShown(cutoffAt)), this.latest(), this.owned(owner)));
    return {
      queue: row?.queue ?? 0,
      needsYou: row?.needsYou ?? 0,
      failed: row?.failed ?? 0,
      running: row?.running ?? 0,
      queued: row?.queued ?? 0,
      paused: 0,
    };
  }

  /** Attempts by id with their request's drivers, newest or not; the action decides what applies. */
  async findActionRows(ids: readonly number[]): Promise<RequestDownloadActionRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({
        id: bookRequestDownloads.id,
        requestId: bookRequestDownloads.requestId,
        status: bookRequestDownloads.status,
        failureCode: bookRequestDownloads.failureCode,
        userId: bookRequests.userId,
        fulfillerUserId: bookRequests.fulfillerUserId,
      })
      .from(bookRequestDownloads)
      .innerJoin(bookRequests, eq(bookRequests.id, bookRequestDownloads.requestId))
      .where(inArray(bookRequestDownloads.id, [...ids]));
    return rows.map((row) => ({ ...row, status: row.status as BookRequestDownloadStatus }));
  }

  /**
   * Running first by when the grab began, then queued attempts by when they were made. Download
   * clients run their own queues, so every queued attempt shares rank 1.
   */
  private async queuePage(query: RequestDownloadPageQuery): Promise<RequestDownloadPageRow[]> {
    const queued = sql`${bookRequestDownloads.status} = 'queued'`;
    const group = sql<number>`case when ${queued} then 1 else 0 end`;
    const rank = sql<number>`case when ${queued} then 1 else 0 end`;
    const at = microseconds(
      sql`case when ${queued} then ${bookRequestDownloads.createdAt} else coalesce(${bookRequestDownloads.grabbedAt}, ${bookRequestDownloads.createdAt}) end`,
    );
    const columns: KeysetColumns = {
      prefix: [
        { kind: 'number', expr: group },
        { kind: 'number', expr: rank },
      ],
      suffix: [{ kind: 'number', expr: at }],
      id: { kind: 'number', expr: sql`${bookRequestDownloads.id}` },
    };
    const rows = await this.db
      .select({ ...PAGE_COLUMNS, group: group.mapWith(Number), rank: rank.mapWith(Number), at })
      .from(bookRequestDownloads)
      .innerJoin(bookRequests, eq(bookRequests.id, bookRequestDownloads.requestId))
      .leftJoin(users, eq(users.id, ownerId))
      .where(
        and(
          inArray(bookRequestDownloads.status, IN_QUEUE),
          this.latest(),
          this.owned(query.owner),
          query.after ? afterPosition(columns, 'queue', query.after, query.typeIndex) : undefined,
        ),
      )
      .orderBy(...keysetOrder(columns, 'queue'))
      .limit(query.limit);
    return rows.map(({ group: band, rank: place, at: since, ...row }) => ({
      ...row,
      status: row.status as BookRequestDownloadStatus,
      key: { prefix: [band, place], suffix: [since], id: row.id },
    }));
  }

  /** Needs you by when review began; Failed and History by when the attempt finished; newest first. */
  private async settledPage(query: RequestDownloadPageQuery): Promise<RequestDownloadPageRow[]> {
    const at = query.view === 'needs-you' ? sql`${bookRequestDownloads.updatedAt}` : FINISH;
    const columns: KeysetColumns = {
      prefix: [{ kind: 'time', expr: at }],
      suffix: [],
      id: { kind: 'number', expr: sql`${bookRequestDownloads.id}` },
    };
    const rows = await this.db
      .select({ ...PAGE_COLUMNS, finish: microseconds(at) })
      .from(bookRequestDownloads)
      .innerJoin(bookRequests, eq(bookRequests.id, bookRequestDownloads.requestId))
      .leftJoin(users, eq(users.id, ownerId))
      .where(
        and(
          this.settledView(query.view, query.cutoffAt),
          this.latest(),
          this.owned(query.owner),
          query.after ? afterPosition(columns, query.view, query.after, query.typeIndex) : undefined,
        ),
      )
      .orderBy(...keysetOrder(columns, query.view))
      .limit(query.limit);
    return rows.map(({ finish, ...row }) => ({
      ...row,
      status: row.status as BookRequestDownloadStatus,
      key: { prefix: [finish], suffix: [], id: row.id },
    }));
  }

  private settledView(view: JobView, cutoffAt: Date): SQL {
    if (view === 'needs-you') return NEEDS_REVIEW;
    if (view === 'failed') return this.failedShown(cutoffAt);
    return and(
      inArray(bookRequestDownloads.status, TERMINAL),
      or(eq(bookRequestDownloads.status, 'imported'), CANCELLED, sql`${FINISH} <= ${cutoffAt}`),
    )!;
  }

  /** Failed by itself rather than by a person, and finished after the cutoff. */
  private failedShown(cutoffAt: Date): SQL {
    return and(
      eq(bookRequestDownloads.status, 'failed'),
      or(isNull(bookRequestDownloads.failureCode), sql`not ${CANCELLED}`),
      sql`${FINISH} > ${cutoffAt}`,
    )!;
  }

  private latest(): SQL {
    return sql`not exists (select 1 from ${bookRequestDownloads} ${later} where ${later.requestId} = ${bookRequestDownloads.requestId} and ${later.id} > ${bookRequestDownloads.id})`;
  }

  /** Written as two arms rather than `coalesce(...) = id`, so each can use its own index on `book_requests`. */
  private owned(owner: RequestDownloadOwnerFilter): SQL | undefined {
    if (owner === null) return undefined;
    return or(eq(bookRequests.fulfillerUserId, owner.id), and(isNull(bookRequests.fulfillerUserId), eq(bookRequests.userId, owner.id)));
  }
}
