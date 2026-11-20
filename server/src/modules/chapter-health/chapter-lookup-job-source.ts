import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Permission, type JobActionKind, type JobCounts, type JobSubject, type JobView } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { compareJobPositions, type JobKey } from '../jobs/job-keyset';
import type { JobAccess, JobSource, JobViewer, SourceActionResult, SourceCountQuery, SourceListQuery, SourceRow } from '../jobs/job-source';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import type { ChapterLookupSummary } from './chapter-health.repository';
import { ChapterHealthService } from './chapter-health.service';

/** A failure summary leaves Failed once a week passes with no new failure; the page still lists them. */
export const CHAPTER_LOOKUP_FAILED_VISIBLE_MS = 7 * 24 * 60 * 60 * 1000;

/** Where every summary row opens: the page that lists the books behind it. */
const CHAPTER_HEALTH_URL = '/tools/chapter-health';
const SUBJECT: JobSubject = { label: null, byline: null, url: CHAPTER_HEALTH_URL, image: null };

/** `queue`: waiting and running lookups. `review`: results waiting for a person. `failed`: lookups that gave up. */
export type ChapterLookupBucket = 'queue' | 'review' | 'failed';

/** `user-12.queue` for one account's lookups, `system.queue` for those of deleted accounts. */
const NATIVE_ID = /^(?:user-([1-9][0-9]{0,9})|system)\.(queue|review|failed)$/;

const BUCKET_ACTIONS: Record<ChapterLookupBucket, readonly JobActionKind[]> = {
  queue: ['cancel'],
  review: ['dismiss'],
  failed: ['retry', 'dismiss'],
};

export interface ChapterLookupJobRow extends SourceRow {
  bucket: ChapterLookupBucket;
  ownerId: number | null;
  summary: ChapterLookupSummary;
}

export function chapterLookupNativeId(ownerId: number | null, bucket: ChapterLookupBucket): string {
  return `${ownerId === null ? 'system' : `user-${ownerId}`}.${bucket}`;
}

interface ParsedRow {
  ownerId: number | null;
  bucket: ChapterLookupBucket;
}

function parseNativeId(nativeId: string): ParsedRow | null {
  const match = NATIVE_ID.exec(nativeId);
  if (!match) return null;
  const ownerId = match[1] === undefined ? null : Number(match[1]);
  if (ownerId !== null && !Number.isSafeInteger(ownerId)) return null;
  return { ownerId, bucket: match[2] as ChapterLookupBucket };
}

function iso(microseconds: number): string {
  return new Date(Math.floor(microseconds / 1000)).toISOString();
}

/** Whether a viewer may see a requester's rows at all: their own, or anyone's for a manager. */
function reaches(viewer: JobViewer, ownerId: number | null): boolean {
  return viewer.access.all || (viewer.access.own && ownerId !== null && ownerId === viewer.user.id);
}

/**
 * Bulk chapter lookups in the Jobs area. A person queues hundreds of books at once and the chapter
 * health page already lists them book by book, so each requester gets one summary row per view:
 * waiting and running lookups in Queue, results to review in Needs you, failures in Failed. Applied,
 * not-found and skipped books are outcomes the page shows and make no row. Lookups of a deleted
 * account form the `system` rows, which only managers see.
 */
@Injectable()
export class ChapterLookupJobSource implements JobSource<ChapterLookupJobRow>, OnModuleInit {
  readonly type = 'chapter-lookup' as const;
  readonly failedWindowMs = CHAPTER_LOOKUP_FAILED_VISIBLE_MS;
  private readonly logger = new Logger(ChapterLookupJobSource.name);

  constructor(
    private readonly registry: JobSourceRegistry,
    private readonly chapterHealth: ChapterHealthService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  access(user: RequestUser): JobAccess {
    return {
      own: user.active && (user.isSuperuser || user.permissions.includes(Permission.LibraryEditMetadata)),
      all: user.active && (user.isSuperuser || user.permissions.includes(Permission.ManageAppSettings)),
    };
  }

  async list(query: SourceListQuery, viewer: JobViewer): Promise<ChapterLookupJobRow[]> {
    if (query.view === 'history') return [];
    const summaries = await this.chapterHealth.jobSummaries(viewer.user, query.owner);
    const cutoff = query.cutoffAt.getTime() * 1000;
    const after = query.after;
    return summaries
      .map((summary) => this.row(query.view, summary, cutoff))
      .filter((row): row is ChapterLookupJobRow => row !== null)
      .filter((row) => after === null || compareJobPositions(query.view, { ...row.key, typeIndex: query.typeIndex }, after) > 0)
      .sort((a, b) => compareJobPositions(query.view, { ...a.key, typeIndex: query.typeIndex }, { ...b.key, typeIndex: query.typeIndex }))
      .slice(0, query.limit);
  }

  /** A summary row counts once in its view, however many books it stands for. */
  async counts(query: SourceCountQuery, viewer: JobViewer): Promise<JobCounts> {
    const summaries = await this.chapterHealth.jobSummaries(viewer.user, query.owner);
    const cutoff = query.cutoffAt.getTime() * 1000;
    const counts: JobCounts = { queue: 0, needsYou: 0, failed: 0, running: 0, queued: 0, paused: 0 };
    for (const summary of summaries) {
      if (summary.queued + summary.processing > 0) {
        counts.queue += 1;
        if (summary.processing > 0) counts.running += 1;
        else counts.queued += 1;
      }
      if (summary.review > 0) counts.needsYou += 1;
      if (summary.failed > 0 && summary.failedAt !== null && summary.failedAt > cutoff) counts.failed += 1;
    }
    return counts;
  }

  describe(rows: ChapterLookupJobRow[]): Promise<Map<string, JobSubject>> {
    return Promise.resolve(new Map(rows.map((row) => [row.nativeId, SUBJECT])));
  }

  actions(row: ChapterLookupJobRow, viewer: JobViewer): { actions: JobActionKind[]; note: string | null } {
    // Cancel leaves the book being looked up alone, so a row with nothing waiting behind it has nothing to cancel.
    if (row.bucket === 'queue' && row.summary.queued === 0) return { actions: [], note: null };
    if (!reaches(viewer, row.ownerId)) return { actions: [], note: null };
    return { actions: [...BUCKET_ACTIONS[row.bucket]], note: null };
  }

  async act(action: JobActionKind, nativeIds: string[], viewer: JobViewer): Promise<SourceActionResult[]> {
    const startedAt = Date.now();
    const unique = [...new Set(nativeIds)];
    const results = new Map<string, SourceActionResult>();
    for (const id of unique) results.set(id, await this.actOn(action, id, viewer));
    const done = [...results.values()].filter((result) => result.outcome === 'done').length;
    this.logger.log(
      `[chapter_lookup.jobs_action] [end] userId=${viewer.user.id} action=${action} rows=${unique.length} done=${done} durationMs=${Date.now() - startedAt} - chapter lookup job action taken`,
    );
    return nativeIds.map((id) => results.get(id)!);
  }

  private async actOn(action: JobActionKind, id: string, viewer: JobViewer): Promise<SourceActionResult> {
    const row = parseNativeId(id);
    // Another account's rows, and the system rows, cannot be told from missing ones by a non-manager.
    if (!row || !reaches(viewer, row.ownerId)) return { id, outcome: 'not-found', status: null };
    if (!BUCKET_ACTIONS[row.bucket].includes(action)) return { id, outcome: 'skipped', status: null };
    try {
      const changed = await this.run(action, row, viewer.user);
      return changed > 0 ? { id, outcome: 'done', status: action === 'retry' ? 'queued' : null } : { id, outcome: 'skipped', status: null };
    } catch (error) {
      this.logger.warn(
        `[chapter_lookup.jobs_action] [fail] row=${id} action=${action} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - chapter lookup job action failed`,
      );
      return { id, outcome: 'error', status: null };
    }
  }

  /** Each action covers every book behind the row that the viewer can reach; the count says whether any was left. */
  private async run(action: JobActionKind, row: ParsedRow, user: RequestUser): Promise<number> {
    if (row.bucket === 'queue') return await this.chapterHealth.clearQueuedFor(user, row.ownerId);
    if (row.bucket === 'review') return await this.chapterHealth.dismissReviewsFor(user, row.ownerId);
    return action === 'retry'
      ? await this.chapterHealth.retryFailedFor(user, row.ownerId)
      : await this.chapterHealth.clearFailedFor(user, row.ownerId);
  }

  private row(view: JobView, summary: ChapterLookupSummary, cutoff: number): ChapterLookupJobRow | null {
    const ownerId = summary.userId;
    const requester = ownerId === null ? null : { id: ownerId, name: summary.userName ?? '' };
    const base = {
      kind: null,
      shape: 'queue' as const,
      phase: null,
      done: null,
      percent: null,
      position: null,
      requester,
      cost: null,
      startedAt: null,
      pausedAt: null,
    };
    if (view === 'queue') {
      const waiting = summary.queued + summary.processing;
      if (waiting === 0 || summary.queueSince === null) return null;
      const running = summary.processing > 0;
      // A summary row has no single start time, so a running one sorts at 0 among running rows; a waiting
      // one sits in the first band, since the lane takes its next book whenever the worker is free.
      const key: JobKey = running
        ? { prefix: [0, 0], suffix: [0], id: chapterLookupNativeId(ownerId, 'queue') }
        : { prefix: [1, 1], suffix: [summary.queueSince], id: chapterLookupNativeId(ownerId, 'queue') };
      return {
        nativeId: key.id as string,
        key,
        bucket: 'queue',
        ownerId,
        summary,
        item: {
          ...base,
          status: running ? 'running' : 'queued',
          reason: null,
          // The books still to look up, the one running included.
          total: waiting,
          createdAt: iso(summary.queueSince),
          finishedAt: null,
          extra: null,
        },
      };
    }
    if (view === 'needs-you') {
      if (summary.review === 0 || summary.reviewAt === null) return null;
      const key: JobKey = { prefix: [summary.reviewAt], suffix: [], id: chapterLookupNativeId(ownerId, 'review') };
      return {
        nativeId: key.id as string,
        key,
        bucket: 'review',
        ownerId,
        summary,
        item: {
          ...base,
          status: 'needs-you',
          reason: 'review',
          total: null,
          createdAt: iso(summary.reviewAt),
          finishedAt: null,
          extra: { review: summary.review },
        },
      };
    }
    if (summary.failed === 0 || summary.failedAt === null || summary.failedAt <= cutoff) return null;
    const key: JobKey = { prefix: [summary.failedAt], suffix: [], id: chapterLookupNativeId(ownerId, 'failed') };
    return {
      nativeId: key.id as string,
      key,
      bucket: 'failed',
      ownerId,
      summary,
      item: {
        ...base,
        status: 'failed',
        reason: 'failed',
        total: null,
        createdAt: iso(summary.failedAt),
        finishedAt: iso(summary.failedAt),
        extra: { failed: summary.failed },
      },
    };
  }
}
