import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
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
    libraryId: number;
    deviceId: string;
    events: KoreaderPageEvent[];
  }): Promise<IngestPageStatsResult> {
    const { userId, bookFileId, libraryId, deviceId, events } = params;

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
              sessionId: session.sessionId,
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
      for (const session of toDelete) affectedDays.add(formatDayKey(session.startedAt));
      for (const session of upserts) affectedDays.add(formatDayKey(session.startedAt));

      if (affectedDays.size > 0) {
        await this.recomputeDailyStats(tx, userId, libraryId, [...affectedDays]);
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

  private async recomputeDailyStats(tx: Tx, userId: number, libraryId: number, days: string[]) {
    await tx
      .delete(schema.userReadingDailyStats)
      .where(
        and(
          eq(schema.userReadingDailyStats.userId, userId),
          eq(schema.userReadingDailyStats.libraryId, libraryId),
          inArray(schema.userReadingDailyStats.day, days),
        ),
      );

    const dayListSql = sql.join(
      days.map((day) => sql`${day}::date`),
      sql`, `,
    );

    await tx.execute(sql`
      insert into user_reading_daily_stats (user_id, library_id, day, reading_seconds, progress_delta, sessions_count, updated_at)
      select
        rs.user_id,
        b.library_id,
        date_trunc('day', rs.started_at)::date as day,
        coalesce(sum(rs.duration_seconds), 0)::int as reading_seconds,
        coalesce(sum(rs.progress_delta), 0)::real as progress_delta,
        count(*)::int as sessions_count,
        now() as updated_at
      from reading_sessions rs
      inner join book_files bf on bf.id = rs.book_file_id
      inner join books b on b.id = bf.book_id
      where rs.user_id = ${userId}
        and b.library_id = ${libraryId}
        and date_trunc('day', rs.started_at)::date in (${dayListSql})
      group by rs.user_id, b.library_id, date_trunc('day', rs.started_at)::date
    `);
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

  async getPluginTotals(userId: number): Promise<{ matchedBooks: number; pageStatEvents: number; annotations: number }> {
    const result = await this.db.execute<{ matched_books: string | number; page_stat_events: string | number; annotations: string | number }>(sql`
      select
        (select count(distinct t.book_file_id) from (
          select book_file_id from koreader_page_stats where user_id = ${userId}
          union
          select book_file_id from koreader_annotations where user_id = ${userId}
        ) t) as matched_books,
        (select count(*) from koreader_page_stats where user_id = ${userId}) as page_stat_events,
        (select count(*) from koreader_annotations where user_id = ${userId}) as annotations
    `);
    const row = result.rows[0];
    return {
      matchedBooks: Number(row?.matched_books ?? 0),
      pageStatEvents: Number(row?.page_stat_events ?? 0),
      annotations: Number(row?.annotations ?? 0),
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

function formatDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
