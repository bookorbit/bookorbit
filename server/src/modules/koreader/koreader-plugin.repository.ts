import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, like, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  aggregateReadingSessionDailyStats,
  getDayRangeForDateKeys,
  getReadingSessionDayKeys,
  type ReadingDailyStatsSegment,
} from '../../common/utils/reading-daily-stats.utils';
import { buildSessionIdPrefix, deriveKoreaderSessions, type DerivedKoreaderSession, type KoreaderPageEvent } from './koreader-stats.util';

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface IngestPageStatsResult {
  accepted: number;
  duplicates: number;
  insertedSessions: DerivedKoreaderSession[];
  updatedSessions: number;
  deletedSessions: number;
}

@Injectable()
export class KoreaderPluginRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async ingestAndDeriveForBook(params: {
    userId: number;
    bookFileId: number;
    bookId: number;
    libraryId: number;
    deviceId: string;
    events: KoreaderPageEvent[];
    timeZone: string;
  }): Promise<IngestPageStatsResult> {
    const { userId, bookFileId, bookId, libraryId, deviceId, events, timeZone } = params;

    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.koreaderPageStats)
        .values(
          events.map((event) => ({
            userId,
            bookFileId,
            deviceId,
            page: event.page,
            startTime: event.startTime,
            durationSeconds: event.durationSeconds,
            totalPages: event.totalPages,
          })),
        )
        .onConflictDoNothing({
          target: [
            schema.koreaderPageStats.userId,
            schema.koreaderPageStats.bookFileId,
            schema.koreaderPageStats.deviceId,
            schema.koreaderPageStats.page,
            schema.koreaderPageStats.startTime,
          ],
        })
        .returning({ id: schema.koreaderPageStats.id });

      const accepted = inserted.length;
      const duplicates = events.length - accepted;
      if (accepted === 0) {
        return { accepted, duplicates, insertedSessions: [], updatedSessions: 0, deletedSessions: 0 };
      }

      const allEvents = await tx
        .select({
          page: schema.koreaderPageStats.page,
          startTime: schema.koreaderPageStats.startTime,
          durationSeconds: schema.koreaderPageStats.durationSeconds,
          totalPages: schema.koreaderPageStats.totalPages,
        })
        .from(schema.koreaderPageStats)
        .where(
          and(
            eq(schema.koreaderPageStats.userId, userId),
            eq(schema.koreaderPageStats.bookFileId, bookFileId),
            eq(schema.koreaderPageStats.deviceId, deviceId),
          ),
        )
        .orderBy(schema.koreaderPageStats.startTime, schema.koreaderPageStats.page);

      const desired = deriveKoreaderSessions(allEvents, deviceId, bookFileId);
      const prefix = buildSessionIdPrefix(deviceId, bookFileId);

      const existing = await tx
        .select({
          id: schema.readingSessions.id,
          sessionId: schema.readingSessions.sessionId,
          startedAt: schema.readingSessions.startedAt,
          endedAt: schema.readingSessions.endedAt,
          durationSeconds: schema.readingSessions.durationSeconds,
          progressDelta: schema.readingSessions.progressDelta,
          endProgress: schema.readingSessions.endProgress,
        })
        .from(schema.readingSessions)
        .where(
          and(
            eq(schema.readingSessions.userId, userId),
            eq(schema.readingSessions.bookFileId, bookFileId),
            like(schema.readingSessions.sessionId, `${prefix}%`),
          ),
        );

      const desiredById = new Map(desired.map((session) => [session.sessionId, session]));
      const existingById = new Map(existing.map((session) => [session.sessionId, session]));

      const toDelete = existing.filter((session) => !desiredById.has(session.sessionId));
      const toInsert = desired.filter((session) => !existingById.has(session.sessionId));
      const toUpdate = desired.filter((session) => {
        const current = existingById.get(session.sessionId);
        if (!current) return false;
        return (
          current.endedAt.getTime() !== session.endedAt.getTime() ||
          current.durationSeconds !== session.durationSeconds ||
          (current.progressDelta ?? null) !== (session.progressDelta ?? null) ||
          (current.endProgress ?? null) !== (session.endProgress ?? null)
        );
      });

      if (toDelete.length > 0) {
        await tx.delete(schema.readingSessions).where(
          inArray(
            schema.readingSessions.id,
            toDelete.map((session) => session.id),
          ),
        );
      }

      const upserts = [...toInsert, ...toUpdate];
      if (upserts.length > 0) {
        await tx
          .insert(schema.readingSessions)
          .values(
            upserts.map((session) => ({
              userId,
              bookFileId,
              bookId,
              sessionId: session.sessionId,
              source: 'koreader' as const,
              startedAt: session.startedAt,
              endedAt: session.endedAt,
              durationSeconds: session.durationSeconds,
              progressDelta: session.progressDelta,
              endProgress: session.endProgress,
            })),
          )
          .onConflictDoUpdate({
            target: [schema.readingSessions.userId, schema.readingSessions.sessionId],
            set: {
              endedAt: sql`excluded.ended_at`,
              durationSeconds: sql`excluded.duration_seconds`,
              progressDelta: sql`excluded.progress_delta`,
              endProgress: sql`excluded.end_progress`,
            },
          });
      }

      const affectedDays = new Set<string>();
      for (const session of toDelete) {
        for (const day of getReadingSessionDayKeys(
          {
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            durationSeconds: session.durationSeconds,
            progressDelta: session.progressDelta ?? null,
          },
          timeZone,
        )) {
          affectedDays.add(day);
        }
      }
      for (const session of upserts) {
        for (const day of getReadingSessionDayKeys(session, timeZone)) {
          affectedDays.add(day);
        }
      }

      if (affectedDays.size > 0) {
        await this.recomputeDailyStats(tx, userId, libraryId, [...affectedDays], timeZone);
      }

      return {
        accepted,
        duplicates,
        insertedSessions: toInsert,
        updatedSessions: toUpdate.length,
        deletedSessions: toDelete.length,
      };
    });
  }

  private async recomputeDailyStats(tx: Tx, userId: number, libraryId: number, days: string[], timeZone: string) {
    const affectedDays = [...new Set(days)].sort();
    if (affectedDays.length === 0) return;

    await this.lockDailyStats(tx, userId, libraryId);

    await tx
      .delete(schema.userReadingDailyStats)
      .where(
        and(
          eq(schema.userReadingDailyStats.userId, userId),
          eq(schema.userReadingDailyStats.libraryId, libraryId),
          inArray(schema.userReadingDailyStats.day, affectedDays),
        ),
      );

    const range = getDayRangeForDateKeys(affectedDays, timeZone);
    if (!range) return;

    const rows = await tx
      .select({
        startedAt: schema.readingSessions.startedAt,
        endedAt: schema.readingSessions.endedAt,
        durationSeconds: schema.readingSessions.durationSeconds,
        progressDelta: schema.readingSessions.progressDelta,
      })
      .from(schema.readingSessions)
      .innerJoin(schema.books, eq(schema.books.id, schema.readingSessions.bookId))
      .where(
        and(
          eq(schema.readingSessions.userId, userId),
          eq(schema.books.libraryId, libraryId),
          lt(schema.readingSessions.startedAt, range.end),
          gt(schema.readingSessions.endedAt, range.start),
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
    await this.insertDailyStatsSegments(tx, userId, libraryId, segments);
  }

  private async lockDailyStats(tx: Tx, userId: number, libraryId: number): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(${userId}::int, ${libraryId}::int)`);
  }

  private async insertDailyStatsSegments(tx: Tx, userId: number, libraryId: number, segments: ReadingDailyStatsSegment[]): Promise<void> {
    if (segments.length === 0) return;

    const now = new Date();
    await tx
      .insert(schema.userReadingDailyStats)
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
        target: [schema.userReadingDailyStats.userId, schema.userReadingDailyStats.libraryId, schema.userReadingDailyStats.day],
        set: {
          readingSeconds: sql`excluded.reading_seconds`,
          progressDelta: sql`excluded.progress_delta`,
          sessionsCount: sql`excluded.sessions_count`,
          updatedAt: now,
        },
      });
  }

  async getRating(userId: number, bookId: number): Promise<{ rating: number; updatedAt: Date } | null> {
    const [row] = await this.db
      .select({ rating: schema.userBookRatings.rating, updatedAt: schema.userBookRatings.updatedAt })
      .from(schema.userBookRatings)
      .where(and(eq(schema.userBookRatings.userId, userId), eq(schema.userBookRatings.bookId, bookId)))
      .limit(1);
    return row ?? null;
  }

  async upsertRating(userId: number, bookId: number, rating: number) {
    await this.db
      .insert(schema.userBookRatings)
      .values({ userId, bookId, rating })
      .onConflictDoUpdate({
        target: [schema.userBookRatings.userId, schema.userBookRatings.bookId],
        set: { rating, updatedAt: new Date() },
      });
  }

  async upsertSweep(data: {
    userId: number;
    deviceId: string;
    deviceModel: string;
    pluginVersion: string;
    booksMatched: number;
    pageStatsUploaded: number;
    annotationsUpserted: number;
  }): Promise<Date> {
    const lastSweepAt = new Date();
    await this.db
      .insert(schema.koreaderDeviceSweeps)
      .values({
        userId: data.userId,
        deviceId: data.deviceId,
        deviceModel: data.deviceModel,
        pluginVersion: data.pluginVersion,
        lastSweepAt,
        lastSweepBooksMatched: data.booksMatched,
        lastSweepPageStats: data.pageStatsUploaded,
        lastSweepAnnotations: data.annotationsUpserted,
      })
      .onConflictDoUpdate({
        target: [schema.koreaderDeviceSweeps.userId, schema.koreaderDeviceSweeps.deviceId],
        set: {
          deviceModel: data.deviceModel,
          pluginVersion: data.pluginVersion,
          lastSweepAt,
          lastSweepBooksMatched: data.booksMatched,
          lastSweepPageStats: data.pageStatsUploaded,
          lastSweepAnnotations: data.annotationsUpserted,
        },
      });
    return lastSweepAt;
  }

  async listSweeps(userId: number) {
    return this.db
      .select()
      .from(schema.koreaderDeviceSweeps)
      .where(eq(schema.koreaderDeviceSweeps.userId, userId))
      .orderBy(desc(schema.koreaderDeviceSweeps.lastSweepAt));
  }

  async getPluginTotals(userId: number): Promise<{
    matchedBooks: number;
    pageStatEvents: number;
    annotations: number;
    trashedAnnotations: number;
    pendingDeletes: number;
    failedPositions: number;
  }> {
    const result = await this.db.execute<{
      matched_books: string | number;
      page_stat_events: string | number;
      annotations: string | number;
      trashed_annotations: string | number;
      pending_deletes: string | number;
      failed_positions: string | number;
    }>(sql`
      select
        (select count(distinct t.book_file_id) from (
          select book_file_id from koreader_page_stats where user_id = ${userId}
          union
          select ap.book_file_id from annotation_positions ap
            join annotations a on a.id = ap.annotation_id
            where a.user_id = ${userId} and a.origin = 'koreader' and ap.book_file_id is not null and ap.format in ('xpointer', 'pdf')
        ) t) as matched_books,
        (select count(*) from koreader_page_stats where user_id = ${userId}) as page_stat_events,
        (select count(*) from annotations where user_id = ${userId} and origin = 'koreader' and deleted_at is null) as annotations,
        (select count(*) from annotations where user_id = ${userId} and deleted_at is not null) as trashed_annotations,
        (select count(*) from annotation_sync_state s
          join annotations a on a.id = s.annotation_id
          where s.user_id = ${userId} and a.deleted_at is not null and s.delete_acked_at is null) as pending_deletes,
        (select count(*) from annotation_positions ap
          join annotations a on a.id = ap.annotation_id
          where ap.user_id = ${userId} and a.deleted_at is null and ap.status = 'failed') as failed_positions
    `);
    const row = result.rows[0];
    return {
      matchedBooks: Number(row?.matched_books ?? 0),
      pageStatEvents: Number(row?.page_stat_events ?? 0),
      annotations: Number(row?.annotations ?? 0),
      trashedAnnotations: Number(row?.trashed_annotations ?? 0),
      pendingDeletes: Number(row?.pending_deletes ?? 0),
      failedPositions: Number(row?.failed_positions ?? 0),
    };
  }

  async getLibraryMaxFileTimestamp(accessibleLibraryIds: number[] | null): Promise<Date | null> {
    if (accessibleLibraryIds !== null && accessibleLibraryIds.length === 0) return null;
    const libraryFilter = accessibleLibraryIds ? inArray(schema.books.libraryId, accessibleLibraryIds) : undefined;

    const [row] = await this.db
      .select({ maxTs: sql<Date | string | null>`max(greatest(${schema.bookFiles.createdAt}, ${schema.bookFiles.updatedAt}))` })
      .from(schema.bookFiles)
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(libraryFilter);

    return row?.maxTs ? new Date(row.maxTs) : null;
  }
}
