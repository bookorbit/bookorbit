import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, lt, lte, max, min, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type {
  BookReadingSession,
  BookReadingSessionListResponse,
  BookReadingSessionStats,
  BookReadingSourceSlice,
  ReadingSessionSource,
} from '@bookorbit/types';
import { READING_SESSION_SOURCE_BUCKETS, emptySourceBucketRecord, toReadingSessionSourceBucket } from '@bookorbit/types';
import {
  aggregateReadingSessionDailyStats,
  getDayRangeForDateKeys,
  getReadingSessionDayKeys,
  splitReadingSessionByDay,
  type ReadingDailyStatsSegment,
} from '../../common/utils/reading-daily-stats.utils';
import { toDateKeyInTimeZone } from '../../common/utils/timezone.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, books, readingSessions, userReadingDailyStats } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const MIN_READING_SESSION_SECONDS = 10;

export type SaveReadingSessionResult =
  | { kind: 'saved' }
  | {
      kind: 'skipped';
      reason: 'duration_below_minimum' | 'book_file_not_found' | 'duplicate_session_id';
    };

export interface InsertManualSessionParams {
  userId: number;
  bookId: number;
  libraryId: number;
  bookFileId: number | null;
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  progressDelta: number | null;
  endProgress: number | null;
  timeZone: string;
}

@Injectable()
export class ReadingSessionRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async saveSession(
    userId: number,
    bookFileId: number,
    sessionId: string,
    startedAt: Date,
    endedAt: Date,
    durationSeconds: number,
    progressDelta: number | null,
    endProgress: number | null,
    source: ReadingSessionSource = 'web',
    timeZone = 'UTC',
  ): Promise<SaveReadingSessionResult> {
    if (durationSeconds < MIN_READING_SESSION_SECONDS) {
      return { kind: 'skipped', reason: 'duration_below_minimum' };
    }

    const [fileRow] = await this.db
      .select({ bookId: books.id, libraryId: books.libraryId })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(bookFiles.id, bookFileId))
      .limit(1);

    if (!fileRow) {
      return { kind: 'skipped', reason: 'book_file_not_found' };
    }

    const { bookId, libraryId } = fileRow;

    return this.db.transaction(async (tx): Promise<SaveReadingSessionResult> => {
      const inserted = await tx
        .insert(readingSessions)
        .values({ userId, bookFileId, bookId, sessionId, source, startedAt, endedAt, durationSeconds, progressDelta, endProgress })
        .onConflictDoNothing({ target: [readingSessions.userId, readingSessions.sessionId] })
        .returning({ id: readingSessions.id });

      if (inserted.length === 0) {
        return { kind: 'skipped', reason: 'duplicate_session_id' };
      }

      await this.upsertDailyStats(tx, { userId, libraryId, startedAt, endedAt, durationSeconds, progressDelta, timeZone });

      return { kind: 'saved' };
    });
  }

  async insertManualSession(params: InsertManualSessionParams): Promise<{ id: number }> {
    const { userId, bookId, libraryId, bookFileId, sessionId, startedAt, endedAt, durationSeconds, progressDelta, endProgress, timeZone } = params;

    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(readingSessions)
        .values({ userId, bookId, bookFileId, sessionId, source: 'manual', startedAt, endedAt, durationSeconds, progressDelta, endProgress })
        .returning({ id: readingSessions.id });

      await this.upsertDailyStats(tx, { userId, libraryId, startedAt, endedAt, durationSeconds, progressDelta, timeZone });

      return { id: inserted.id };
    });
  }

  async findBookContext(bookId: number): Promise<{ libraryId: number; files: { id: number; format: string | null }[] } | null> {
    const [bookRow] = await this.db.select({ libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);
    if (!bookRow) return null;

    const files = await this.db
      .select({ id: bookFiles.id, format: sql<string | null>`nullif(${bookFiles.format}, '')` })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId));

    return { libraryId: bookRow.libraryId, files };
  }

  async findLatestEndProgressBefore(userId: number, bookId: number, before: Date): Promise<number | null> {
    const [row] = await this.db
      .select({ endProgress: readingSessions.endProgress })
      .from(readingSessions)
      .where(
        and(
          eq(readingSessions.userId, userId),
          eq(readingSessions.bookId, bookId),
          lt(readingSessions.startedAt, before),
          isNotNull(readingSessions.endProgress),
        ),
      )
      .orderBy(desc(readingSessions.startedAt))
      .limit(1);

    return row?.endProgress ?? null;
  }

  async listByBook(
    userId: number,
    bookId: number,
    page: number,
    pageSize: number,
    sortBy: string,
    sortDir: string,
    dateFrom?: string,
    dateTo?: string,
    format?: string,
    timeZone = 'UTC',
  ): Promise<BookReadingSessionListResponse> {
    const conditions = [eq(readingSessions.bookId, bookId), eq(readingSessions.userId, userId)];
    if (dateFrom) conditions.push(gte(readingSessions.startedAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(readingSessions.startedAt, new Date(dateTo)));
    if (format) conditions.push(eq(sql`upper(${bookFiles.format})`, format.toUpperCase()));

    const whereClause = and(...conditions);

    let orderCol;
    switch (sortBy) {
      case 'durationSeconds':
        orderCol = readingSessions.durationSeconds;
        break;
      case 'progressDelta':
        orderCol = readingSessions.progressDelta;
        break;
      case 'endProgress':
        orderCol = readingSessions.endProgress;
        break;
      default:
        orderCol = readingSessions.startedAt;
    }
    const orderExpr = sortDir === 'asc' ? asc(orderCol) : desc(orderCol);
    const offset = (page - 1) * pageSize;

    const [rows, countRows, statsRows, summaryRows, sourceRows] = await Promise.all([
      this.db
        .select({
          id: readingSessions.id,
          startedAt: readingSessions.startedAt,
          endedAt: readingSessions.endedAt,
          durationSeconds: readingSessions.durationSeconds,
          progressDelta: readingSessions.progressDelta,
          endProgress: readingSessions.endProgress,
          format: sql<string | null>`nullif(${bookFiles.format}, '')`,
          source: readingSessions.source,
        })
        .from(readingSessions)
        .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .where(whereClause)
        .orderBy(orderExpr)
        .limit(pageSize)
        .offset(offset),

      this.db.select({ total: count() }).from(readingSessions).leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId)).where(whereClause),

      this.db
        .select({
          totalSessions: count(),
          totalSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}), 0)::int`,
          avgDurationSeconds: sql<number>`coalesce(avg(${readingSessions.durationSeconds}), 0)::int`,
          firstSessionAt: min(readingSessions.startedAt),
          lastSessionAt: max(readingSessions.startedAt),
          paceProgressDelta: sql<number>`coalesce(sum(${readingSessions.progressDelta}) filter (where ${readingSessions.progressDelta} > 0), 0)::real`,
          paceDurationSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}) filter (where ${readingSessions.progressDelta} > 0), 0)::int`,
        })
        .from(readingSessions)
        .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .where(whereClause),

      this.db
        .select({
          startedAt: readingSessions.startedAt,
          endedAt: readingSessions.endedAt,
          durationSeconds: readingSessions.durationSeconds,
          progressDelta: readingSessions.progressDelta,
          endProgress: readingSessions.endProgress,
        })
        .from(readingSessions)
        .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .where(whereClause)
        .orderBy(asc(readingSessions.startedAt)),

      this.db
        .select({
          source: readingSessions.source,
          totalSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}), 0)::int`,
          totalSessions: count(),
        })
        .from(readingSessions)
        .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .where(whereClause)
        .groupBy(readingSessions.source),
    ]);

    const total = countRows[0]?.total ?? 0;
    const statsRow = statsRows[0];

    const bucketSeconds = emptySourceBucketRecord();
    const bucketSessions = emptySourceBucketRecord();
    for (const row of sourceRows) {
      const bucket = toReadingSessionSourceBucket(row.source);
      bucketSeconds[bucket] += row.totalSeconds;
      bucketSessions[bucket] += row.totalSessions;
    }
    const bySource: BookReadingSourceSlice[] = READING_SESSION_SOURCE_BUCKETS.filter((bucket) => bucketSessions[bucket] > 0).map((bucket) => ({
      bucket,
      totalSeconds: bucketSeconds[bucket],
      totalSessions: bucketSessions[bucket],
    }));

    const dailySummary = aggregateReadingSessionDailyStats(
      summaryRows.map((row) => ({
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationSeconds: row.durationSeconds,
        progressDelta: row.progressDelta ?? null,
      })),
      timeZone,
    ).map((segment) => ({
      day: segment.day,
      totalMinutes: Math.round((segment.readingSeconds / 60) * 10) / 10,
    }));

    const progressByDay = new Map<string, { day: string; endProgress: number; endedAtMs: number }>();
    for (const row of summaryRows) {
      if (row.endProgress == null) continue;
      const day = toDateKeyInTimeZone(row.endedAt, timeZone);
      const endedAtMs = row.endedAt.getTime();
      const existing = progressByDay.get(day);
      if (!existing || endedAtMs > existing.endedAtMs) {
        progressByDay.set(day, { day, endProgress: row.endProgress, endedAtMs });
      }
    }
    const progressSummary = [...progressByDay.values()]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map(({ day, endProgress }) => ({ day, endProgress }));

    const stats: BookReadingSessionStats = {
      totalSessions: statsRow?.totalSessions ?? 0,
      totalSeconds: statsRow?.totalSeconds ?? 0,
      avgDurationSeconds: statsRow?.avgDurationSeconds ?? 0,
      firstSessionAt: statsRow?.firstSessionAt ? (statsRow.firstSessionAt as Date).toISOString() : null,
      lastSessionAt: statsRow?.lastSessionAt ? (statsRow.lastSessionAt as Date).toISOString() : null,
      dailySummary,
      paceProgressDelta: statsRow?.paceProgressDelta ?? 0,
      paceDurationSeconds: statsRow?.paceDurationSeconds ?? 0,
      progressSummary,
      bySource,
    };

    const items: BookReadingSession[] = rows.map((r) => ({
      id: r.id,
      startedAt: (r.startedAt as Date).toISOString(),
      endedAt: (r.endedAt as Date).toISOString(),
      durationSeconds: r.durationSeconds,
      progressDelta: r.progressDelta ?? null,
      endProgress: r.endProgress ?? null,
      format: r.format ?? null,
      source: r.source ?? null,
    }));

    return { items, total, page, pageSize, stats };
  }

  async deleteSessionByBook(userId: number, bookId: number, sessionId: number, timeZone = 'UTC'): Promise<{ found: boolean }> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: readingSessions.id,
          startedAt: readingSessions.startedAt,
          endedAt: readingSessions.endedAt,
          durationSeconds: readingSessions.durationSeconds,
          progressDelta: readingSessions.progressDelta,
          libraryId: books.libraryId,
        })
        .from(readingSessions)
        .innerJoin(books, eq(books.id, readingSessions.bookId))
        .where(and(eq(readingSessions.id, sessionId), eq(readingSessions.userId, userId), eq(readingSessions.bookId, bookId)))
        .limit(1);

      if (!row) return { found: false };

      const { startedAt, endedAt, durationSeconds, progressDelta, libraryId } = row;
      const affectedDays = getReadingSessionDayKeys({ startedAt, endedAt, durationSeconds, progressDelta: progressDelta ?? null }, timeZone);

      await tx.delete(readingSessions).where(eq(readingSessions.id, sessionId));

      await this.recomputeDailyStats(tx, userId, libraryId, affectedDays, timeZone);

      return { found: true };
    });
  }

  private async upsertDailyStats(
    tx: Tx,
    params: {
      userId: number;
      libraryId: number;
      startedAt: Date;
      endedAt: Date;
      durationSeconds: number;
      progressDelta: number | null;
      timeZone: string;
    },
  ): Promise<void> {
    const { userId, libraryId, startedAt, endedAt, durationSeconds, progressDelta, timeZone } = params;
    await this.lockDailyStats(tx, userId, libraryId);
    const segments = splitReadingSessionByDay({ startedAt, endedAt, durationSeconds, progressDelta }, timeZone);
    await this.insertDailyStatsSegments(tx, userId, libraryId, segments, 'increment');
  }

  private async recomputeDailyStats(tx: Tx, userId: number, libraryId: number, days: string[], timeZone: string): Promise<void> {
    const affectedDays = [...new Set(days)].sort();
    if (affectedDays.length === 0) return;

    await this.lockDailyStats(tx, userId, libraryId);

    await tx
      .delete(userReadingDailyStats)
      .where(
        and(
          eq(userReadingDailyStats.userId, userId),
          eq(userReadingDailyStats.libraryId, libraryId),
          inArray(userReadingDailyStats.day, affectedDays),
        ),
      );

    const range = getDayRangeForDateKeys(affectedDays, timeZone);
    if (!range) return;

    const rows = await tx
      .select({
        startedAt: readingSessions.startedAt,
        endedAt: readingSessions.endedAt,
        durationSeconds: readingSessions.durationSeconds,
        progressDelta: readingSessions.progressDelta,
      })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(
        and(
          eq(readingSessions.userId, userId),
          eq(books.libraryId, libraryId),
          lt(readingSessions.startedAt, range.end),
          gt(readingSessions.endedAt, range.start),
        ),
      );

    const segments = aggregateReadingSessionDailyStats(
      rows.map((row) => ({
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationSeconds: row.durationSeconds,
        progressDelta: row.progressDelta ?? null,
      })),
      timeZone,
      new Set(affectedDays),
    );
    await this.insertDailyStatsSegments(tx, userId, libraryId, segments, 'replace');
  }

  private async lockDailyStats(tx: Tx, userId: number, libraryId: number): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(${userId}::int, ${libraryId}::int)`);
  }

  private async insertDailyStatsSegments(
    tx: Tx,
    userId: number,
    libraryId: number,
    segments: ReadingDailyStatsSegment[],
    mode: 'increment' | 'replace',
  ): Promise<void> {
    if (segments.length === 0) return;

    const now = new Date();
    await tx
      .insert(userReadingDailyStats)
      .values(
        segments.map((segment) => ({
          userId,
          libraryId,
          day: segment.day,
          readingSeconds: segment.readingSeconds,
          progressDelta: segment.progressDelta,
          sessionsCount: segment.sessionsCount,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [userReadingDailyStats.userId, userReadingDailyStats.libraryId, userReadingDailyStats.day],
        set:
          mode === 'increment'
            ? {
                readingSeconds: sql`${userReadingDailyStats.readingSeconds} + excluded.reading_seconds`,
                progressDelta: sql`${userReadingDailyStats.progressDelta} + excluded.progress_delta`,
                sessionsCount: sql`${userReadingDailyStats.sessionsCount} + excluded.sessions_count`,
                updatedAt: now,
              }
            : {
                readingSeconds: sql`excluded.reading_seconds`,
                progressDelta: sql`excluded.progress_delta`,
                sessionsCount: sql`excluded.sessions_count`,
                updatedAt: now,
              },
      });
  }
}
