import { Inject, Injectable } from '@nestjs/common';
import type { AuthorEnrichmentStatus } from '@projectx/types';
import { and, asc, count, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authorEnrichmentQueue, bookAuthors } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export const AUTHOR_ENRICHMENT_ACTIVE_STATUSES = ['queued', 'rate_limited'] as const;

export type AuthorEnrichmentActiveStatus = (typeof AUTHOR_ENRICHMENT_ACTIVE_STATUSES)[number];

export type AuthorEnrichmentQueueRow = typeof authorEnrichmentQueue.$inferSelect;

@Injectable()
export class AuthorEnrichmentRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async upsertSchedule(authorIds: number[], reason: string): Promise<number> {
    const uniqueAuthorIds = [...new Set(authorIds)].filter((id) => Number.isInteger(id) && id > 0);
    if (uniqueAuthorIds.length === 0) return 0;

    const now = new Date();
    const touched = await this.db
      .insert(authorEnrichmentQueue)
      .values(
        uniqueAuthorIds.map((authorId) => ({
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

  async enqueueAllLinkedAuthors(reason: string): Promise<number> {
    const rows = await this.db.selectDistinct({ authorId: bookAuthors.authorId }).from(bookAuthors);
    const authorIds = rows.map((row) => row.authorId);
    return this.upsertSchedule(authorIds, reason);
  }

  async fetchDue(limit: number): Promise<AuthorEnrichmentQueueRow[]> {
    if (limit <= 0) return [];
    return this.db
      .select()
      .from(authorEnrichmentQueue)
      .where(and(inArray(authorEnrichmentQueue.status, [...AUTHOR_ENRICHMENT_ACTIVE_STATUSES]), lte(authorEnrichmentQueue.nextAttemptAt, new Date())))
      .orderBy(asc(authorEnrichmentQueue.nextAttemptAt), asc(authorEnrichmentQueue.authorId))
      .limit(limit);
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
      summary.total += value;

      if (row.status === 'queued') summary.queued = value;
      else if (row.status === 'processing') summary.processing = value;
      else if (row.status === 'rate_limited') summary.rateLimited = value;
      else if (row.status === 'failed') summary.failed = value;
      else if (row.status === 'done') summary.done = value;
    }

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

  async markDone(authorId: number): Promise<void> {
    const now = new Date();
    await this.db
      .update(authorEnrichmentQueue)
      .set({
        status: 'done',
        attemptCount: 0,
        lastSuccessAt: now,
        lastError: null,
        lastHttpStatus: null,
        nextAttemptAt: now,
        updatedAt: now,
      })
      .where(eq(authorEnrichmentQueue.authorId, authorId));
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
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = Reflect.get(error, 'code');
  return code === '23505';
}
