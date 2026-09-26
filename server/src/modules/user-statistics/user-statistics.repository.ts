import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type {
  ChordDiagramData,
  ReadingSessionSource,
  UserCompletionTimelinePoint,
  UserDailyReadingStat,
  UserProgressFunnel,
  UserReadingPacePoint,
  UserSessionArchetypePoint,
  UserStatisticsSummary,
} from '@bookorbit/types';
import { toReadingSessionSourceBucket } from '@bookorbit/types';

import {
  aggregateReadingSessionDailyStats,
  getDayRangeForDateKeys,
  getReadingSessionDayKeys,
  mergeReadingDailyStatsSegments,
  sortReadingDailyStatsSegments,
  type ReadingDailyStatsSegment,
} from '../../common/utils/reading-daily-stats.utils';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  bookFiles,
  bookGenres,
  bookMetadata,
  books,
  genres,
  readingAttempts,
  readingProgress,
  readingSessions,
  userBookStatus,
  userLibraryAccess,
  userReadingDailyStats,
  users,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type SessionTimelineItemRow = {
  sessionId: number;
  bookId: number;
  bookTitle: string | null;
  bookFormat: string | null;
  source: ReadingSessionSource | null;
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
export type ActivitySessionRow = {
  id: number;
  bookId: number;
  bookFileId: number | null;
  bookTitle: string | null;
  coverSource: string | null;
  metadataUpdatedAt: Date | null;
  format: string | null;
  source: ReadingSessionSource | null;
  sessionType: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  progressDelta: number | null;
};

export type ActivityPaceSummary = {
  overall: {
    eligibleSessions: number;
    medianDurationSeconds: number | null;
    medianProgressDelta: number | null;
  };
  byMedia: Array<{
    bucket: 'reading' | 'listening';
    eligibleSessions: number;
    medianDurationSeconds: number | null;
    medianProgressDelta: number | null;
  }>;
};
export type ActivityCompletionSpeedRow = {
  firstStartedAt: Date;
  completedAt: Date;
  format: string;
};
export type ActivityGenreTimeRow = {
  genre: string;
  genreTotalSeconds: number;
  author: string | null;
  authorTotalSeconds: number;
  bookId: number;
  bookTitle: string | null;
  bookTotalSeconds: number;
};
export type ActivityPaceBandRow = {
  band: 'under_15' | '15_to_30' | '30_to_60' | '60_to_120' | '120_to_240';
  medianProgressDelta: number | null;
  sampleCount: number;
};
const RECENT_DAILY_AGGREGATION_DAYS = 2;
/** A full-history rebuild pages sessions rather than loading a long reader's whole timeline at once. */
const DAILY_STATS_REBUILD_PAGE_SIZE = 5_000;
const DAILY_STATS_INSERT_CHUNK_SIZE = 1_000;

@Injectable()
export class UserStatisticsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async getAccessibleLibraryIds(userId: number, isSuperuser: boolean): Promise<number[] | null> {
    if (isSuperuser) return null;
    const rows = await this.db.select({ libraryId: userLibraryAccess.libraryId }).from(userLibraryAccess).where(eq(userLibraryAccess.userId, userId));
    return rows.map((r) => r.libraryId);
  }

  private intersectLibraryIds(accessible: number[] | null, requested: number[] | number | undefined): number[] | null {
    const requestedIds = Array.isArray(requested) ? requested : requested == null ? [] : [requested];
    if (requestedIds.length === 0) return accessible;
    if (accessible === null) return requestedIds;
    const set = new Set(accessible);
    return requestedIds.filter((id) => set.has(id));
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

  async resolveActivityLibraryIds(userId: number, isSuperuser: boolean, requested?: number[]): Promise<number[] | null> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    return this.intersectLibraryIds(accessible, requested);
  }

  async getActivitySessionPage(
    userId: number,
    libraryIds: number[] | null,
    sinceInclusive: Date,
    untilExclusive: Date,
    afterId: number,
    limit: number,
  ): Promise<ActivitySessionRow[]> {
    return this.db
      .select({
        id: readingSessions.id,
        bookId: readingSessions.bookId,
        bookFileId: readingSessions.bookFileId,
        bookTitle: bookMetadata.title,
        coverSource: bookMetadata.coverSource,
        metadataUpdatedAt: bookMetadata.updatedAt,
        format: bookFiles.format,
        source: readingSessions.source,
        sessionType: readingSessions.sessionType,
        startedAt: readingSessions.startedAt,
        endedAt: readingSessions.endedAt,
        durationSeconds: readingSessions.durationSeconds,
        progressDelta: readingSessions.progressDelta,
      })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, readingSessions.bookId))
      .where(
        and(
          eq(readingSessions.userId, userId),
          gt(readingSessions.id, afterId),
          lt(readingSessions.startedAt, untilExclusive),
          gt(readingSessions.endedAt, sinceInclusive),
          this.libraryFilter(libraryIds),
        ),
      )
      .orderBy(asc(readingSessions.id))
      .limit(limit);
  }

  async getActivityAvailableYears(userId: number, libraryIds: number[] | null, timeZone: string): Promise<number[]> {
    const yearExpr = sql<number>`extract(year from (${readingSessions.startedAt} AT TIME ZONE ${timeZone}))::int`;
    const rows = await this.db
      .select({ year: yearExpr })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), this.libraryFilter(libraryIds)))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    return rows.map((row) => row.year);
  }

  async getActivityActiveDays(userId: number, libraryIds: number[] | null): Promise<string[]> {
    const rows = await this.db
      .select({ day: userReadingDailyStats.day })
      .from(userReadingDailyStats)
      .where(and(eq(userReadingDailyStats.userId, userId), gt(userReadingDailyStats.readingSeconds, 0), this.dailyStatsLibraryFilter(libraryIds)))
      .groupBy(userReadingDailyStats.day)
      .orderBy(userReadingDailyStats.day);
    return rows.map((row) => row.day);
  }

  /**
   * Completed books per month for the activity overview.
   *
   * Completed reading attempts are the canonical record, the same source the dashboard's
   * reading-goal widget counts, so the Home tile and the activity goal card cannot disagree.
   * Deriving completions from sessions that reached 99 percent instead drops every book marked
   * read by hand or finished on Kobo, KOReader or an audiobook that stops short of the end, and
   * collapses a re-read into the year of its first finish. `endedOn` is a calendar date rather
   * than an instant, so it carries no zone to convert and is bucketed as stored.
   */
  async getActivityCompletionTimeline(userId: number, libraryIds: number[] | null): Promise<UserCompletionTimelinePoint[]> {
    const yearExpr = sql<number>`extract(year from ${readingAttempts.endedOn})::int`;
    const monthExpr = sql<number>`extract(month from ${readingAttempts.endedOn})::int`;

    return this.db
      .select({
        year: yearExpr,
        month: monthExpr,
        count: sql<number>`count(*)::int`,
      })
      .from(readingAttempts)
      .innerJoin(books, eq(books.id, readingAttempts.bookId))
      .where(
        and(
          eq(readingAttempts.userId, userId),
          eq(readingAttempts.outcome, 'completed'),
          isNotNull(readingAttempts.endedOn),
          isNull(readingAttempts.deletedAt),
          this.libraryFilter(libraryIds),
        ),
      )
      .groupBy(yearExpr, monthExpr)
      .orderBy(yearExpr, monthExpr);
  }

  async getActivityPaceSummary(userId: number, libraryIds: number[] | null, days = 1825): Promise<ActivityPaceSummary> {
    const since = this.sinceDateForDays(days);
    const mediaExpr = sql<'reading' | 'listening'>`case when ${readingSessions.sessionType} in ('tts', 'listen') then 'listening' else 'reading' end`;
    const filters = and(
      eq(readingSessions.userId, userId),
      gte(readingSessions.startedAt, since),
      gt(readingSessions.durationSeconds, 0),
      lte(readingSessions.durationSeconds, 14_400),
      isNotNull(readingSessions.progressDelta),
      gt(readingSessions.progressDelta, 0),
      this.libraryFilter(libraryIds),
    );
    const select = {
      eligibleSessions: sql<number>`count(*)::int`,
      medianDurationSeconds: sql<number | null>`percentile_cont(0.5) within group (order by ${readingSessions.durationSeconds})::float`,
      medianProgressDelta: sql<number | null>`percentile_cont(0.5) within group (order by ${readingSessions.progressDelta})::float`,
    };
    const [overallRows, mediaRows] = await Promise.all([
      this.db.select(select).from(readingSessions).innerJoin(books, eq(books.id, readingSessions.bookId)).where(filters),
      this.db
        .select({
          bucket: mediaExpr,
          ...select,
        })
        .from(readingSessions)
        .innerJoin(books, eq(books.id, readingSessions.bookId))
        .where(filters)
        .groupBy(mediaExpr),
    ]);
    const overall = overallRows[0];
    return {
      overall: {
        eligibleSessions: overall?.eligibleSessions ?? 0,
        medianDurationSeconds: overall?.medianDurationSeconds ?? null,
        medianProgressDelta: overall?.medianProgressDelta ?? null,
      },
      byMedia: mediaRows,
    };
  }

  async getActivityCompletionSpeedRows(userId: number, libraryIds: number[] | null, since: Date): Promise<ActivityCompletionSpeedRow[]> {
    const result = await this.db.execute<ActivityCompletionSpeedRow>(sql`
      with first_completions as (
        select ${readingSessions.bookId} as book_id, min(${readingSessions.endedAt}) as completed_at
        from ${readingSessions}
        inner join ${books} on ${books.id} = ${readingSessions.bookId}
        where ${readingSessions.userId} = ${userId}
          and ${readingSessions.endProgress} >= 99
          and ${this.libraryFilter(libraryIds) ?? sql`true`}
        group by ${readingSessions.bookId}
      )
      select
        min(all_sessions.started_at) as "firstStartedAt",
        first_completions.completed_at as "completedAt",
        coalesce(completion_file.format, 'UNKNOWN') as format
      from first_completions
      inner join ${readingSessions} all_sessions
        on all_sessions.book_id = first_completions.book_id
       and all_sessions.user_id = ${userId}
      left join lateral (
        select upper(coalesce(${bookFiles.format}, 'UNKNOWN')) as format
        from ${readingSessions} completion_session
        left join ${bookFiles} on ${bookFiles.id} = completion_session.book_file_id
        where completion_session.user_id = ${userId}
          and completion_session.book_id = first_completions.book_id
          and completion_session.end_progress >= 99
        order by completion_session.ended_at, completion_session.id
        limit 1
      ) completion_file on true
      where first_completions.completed_at >= ${since}
      group by first_completions.book_id, first_completions.completed_at, completion_file.format
      order by first_completions.completed_at
    `);
    return result.rows.map((row) => ({
      ...row,
      firstStartedAt: row.firstStartedAt instanceof Date ? row.firstStartedAt : new Date(row.firstStartedAt as unknown as string),
      completedAt: row.completedAt instanceof Date ? row.completedAt : new Date(row.completedAt as unknown as string),
    }));
  }

  async getActivityGenreTimeRows(userId: number, libraryIds: number[] | null, since: Date): Promise<ActivityGenreTimeRow[]> {
    const result = await this.db.execute<ActivityGenreTimeRow>(sql`
      with book_totals as (
        select
          ${books.id} as book_id,
          ${bookMetadata.title} as book_title,
          coalesce(sum(${readingSessions.durationSeconds}), 0)::int as total_seconds
        from ${readingSessions}
        inner join ${books} on ${books.id} = ${readingSessions.bookId}
        left join ${bookMetadata} on ${bookMetadata.bookId} = ${books.id}
        where ${readingSessions.userId} = ${userId}
          and ${readingSessions.startedAt} >= ${since}
          and ${readingSessions.durationSeconds} > 0
          and ${this.libraryFilter(libraryIds) ?? sql`true`}
        group by ${books.id}, ${bookMetadata.title}
      ), genre_books as (
        select
          ${genres.name} as genre,
          book_totals.book_id,
          book_totals.book_title,
          book_totals.total_seconds,
          (
            select author.name
            from book_authors
            inner join authors author on author.id = book_authors.author_id
            where book_authors.book_id = book_totals.book_id
            order by book_authors.display_order, book_authors.author_id
            limit 1
          ) as author
        from book_totals
        inner join ${bookGenres} on ${bookGenres.bookId} = book_totals.book_id
        inner join ${genres} on ${genres.id} = ${bookGenres.genreId}
      ), ranked_genres as (
        select genre, sum(total_seconds)::int as genre_total_seconds
        from genre_books
        group by genre
        order by genre_total_seconds desc, genre
        limit 30
      ), author_totals as (
        select
          genre,
          author,
          sum(total_seconds)::int as author_total_seconds,
          dense_rank() over (partition by genre order by sum(total_seconds) desc, author nulls last) as author_rank
        from genre_books
        group by genre, author
      ), ranked_books as (
        select
          genre,
          author,
          book_id,
          book_title,
          total_seconds,
          row_number() over (partition by genre, author order by total_seconds desc, book_title nulls last, book_id) as book_rank
        from genre_books
      )
      select
        ranked_genres.genre,
        ranked_genres.genre_total_seconds as "genreTotalSeconds",
        author_totals.author,
        author_totals.author_total_seconds as "authorTotalSeconds",
        ranked_books.book_id as "bookId",
        ranked_books.book_title as "bookTitle",
        ranked_books.total_seconds as "bookTotalSeconds"
      from ranked_genres
      inner join author_totals on author_totals.genre = ranked_genres.genre and author_totals.author_rank <= 30
      inner join ranked_books
        on ranked_books.genre = author_totals.genre
       and ranked_books.author is not distinct from author_totals.author
       and ranked_books.book_rank <= 50
      order by ranked_genres.genre_total_seconds desc, ranked_genres.genre, author_totals.author_total_seconds desc,
        author_totals.author, ranked_books.total_seconds desc, ranked_books.book_id
    `);
    return result.rows;
  }

  async getActivityPaceBands(
    userId: number,
    libraryIds: number[] | null,
    since: Date,
    format?: string,
    media?: 'reading' | 'listening',
  ): Promise<{ availableFormats: string[]; bands: ActivityPaceBandRow[] }> {
    const formatExpr = sql<string>`upper(coalesce(${bookFiles.format}, 'UNKNOWN'))`;
    const mediaExpr = sql<'reading' | 'listening'>`case when ${readingSessions.sessionType} in ('tts', 'listen') then 'listening' else 'reading' end`;
    const eligible = and(
      eq(readingSessions.userId, userId),
      gte(readingSessions.startedAt, since),
      gt(readingSessions.durationSeconds, 0),
      lte(readingSessions.durationSeconds, 14_400),
      isNotNull(readingSessions.progressDelta),
      gt(readingSessions.progressDelta, 0),
      this.libraryFilter(libraryIds),
    );
    const selected = and(
      eligible,
      format ? sql`${formatExpr} = ${format.toUpperCase()}` : undefined,
      media ? sql`${mediaExpr} = ${media}` : undefined,
    );
    const bandExpr = sql<ActivityPaceBandRow['band']>`case
      when ${readingSessions.durationSeconds} < 900 then 'under_15'
      when ${readingSessions.durationSeconds} < 1800 then '15_to_30'
      when ${readingSessions.durationSeconds} < 3600 then '30_to_60'
      when ${readingSessions.durationSeconds} < 7200 then '60_to_120'
      else '120_to_240'
    end`;

    const [formatRows, bands] = await Promise.all([
      this.db
        .select({ format: formatExpr })
        .from(readingSessions)
        .innerJoin(books, eq(books.id, readingSessions.bookId))
        .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .where(eligible)
        .groupBy(formatExpr)
        .orderBy(formatExpr),
      this.db
        .select({
          band: bandExpr,
          medianProgressDelta: sql<number | null>`percentile_cont(0.5) within group (order by ${readingSessions.progressDelta})::float`,
          sampleCount: sql<number>`count(*)::int`,
        })
        .from(readingSessions)
        .innerJoin(books, eq(books.id, readingSessions.bookId))
        .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .where(selected)
        .groupBy(bandExpr),
    ]);

    return { availableFormats: formatRows.map((row) => row.format), bands };
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
        startedBooks: sql<number>`count(*) filter (where ${userBookStatus.status} in ('reading', 'on_hold', 'rereading', 'read', 'skimmed', 'abandoned'))::int`,
        inProgressBooks: sql<number>`count(*) filter (where ${userBookStatus.status} in ('reading', 'on_hold', 'rereading'))::int`,
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
    timeZone = 'UTC',
  ): Promise<{ hour: number; format: string; source: ReadingSessionSource | null; readingSeconds: number; eventsCount: number }[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);
    const resolvedTimeZone = resolveTimeZone(timeZone, 'UTC');
    const hourExpr = sql<number>`extract(hour from (${readingSessions.startedAt} AT TIME ZONE ${resolvedTimeZone}))::int`;
    const formatExpr = sql<string>`upper(coalesce(${bookFiles.format}, 'UNKNOWN'))`;

    const sessionBuckets = this.db
      .select({
        hour: hourExpr.as('hour'),
        format: formatExpr.as('format'),
        source: readingSessions.source,
        durationSeconds: readingSessions.durationSeconds,
      })
      .from(readingSessions)
      .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), libraryFilter))
      .as('session_buckets');

    return this.db
      .select({
        hour: sessionBuckets.hour,
        format: sessionBuckets.format,
        source: sessionBuckets.source,
        readingSeconds: sql<number>`coalesce(sum(${sessionBuckets.durationSeconds}), 0)::int`,
        eventsCount: sql<number>`count(*)::int`,
      })
      .from(sessionBuckets)
      .groupBy(sessionBuckets.hour, sessionBuckets.format, sessionBuckets.source)
      .orderBy(sessionBuckets.hour);
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
        bookId: readingSessions.bookId,
        bookTitle: bookMetadata.title,
        bookFormat: sql<string | null>`nullif(${bookFiles.format}, '')`,
        source: readingSessions.source,
        startedAt: readingSessions.startedAt,
        endedAt: readingSessions.endedAt,
        durationSeconds: readingSessions.durationSeconds,
      })
      .from(readingSessions)
      .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, readingSessions.bookId))
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
        bookId: readingSessions.bookId,
        bookTitle: bookMetadata.title,
        bookFormat: sql<string | null>`nullif(${bookFiles.format}, '')`,
        source: readingSessions.source,
        startedAt: readingSessions.startedAt,
        endedAt: readingSessions.endedAt,
        durationSeconds: readingSessions.durationSeconds,
      })
      .from(readingSessions)
      .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, sessionId), libraryFilter))
      .limit(1);

    return row ?? null;
  }

  async moveSessionTimelineSessionAtomic(
    userId: number,
    sessionId: number,
    libraryId: number,
    previousStartedAt: Date,
    previousEndedAt: Date,
    startedAt: Date,
    endedAt: Date,
    durationSeconds: number,
    timeZone = 'UTC',
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

      const uniqueDays = [
        ...new Set([
          ...getReadingSessionDayKeys({ startedAt: previousStartedAt, endedAt: previousEndedAt, durationSeconds, progressDelta: null }, timeZone),
          ...getReadingSessionDayKeys({ startedAt, endedAt, durationSeconds, progressDelta: null }, timeZone),
        ]),
      ];
      if (uniqueDays.length > 0) {
        await this.recomputeDailyStats(tx, userId, libraryId, uniqueDays, timeZone);
      }

      const [updated] = await tx
        .select({
          sessionId: readingSessions.id,
          libraryId: books.libraryId,
          bookId: readingSessions.bookId,
          bookTitle: bookMetadata.title,
          bookFormat: sql<string | null>`nullif(${bookFiles.format}, '')`,
          source: readingSessions.source,
          startedAt: readingSessions.startedAt,
          endedAt: readingSessions.endedAt,
          durationSeconds: readingSessions.durationSeconds,
        })
        .from(readingSessions)
        .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .innerJoin(books, eq(books.id, readingSessions.bookId))
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, readingSessions.bookId))
        .where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, sessionId)))
        .limit(1);

      return { updated: updated ?? null, conflict: null };
    });
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
    await this.insertDailyStatsSegments(tx, userId, libraryId, segments);
  }

  private async lockDailyStats(tx: Tx, userId: number, libraryId: number): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(${userId}::int, ${libraryId}::int)`);
  }

  private async insertDailyStatsSegments(tx: Tx, userId: number, libraryId: number, segments: ReadingDailyStatsSegment[]): Promise<void> {
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
        set: {
          readingSeconds: sql`excluded.reading_seconds`,
          progressDelta: sql`excluded.progress_delta`,
          sessionsCount: sql`excluded.sessions_count`,
          updatedAt: now,
        },
      });
  }

  async getFavoriteReadingDays(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    days = 365,
  ): Promise<{ dayOfWeek: number; source: ReadingSessionSource | null; format: string; readingSeconds: number; eventsCount: number }[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);
    const dayOfWeekExpr = sql<number>`extract(dow from ${readingSessions.startedAt})::int`;
    const formatExpr = sql<string>`upper(coalesce(${bookFiles.format}, 'UNKNOWN'))`;

    return this.db
      .select({
        dayOfWeek: dayOfWeekExpr,
        source: readingSessions.source,
        format: formatExpr,
        readingSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}), 0)::int`,
        eventsCount: sql<number>`count(*)::int`,
      })
      .from(readingSessions)
      .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), libraryFilter))
      .groupBy(dayOfWeekExpr, readingSessions.source, formatExpr)
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
    const since = this.formatDayKey(this.sinceDateForDays(days));
    const yearExpr = sql<number>`extract(year from ${readingAttempts.endedOn})::int`;
    const monthExpr = sql<number>`extract(month from ${readingAttempts.endedOn})::int`;

    return this.db
      .select({
        year: yearExpr,
        month: monthExpr,
        count: sql<number>`count(*)::int`,
      })
      .from(readingAttempts)
      .innerJoin(books, eq(books.id, readingAttempts.bookId))
      .where(
        and(
          eq(readingAttempts.userId, userId),
          eq(readingAttempts.outcome, 'completed'),
          isNotNull(readingAttempts.endedOn),
          isNull(readingAttempts.deletedAt),
          gte(readingAttempts.endedOn, since),
          libraryFilter,
        ),
      )
      .groupBy(yearExpr, monthExpr)
      .orderBy(yearExpr, monthExpr);
  }

  async getMonthlyCompletions(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 365): Promise<UserCompletionTimelinePoint[]> {
    return this.getCompletionTimeline(userId, isSuperuser, filterLibraryIds, days);
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
        bookId: readingSessions.bookId,
        maxPercentage: sql<number>`max(${readingSessions.endProgress})`.as('max_percentage'),
      })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), timeFilter, libraryFilter, isNotNull(readingSessions.endProgress)))
      .groupBy(readingSessions.bookId)
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
    const since = this.formatDayKey(this.sinceDateForDays(days));

    const rows = await this.db
      .select({
        days: sql<number | string>`${readingAttempts.endedOn} - ${readingAttempts.startedOn}`,
      })
      .from(readingAttempts)
      .innerJoin(books, eq(books.id, readingAttempts.bookId))
      .where(
        and(
          eq(readingAttempts.userId, userId),
          eq(readingAttempts.outcome, 'completed'),
          isNotNull(readingAttempts.startedOn),
          isNotNull(readingAttempts.endedOn),
          isNull(readingAttempts.deletedAt),
          gte(readingAttempts.endedOn, since),
          sql`${readingAttempts.endedOn} >= ${readingAttempts.startedOn}`,
          libraryFilter,
        ),
      );

    return rows
      .map((row) => (typeof row.days === 'number' ? row.days : Number.parseFloat(String(row.days))))
      .filter((daysValue) => Number.isFinite(daysValue) && daysValue >= 0);
  }

  async getGenreReadingTime(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds?: number[],
    days = 365,
  ): Promise<{ genre: string; source: ReadingSessionSource | null; readingSeconds: number }[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    // Grouped by source so the genre treemap can show a per-source tooltip breakdown;
    // the top-N limit and ordering are applied in the service after folding by genre.
    return this.db
      .select({
        genre: genres.name,
        source: readingSessions.source,
        readingSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}), 0)::int`,
      })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .innerJoin(bookGenres, eq(bookGenres.bookId, books.id))
      .innerJoin(genres, eq(genres.id, bookGenres.genreId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), libraryFilter))
      .groupBy(genres.name, readingSessions.source);
  }

  async getDailyReadingSecondsBySource(
    userId: number,
    isSuperuser: boolean,
    filterLibraryIds: number[] | undefined,
    days: number,
  ): Promise<{ day: string; source: ReadingSessionSource | null; readingSeconds: number }[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);
    const dayExpr = sql<string>`date_trunc('day', ${readingSessions.startedAt})::date::text`;

    return this.db
      .select({
        day: dayExpr,
        source: readingSessions.source,
        readingSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}), 0)::int`,
      })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), libraryFilter))
      .groupBy(dayExpr, readingSessions.source);
  }

  async getReadingPacePoints(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 1825): Promise<UserReadingPacePoint[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    const rows = await this.db
      .select({
        durationSeconds: readingSessions.durationSeconds,
        progressDelta: readingSessions.progressDelta,
        source: readingSessions.source,
        format: sql<string>`upper(coalesce(${bookFiles.format}, 'UNKNOWN'))`,
      })
      .from(readingSessions)
      .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(books, eq(books.id, readingSessions.bookId))
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

    return rows.map((r) => ({
      durationSeconds: r.durationSeconds,
      progressDelta: r.progressDelta!,
      bucket: toReadingSessionSourceBucket(r.source),
      format: r.format,
    }));
  }

  async getReadingSurvivalMaxProgress(userId: number, isSuperuser: boolean, filterLibraryIds?: number[], days = 1825): Promise<number[]> {
    const accessible = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const libraryFilter = this.libraryFilter(this.intersectLibraryIds(accessible, filterLibraryIds));
    const since = this.sinceDateForDays(days);

    const perBook = this.db
      .select({
        bookId: readingSessions.bookId,
        maxProgress: sql<number>`max(${readingSessions.endProgress})`.as('max_progress'),
      })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), isNotNull(readingSessions.endProgress), libraryFilter))
      .groupBy(readingSessions.bookId)
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
      .select({ bookId: readingSessions.bookId })
      .from(readingSessions)
      .innerJoin(books, eq(books.id, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since), isNotNull(readingSessions.endProgress), libraryFilter))
      .groupBy(readingSessions.bookId)
      .orderBy(sql`count(*) desc`)
      .limit(limit)
      .then((rows) => rows.map((r) => r.bookId));

    if (!topBookIds.length) return [];

    return this.db
      .select({
        bookId: readingSessions.bookId,
        title: bookMetadata.title,
        startedAt: readingSessions.startedAt,
        endProgress: readingSessions.endProgress,
      })
      .from(readingSessions)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, readingSessions.bookId))
      .where(and(eq(readingSessions.userId, userId), inArray(readingSessions.bookId, topBookIds), isNotNull(readingSessions.endProgress)))
      .orderBy(readingSessions.bookId, readingSessions.startedAt)
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
      .innerJoin(books, eq(books.id, readingSessions.bookId))
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
        inner join books b on b.id = rs.book_id
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
        inner join books b on b.id = rs.book_id
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
      inner join books b on b.id = rs.book_id
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
    const broadSince = new Date(Date.parse(`${sinceDay}T00:00:00.000Z`) - 14 * 60 * 60 * 1000);

    return this.db.transaction(async (tx) => {
      const existingGroups = await tx
        .select({
          userId: userReadingDailyStats.userId,
          libraryId: userReadingDailyStats.libraryId,
          settings: users.settings,
        })
        .from(userReadingDailyStats)
        .innerJoin(users, eq(users.id, userReadingDailyStats.userId))
        .where(gte(userReadingDailyStats.day, sinceDay))
        .groupBy(userReadingDailyStats.userId, userReadingDailyStats.libraryId, users.settings);

      const sessionGroups = await tx
        .select({
          userId: readingSessions.userId,
          libraryId: books.libraryId,
          settings: users.settings,
        })
        .from(readingSessions)
        .innerJoin(books, eq(books.id, readingSessions.bookId))
        .innerJoin(users, eq(users.id, readingSessions.userId))
        .where(gt(readingSessions.endedAt, broadSince))
        .groupBy(readingSessions.userId, books.libraryId, users.settings);

      const groups = new Map<string, { userId: number; libraryId: number; settings: unknown }>();
      for (const group of [...existingGroups, ...sessionGroups]) {
        groups.set(`${group.userId}:${group.libraryId}`, group);
      }

      // Sorted so this pass and a concurrent per-user rebuild take the shared advisory locks in
      // one order. Map insertion order follows the query results, which can invert against the
      // rebuild's ascending order and deadlock a user holding more than one library.
      const orderedGroups = [...groups.values()].sort((a, b) => a.userId - b.userId || a.libraryId - b.libraryId);

      let deleted = 0;
      let inserted = 0;

      for (const group of orderedGroups) {
        await this.lockDailyStats(tx, group.userId, group.libraryId);

        const deleteResult = await tx.execute(sql`
          delete from user_reading_daily_stats
          where user_id = ${group.userId}
            and library_id = ${group.libraryId}
            and day >= ${sinceDay}::date
        `);
        deleted += Number((deleteResult as { rowCount?: number }).rowCount ?? 0);

        const timeZone = resolveTimeZone((group.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
        const range = getDayRangeForDateKeys([sinceDay], timeZone);
        if (!range) continue;

        const rows = await tx
          .select({
            startedAt: readingSessions.startedAt,
            endedAt: readingSessions.endedAt,
            durationSeconds: readingSessions.durationSeconds,
            progressDelta: readingSessions.progressDelta,
          })
          .from(readingSessions)
          .innerJoin(books, eq(books.id, readingSessions.bookId))
          .where(and(eq(readingSessions.userId, group.userId), eq(books.libraryId, group.libraryId), gt(readingSessions.endedAt, range.start)));

        const segments = aggregateReadingSessionDailyStats(
          rows.map((row) => ({
            startedAt: row.startedAt,
            endedAt: row.endedAt,
            durationSeconds: row.durationSeconds,
            progressDelta: row.progressDelta ?? null,
          })),
          timeZone,
        ).filter((segment) => segment.day >= sinceDay);

        await this.insertDailyStatsSegments(tx, group.userId, group.libraryId, segments);
        inserted += segments.length;
      }

      return { deleted, inserted, since: sinceDay };
    });
  }

  /** Everyone who has reading history to rebuild. */
  async listUserIdsWithReadingHistory(): Promise<number[]> {
    const [sessionUsers, statsUsers] = await Promise.all([
      this.db.selectDistinct({ userId: readingSessions.userId }).from(readingSessions),
      this.db.selectDistinct({ userId: userReadingDailyStats.userId }).from(userReadingDailyStats),
    ]);

    return [...new Set([...sessionUsers, ...statsUsers].map((row) => row.userId))].sort((a, b) => a - b);
  }

  /**
   * The timezone one user's history should be rebuilt under, read at the moment of rebuilding.
   *
   * Deliberately not carried along from a listing taken earlier. A user who corrects their
   * timezone while a bulk rebuild is walking the roster would otherwise have their own correct
   * rebuild overwritten by the stale value that listing captured.
   */
  async getUserTimeZone(userId: number): Promise<string | null> {
    const [row] = await this.db.select({ settings: users.settings }).from(users).where(eq(users.id, userId)).limit(1);
    if (!row) return null;
    return resolveTimeZone((row.settings as { timezone?: unknown } | null)?.timezone, 'UTC');
  }

  /**
   * Rebuilds every daily-stat row one user owns, under a single timezone.
   *
   * The rolling recompute above is enough while a timezone holds still, because it only ever
   * revisits days that are still being written to. A user who corrects theirs invalidates all
   * of their history at once: rows are keyed by local day, so every day boundary moves, and a
   * streak broken by the old zone stays broken until the rows that built it are rebuilt.
   *
   * Sessions are paged rather than read whole. The day map is bounded by how long the user has
   * been reading; their session list is not.
   */
  async rebuildDailyStatsForUser(userId: number, timeZone: string): Promise<{ deleted: number; inserted: number; libraries: number }> {
    const resolvedTimeZone = resolveTimeZone(timeZone, 'UTC');

    return this.db.transaction(async (tx) => {
      const [statLibraries, sessionLibraries] = await Promise.all([
        tx.selectDistinct({ libraryId: userReadingDailyStats.libraryId }).from(userReadingDailyStats).where(eq(userReadingDailyStats.userId, userId)),
        tx
          .selectDistinct({ libraryId: books.libraryId })
          .from(readingSessions)
          .innerJoin(books, eq(books.id, readingSessions.bookId))
          .where(eq(readingSessions.userId, userId)),
      ]);

      // Libraries the user no longer has sessions in still hold rows, and dropping them is the
      // point of a rebuild. Sorted so concurrent writers take the per-library locks in one order.
      const libraryIds = [...new Set([...statLibraries, ...sessionLibraries].map((row) => row.libraryId))].sort((a, b) => a - b);

      let deleted = 0;
      let inserted = 0;

      for (const libraryId of libraryIds) {
        await this.lockDailyStats(tx, userId, libraryId);

        const deleteResult = await tx.execute(sql`
          delete from user_reading_daily_stats
          where user_id = ${userId}
            and library_id = ${libraryId}
        `);
        deleted += Number((deleteResult as { rowCount?: number }).rowCount ?? 0);

        const byDay = new Map<string, ReadingDailyStatsSegment>();
        let cursor = 0;
        for (;;) {
          const rows = await tx
            .select({
              id: readingSessions.id,
              startedAt: readingSessions.startedAt,
              endedAt: readingSessions.endedAt,
              durationSeconds: readingSessions.durationSeconds,
              progressDelta: readingSessions.progressDelta,
            })
            .from(readingSessions)
            .innerJoin(books, eq(books.id, readingSessions.bookId))
            .where(and(eq(readingSessions.userId, userId), eq(books.libraryId, libraryId), gt(readingSessions.id, cursor)))
            .orderBy(readingSessions.id)
            .limit(DAILY_STATS_REBUILD_PAGE_SIZE);

          if (rows.length === 0) break;
          cursor = rows[rows.length - 1]!.id;

          mergeReadingDailyStatsSegments(
            byDay,
            aggregateReadingSessionDailyStats(
              rows.map((row) => ({
                startedAt: row.startedAt,
                endedAt: row.endedAt,
                durationSeconds: row.durationSeconds,
                progressDelta: row.progressDelta ?? null,
              })),
              resolvedTimeZone,
            ),
          );

          if (rows.length < DAILY_STATS_REBUILD_PAGE_SIZE) break;
        }

        const segments = sortReadingDailyStatsSegments(byDay);
        for (let offset = 0; offset < segments.length; offset += DAILY_STATS_INSERT_CHUNK_SIZE) {
          await this.insertDailyStatsSegments(tx, userId, libraryId, segments.slice(offset, offset + DAILY_STATS_INSERT_CHUNK_SIZE));
        }
        inserted += segments.length;
      }

      return { deleted, inserted, libraries: libraryIds.length };
    });
  }
}
