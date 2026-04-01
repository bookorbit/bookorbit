import { Inject, Injectable } from '@nestjs/common';
import type {
  BookMetadataFetchConfig,
  BookMetadataFetchFailedItem,
  BookMetadataFetchReason,
  BookMetadataFetchStatus,
  MetadataField,
} from '@projectx/types';
import type { SQL } from 'drizzle-orm';
import { and, asc, count, eq, isNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookAuthors, bookGenres, bookMetadata, bookMetadataFetchQueue, bookNarrators, books, libraries } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const PROCESSING_STALE_AFTER_MS = 10 * 60 * 1000;
const QUEUE_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  FAILED: 'failed',
} as const;

@Injectable()
export class BookMetadataFetchQueueRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async upsertSchedule(bookIds: number[], reason: BookMetadataFetchReason): Promise<number> {
    const unique = [...new Set(bookIds)].filter((id) => Number.isInteger(id) && id > 0);
    if (unique.length === 0) return 0;

    const now = new Date();
    const touched = await this.db
      .insert(bookMetadataFetchQueue)
      .values(
        unique.map((bookId) => ({
          bookId,
          status: QUEUE_STATUS.QUEUED,
          reason,
          attemptCount: 0,
        })),
      )
      .onConflictDoUpdate({
        target: bookMetadataFetchQueue.bookId,
        set: {
          status: QUEUE_STATUS.QUEUED,
          reason,
          attemptCount: 0,
          updatedAt: now,
        },
        // Only re-queue failed rows. Already-queued rows are intentionally ignored
        // so progress totals only reflect newly scheduled work.
        setWhere: eq(bookMetadataFetchQueue.status, QUEUE_STATUS.FAILED),
      })
      .returning({ bookId: bookMetadataFetchQueue.bookId });

    return touched.length;
  }

  async fetchDue(limit: number): Promise<{ bookId: number; title: string | null }[]> {
    if (limit <= 0) return [];
    return this.db
      .select({
        bookId: bookMetadataFetchQueue.bookId,
        title: sql<string | null>`COALESCE(${bookMetadata.title}, ${books.folderPath})`,
      })
      .from(bookMetadataFetchQueue)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, bookMetadataFetchQueue.bookId))
      .leftJoin(books, eq(books.id, bookMetadataFetchQueue.bookId))
      .where(eq(bookMetadataFetchQueue.status, QUEUE_STATUS.QUEUED))
      .orderBy(asc(bookMetadataFetchQueue.createdAt), asc(bookMetadataFetchQueue.bookId))
      .limit(limit);
  }

  async markProcessing(bookId: number): Promise<boolean> {
    const now = new Date();
    try {
      const updated = await this.db
        .update(bookMetadataFetchQueue)
        .set({
          status: QUEUE_STATUS.PROCESSING,
          lastAttemptAt: now,
          attemptCount: sql`${bookMetadataFetchQueue.attemptCount} + 1`,
          updatedAt: now,
        })
        .where(and(eq(bookMetadataFetchQueue.bookId, bookId), eq(bookMetadataFetchQueue.status, QUEUE_STATUS.QUEUED)))
        .returning({ bookId: bookMetadataFetchQueue.bookId });
      return updated.length > 0;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async markDone(bookId: number): Promise<void> {
    await this.db.delete(bookMetadataFetchQueue).where(eq(bookMetadataFetchQueue.bookId, bookId));
  }

  async markFailed(bookId: number, error: string, httpStatus?: number): Promise<void> {
    const now = new Date();
    await this.db
      .update(bookMetadataFetchQueue)
      .set({ status: QUEUE_STATUS.FAILED, lastError: error.slice(0, 2000), lastHttpStatus: httpStatus ?? null, updatedAt: now })
      .where(eq(bookMetadataFetchQueue.bookId, bookId));
  }

  async cancelPending(): Promise<number> {
    const deleted = await this.db
      .delete(bookMetadataFetchQueue)
      .where(eq(bookMetadataFetchQueue.status, QUEUE_STATUS.QUEUED))
      .returning({ bookId: bookMetadataFetchQueue.bookId });
    return deleted.length;
  }

  async requeueFailed(): Promise<number> {
    const now = new Date();
    const updated = await this.db
      .update(bookMetadataFetchQueue)
      .set({ status: QUEUE_STATUS.QUEUED, reason: 'manual_retry', lastError: null, lastHttpStatus: null, attemptCount: 0, updatedAt: now })
      .where(eq(bookMetadataFetchQueue.status, QUEUE_STATUS.FAILED))
      .returning({ bookId: bookMetadataFetchQueue.bookId });
    return updated.length;
  }

  async getStatusSummary(): Promise<Pick<BookMetadataFetchStatus, 'queued' | 'processing' | 'failed'>> {
    const rows = await this.db
      .select({ status: bookMetadataFetchQueue.status, cnt: count() })
      .from(bookMetadataFetchQueue)
      .groupBy(bookMetadataFetchQueue.status);

    const summary = { queued: 0, processing: 0, failed: 0 };
    for (const row of rows) {
      const value = Number(row.cnt);
      if (row.status === QUEUE_STATUS.QUEUED) summary.queued = value;
      else if (row.status === QUEUE_STATUS.PROCESSING) summary.processing = value;
      else if (row.status === QUEUE_STATUS.FAILED) summary.failed = value;
    }
    return summary;
  }

  async resetAllProcessingOnBoot(): Promise<number> {
    const updated = await this.db
      .update(bookMetadataFetchQueue)
      .set({ status: QUEUE_STATUS.QUEUED, updatedAt: new Date() })
      .where(eq(bookMetadataFetchQueue.status, QUEUE_STATUS.PROCESSING))
      .returning({ bookId: bookMetadataFetchQueue.bookId });
    return updated.length;
  }

  async recoverStuckProcessing(): Promise<number> {
    const staleBefore = new Date(Date.now() - PROCESSING_STALE_AFTER_MS);
    const now = new Date();
    const updated = await this.db
      .update(bookMetadataFetchQueue)
      .set({ status: QUEUE_STATUS.QUEUED, updatedAt: now })
      .where(
        and(
          eq(bookMetadataFetchQueue.status, QUEUE_STATUS.PROCESSING),
          or(isNull(bookMetadataFetchQueue.lastAttemptAt), sql`${bookMetadataFetchQueue.lastAttemptAt} <= ${staleBefore}`),
        ),
      )
      .returning({ bookId: bookMetadataFetchQueue.bookId });
    return updated.length;
  }

  async fetchEligibleBookIds(config: BookMetadataFetchConfig, libraryId?: number): Promise<number[]> {
    const whereClause = this.buildEligibleBooksWhereClause(config, libraryId);
    if (!whereClause) return [];

    const rows = await this.db
      .select({ bookId: bookMetadata.bookId })
      .from(bookMetadata)
      .innerJoin(books, eq(books.id, bookMetadata.bookId))
      .where(whereClause);

    return rows.map((r) => r.bookId);
  }

  async countEligibleBooks(config: BookMetadataFetchConfig, libraryId?: number): Promise<number> {
    const whereClause = this.buildEligibleBooksWhereClause(config, libraryId);
    if (!whereClause) return 0;

    const rows = await this.db.select({ cnt: count() }).from(bookMetadata).innerJoin(books, eq(books.id, bookMetadata.bookId)).where(whereClause);

    return Number(rows[0]?.cnt ?? 0);
  }

  async getFailedItems(page: number, limit: number): Promise<{ items: BookMetadataFetchFailedItem[]; total: number }> {
    const offset = (page - 1) * limit;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          bookId: bookMetadataFetchQueue.bookId,
          title: bookMetadata.title,
          libraryName: libraries.name,
          error: bookMetadataFetchQueue.lastError,
          httpStatus: bookMetadataFetchQueue.lastHttpStatus,
          failedAt: bookMetadataFetchQueue.updatedAt,
        })
        .from(bookMetadataFetchQueue)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, bookMetadataFetchQueue.bookId))
        .leftJoin(books, eq(books.id, bookMetadataFetchQueue.bookId))
        .leftJoin(libraries, eq(libraries.id, books.libraryId))
        .where(eq(bookMetadataFetchQueue.status, 'failed'))
        .orderBy(asc(bookMetadataFetchQueue.updatedAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ cnt: count() }).from(bookMetadataFetchQueue).where(eq(bookMetadataFetchQueue.status, 'failed')),
    ]);

    return {
      items: rows.map((r) => ({
        bookId: r.bookId,
        title: r.title ?? null,
        libraryName: r.libraryName ?? null,
        error: r.error ?? null,
        httpStatus: r.httpStatus ?? null,
        failedAt: r.failedAt.toISOString(),
      })),
      total: Number(totalRows[0]?.cnt ?? 0),
    };
  }

  private buildEligibleBooksWhereClause(config: BookMetadataFetchConfig, libraryId?: number): SQL | null {
    const eligibilityClause = this.buildEligibilityClause(config);
    if (!eligibilityClause) return null;

    const notAlreadyQueued = sql`NOT EXISTS (SELECT 1 FROM ${bookMetadataFetchQueue} WHERE ${bookMetadataFetchQueue.bookId} = ${bookMetadata.bookId})`;

    const whereClause =
      libraryId !== undefined
        ? and(eq(books.status, 'present'), eq(books.libraryId, libraryId), eligibilityClause, notAlreadyQueued)
        : and(eq(books.status, 'present'), eligibilityClause, notAlreadyQueued);
    return whereClause ?? null;
  }

  private buildEligibilityClause(config: BookMetadataFetchConfig): SQL | null {
    const { conditions } = config;
    const conditionClauses: SQL[] = [];

    if (conditions.neverFetched.enabled) {
      conditionClauses.push(sql`${bookMetadata.lastMetadataFetchAt} IS NULL`);
    }

    if (conditions.scoreThreshold.enabled) {
      conditionClauses.push(sql`(${bookMetadata.metadataScore} IS NULL OR ${bookMetadata.metadataScore} < ${conditions.scoreThreshold.threshold})`);
    }

    if (conditions.missingFields.enabled && conditions.missingFields.fields.length > 0) {
      const missingFieldClauses = conditions.missingFields.fields
        .map((field) => this.buildMissingFieldClause(field))
        .filter((clause): clause is SQL => clause !== null);

      if (missingFieldClauses.length > 0) {
        conditionClauses.push(sql`(${sql.join(missingFieldClauses, sql` OR `)})`);
      }
    }

    if (conditionClauses.length === 0) return null;
    return sql`(${sql.join(conditionClauses, sql` OR `)})`;
  }

  private buildMissingFieldClause(field: MetadataField): SQL | null {
    switch (field) {
      case 'authors':
        return sql`NOT EXISTS (SELECT 1 FROM ${bookAuthors} WHERE ${bookAuthors.bookId} = ${bookMetadata.bookId})`;
      case 'genres':
        return sql`NOT EXISTS (SELECT 1 FROM ${bookGenres} WHERE ${bookGenres.bookId} = ${bookMetadata.bookId})`;
      case 'narrators':
        return sql`NOT EXISTS (SELECT 1 FROM ${bookNarrators} WHERE ${bookNarrators.bookId} = ${bookMetadata.bookId})`;
      case 'duration':
        return sql`${bookMetadata.durationSeconds} IS NULL`;
      case 'abridged':
        return sql`${bookMetadata.abridged} IS NULL`;
      case 'cover':
        return sql`${bookMetadata.coverSource} IS NULL`;
      case 'title':
        return sql`(${bookMetadata.title} IS NULL OR ${bookMetadata.title} = '')`;
      case 'subtitle':
        return sql`(${bookMetadata.subtitle} IS NULL OR ${bookMetadata.subtitle} = '')`;
      case 'description':
        return sql`(${bookMetadata.description} IS NULL OR ${bookMetadata.description} = '')`;
      case 'publisher':
        return sql`(${bookMetadata.publisher} IS NULL OR ${bookMetadata.publisher} = '')`;
      case 'publishedYear':
        return sql`${bookMetadata.publishedYear} IS NULL`;
      case 'language':
        return sql`(${bookMetadata.language} IS NULL OR ${bookMetadata.language} = '')`;
      case 'pageCount':
        return sql`${bookMetadata.pageCount} IS NULL`;
      case 'seriesName':
        return sql`(${bookMetadata.seriesName} IS NULL OR ${bookMetadata.seriesName} = '')`;
      case 'seriesIndex':
        return sql`${bookMetadata.seriesIndex} IS NULL`;
      default:
        return null;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return Reflect.get(error, 'code') === '23505';
}
