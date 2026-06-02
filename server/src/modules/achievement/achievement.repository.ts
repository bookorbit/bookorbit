import { Inject, Injectable } from '@nestjs/common';
import { and, count, countDistinct, desc, eq, gt, gte, isNotNull, lt, ne, notInArray, sql, sum } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  achievements,
  userAchievements,
  userBookStatus,
  readingSessions,
  annotations,
  collections,
  collectionBooks,
  books,
  bookFiles,
  bookMetadata,
  bookGenres,
  bookAuthors,
  userReadingDailyStats,
  userLibraryAccess,
  users,
} from '../../db/schema';
import type { AchievementRow, NewAchievement, UserAchievementRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class AchievementRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async upsertCatalogue(seed: NewAchievement[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (seed.length > 0) {
        await tx
          .insert(achievements)
          .values(seed)
          .onConflictDoUpdate({
            target: achievements.key,
            set: {
              groupKey: sql`excluded.group_key`,
              tier: sql`excluded.tier`,
              category: sql`excluded.category`,
              name: sql`excluded.name`,
              description: sql`excluded.description`,
              iconName: sql`excluded.icon_name`,
              rarity: sql`excluded.rarity`,
              threshold: sql`excluded.threshold`,
              hidden: sql`excluded.hidden`,
              sortOrder: sql`excluded.sort_order`,
            },
          });
        await tx.delete(achievements).where(
          notInArray(
            achievements.key,
            seed.map((row) => row.key),
          ),
        );
      } else {
        await tx.delete(achievements);
      }
    });
  }

  async findAchievementByKey(key: string): Promise<AchievementRow | null> {
    const [row] = await this.db.select().from(achievements).where(eq(achievements.key, key)).limit(1);
    return row ?? null;
  }

  async findAllAchievements(): Promise<AchievementRow[]> {
    return this.db.select().from(achievements).orderBy(achievements.category, achievements.sortOrder);
  }

  async findUserAchievements(userId: number): Promise<UserAchievementRow[]> {
    return this.db.select().from(userAchievements).where(eq(userAchievements.userId, userId)).orderBy(desc(userAchievements.awardedAt));
  }

  async findUserEarnedKeys(userId: number): Promise<Set<string>> {
    const rows = await this.db
      .select({ achievementKey: userAchievements.achievementKey })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId));
    return new Set(rows.map((r) => r.achievementKey));
  }

  async hasAchievement(userId: number, key: string): Promise<boolean> {
    const [row] = await this.db
      .select({ key: userAchievements.achievementKey })
      .from(userAchievements)
      .where(and(eq(userAchievements.userId, userId), eq(userAchievements.achievementKey, key)))
      .limit(1);
    return !!row;
  }

  async award(userId: number, key: string, context: Record<string, unknown> | null): Promise<UserAchievementRow | null> {
    const [row] = await this.db
      .insert(userAchievements)
      .values({ userId, achievementKey: key, contextJson: context })
      .onConflictDoNothing({ target: [userAchievements.userId, userAchievements.achievementKey] })
      .returning();
    return row ?? null;
  }

  async findUserIsSuperuser(userId: number): Promise<boolean> {
    const [row] = await this.db.select({ isSuperuser: users.isSuperuser }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.isSuperuser ?? false;
  }

  async countFinishedBooks(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(userBookStatus)
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read')));
    return value;
  }

  async sumPagesRead(userId: number): Promise<number> {
    const [result] = await this.db
      .select({
        value: sql<number>`coalesce(sum(${bookMetadata.pageCount} * least(greatest(coalesce(${readingSessions.progressDelta}, 0), 0), 100) / 100.0), 0)::float`,
      })
      .from(readingSessions)
      .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, bookFiles.bookId))
      .where(
        and(
          eq(readingSessions.userId, userId),
          isNotNull(bookMetadata.pageCount),
          gt(bookMetadata.pageCount, 0),
          isNotNull(readingSessions.progressDelta),
          gt(readingSessions.progressDelta, 0),
          sql`${readingSessions.progressDelta} <= 100`,
          gt(readingSessions.durationSeconds, 0),
        ),
      );
    return Math.floor(Number(result?.value ?? 0));
  }

  async sumReadingHours(userId: number): Promise<number> {
    const [result] = await this.db
      .select({ value: sum(readingSessions.durationSeconds) })
      .from(readingSessions)
      .where(eq(readingSessions.userId, userId));
    return Math.floor(Number(result?.value ?? 0) / 3600);
  }

  async countAnnotations(userId: number): Promise<number> {
    const [{ value }] = await this.db.select({ value: count() }).from(annotations).where(eq(annotations.userId, userId));
    return value;
  }

  async countAccessibleBooks(userId: number, isSuperuser: boolean): Promise<number> {
    if (isSuperuser) {
      const [{ value }] = await this.db.select({ value: count() }).from(books).where(eq(books.status, 'present'));
      return value;
    }
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(books)
      .innerJoin(userLibraryAccess, eq(books.libraryId, userLibraryAccess.libraryId))
      .where(and(eq(userLibraryAccess.userId, userId), eq(books.status, 'present')));
    return value;
  }

  async countDistinctFormats(userId: number, isSuperuser: boolean): Promise<number> {
    if (isSuperuser) {
      const [{ value }] = await this.db
        .select({ value: countDistinct(bookFiles.format) })
        .from(bookFiles)
        .where(isNotNull(bookFiles.format));
      return value;
    }
    const [{ value }] = await this.db
      .select({ value: countDistinct(bookFiles.format) })
      .from(bookFiles)
      .innerJoin(books, eq(bookFiles.bookId, books.id))
      .innerJoin(userLibraryAccess, eq(books.libraryId, userLibraryAccess.libraryId))
      .where(and(eq(userLibraryAccess.userId, userId), isNotNull(bookFiles.format)));
    return value;
  }

  async countCollections(userId: number): Promise<number> {
    const [{ value }] = await this.db.select({ value: count() }).from(collections).where(eq(collections.userId, userId));
    return value;
  }

  async countDistinctGenresRead(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: countDistinct(bookGenres.genreId) })
      .from(userBookStatus)
      .innerJoin(bookGenres, eq(userBookStatus.bookId, bookGenres.bookId))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read')));
    return value;
  }

  async countDistinctLanguagesRead(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: countDistinct(bookMetadata.language) })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), isNotNull(bookMetadata.language)));
    return value;
  }

  async countDistinctCenturiesRead(userId: number): Promise<number> {
    const rows = await this.db
      .select({ century: sql<number>`floor(${bookMetadata.publishedYear} / 100)` })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), isNotNull(bookMetadata.publishedYear)))
      .groupBy(sql`floor(${bookMetadata.publishedYear} / 100)`);
    return rows.length;
  }

  async hasCompletedSeries(userId: number): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1 FROM (
	        SELECT bm.series_id,
          COUNT(DISTINCT bm.book_id) AS total_in_series,
          COUNT(DISTINCT ubs.book_id) AS read_count
        FROM book_metadata bm
        LEFT JOIN user_book_status ubs
          ON ubs.book_id = bm.book_id AND ubs.user_id = ${userId} AND ubs.status = 'read'
	        WHERE bm.series_id IS NOT NULL
	        GROUP BY bm.series_id
        HAVING COUNT(DISTINCT bm.book_id) >= 2
          AND COUNT(DISTINCT bm.book_id) = COUNT(DISTINCT ubs.book_id)
      ) complete_series
      LIMIT 1
    `);
    return (result as unknown as { rows: unknown[] }).rows.length > 0;
  }

  async maxBooksPerAuthor(userId: number): Promise<number> {
    const rows = await this.db
      .select({ cnt: count() })
      .from(userBookStatus)
      .innerJoin(bookAuthors, eq(userBookStatus.bookId, bookAuthors.bookId))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read')))
      .groupBy(bookAuthors.authorId)
      .orderBy(desc(count()))
      .limit(1);
    return rows.length > 0 ? rows[0].cnt : 0;
  }

  async getBookPageCount(bookId: number): Promise<number | null> {
    const [row] = await this.db.select({ pageCount: bookMetadata.pageCount }).from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).limit(1);
    return row?.pageCount ?? null;
  }

  async getBookPublishedYear(bookId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ publishedYear: bookMetadata.publishedYear })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);
    return row?.publishedYear ?? null;
  }

  async getBookTitle(bookId: number): Promise<string | null> {
    const [row] = await this.db.select({ title: bookMetadata.title }).from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).limit(1);
    return row?.title ?? null;
  }

  async getCurrentStreak(userId: number): Promise<number> {
    // Count consecutive days with reading activity ending at today or yesterday
    const result = await this.db.execute(sql`
      WITH daily AS (
        SELECT DISTINCT day::date as d
        FROM user_reading_daily_stats
        WHERE user_id = ${userId} AND sessions_count > 0
      ),
      streak AS (
        SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp
        FROM daily
      )
      SELECT COUNT(*) as streak_length
      FROM streak
      WHERE grp = (
        SELECT grp FROM streak WHERE d >= CURRENT_DATE - INTERVAL '1 day' ORDER BY d DESC LIMIT 1
      )
    `);
    const rows = (result as unknown as { rows: Array<{ streak_length: string }> }).rows;
    return rows.length > 0 ? Number(rows[0].streak_length) : 0;
  }

  async countDistinctMonthsWithReading(userId: number, year: number): Promise<number> {
    const rows = await this.db
      .select({ month: sql<string>`EXTRACT(MONTH FROM day::date)` })
      .from(userReadingDailyStats)
      .where(
        and(
          eq(userReadingDailyStats.userId, userId),
          gt(userReadingDailyStats.sessionsCount, 0),
          sql`EXTRACT(YEAR FROM ${userReadingDailyStats.day}::date) = ${year}`,
        ),
      )
      .groupBy(sql`EXTRACT(MONTH FROM day::date)`);
    return rows.length;
  }

  async wasBookAbandonedBefore(userId: number, bookId: number, monthsAgo: number): Promise<boolean> {
    const [row] = await this.db
      .select({ startedAt: userBookStatus.startedAt, finishedAt: userBookStatus.finishedAt })
      .from(userBookStatus)
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.bookId, bookId)))
      .limit(1);
    if (!row?.startedAt || !row?.finishedAt) return false;
    const diffMs = row.finishedAt.getTime() - row.startedAt.getTime();
    const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30);
    return diffMonths >= monthsAgo;
  }

  async countBooksFinishedInDateRange(userId: number, start: Date, end: Date): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(userBookStatus)
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          gte(userBookStatus.finishedAt, start),
          lt(userBookStatus.finishedAt, end),
        ),
      );
    return value;
  }

  async wasBookStartedAndFinishedOnSameDay(userId: number, bookId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ startedAt: userBookStatus.startedAt, finishedAt: userBookStatus.finishedAt })
      .from(userBookStatus)
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.bookId, bookId)))
      .limit(1);
    if (!row?.startedAt || !row?.finishedAt) return false;
    return row.startedAt.toDateString() === row.finishedAt.toDateString();
  }

  async sumWeekendReadingHours(userId: number, saturdayDate: string): Promise<number> {
    const saturday = new Date(saturdayDate);
    const monday = new Date(saturday);
    monday.setDate(monday.getDate() + 2);

    const [result] = await this.db
      .select({ value: sum(userReadingDailyStats.readingSeconds) })
      .from(userReadingDailyStats)
      .where(
        and(
          eq(userReadingDailyStats.userId, userId),
          gte(sql`${userReadingDailyStats.day}::date`, sql`${saturdayDate}::date`),
          lt(sql`${userReadingDailyStats.day}::date`, sql`${monday.toISOString().split('T')[0]}::date`),
        ),
      );
    return Math.floor(Number(result?.value ?? 0) / 3600);
  }

  async getBookIdForFile(fileId: number): Promise<number | null> {
    const [row] = await this.db.select({ bookId: bookFiles.bookId }).from(bookFiles).where(eq(bookFiles.id, fileId)).limit(1);
    return row?.bookId ?? null;
  }

  async getPreviousSessionEndedAt(userId: number, currentSessionId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ endedAt: readingSessions.endedAt })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), sql`${readingSessions.sessionId} != ${currentSessionId}`))
      .orderBy(desc(readingSessions.endedAt))
      .limit(1);
    return row?.endedAt ?? null;
  }

  async findAllUserIds(): Promise<number[]> {
    const rows = await this.db.execute<{ id: number }>(sql`SELECT id FROM users WHERE active = true ORDER BY id`);
    return (rows as unknown as { rows: Array<{ id: number }> }).rows.map((r) => r.id);
  }

  async hasSessionLongerThan(userId: number, minSeconds: number): Promise<boolean> {
    const [row] = await this.db
      .select({ sessionId: readingSessions.sessionId })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.durationSeconds, minSeconds)))
      .limit(1);
    return !!row;
  }

  async hasSessionInHourRange(userId: number, startHour: number, endHour: number): Promise<boolean> {
    const [row] = await this.db
      .select({ sessionId: readingSessions.sessionId })
      .from(readingSessions)
      .where(
        and(
          eq(readingSessions.userId, userId),
          sql`(
            EXTRACT(HOUR FROM ${readingSessions.startedAt}) >= ${startHour} AND EXTRACT(HOUR FROM ${readingSessions.startedAt}) < ${endHour}
            OR EXTRACT(HOUR FROM ${readingSessions.endedAt}) >= ${startHour} AND EXTRACT(HOUR FROM ${readingSessions.endedAt}) < ${endHour}
            OR EXTRACT(HOUR FROM ${readingSessions.startedAt}) < ${startHour} AND EXTRACT(HOUR FROM ${readingSessions.endedAt}) >= ${endHour}
          )`,
        ),
      )
      .limit(1);
    return !!row;
  }

  async hasSessionStartingInHourRange(userId: number, startHour: number, endHour: number): Promise<boolean> {
    const [row] = await this.db
      .select({ sessionId: readingSessions.sessionId })
      .from(readingSessions)
      .where(
        and(
          eq(readingSessions.userId, userId),
          sql`EXTRACT(HOUR FROM ${readingSessions.startedAt}) >= ${startHour} AND EXTRACT(HOUR FROM ${readingSessions.startedAt}) < ${endHour}`,
        ),
      )
      .limit(1);
    return !!row;
  }

  async getMaxFinishedBookPageCount(userId: number): Promise<number> {
    const [result] = await this.db
      .select({ value: sql<number>`coalesce(max(${bookMetadata.pageCount}), 0)::int` })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), isNotNull(bookMetadata.pageCount)));
    return Number(result?.value ?? 0);
  }

  async hasFinishedBookWithMinPages(userId: number, minPages: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(bookMetadata.pageCount),
          gte(bookMetadata.pageCount, minPages),
        ),
      )
      .limit(1);
    return !!row;
  }

  async hasAnyBookStartedAndFinishedOnSameDay(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(userBookStatus.startedAt),
          isNotNull(userBookStatus.finishedAt),
          sql`${userBookStatus.startedAt}::date = ${userBookStatus.finishedAt}::date`,
        ),
      )
      .limit(1);
    return !!row;
  }

  async hasFinishedBookPublishedBefore(userId: number, year: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(bookMetadata.publishedYear),
          lt(bookMetadata.publishedYear, year),
        ),
      )
      .limit(1);
    return !!row;
  }

  async hasFinishedBookPublishedInYear(userId: number, year: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), eq(bookMetadata.publishedYear, year)))
      .limit(1);
    return !!row;
  }

  async hasAnyBookRebornFromAbandoned(userId: number, monthsAgo: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(userBookStatus.startedAt),
          isNotNull(userBookStatus.finishedAt),
          sql`EXTRACT(EPOCH FROM (${userBookStatus.finishedAt} - ${userBookStatus.startedAt})) / 2592000 >= ${monthsAgo}`,
        ),
      )
      .limit(1);
    return !!row;
  }

  async hasLargeGapBetweenAnySessions(userId: number, minDays: number): Promise<boolean> {
    const result = await this.db.execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM (
          SELECT
            ended_at,
            LEAD(started_at) OVER (ORDER BY started_at) AS next_start
          FROM reading_sessions
          WHERE user_id = ${userId}
        ) gaps
        WHERE next_start IS NOT NULL
          AND EXTRACT(EPOCH FROM (next_start - ended_at)) / 86400 >= ${minDays}
      ) AS found
    `);
    return (result as unknown as { rows: Array<{ found: boolean }> }).rows[0]?.found ?? false;
  }

  async hasSessionOnJanFirst(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ sessionId: readingSessions.sessionId })
      .from(readingSessions)
      .where(
        and(
          eq(readingSessions.userId, userId),
          sql`EXTRACT(MONTH FROM ${readingSessions.startedAt}) = 1`,
          sql`EXTRACT(DAY FROM ${readingSessions.startedAt}) = 1`,
        ),
      )
      .limit(1);
    return !!row;
  }

  async getMaxSessionMinutes(userId: number): Promise<number> {
    const [result] = await this.db
      .select({ value: sql<number>`coalesce(max(${readingSessions.durationSeconds}) / 60.0, 0)::float` })
      .from(readingSessions)
      .where(eq(readingSessions.userId, userId));
    return Math.floor(Number(result?.value ?? 0));
  }

  async hasWeekendMarathon(userId: number, minHours: number): Promise<boolean> {
    const minSeconds = minHours * 3600;
    const result = await this.db.execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM user_reading_daily_stats
        WHERE user_id = ${userId}
          AND EXTRACT(DOW FROM day::date) IN (0, 6)
          AND reading_seconds >= ${minSeconds}
      ) AS found
    `);
    return (result as unknown as { rows: Array<{ found: boolean }> }).rows[0]?.found ?? false;
  }

  async countBooksFinishedInYear(userId: number, year: number): Promise<number> {
    const start = new Date(`${year}-01-01T00:00:00.000Z`);
    const end = new Date(`${year + 1}-01-01T00:00:00.000Z`);
    return this.countBooksFinishedInDateRange(userId, start, end);
  }

  async countBooksFinishedInMonth(userId: number, year: number, month: number): Promise<number> {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return this.countBooksFinishedInDateRange(userId, start, end);
  }

  async hasCompletedSeriesOfSize(userId: number, size: number): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1 FROM (
	        SELECT bm.series_id,
          COUNT(DISTINCT bm.book_id) AS total_in_series,
          COUNT(DISTINCT ubs.book_id) AS read_count
        FROM book_metadata bm
        LEFT JOIN user_book_status ubs
          ON ubs.book_id = bm.book_id AND ubs.user_id = ${userId} AND ubs.status = 'read'
	        WHERE bm.series_id IS NOT NULL
	        GROUP BY bm.series_id
        HAVING COUNT(DISTINCT bm.book_id) = ${size}
          AND COUNT(DISTINCT bm.book_id) = COUNT(DISTINCT ubs.book_id)
      ) complete_series
      LIMIT 1
    `);
    return (result as unknown as { rows: unknown[] }).rows.length > 0;
  }

  async countDistinctDecadesRead(userId: number): Promise<number> {
    const rows = await this.db
      .select({ decade: sql<number>`floor(${bookMetadata.publishedYear} / 10)` })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), isNotNull(bookMetadata.publishedYear)))
      .groupBy(sql`floor(${bookMetadata.publishedYear} / 10)`);
    return rows.length;
  }

  async countFinishedBooksByMaxPageCount(userId: number, maxPages: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(bookMetadata.pageCount),
          lt(bookMetadata.pageCount, maxPages),
        ),
      );
    return value;
  }

  async hasFinishedBookUnderPages(userId: number, maxPages: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(bookMetadata.pageCount),
          lt(bookMetadata.pageCount, maxPages),
        ),
      )
      .limit(1);
    return !!row;
  }

  async hasFinishedBookOverPages(userId: number, minPages: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(bookMetadata.pageCount),
          gt(bookMetadata.pageCount, minPages),
        ),
      )
      .limit(1);
    return !!row;
  }

  async maxBooksPerGenre(userId: number): Promise<number> {
    const rows = await this.db
      .select({ cnt: count() })
      .from(userBookStatus)
      .innerJoin(bookGenres, eq(userBookStatus.bookId, bookGenres.bookId))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read')))
      .groupBy(bookGenres.genreId)
      .orderBy(desc(count()))
      .limit(1);
    return rows.length > 0 ? rows[0].cnt : 0;
  }

  async countAnnotationsOnDay(userId: number, date: Date): Promise<number> {
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(annotations)
      .where(and(eq(annotations.userId, userId), gte(annotations.createdAt, dayStart), lt(annotations.createdAt, dayEnd)));
    return value;
  }

  async countAnnotationsWithNotes(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(annotations)
      .where(and(eq(annotations.userId, userId), isNotNull(annotations.note), ne(annotations.note, '')));
    return value;
  }

  async countCollectionBookLinks(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(collectionBooks)
      .innerJoin(collections, eq(collectionBooks.collectionId, collections.id))
      .where(eq(collections.userId, userId));
    return value;
  }

  async getBookSeriesName(bookId: number): Promise<string | null> {
    const [row] = await this.db.select({ seriesName: bookMetadata.seriesName }).from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).limit(1);
    return row?.seriesName ?? null;
  }

  async countDistinctFinishedAnnotatedBooks(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: countDistinct(userBookStatus.bookId) })
      .from(userBookStatus)
      .innerJoin(annotations, and(eq(annotations.bookId, userBookStatus.bookId), eq(annotations.userId, userId)))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read')));
    return value;
  }

  async countDistinctFinishedBooksInCollections(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: countDistinct(userBookStatus.bookId) })
      .from(userBookStatus)
      .innerJoin(collectionBooks, eq(collectionBooks.bookId, userBookStatus.bookId))
      .innerJoin(collections, and(eq(collections.id, collectionBooks.collectionId), eq(collections.userId, userId)))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read')));
    return value;
  }

  async countDistinctEarnedCategories(userId: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: countDistinct(achievements.category) })
      .from(userAchievements)
      .innerJoin(achievements, eq(achievements.key, userAchievements.achievementKey))
      .where(eq(userAchievements.userId, userId));
    return value;
  }

  async hasConsecutiveWeekendsWithReading(userId: number, weeks: number): Promise<boolean> {
    const result = await this.db.execute<{ found: boolean }>(sql`
      WITH weekend_weeks AS (
        SELECT DISTINCT
          TO_CHAR(day::date, 'IYYY-IW') AS iso_week
        FROM user_reading_daily_stats
        WHERE user_id = ${userId}
          AND reading_seconds > 0
          AND EXTRACT(DOW FROM day::date) IN (0, 6)
      ),
      ordered AS (
        SELECT iso_week,
          iso_week::text AS yw,
          ROW_NUMBER() OVER (ORDER BY iso_week) AS rn
        FROM weekend_weeks
      ),
      grouped AS (
        SELECT iso_week,
          rn - ROW_NUMBER() OVER (ORDER BY iso_week) AS grp
        FROM ordered
      ),
      runs AS (
        SELECT COUNT(*) AS run_length FROM grouped GROUP BY grp
      )
      SELECT EXISTS (SELECT 1 FROM runs WHERE run_length >= ${weeks}) AS found
    `);
    return (result as unknown as { rows: Array<{ found: boolean }> }).rows[0]?.found ?? false;
  }

  async countDistinctSeasonsWithReading(userId: number, year: number): Promise<number> {
    const result = await this.db.execute<{ season: number }>(sql`
      SELECT DISTINCT
        CASE
          WHEN EXTRACT(MONTH FROM day::date) IN (12, 1, 2) THEN 1
          WHEN EXTRACT(MONTH FROM day::date) IN (3, 4, 5)  THEN 2
          WHEN EXTRACT(MONTH FROM day::date) IN (6, 7, 8)  THEN 3
          ELSE 4
        END AS season
      FROM user_reading_daily_stats
      WHERE user_id = ${userId}
        AND reading_seconds > 0
        AND EXTRACT(YEAR FROM day::date) = ${year}
    `);
    return (result as unknown as { rows: unknown[] }).rows.length;
  }

  async hasReadEveryDayInAnyMonth(userId: number): Promise<boolean> {
    const result = await this.db.execute<{ found: boolean }>(sql`
      WITH daily AS (
        SELECT
          DATE_TRUNC('month', day::date) AS month_start,
          COUNT(DISTINCT day::date) AS days_read,
          EXTRACT(DAY FROM (DATE_TRUNC('month', day::date) + INTERVAL '1 month' - INTERVAL '1 day'))::int AS days_in_month
        FROM user_reading_daily_stats
        WHERE user_id = ${userId} AND reading_seconds > 0
        GROUP BY DATE_TRUNC('month', day::date)
      )
      SELECT EXISTS (
        SELECT 1 FROM daily WHERE days_read = days_in_month
      ) AS found
    `);
    return (result as unknown as { rows: Array<{ found: boolean }> }).rows[0]?.found ?? false;
  }

  async hasConsecutiveDaysWithMinReading(userId: number, days: number, minSeconds: number): Promise<boolean> {
    const result = await this.db.execute<{ found: boolean }>(sql`
      WITH qualifying AS (
        SELECT DISTINCT day::date AS d
        FROM user_reading_daily_stats
        WHERE user_id = ${userId} AND reading_seconds >= ${minSeconds}
      ),
      streaks AS (
        SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp
        FROM qualifying
      ),
      runs AS (
        SELECT COUNT(*) AS run_length FROM streaks GROUP BY grp
      )
      SELECT EXISTS (SELECT 1 FROM runs WHERE run_length >= ${days}) AS found
    `);
    return (result as unknown as { rows: Array<{ found: boolean }> }).rows[0]?.found ?? false;
  }

  async countSessionsLongerThan(userId: number, minSeconds: number): Promise<number> {
    const [{ value }] = await this.db
      .select({ value: count() })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.durationSeconds, minSeconds)));
    return value;
  }

  async getBookStartedAndFinishedAt(userId: number, bookId: number): Promise<{ startedAt: Date | null; finishedAt: Date | null } | null> {
    const [row] = await this.db
      .select({ startedAt: userBookStatus.startedAt, finishedAt: userBookStatus.finishedAt })
      .from(userBookStatus)
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.bookId, bookId)))
      .limit(1);
    return row ?? null;
  }

  async hasAnySlowBurnBook(userId: number, minDays: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(userBookStatus.startedAt),
          isNotNull(userBookStatus.finishedAt),
          sql`EXTRACT(EPOCH FROM (${userBookStatus.finishedAt} - ${userBookStatus.startedAt})) / 86400 > ${minDays}`,
        ),
      )
      .limit(1);
    return !!row;
  }

  async hasMonthWithBooksFinished(userId: number, minCount: number): Promise<boolean> {
    const result = await this.db.execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM user_book_status
        WHERE user_id = ${userId}
          AND status = 'read'
          AND finished_at IS NOT NULL
        GROUP BY DATE_TRUNC('month', finished_at)
        HAVING COUNT(*) >= ${minCount}
      ) AS found
    `);
    return (result as unknown as { rows: Array<{ found: boolean }> }).rows[0]?.found ?? false;
  }

  async hasSessionWithProgressDeltaAtLeast(userId: number, minDelta: number): Promise<boolean> {
    const [row] = await this.db
      .select({ sessionId: readingSessions.sessionId })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), isNotNull(readingSessions.progressDelta), gte(readingSessions.progressDelta, minDelta)))
      .limit(1);
    return !!row;
  }

  async hasAnyDayWithAnnotationCount(userId: number, minCount: number): Promise<boolean> {
    const result = await this.db.execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM annotations
        WHERE user_id = ${userId}
        GROUP BY DATE_TRUNC('day', created_at)
        HAVING COUNT(*) >= ${minCount}
      ) AS found
    `);
    return (result as unknown as { rows: Array<{ found: boolean }> }).rows[0]?.found ?? false;
  }

  async hasFinishedBookInSeries(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(userBookStatus.bookId, bookMetadata.bookId))
      .where(
        and(
          eq(userBookStatus.userId, userId),
          eq(userBookStatus.status, 'read'),
          isNotNull(bookMetadata.seriesName),
          ne(bookMetadata.seriesName, ''),
        ),
      )
      .limit(1);
    return !!row;
  }
}
