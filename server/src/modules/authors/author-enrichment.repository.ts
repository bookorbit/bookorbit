import { Inject, Injectable } from '@nestjs/common';
import type { AuthorEnrichmentConditions, AuthorEnrichmentFailedItem, AuthorEnrichmentStatus } from '@bookorbit/types';
import type { SQL } from 'drizzle-orm';
import { and, asc, count, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authorEnrichmentQueue, authors, bookAuthors } from '../../db/schema';
import { AuthorEnrichmentReason } from './author-enrichment-reasons';

type Db = NodePgDatabase<typeof schema>;

const DEFAULT_SCHEDULE_BATCH_SIZE = 1000;

export const AUTHOR_ENRICHMENT_ACTIVE_STATUSES = ['queued', 'rate_limited'] as const;

export type AuthorEnrichmentQueueRow = typeof authorEnrichmentQueue.$inferSelect;

@Injectable()
export class AuthorEnrichmentRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async upsertSchedule(authorIds: number[], reason: AuthorEnrichmentReason, batchSize = DEFAULT_SCHEDULE_BATCH_SIZE): Promise<number> {
    const uniqueAuthorIds = [...new Set(authorIds)].filter((id) => Number.isInteger(id) && id > 0);
    if (uniqueAuthorIds.length === 0) return 0;

    const resolvedBatchSize = resolveBatchSize(batchSize);
    if (!resolvedBatchSize) return 0;

    const now = new Date();
    let totalTouched = 0;
    for (let offset = 0; offset < uniqueAuthorIds.length; offset += resolvedBatchSize) {
      const batch = uniqueAuthorIds.slice(offset, offset + resolvedBatchSize);
      totalTouched += await this.upsertScheduleBatch(batch, reason, now);
    }

    return totalTouched;
  }

  private async upsertScheduleBatch(authorIds: number[], reason: AuthorEnrichmentReason, now: Date): Promise<number> {
    const touched = await this.db
      .insert(authorEnrichmentQueue)
      .values(
        authorIds.map((authorId) => ({
          authorId,
          status: 'queued',
          reason,
          attemptCount: 0,
          nextAttemptAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: authorEnrichmentQueue.authorId,
        set: {
          status: 'queued',
          reason,
          attemptCount: 0,
          nextAttemptAt: now,
          updatedAt: now,
        },
        setWhere: sql`${authorEnrichmentQueue.status} <> 'processing'`,
      })
      .returning({ authorId: authorEnrichmentQueue.authorId });

    return touched.length;
  }

  async enqueueAllLinkedAuthors(reason: AuthorEnrichmentReason, batchSize = DEFAULT_SCHEDULE_BATCH_SIZE): Promise<number> {
    const resolvedBatchSize = resolveBatchSize(batchSize);
    if (!resolvedBatchSize) return 0;

    let cursorAuthorId = 0;
    let totalQueued = 0;

    for (;;) {
      const rows = await this.db
        .selectDistinct({ authorId: bookAuthors.authorId })
        .from(bookAuthors)
        .where(sql`${bookAuthors.authorId} > ${cursorAuthorId}`)
        .orderBy(asc(bookAuthors.authorId))
        .limit(resolvedBatchSize);

      if (rows.length === 0) break;

      totalQueued += await this.upsertSchedule(
        rows.map((row) => row.authorId),
        reason,
        resolvedBatchSize,
      );
      cursorAuthorId = rows[rows.length - 1]!.authorId;
    }

    return totalQueued;
  }

  async filterEligibleAuthorIds(
    authorIds: number[],
    conditions: AuthorEnrichmentConditions,
    batchSize = DEFAULT_SCHEDULE_BATCH_SIZE,
  ): Promise<number[]> {
    if (authorIds.length === 0) return [];

    const eligibility = this.buildEligibilityPredicate(conditions);
    if (!eligibility) return [];

    const resolvedBatchSize = resolveBatchSize(batchSize);
    if (!resolvedBatchSize) return [];

    const eligibleIds: number[] = [];
    const uniqueAuthorIds = [...new Set(authorIds)].filter((id) => Number.isInteger(id) && id > 0);
    for (let offset = 0; offset < uniqueAuthorIds.length; offset += resolvedBatchSize) {
      const batch = uniqueAuthorIds.slice(offset, offset + resolvedBatchSize);
      const rows = await this.db
        .select({ id: authors.id })
        .from(authors)
        .where(and(inArray(authors.id, batch), eligibility));
      eligibleIds.push(...rows.map((r) => r.id));
    }

    return eligibleIds;
  }

  async enqueueEligibleLinkedAuthors(
    reason: AuthorEnrichmentReason,
    conditions: AuthorEnrichmentConditions,
    batchSize = DEFAULT_SCHEDULE_BATCH_SIZE,
  ): Promise<number> {
    const eligibility = this.buildEligibilityPredicate(conditions);
    if (!eligibility) return 0;

    const resolvedBatchSize = resolveBatchSize(batchSize);
    if (!resolvedBatchSize) return 0;

    let cursorAuthorId = 0;
    let totalQueued = 0;

    for (;;) {
      const rows = await this.db
        .selectDistinct({ authorId: bookAuthors.authorId })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(and(eligibility, sql`${bookAuthors.authorId} > ${cursorAuthorId}`))
        .orderBy(asc(bookAuthors.authorId))
        .limit(resolvedBatchSize);

      if (rows.length === 0) break;

      totalQueued += await this.upsertSchedule(
        rows.map((row) => row.authorId),
        reason,
        resolvedBatchSize,
      );
      cursorAuthorId = rows[rows.length - 1]!.authorId;
    }

    return totalQueued;
  }

  async countEligibleLinkedAuthors(conditions: AuthorEnrichmentConditions): Promise<number> {
    const eligibility = this.buildEligibilityPredicate(conditions);
    if (!eligibility) return 0;
    const [row] = await this.db
      .select({ total: sql<number>`count(distinct ${bookAuthors.authorId})::int` })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(eligibility);
    return Number(row?.total ?? 0);
  }

  async fetchDue(limit: number): Promise<(AuthorEnrichmentQueueRow & { authorName: string | null })[]> {
    if (limit <= 0) return [];
    const rows = await this.db
      .select({ queue: authorEnrichmentQueue, authorName: authors.name })
      .from(authorEnrichmentQueue)
      .leftJoin(authors, eq(authors.id, authorEnrichmentQueue.authorId))
      .where(and(inArray(authorEnrichmentQueue.status, [...AUTHOR_ENRICHMENT_ACTIVE_STATUSES]), lte(authorEnrichmentQueue.nextAttemptAt, new Date())))
      .orderBy(asc(authorEnrichmentQueue.nextAttemptAt), asc(authorEnrichmentQueue.authorId))
      .limit(limit);
    return rows.map((r) => ({ ...r.queue, authorName: r.authorName }));
  }

  async getStatusSummary(): Promise<AuthorEnrichmentStatus> {
    const rows = await this.db
      .select({
        status: authorEnrichmentQueue.status,
        cnt: count(),
      })
      .from(authorEnrichmentQueue)
      .groupBy(authorEnrichmentQueue.status);

    const summary: AuthorEnrichmentStatus = {
      queued: 0,
      processing: 0,
      rateLimited: 0,
      failed: 0,
      done: 0,
      total: 0,
    };

    for (const row of rows) {
      const value = Number(row.cnt);
      if (row.status === 'queued') summary.queued = value;
      else if (row.status === 'processing') summary.processing = value;
      else if (row.status === 'rate_limited') summary.rateLimited = value;
      else if (row.status === 'failed') summary.failed = value;
    }

    summary.total = summary.queued + summary.processing + summary.rateLimited + summary.failed;
    return summary;
  }

  async markProcessing(authorId: number): Promise<boolean> {
    const now = new Date();
    try {
      const updated = await this.db
        .update(authorEnrichmentQueue)
        .set({
          status: 'processing',
          lastAttemptAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(authorEnrichmentQueue.authorId, authorId),
            inArray(authorEnrichmentQueue.status, [...AUTHOR_ENRICHMENT_ACTIVE_STATUSES]),
            lte(authorEnrichmentQueue.nextAttemptAt, now),
          ),
        )
        .returning({ authorId: authorEnrichmentQueue.authorId });
      return updated.length > 0;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async markDone(authorId: number, imageUpdated: boolean): Promise<void> {
    const now = new Date();
    const authorUpdate: { lastEnrichedAt: Date; hasPhoto?: true } = { lastEnrichedAt: now };
    if (imageUpdated) authorUpdate.hasPhoto = true;

    await Promise.all([
      this.db.delete(authorEnrichmentQueue).where(eq(authorEnrichmentQueue.authorId, authorId)),
      this.db.update(authors).set(authorUpdate).where(eq(authors.id, authorId)),
    ]);
  }

  async recoverStuckProcessing(staleBefore: Date): Promise<number> {
    const now = new Date();
    const updated = await this.db
      .update(authorEnrichmentQueue)
      .set({
        status: 'queued',
        nextAttemptAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(authorEnrichmentQueue.status, 'processing'),
          or(isNull(authorEnrichmentQueue.lastAttemptAt), lte(authorEnrichmentQueue.lastAttemptAt, staleBefore)),
        ),
      )
      .returning({ authorId: authorEnrichmentQueue.authorId });

    return updated.length;
  }

  async cancelPending(): Promise<number> {
    const deleted = await this.db
      .delete(authorEnrichmentQueue)
      .where(inArray(authorEnrichmentQueue.status, ['queued', 'rate_limited']))
      .returning({ authorId: authorEnrichmentQueue.authorId });
    return deleted.length;
  }

  async requeueFailed(): Promise<number> {
    const now = new Date();
    const updated = await this.db
      .update(authorEnrichmentQueue)
      .set({ status: 'queued', attemptCount: 0, nextAttemptAt: now, lastError: null, lastHttpStatus: null, updatedAt: now })
      .where(eq(authorEnrichmentQueue.status, 'failed'))
      .returning({ authorId: authorEnrichmentQueue.authorId });
    return updated.length;
  }

  async resetAllProcessingOnBoot(): Promise<number> {
    const now = new Date();
    const updated = await this.db
      .update(authorEnrichmentQueue)
      .set({ status: 'queued', nextAttemptAt: now, updatedAt: now })
      .where(eq(authorEnrichmentQueue.status, 'processing'))
      .returning({ authorId: authorEnrichmentQueue.authorId });
    return updated.length;
  }

  async getFailedItems(page: number, limit: number): Promise<{ items: AuthorEnrichmentFailedItem[]; total: number }> {
    const offset = (page - 1) * limit;
    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          authorId: authorEnrichmentQueue.authorId,
          name: authors.name,
          error: authorEnrichmentQueue.lastError,
          httpStatus: authorEnrichmentQueue.lastHttpStatus,
          failedAt: authorEnrichmentQueue.updatedAt,
        })
        .from(authorEnrichmentQueue)
        .leftJoin(authors, eq(authors.id, authorEnrichmentQueue.authorId))
        .where(eq(authorEnrichmentQueue.status, 'failed'))
        .orderBy(asc(authorEnrichmentQueue.updatedAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ cnt: count() }).from(authorEnrichmentQueue).where(eq(authorEnrichmentQueue.status, 'failed')),
    ]);
    return {
      items: rows.map((r) => ({
        authorId: r.authorId,
        name: r.name ?? null,
        error: r.error ?? null,
        httpStatus: r.httpStatus ?? null,
        failedAt: r.failedAt.toISOString(),
      })),
      total: Number(totalRows[0]?.cnt ?? 0),
    };
  }

  async markFailed(params: {
    authorId: number;
    error: string;
    httpStatus?: number | null;
    nextAttemptAt: Date | null;
    rateLimited: boolean;
  }): Promise<void> {
    const now = new Date();
    await this.db
      .update(authorEnrichmentQueue)
      .set({
        status: params.nextAttemptAt ? (params.rateLimited ? 'rate_limited' : 'queued') : 'failed',
        attemptCount: sql`${authorEnrichmentQueue.attemptCount} + 1`,
        nextAttemptAt: params.nextAttemptAt ?? now,
        lastError: params.error,
        lastHttpStatus: params.httpStatus ?? null,
        updatedAt: now,
      })
      .where(eq(authorEnrichmentQueue.authorId, params.authorId));
  }

  private buildEligibilityPredicate(conditions: AuthorEnrichmentConditions): SQL | null {
    const clauses: SQL[] = [];
    if (conditions.neverEnriched) clauses.push(isNull(authors.lastEnrichedAt));
    if (conditions.missingBio) clauses.push(isNull(authors.description));
    if (conditions.missingPhoto) clauses.push(eq(authors.hasPhoto, false));
    if (clauses.length === 0) return null;
    return or(...clauses)!;
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = Reflect.get(error, 'code');
  return code === '23505';
}

function resolveBatchSize(batchSize: number): number | null {
  const resolved = Math.floor(batchSize);
  if (!Number.isFinite(resolved) || resolved <= 0) return null;
  return resolved;
}
