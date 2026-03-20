import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type {
  UserCompletionTimelinePoint,
  UserDailyReadingStat,
  UserFavoriteDayStat,
  UserPeakHourStat,
  UserProgressFunnel,
  UserStatisticsSummary,
} from '@projectx/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, books, readingProgress, readingSessionEvents, userLibraryAccess, userReadingDailyStats } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
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

  async getSummary(userId: number, isSuperuser: boolean, filterLibraryIds?: number[]): Promise<UserStatisticsSummary> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const filter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));

    const perBookProgress = this.db
      .select({
        bookId: bookFiles.bookId,
        maxPercentage: sql<number>`max(${readingProgress.percentage})`.as('max_percentage'),
      })
      .from(readingProgress)
      .innerJoin(bookFiles, eq(bookFiles.id, readingProgress.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingProgress.userId, userId), filter))
      .groupBy(bookFiles.bookId)
      .as('per_book_progress');

    const [row] = await this.db
      .select({
        trackedBooks: sql<number>`count(*)::int`,
        startedBooks: sql<number>`count(*) filter (where ${perBookProgress.maxPercentage} > 0)::int`,
        inProgressBooks: sql<number>`count(*) filter (where ${perBookProgress.maxPercentage} > 0 and ${perBookProgress.maxPercentage} < 100)::int`,
        completedBooks: sql<number>`count(*) filter (where ${perBookProgress.maxPercentage} >= 100)::int`,
        meanProgressPercent: sql<number>`coalesce(avg(${perBookProgress.maxPercentage}), 0)::float`,
      })
      .from(perBookProgress);

    return {
      trackedBooks: row?.trackedBooks ?? 0,
      startedBooks: row?.startedBooks ?? 0,
      inProgressBooks: row?.inProgressBooks ?? 0,
      completedBooks: row?.completedBooks ?? 0,
      meanProgressPercent: row?.meanProgressPercent ?? 0,
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
        eventsCount: sql<number>`coalesce(sum(${userReadingDailyStats.eventsCount}), 0)::int`,
      })
      .from(userReadingDailyStats)
      .where(and(eq(userReadingDailyStats.userId, userId), gte(userReadingDailyStats.day, sinceDay), libraryFilter))
      .groupBy(userReadingDailyStats.day)
      .orderBy(userReadingDailyStats.day);
  }

  async getPeakReadingHours(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 365): Promise<UserPeakHourStat[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);
    const hourExpr = sql<number>`extract(hour from ${readingSessionEvents.recordedAt})::int`;

    return this.db
      .select({
        hour: hourExpr,
        readingSeconds: sql<number>`coalesce(sum(case when ${readingSessionEvents.deltaSeconds} > 0 and ${readingSessionEvents.deltaSeconds} <= 1800 then ${readingSessionEvents.deltaSeconds} else 0 end), 0)::int`,
        eventsCount: sql<number>`count(*)::int`,
      })
      .from(readingSessionEvents)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessionEvents.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingSessionEvents.userId, userId), gte(readingSessionEvents.recordedAt, since), libraryFilter))
      .groupBy(hourExpr)
      .orderBy(hourExpr);
  }

  async getFavoriteReadingDays(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 365): Promise<UserFavoriteDayStat[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);
    const dayOfWeekExpr = sql<number>`extract(dow from ${readingSessionEvents.recordedAt})::int`;

    return this.db
      .select({
        dayOfWeek: dayOfWeekExpr,
        readingSeconds: sql<number>`coalesce(sum(case when ${readingSessionEvents.deltaSeconds} > 0 and ${readingSessionEvents.deltaSeconds} <= 1800 then ${readingSessionEvents.deltaSeconds} else 0 end), 0)::int`,
        eventsCount: sql<number>`count(*)::int`,
      })
      .from(readingSessionEvents)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessionEvents.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingSessionEvents.userId, userId), gte(readingSessionEvents.recordedAt, since), libraryFilter))
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
        firstCompletedAt: sql<Date>`min(${readingSessionEvents.recordedAt})`.as('first_completed_at'),
      })
      .from(readingSessionEvents)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessionEvents.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingSessionEvents.userId, userId), gte(readingSessionEvents.percentage, 100), libraryFilter))
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
      ? and(gte(readingSessionEvents.recordedAt, since), lt(readingSessionEvents.recordedAt, untilExclusive))
      : gte(readingSessionEvents.recordedAt, since);

    const perBookProgress = this.db
      .select({
        bookId: bookFiles.bookId,
        maxPercentage: sql<number>`max(${readingSessionEvents.percentage})`.as('max_percentage'),
      })
      .from(readingSessionEvents)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessionEvents.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(and(eq(readingSessionEvents.userId, userId), timeFilter, libraryFilter))
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
        completedAt: sql<Date>`min(${readingSessionEvents.recordedAt})`.as('completed_at'),
      })
      .from(readingSessionEvents)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessionEvents.bookFileId))
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(
        and(
          eq(readingSessionEvents.userId, userId),
          gte(readingSessionEvents.recordedAt, since),
          gte(readingSessionEvents.percentage, 100),
          libraryFilter,
        ),
      )
      .groupBy(bookFiles.bookId)
      .as('completed_in_window');

    const startedAndCompleted = this.db
      .select({
        completedAt: completedInWindow.completedAt,
        startedAt: sql<Date | null>`min(case when ${readingSessionEvents.percentage} > 0 then ${readingSessionEvents.recordedAt} end)`.as(
          'started_at',
        ),
      })
      .from(readingSessionEvents)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessionEvents.bookFileId))
      .innerJoin(completedInWindow, eq(completedInWindow.bookId, bookFiles.bookId))
      .where(eq(readingSessionEvents.userId, userId))
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

  async recomputeRecentDailyStats(days = RECENT_DAILY_AGGREGATION_DAYS): Promise<{ deleted: number; inserted: number; since: string }> {
    const since = this.sinceDateForDays(days);
    const sinceDay = since.toISOString().slice(0, 10);

    return this.db.transaction(async (tx) => {
      const deleteResult = await tx.execute(sql`delete from user_reading_daily_stats where day >= ${sinceDay}::date`);
      const insertResult = await tx.execute(sql`
        insert into user_reading_daily_stats (user_id, library_id, day, reading_seconds, progress_delta, events_count, updated_at)
        select
          ${readingSessionEvents.userId} as user_id,
          ${books.libraryId} as library_id,
          date_trunc('day', ${readingSessionEvents.recordedAt})::date as day,
          coalesce(
            sum(
              case
                when ${readingSessionEvents.deltaSeconds} > 0 and ${readingSessionEvents.deltaSeconds} <= 1800
                  then ${readingSessionEvents.deltaSeconds}
                else 0
              end
            ),
            0
          )::int as reading_seconds,
          coalesce(sum(${readingSessionEvents.percentageDelta}), 0)::real as progress_delta,
          count(*)::int as events_count,
          now() as updated_at
        from ${readingSessionEvents}
        inner join ${bookFiles} on ${bookFiles.id} = ${readingSessionEvents.bookFileId}
        inner join ${books} on ${books.id} = ${bookFiles.bookId}
        where ${readingSessionEvents.recordedAt} >= ${since}
        group by ${readingSessionEvents.userId}, ${books.libraryId}, date_trunc('day', ${readingSessionEvents.recordedAt})::date
      `);

      const deleted = Number((deleteResult as { rowCount?: number }).rowCount ?? 0);
      const inserted = Number((insertResult as { rowCount?: number }).rowCount ?? 0);
      return { deleted, inserted, since: sinceDay };
    });
  }
}
