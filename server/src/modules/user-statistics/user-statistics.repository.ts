import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, gte, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type {
  ChordDiagramData,
  UserCompletionTimelinePoint,
  UserDailyReadingStat,
  UserFavoriteDayStat,
  UserGenreReadingTimeItem,
  UserProgressFunnel,
  UserReadingPacePoint,
  UserSessionArchetypePoint,
  UserStatisticsSummary,
} from '@projectx/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  bookFiles,
  bookGenres,
  bookMetadata,
  books,
  genres,
  readingProgress,
  readingSessions,
  userBookStatus,
  userLibraryAccess,
  userReadingDailyStats,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type SessionTimelineItemRow = {
  sessionId: number;
  bookId: number;
  bookTitle: string | null;
  bookFormat: string | null;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
};
type SessionTimelineSessionRow = SessionTimelineItemRow & {
  libraryId: number;
};
type SessionTimelineConflictRow = {
  sessionId: number;
  startedAt: Date;
  endedAt: Date;
};
const RECENT_DAILY_AGGREGATION_DAYS = 2;

@Injectable()
export class UserStatisticsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async getAccessibleLibraryIds(userId: number, isSuperuser: boolean): Promise<number[] | null> {
    if (isSuperuser) return null;
    const rows = await this.db.select({ libraryId: userLibraryAccess.libraryId }).from(userLibraryAccess).where(eq(userLibraryAccess.userId, userId));
    return rows.map((r) => r.libraryId);
  }

  private intersectLibraryIds(accessible: number[] | null, requested: number[] | undefined): number[] | null {
    if (!requested || requested.length === 0) return accessible;
    if (accessible === null) return requested;
    const set = new Set(accessible);
    return requested.filter((id) => set.has(id));
  }

  private libraryFilter(libraryIds: number[] | null) {
    if (libraryIds === null) return undefined;
    if (libraryIds.length === 0) return sql`false`;
    return inArray(books.libraryId, libraryIds);
  }

  private dailyStatsLibraryFilter(libraryIds: number[] | null) {
    if (libraryIds === null) return undefined;
    if (libraryIds.length === 0) return sql`false`;
    return inArray(userReadingDailyStats.libraryId, libraryIds);
  }

  private startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private sinceDateForDays(days: number): Date {
    const normalized = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 1;
    const now = new Date();
    const startToday = this.startOfUtcDay(now);
    startToday.setUTCDate(startToday.getUTCDate() - (normalized - 1));
    return startToday;
  }

  private formatDayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  async getSummary(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]): Promise<UserStatisticsSummary> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryIds = this.intersectLibraryIds(accessible, filterLibraryIds);
    const libraryFilter = this.libraryFilter(libraryIds);

    // Status counts come from user_book_status (respects manual overrides)
    const [statusRow] = await this.db
      .select({
        trackedBooks: sql<number>`count(*)::int`,
        startedBooks: sql<number>`count(*) filter (where ${userBookStatus.status} in ('reading', 'read', 'abandoned'))::int`,
        inProgressBooks: sql<number>`count(*) filter (where ${userBookStatus.status} = 'reading')::int`,
        completedBooks: sql<number>`count(*) filter (where ${userBookStatus.status} = 'read')::int`,
      })
      .from(userBookStatus)
      .innerJoin(books, eq(books.id, userBookStatus.bookId))
      .where(and(eq(userBookStatus.userId, userId), libraryFilter));

    // meanProgressPercent stays derived from actual reading position
    const perBookProgress = this.db
      .select({
        bookId: bookFiles.bookId,
        maxPercentage: sql<number>`max(${readingProgress.percentage})`.as('max_percentage'),
      })
      .from(readingProgress)
      .innerJoin(bookFiles, eq(bookFiles.id, readingProgress.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingProgress.userId, userId), libraryFilter))
      .groupBy(bookFiles.bookId)
      .as('per_book_progress');

    const [progressRow] = await this.db
      .select({ meanProgressPercent: sql<number>`coalesce(avg(${perBookProgress.maxPercentage}), 0)::float` })
      .from(perBookProgress);

    return {
      trackedBooks: statusRow?.trackedBooks ?? 0,
      startedBooks: statusRow?.startedBooks ?? 0,
      inProgressBooks: statusRow?.inProgressBooks ?? 0,
      completedBooks: statusRow?.completedBooks ?? 0,
      meanProgressPercent: progressRow?.meanProgressPercent ?? 0,
    };
  }

  async getDailyReadingStats(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 365): Promise<UserDailyReadingStat[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.dailyStatsLibraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const sinceDay = this.sinceDateForDays(days).toISOString().slice(0, 10);

    return this.db
      .select({
        day: userReadingDailyStats.day,
        readingSeconds: sql<number>`coalesce(sum(${userReadingDailyStats.readingSeconds}), 0)::int`,
        progressDelta: sql<number>`coalesce(sum(${userReadingDailyStats.progressDelta}), 0)::float`,
        eventsCount: sql<number>`coalesce(sum(${userReadingDailyStats.sessionsCount}), 0)::int`,
      })
      .from(userReadingDailyStats)
      .where(and(eq(userReadingDailyStats.userId, userId), gte(userReadingDailyStats.day, sinceDay), libraryFilter))
      .groupBy(userReadingDailyStats.day)
      .orderBy(userReadingDailyStats.day);
  }

  async getPeakReadingHours(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    days = 365,
  ): Promise<{ hour: number; format: string; readingSeconds: number; eventsCount: number }[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);
    const hourExpr = sql<number>`extract(hour from ${readingSessions.startedAt})::int`;
    const formatExpr = sql<string>`upper(coalesce(${bookFiles.format}, 'UNKNOWN'))`;

    return this.db
      .select({
        hour: hourExpr,
        format: formatExpr,
        readingSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}), 0)::int`,
        eventsCount: sql<number>`count(*)::int`,
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), libraryFilter))
      .groupBy(hourExpr, formatExpr)
      .orderBy(hourExpr);
  }

  async getSessionTimelineItems(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds: number[] | undefined,
    sinceInclusive: Date,
    untilExclusive: Date,
    limit = 3000,
  ): Promise<SessionTimelineItemRow[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    return this.db
      .select({
        sessionId: readingSessions.id,
        bookId: bookFiles.bookId,
        bookTitle: bookMetadata.title,
        bookFormat: sql<string | null>`nullif(${bookFiles.format}, '')`,
        startedAt: readingSessions.startedAt,
        endedAt: readingSessions.endedAt,
        durationSeconds: readingSessions.durationSeconds,
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, bookFiles.bookId))
      .where(
        and(
          eq(readingSessions.userId, userId),
          lt(readingSessions.startedAt, untilExclusive),
          gt(readingSessions.endedAt, sinceInclusive),
          libraryFilter,
        ),
      )
      .orderBy(readingSessions.startedAt)
      .limit(limit);
  }

  async getSessionTimelineSessionById(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds: number[] | undefined,
    sessionId: number,
  ): Promise<SessionTimelineSessionRow | null> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    const [row] = await this.db
      .select({
        sessionId: readingSessions.id,
        libraryId: books.libraryId,
        bookId: bookFiles.bookId,
        bookTitle: bookMetadata.title,
        bookFormat: sql<string | null>`nullif(${bookFiles.format}, '')`,
        startedAt: readingSessions.startedAt,
        endedAt: readingSessions.endedAt,
        durationSeconds: readingSessions.durationSeconds,
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, bookFiles.bookId))
      .where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, sessionId), libraryFilter))
      .limit(1);

    return row ?? null;
  }

  async findSessionTimelineConflict(userId: number, sessionId: number, startedAt: Date, endedAt: Date): Promise<SessionTimelineConflictRow | null> {
    const [row] = await this.db
      .select({
        sessionId: readingSessions.id,
        startedAt: readingSessions.startedAt,
        endedAt: readingSessions.endedAt,
      })
      .from(readingSessions)
      .where(
        and(
          eq(readingSessions.userId, userId),
          ne(readingSessions.id, sessionId),
          lt(readingSessions.startedAt, endedAt),
          gt(readingSessions.endedAt, startedAt),
        ),
      )
      .orderBy(readingSessions.startedAt)
      .limit(1);

    return row ?? null;
  }

  async updateSessionTimelineSession(userId: number, sessionId: number, startedAt: Date, endedAt: Date): Promise<SessionTimelineSessionRow | null> {
    const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    const updated = await this.db
      .update(readingSessions)
      .set({ startedAt, endedAt, durationSeconds })
      .where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, sessionId)))
      .returning({ id: readingSessions.id });

    if (updated.length === 0) return null;
    return this.getSessionTimelineSessionById(userId, true, undefined, sessionId);
  }

  async moveSessionTimelineSessionAtomic(
    userId: number,
    sessionId: number,
    libraryId: number,
    previousStartedAt: Date,
    startedAt: Date,
    endedAt: Date,
    durationSeconds: number,
  ): Promise<{ updated: SessionTimelineSessionRow | null; conflict: SessionTimelineConflictRow | null }> {
    return this.db.transaction(async (tx) => {
      // Serialize edits per user to avoid race conditions between concurrent drags.
      await tx.execute(sql`select pg_advisory_xact_lock(${userId}::bigint)`);

      const [conflict] = await tx
        .select({
          sessionId: readingSessions.id,
          startedAt: readingSessions.startedAt,
          endedAt: readingSessions.endedAt,
        })
        .from(readingSessions)
        .where(
          and(
            eq(readingSessions.userId, userId),
            ne(readingSessions.id, sessionId),
            lt(readingSessions.startedAt, endedAt),
            gt(readingSessions.endedAt, startedAt),
          ),
        )
        .orderBy(readingSessions.startedAt)
        .limit(1);

      if (conflict) return { updated: null, conflict };

      const touched = await tx
        .update(readingSessions)
        .set({ startedAt, endedAt, durationSeconds })
        .where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, sessionId)))
        .returning({ id: readingSessions.id });
      if (touched.length === 0) return { updated: null, conflict: null };

      const uniqueDays = [...new Set([this.formatDayKey(previousStartedAt), this.formatDayKey(startedAt)])];
      if (uniqueDays.length > 0) {
        const dayDateList = sql.join(
          uniqueDays.map((day) => sql`${day}::date`),
          sql`, `,
        );

        await tx
          .delete(userReadingDailyStats)
          .where(
            and(
              eq(userReadingDailyStats.userId, userId),
              eq(userReadingDailyStats.libraryId, libraryId),
              inArray(userReadingDailyStats.day, uniqueDays),
            ),
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
            and date_trunc('day', rs.started_at)::date in (${dayDateList})
          group by rs.user_id, b.library_id, date_trunc('day', rs.started_at)::date
        `);
      }

      const [updated] = await tx
        .select({
          sessionId: readingSessions.id,
          libraryId: books.libraryId,
          bookId: bookFiles.bookId,
          bookTitle: bookMetadata.title,
          bookFormat: sql<string | null>`nullif(${bookFiles.format}, '')`,
          startedAt: readingSessions.startedAt,
          endedAt: readingSessions.endedAt,
          durationSeconds: readingSessions.durationSeconds,
        })
        .from(readingSessions)
        .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .innerJoin(books, eq(books.id, bookFiles.bookId))
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, bookFiles.bookId))
        .where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, sessionId)))
        .limit(1);

      return { updated: updated ?? null, conflict: null };
    });
  }

  async recomputeUserDailyStatsForLibraryDays(userId: number, libraryId: number, days: string[]): Promise<void> {
    const uniqueDays = [...new Set(days)];
    if (uniqueDays.length === 0) return;

    const dayDateList = sql.join(
      uniqueDays.map((day) => sql`${day}::date`),
      sql`, `,
    );

    await this.db.transaction(async (tx) => {
      await tx
        .delete(userReadingDailyStats)
        .where(
          and(
            eq(userReadingDailyStats.userId, userId),
            eq(userReadingDailyStats.libraryId, libraryId),
            inArray(userReadingDailyStats.day, uniqueDays),
          ),
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
          and date_trunc('day', rs.started_at)::date in (${dayDateList})
        group by rs.user_id, b.library_id, date_trunc('day', rs.started_at)::date
      `);
    });
  }

  async getFavoriteReadingDays(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 365): Promise<UserFavoriteDayStat[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);
    const dayOfWeekExpr = sql<number>`extract(dow from ${readingSessions.startedAt})::int`;

    return this.db
      .select({
        dayOfWeek: dayOfWeekExpr,
        readingSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}), 0)::int`,
        eventsCount: sql<number>`count(*)::int`,
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), libraryFilter))
      .groupBy(dayOfWeekExpr)
      .orderBy(dayOfWeekExpr);
  }

  async getCompletionTimeline(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    days = 1825,
  ): Promise<UserCompletionTimelinePoint[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    const firstCompletion = this.db
      .select({
        bookId: bookFiles.bookId,
        firstCompletedAt: sql<Date>`min(${readingSessions.endedAt})`.as('first_completed_at'),
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.endProgress, 100), libraryFilter))
      .groupBy(bookFiles.bookId)
      .as('first_completion');

    const yearExpr = sql<number>`extract(year from ${firstCompletion.firstCompletedAt})::int`;
    const monthExpr = sql<number>`extract(month from ${firstCompletion.firstCompletedAt})::int`;

    return this.db
      .select({
        year: yearExpr,
        month: monthExpr,
        count: sql<number>`count(*)::int`,
      })
      .from(firstCompletion)
      .where(sql`${firstCompletion.firstCompletedAt} >= ${since}`)
      .groupBy(yearExpr, monthExpr)
      .orderBy(yearExpr, monthExpr);
  }

  async getMonthlyCompletions(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 365): Promise<UserCompletionTimelinePoint[]> {
    return this.getCompletionTimeline(userId, isSuperuser, filterLibraryIds, days);
  }

  async getProgressFunnel(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 365): Promise<UserProgressFunnel> {
    const since = this.sinceDateForDays(days);
    return this.getProgressFunnelInRange(userId, isSuperuser, filterLibraryIds, since);
  }

  async getProgressFunnelInRange(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds: number[] | undefined,
    since: Date,
    untilExclusive?: Date,
  ): Promise<UserProgressFunnel> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const timeFilter = untilExclusive
      ? and(gte(readingSessions.startedAt, since), lt(readingSessions.startedAt, untilExclusive))
      : gte(readingSessions.startedAt, since);

    const perBookProgress = this.db
      .select({
        bookId: bookFiles.bookId,
        maxPercentage: sql<number>`max(${readingSessions.endProgress})`.as('max_percentage'),
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingSessions.userId, userId), timeFilter, libraryFilter, isNotNull(readingSessions.endProgress)))
      .groupBy(bookFiles.bookId)
      .as('per_book_progress');

    const [row] = await this.db
      .select({
        started: sql<number>`count(*) filter (where ${perBookProgress.maxPercentage} > 0)::int`,
        reached25: sql<number>`count(*) filter (where ${perBookProgress.maxPercentage} >= 25)::int`,
        reached50: sql<number>`count(*) filter (where ${perBookProgress.maxPercentage} >= 50)::int`,
        reached75: sql<number>`count(*) filter (where ${perBookProgress.maxPercentage} >= 75)::int`,
        completed: sql<number>`count(*) filter (where ${perBookProgress.maxPercentage} >= 100)::int`,
      })
      .from(perBookProgress);

    return {
      started: row?.started ?? 0,
      reached25: row?.reached25 ?? 0,
      reached50: row?.reached50 ?? 0,
      reached75: row?.reached75 ?? 0,
      completed: row?.completed ?? 0,
    };
  }

  async getCompletionLatencyDays(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 1825): Promise<number[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    const completedInWindow = this.db
      .select({
        bookId: bookFiles.bookId,
        completedAt: sql<Date>`min(${readingSessions.endedAt})`.as('completed_at'),
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), gte(readingSessions.endProgress, 100), libraryFilter))
      .groupBy(bookFiles.bookId)
      .as('completed_in_window');

    const startedAndCompleted = this.db
      .select({
        completedAt: completedInWindow.completedAt,
        startedAt: sql<Date | null>`min(${readingSessions.startedAt})`.as('started_at'),
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(completedInWindow, eq(completedInWindow.bookId, bookFiles.bookId))
      .where(eq(readingSessions.userId, userId))
      .groupBy(completedInWindow.bookId, completedInWindow.completedAt)
      .as('started_and_completed');

    const rows = await this.db
      .select({
        days: sql<number | string>`extract(epoch from (${startedAndCompleted.completedAt} - ${startedAndCompleted.startedAt})) / 86400`,
      })
      .from(startedAndCompleted)
      .where(and(sql`${startedAndCompleted.startedAt} is not null`, sql`${startedAndCompleted.completedAt} >= ${startedAndCompleted.startedAt}`));

    return rows
      .map((row) => (typeof row.days === 'number' ? row.days : Number.parseFloat(String(row.days))))
      .filter((daysValue) => Number.isFinite(daysValue) && daysValue >= 0);
  }

  async getGenreReadingTime(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 365): Promise<UserGenreReadingTimeItem[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    return this.db
      .select({
        genre: genres.name,
        readingSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}), 0)::int`,
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .innerJoin(bookGenres, eq(bookGenres.bookId, books.id))
      .innerJoin(genres, eq(genres.id, bookGenres.genreId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), libraryFilter))
      .groupBy(genres.name)
      .orderBy(sql`sum(${readingSessions.durationSeconds}) desc`)
      .limit(30);
  }

  async getReadingPacePoints(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 1825): Promise<UserReadingPacePoint[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    const rows = await this.db
      .select({
        durationSeconds: readingSessions.durationSeconds,
        progressDelta: readingSessions.progressDelta,
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(
        and(
          eq(readingSessions.userId, userId),
          gte(readingSessions.startedAt, since),
          isNotNull(readingSessions.progressDelta),
          gt(readingSessions.progressDelta, 0),
          libraryFilter,
        ),
      )
      .orderBy(readingSessions.startedAt)
      .limit(2000);

    return rows.map((r) => ({ durationSeconds: r.durationSeconds, progressDelta: r.progressDelta! }));
  }

  async getReadingSurvivalMaxProgress(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 1825): Promise<number[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    const perBook = this.db
      .select({
        bookId: bookFiles.bookId,
        maxProgress: sql<number>`max(${readingSessions.endProgress})`.as('max_progress'),
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), isNotNull(readingSessions.endProgress), libraryFilter))
      .groupBy(bookFiles.bookId)
      .as('per_book');

    const rows = await this.db.select({ maxProgress: perBook.maxProgress }).from(perBook);
    return rows.map((r) => Number(r.maxProgress)).filter((v) => Number.isFinite(v));
  }

  async getCompletionRaceRawSessions(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    days = 1825,
    limit = 15,
  ): Promise<{ bookId: number; title: string | null; startedAt: Date; endProgress: number }[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    const topBookIds = await this.db
      .select({ bookId: bookFiles.bookId })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), isNotNull(readingSessions.endProgress), libraryFilter))
      .groupBy(bookFiles.bookId)
      .orderBy(sql`count(*) desc`)
      .limit(limit)
      .then((rows) => rows.map((r) => r.bookId));

    if (!topBookIds.length) return [];

    return this.db
      .select({
        bookId: bookFiles.bookId,
        title: bookMetadata.title,
        startedAt: readingSessions.startedAt,
        endProgress: readingSessions.endProgress,
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, bookFiles.bookId))
      .where(and(eq(readingSessions.userId, userId), inArray(bookFiles.bookId, topBookIds), isNotNull(readingSessions.endProgress)))
      .orderBy(bookFiles.bookId, readingSessions.startedAt)
      .then((rows) => rows.map((r) => ({ ...r, endProgress: r.endProgress! })));
  }

  async getSessionArchetypePoints(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    days = 365,
  ): Promise<UserSessionArchetypePoint[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    const hourExpr = sql<number>`extract(hour from ${readingSessions.startedAt}) + extract(minute from ${readingSessions.startedAt}) / 60.0`;
    const durationExpr = sql<number>`${readingSessions.durationSeconds} / 60.0`;
    const dowExpr = sql<number>`extract(dow from ${readingSessions.startedAt})::int`;

    const rows = await this.db
      .select({ hour: hourExpr, durationMinutes: durationExpr, dayOfWeek: dowExpr })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), gte(readingSessions.durationSeconds, 300), libraryFilter))
      .orderBy(readingSessions.startedAt)
      .limit(2000);

    return rows.map((r) => ({
      hour: Number(r.hour),
      durationMinutes: Number(r.durationMinutes),
      dayOfWeek: Number(r.dayOfWeek),
    }));
  }

  async getAuthorGenreChord(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    days = 1825,
    authorLimit = 12,
    genreLimit = 12,
  ): Promise<ChordDiagramData> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libFilter = this.intersectLibraryIds(accessible, filterLibraryIds);
    const since = this.sinceDateForDays(days);
    const sinceStr = since.toISOString().slice(0, 10);

    const libCondition = libFilter === null ? sql`true` : libFilter.length === 0 ? sql`false` : inArray(books.libraryId, libFilter);

    const rows = await this.db.execute<{ author: string; genre: string; reading_seconds: number }>(sql`
      with top_authors as (
        select a.name, sum(rs.duration_seconds) as total
        from reading_sessions rs
        inner join book_files bf on bf.id = rs.book_file_id
        inner join books b on b.id = bf.book_id
        inner join book_authors ba on ba.book_id = b.id
        inner join authors a on a.id = ba.author_id
        where rs.user_id = ${userId}
          and rs.started_at >= ${sinceStr}::timestamp
          and ${libCondition}
        group by a.name
        order by total desc
        limit ${authorLimit}
      ),
      top_genres as (
        select g.name, sum(rs.duration_seconds) as total
        from reading_sessions rs
        inner join book_files bf on bf.id = rs.book_file_id
        inner join books b on b.id = bf.book_id
        inner join book_genres bg on bg.book_id = b.id
        inner join genres g on g.id = bg.genre_id
        where rs.user_id = ${userId}
          and rs.started_at >= ${sinceStr}::timestamp
          and ${libCondition}
        group by g.name
        order by total desc
        limit ${genreLimit}
      )
      select
        a.name as author,
        g.name as genre,
        sum(rs.duration_seconds)::int as reading_seconds
      from reading_sessions rs
      inner join book_files bf on bf.id = rs.book_file_id
      inner join books b on b.id = bf.book_id
      inner join book_authors ba on ba.book_id = b.id
      inner join top_authors a on a.name = (
        select a2.name from book_authors ba2 inner join authors a2 on a2.id = ba2.author_id where ba2.book_id = b.id order by ba2.display_order, ba2.author_id limit 1
      )
      inner join book_genres bg on bg.book_id = b.id
      inner join top_genres g on g.name = (
        select g2.name from book_genres bg2 inner join genres g2 on g2.id = bg2.genre_id where bg2.book_id = b.id order by bg2.genre_id limit 1
      )
      where rs.user_id = ${userId}
        and rs.started_at >= ${sinceStr}::timestamp
        and ${libCondition}
      group by a.name, g.name
      having sum(rs.duration_seconds) > 0
      order by reading_seconds desc
    `);

    if (rows.rows.length === 0) return { nodes: [], links: [] };

    const authorNames = [...new Set(rows.rows.map((r) => r.author))];
    const genreNames = [...new Set(rows.rows.map((r) => r.genre))];

    return {
      nodes: [...authorNames.map((n) => ({ name: n })), ...genreNames.map((n) => ({ name: n }))],
      links: rows.rows.map((r) => ({ source: r.author, target: r.genre, value: r.reading_seconds })),
    };
  }

  async recomputeRecentDailyStats(days = RECENT_DAILY_AGGREGATION_DAYS): Promise<{ deleted: number; inserted: number; since: string }> {
    const sinceDay = this.sinceDateForDays(days).toISOString().slice(0, 10);

    return this.db.transaction(async (tx) => {
      const deleteResult = await tx.execute(sql`delete from user_reading_daily_stats where day >= ${sinceDay}::date`);

      const insertResult = await tx.execute(sql`
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
        where rs.started_at >= ${sinceDay}::timestamp
        group by rs.user_id, b.library_id, date_trunc('day', rs.started_at)::date
      `);

      const deleted = Number((deleteResult as { rowCount?: number }).rowCount ?? 0);
      const inserted = Number((insertResult as { rowCount?: number }).rowCount ?? 0);
      return { deleted, inserted, since: sinceDay };
    });
  }
}
