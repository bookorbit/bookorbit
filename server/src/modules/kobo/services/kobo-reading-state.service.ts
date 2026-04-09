import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { KoboBookAccessService } from './kobo-book-access.service';

type Db = NodePgDatabase<typeof schema>;
type JsonObj = Record<string, unknown>;
const PROGRESS_PUSH_PAGE_SIZE = 250;

function mergeSubObject(incoming: JsonObj | null | undefined, existing: JsonObj | null | undefined): JsonObj | null {
  if (!incoming) return existing ?? null;
  if (!existing) return incoming;
  const a = incoming.LastModified as string | undefined;
  const b = existing.LastModified as string | undefined;
  if (!a || !b) return incoming;
  return a >= b ? incoming : existing;
}

@Injectable()
export class KoboReadingStateService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bookAccessService: KoboBookAccessService,
  ) {}

  async upsertState(userId: number, bookId: number, payload: Record<string, unknown>, readingThreshold: number, finishedThreshold: number) {
    await this.bookAccessService.assertBookAccessible(userId, bookId);

    const entitlementId = String(bookId);
    const now = new Date().toISOString();

    const book = await this.db.query.books.findFirst({
      where: eq(schema.books.id, bookId),
      columns: { id: true },
    });
    if (!book) {
      return {
        RequestResult: 'Success',
        UpdateResults: [
          {
            EntitlementId: entitlementId,
            CurrentBookmarkResult: { Result: 'Ignored' },
            StatisticsResult: { Result: 'Ignored' },
            StatusInfoResult: { Result: 'Ignored' },
          },
        ],
      };
    }

    const created = (payload.Created as string | undefined) ?? now;
    const lastModified = (payload.LastModified as string | undefined) ?? now;
    const priorityTimestamp = (payload.PriorityTimestamp as string | undefined) ?? lastModified;

    const incomingBookmark = (payload.CurrentBookmark as JsonObj | undefined) ?? null;
    const incomingStats = (payload.Statistics as JsonObj | undefined) ?? null;
    const incomingStatus = (payload.StatusInfo as JsonObj | undefined) ?? null;

    const existing = await this.db.query.koboReadingStates.findFirst({
      where: and(eq(schema.koboReadingStates.userId, userId), eq(schema.koboReadingStates.bookId, bookId)),
    });

    const mergedBookmark = mergeSubObject(incomingBookmark, existing?.currentBookmark as JsonObj | null);
    const mergedStats = mergeSubObject(incomingStats, existing?.statistics as JsonObj | null);
    const mergedStatus = mergeSubObject(incomingStatus, existing?.statusInfo as JsonObj | null);

    await this.db
      .insert(schema.koboReadingStates)
      .values({
        userId,
        bookId,
        entitlementId,
        createdAtKobo: created,
        lastModifiedKobo: lastModified,
        priorityTimestamp,
        currentBookmark: mergedBookmark,
        statistics: mergedStats,
        statusInfo: mergedStatus,
        progressSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.koboReadingStates.userId, schema.koboReadingStates.bookId],
        set: {
          lastModifiedKobo: lastModified,
          priorityTimestamp,
          currentBookmark: sql`excluded.current_bookmark`,
          statistics: sql`excluded.statistics`,
          statusInfo: sql`excluded.status_info`,
          progressSyncedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });

    const percent = this.extractPercent(mergedBookmark);
    if (percent !== null) {
      await this.syncToReadingProgress(userId, bookId, percent, readingThreshold, finishedThreshold);
    }

    return this.getRawState(userId, bookId);
  }

  async getRawState(userId: number, bookId: number): Promise<unknown> {
    await this.bookAccessService.assertBookAccessible(userId, bookId);

    const row = await this.db.query.koboReadingStates.findFirst({
      where: and(eq(schema.koboReadingStates.userId, userId), eq(schema.koboReadingStates.bookId, bookId)),
    });

    if (!row) return null;

    return {
      EntitlementId: row.entitlementId,
      Created: row.createdAtKobo,
      LastModified: row.lastModifiedKobo,
      PriorityTimestamp: row.priorityTimestamp,
      CurrentBookmark: row.currentBookmark,
      Statistics: row.statistics,
      StatusInfo: row.statusInfo,
    };
  }

  async getAndMarkStatesNeedingPush(
    userId: number,
    readingThreshold: number,
    finishedThreshold: number,
  ): Promise<{ items: unknown[]; hasMore: boolean }> {
    const accessibleLibraryIds = await this.bookAccessService.getAccessibleLibraryIds(userId);
    const libraryAccessFilter =
      accessibleLibraryIds === null
        ? undefined
        : accessibleLibraryIds.length === 0
          ? sql`false`
          : inArray(schema.books.libraryId, accessibleLibraryIds);

    const rows = await this.db
      .select({
        bookId: schema.books.id,
        percentage: schema.readingProgress.percentage,
      })
      .from(schema.readingProgress)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.readingProgress.bookFileId))
      .innerJoin(schema.books, eq(schema.books.primaryFileId, schema.bookFiles.id))
      .leftJoin(schema.koboReadingStates, and(eq(schema.koboReadingStates.bookId, schema.books.id), eq(schema.koboReadingStates.userId, userId)))
      .where(
        and(
          eq(schema.readingProgress.userId, userId),
          libraryAccessFilter,
          or(
            isNull(schema.koboReadingStates.progressSyncedAt),
            sql`${schema.readingProgress.updatedAt} > ${schema.koboReadingStates.progressSyncedAt}`,
          ),
        ),
      )
      .orderBy(asc(schema.readingProgress.updatedAt), asc(schema.books.id))
      .limit(PROGRESS_PUSH_PAGE_SIZE + 1);

    if (rows.length === 0) return { items: [], hasMore: false };

    const hasMore = rows.length > PROGRESS_PUSH_PAGE_SIZE;
    const pageRows = rows.slice(0, PROGRESS_PUSH_PAGE_SIZE);

    const now = new Date();
    const nowIso = now.toISOString();
    const result: unknown[] = [];
    const upsertRows: (typeof schema.koboReadingStates.$inferInsert)[] = [];

    for (const row of pageRows) {
      const id = String(row.bookId);
      const pct = row.percentage ?? 0;
      const status = pct >= finishedThreshold ? 'Finished' : pct >= readingThreshold ? 'Reading' : 'ReadyToRead';

      result.push({
        ChangedReadingState: {
          ReadingState: {
            EntitlementId: id,
            Created: nowIso,
            LastModified: nowIso,
            PriorityTimestamp: nowIso,
            StatusInfo: { LastModified: nowIso, Status: status, TimesStartedReading: pct >= readingThreshold ? 1 : 0 },
            Statistics: { LastModified: nowIso },
            CurrentBookmark: { LastModified: nowIso, ProgressPercent: pct, ContentSourceProgressPercent: pct },
          },
        },
      });

      upsertRows.push({
        userId,
        bookId: row.bookId,
        entitlementId: id,
        createdAtKobo: nowIso,
        lastModifiedKobo: nowIso,
        priorityTimestamp: nowIso,
        progressSyncedAt: now,
        updatedAt: now,
      });
    }

    await this.db
      .insert(schema.koboReadingStates)
      .values(upsertRows)
      .onConflictDoUpdate({
        target: [schema.koboReadingStates.userId, schema.koboReadingStates.bookId],
        set: {
          lastModifiedKobo: nowIso,
          priorityTimestamp: nowIso,
          progressSyncedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });

    return { items: result, hasMore };
  }

  private extractPercent(bookmark: JsonObj | null): number | null {
    if (!bookmark) return null;
    const pct = bookmark.ProgressPercent ?? bookmark.ContentSourceProgressPercent;
    if (typeof pct === 'number') return Math.max(0, Math.min(100, pct));
    return null;
  }

  private async syncToReadingProgress(userId: number, bookId: number, percent: number, readingThreshold: number, finishedThreshold: number) {
    if (percent < readingThreshold) return;

    const book = await this.db.query.books.findFirst({
      where: eq(schema.books.id, bookId),
      columns: { primaryFileId: true },
    });
    if (!book?.primaryFileId) return;

    const file = await this.db.query.bookFiles.findFirst({
      where: and(eq(schema.bookFiles.bookId, bookId), eq(schema.bookFiles.id, book.primaryFileId)),
    });

    if (!file) return;

    const normalizedPercent = percent >= finishedThreshold ? 100 : percent;

    await this.db
      .insert(schema.readingProgress)
      .values({ bookFileId: file.id, userId, percentage: normalizedPercent, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.readingProgress.bookFileId, schema.readingProgress.userId],
        set: { percentage: normalizedPercent, updatedAt: sql`now()` },
      });
  }
}
