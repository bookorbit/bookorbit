import { Inject, Injectable } from '@nestjs/common';
import type { BookMetadataFetchConfig, BookMetadataFetchFailedItem, BookMetadataFetchReason, BookMetadataFetchStatus } from '@projectx/types';
import { and, asc, count, eq, isNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookAuthors, bookGenres, bookMetadata, bookMetadataFetchQueue, books, libraries } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const PROCESSING_STALE_AFTER_MS = 10 * 60 * 1000;

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
          status: 'queued',
          reason,
          attemptCount: 0,
        })),
      )
      .onConflictDoUpdate({
        target: bookMetadataFetchQueue.bookId,
        set: {
          status: 'queued',
          reason,
          attemptCount: 0,
          updatedAt: now,
        },
        // Only reset rows that are not currently being processed
        setWhere: sql`${bookMetadataFetchQueue.status} <> 'processing'`,
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
      .where(eq(bookMetadataFetchQueue.status, 'queued'))
      .orderBy(asc(bookMetadataFetchQueue.createdAt), asc(bookMetadataFetchQueue.bookId))
      .limit(limit);
  }

  async markProcessing(bookId: number): Promise<boolean> {
    const now = new Date();
    try {
      const updated = await this.db
        .update(bookMetadataFetchQueue)
        .set({ status: 'processing', lastAttemptAt: now, attemptCount: sql`${bookMetadataFetchQueue.attemptCount} + 1`, updatedAt: now })
        .where(and(eq(bookMetadataFetchQueue.bookId, bookId), eq(bookMetadataFetchQueue.status, 'queued')))
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
      .set({ status: 'failed', lastError: error.slice(0, 2000), lastHttpStatus: httpStatus ?? null, updatedAt: now })
      .where(eq(bookMetadataFetchQueue.bookId, bookId));
  }

  async cancelPending(): Promise<number> {
    const deleted = await this.db
      .delete(bookMetadataFetchQueue)
      .where(eq(bookMetadataFetchQueue.status, 'queued'))
      .returning({ bookId: bookMetadataFetchQueue.bookId });
    return deleted.length;
  }

  async requeueFailed(): Promise<number> {
    const now = new Date();
    const updated = await this.db
      .update(bookMetadataFetchQueue)
      .set({ status: 'queued', reason: 'manual_retry', lastError: null, lastHttpStatus: null, attemptCount: 0, updatedAt: now })
      .where(eq(bookMetadataFetchQueue.status, 'failed'))
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
      if (row.status === 'queued') summary.queued = value;
      else if (row.status === 'processing') summary.processing = value;
      else if (row.status === 'failed') summary.failed = value;
    }
    return summary;
  }

  async resetAllProcessingOnBoot(): Promise<number> {
    const updated = await this.db
      .update(bookMetadataFetchQueue)
      .set({ status: 'queued', updatedAt: new Date() })
      .where(eq(bookMetadataFetchQueue.status, 'processing'))
      .returning({ bookId: bookMetadataFetchQueue.bookId });
    return updated.length;
  }

  async recoverStuckProcessing(): Promise<number> {
    const staleBefore = new Date(Date.now() - PROCESSING_STALE_AFTER_MS);
    const now = new Date();
    const updated = await this.db
      .update(bookMetadataFetchQueue)
      .set({ status: 'queued', updatedAt: now })
      .where(
        and(
          eq(bookMetadataFetchQueue.status, 'processing'),
          or(isNull(bookMetadataFetchQueue.lastAttemptAt), sql`${bookMetadataFetchQueue.lastAttemptAt} <= ${staleBefore}`),
        ),
      )
      .returning({ bookId: bookMetadataFetchQueue.bookId });
    return updated.length;
  }

  async fetchEligibleBookIds(config: BookMetadataFetchConfig, libraryId?: number): Promise<number[]> {
    const { conditions } = config;
    const conditionClauses: ReturnType<typeof sql>[] = [];

    if (conditions.neverFetched.enabled) {
      conditionClauses.push(sql`${bookMetadata.lastMetadataFetchAt} IS NULL`);
    }

    if (conditions.scoreThreshold.enabled) {
      conditionClauses.push(sql`(${bookMetadata.metadataScore} IS NULL OR ${bookMetadata.metadataScore} < ${conditions.scoreThreshold.threshold})`);
    }

    if (conditions.missingFields.enabled && conditions.missingFields.fields.length > 0) {
      const fieldClauses: ReturnType<typeof sql>[] = [];
      for (const field of conditions.missingFields.fields) {
        switch (field) {
          case 'authors':
            fieldClauses.push(sql`NOT EXISTS (SELECT 1 FROM ${bookAuthors} WHERE ${bookAuthors.bookId} = ${bookMetadata.bookId})`);
            break;
          case 'genres':
            fieldClauses.push(sql`NOT EXISTS (SELECT 1 FROM ${bookGenres} WHERE ${bookGenres.bookId} = ${bookMetadata.bookId})`);
            break;
          case 'title':
            fieldClauses.push(sql`(${bookMetadata.title} IS NULL OR ${bookMetadata.title} = '')`);
            break;
          case 'subtitle':
            fieldClauses.push(sql`(${bookMetadata.subtitle} IS NULL OR ${bookMetadata.subtitle} = '')`);
            break;
          case 'description':
            fieldClauses.push(sql`(${bookMetadata.description} IS NULL OR ${bookMetadata.description} = '')`);
            break;
          case 'publisher':
            fieldClauses.push(sql`(${bookMetadata.publisher} IS NULL OR ${bookMetadata.publisher} = '')`);
            break;
          case 'publishedYear':
            fieldClauses.push(sql`${bookMetadata.publishedYear} IS NULL`);
            break;
          case 'language':
            fieldClauses.push(sql`(${bookMetadata.language} IS NULL OR ${bookMetadata.language} = '')`);
            break;
          case 'pageCount':
            fieldClauses.push(sql`${bookMetadata.pageCount} IS NULL`);
            break;
          case 'seriesName':
            fieldClauses.push(sql`(${bookMetadata.seriesName} IS NULL OR ${bookMetadata.seriesName} = '')`);
            break;
          case 'seriesIndex':
            fieldClauses.push(sql`${bookMetadata.seriesIndex} IS NULL`);
            break;
          case 'cover':
            fieldClauses.push(sql`${bookMetadata.coverSource} IS NULL`);
            break;
        }
      }
      if (fieldClauses.length > 0) {
        conditionClauses.push(sql`(${sql.join(fieldClauses, sql` OR `)})`);
      }
    }

    if (conditionClauses.length === 0) return [];

    const notAlreadyQueued = sql`NOT EXISTS (SELECT 1 FROM ${bookMetadataFetchQueue} WHERE ${bookMetadataFetchQueue.bookId} = ${bookMetadata.bookId})`;
    const eligibilityClause = sql`(${sql.join(conditionClauses, sql` OR `)})`;

    const whereClause =
      libraryId !== undefined
        ? and(eq(books.status, 'present'), eq(books.libraryId, libraryId), eligibilityClause, notAlreadyQueued)
        : and(eq(books.status, 'present'), eligibilityClause, notAlreadyQueued);

    const rows = await this.db
      .select({ bookId: bookMetadata.bookId })
      .from(bookMetadata)
      .innerJoin(books, eq(books.id, bookMetadata.bookId))
      .where(whereClause);

    return rows.map((r) => r.bookId);
  }

  async countEligibleBooks(config: BookMetadataFetchConfig, libraryId?: number): Promise<number> {
    const { conditions } = config;
    const conditionClauses: ReturnType<typeof sql>[] = [];

    if (conditions.neverFetched.enabled) {
      conditionClauses.push(sql`${bookMetadata.lastMetadataFetchAt} IS NULL`);
    }

    if (conditions.scoreThreshold.enabled) {
      conditionClauses.push(sql`(${bookMetadata.metadataScore} IS NULL OR ${bookMetadata.metadataScore} < ${conditions.scoreThreshold.threshold})`);
    }

    if (conditions.missingFields.enabled && conditions.missingFields.fields.length > 0) {
      const fieldClauses: ReturnType<typeof sql>[] = [];
      for (const field of conditions.missingFields.fields) {
        switch (field) {
          case 'authors':
            fieldClauses.push(sql`NOT EXISTS (SELECT 1 FROM ${bookAuthors} WHERE ${bookAuthors.bookId} = ${bookMetadata.bookId})`);
            break;
          case 'genres':
            fieldClauses.push(sql`NOT EXISTS (SELECT 1 FROM ${bookGenres} WHERE ${bookGenres.bookId} = ${bookMetadata.bookId})`);
            break;
          case 'title':
            fieldClauses.push(sql`(${bookMetadata.title} IS NULL OR ${bookMetadata.title} = '')`);
            break;
          case 'subtitle':
            fieldClauses.push(sql`(${bookMetadata.subtitle} IS NULL OR ${bookMetadata.subtitle} = '')`);
            break;
          case 'description':
            fieldClauses.push(sql`(${bookMetadata.description} IS NULL OR ${bookMetadata.description} = '')`);
            break;
          case 'publisher':
            fieldClauses.push(sql`(${bookMetadata.publisher} IS NULL OR ${bookMetadata.publisher} = '')`);
            break;
          case 'publishedYear':
            fieldClauses.push(sql`${bookMetadata.publishedYear} IS NULL`);
            break;
          case 'language':
            fieldClauses.push(sql`(${bookMetadata.language} IS NULL OR ${bookMetadata.language} = '')`);
            break;
          case 'pageCount':
            fieldClauses.push(sql`${bookMetadata.pageCount} IS NULL`);
            break;
          case 'seriesName':
            fieldClauses.push(sql`(${bookMetadata.seriesName} IS NULL OR ${bookMetadata.seriesName} = '')`);
            break;
          case 'seriesIndex':
            fieldClauses.push(sql`${bookMetadata.seriesIndex} IS NULL`);
            break;
          case 'cover':
            fieldClauses.push(sql`${bookMetadata.coverSource} IS NULL`);
            break;
        }
      }
      if (fieldClauses.length > 0) {
        conditionClauses.push(sql`(${sql.join(fieldClauses, sql` OR `)})`);
      }
    }

    if (conditionClauses.length === 0) return 0;

    const notAlreadyQueued = sql`NOT EXISTS (SELECT 1 FROM ${bookMetadataFetchQueue} WHERE ${bookMetadataFetchQueue.bookId} = ${bookMetadata.bookId})`;
    const eligibilityClause = sql`(${sql.join(conditionClauses, sql` OR `)})`;

    const whereClause =
      libraryId !== undefined
        ? and(eq(books.status, 'present'), eq(books.libraryId, libraryId), eligibilityClause, notAlreadyQueued)
        : and(eq(books.status, 'present'), eligibilityClause, notAlreadyQueued);

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
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return Reflect.get(error, 'code') === '23505';
}
