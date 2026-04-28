import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, notInArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type {
  CurrentlyReadingBook,
  CurrentlyReadingWidgetData,
  HighlightOfTheDayWidgetData,
  LibraryOverviewWidgetData,
  LongWaitWidgetData,
  NeglectedGemsWidgetData,
  ReadingStreakWidgetData,
} from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  annotations,
  authors,
  bookAuthors,
  bookFiles,
  bookGenres,
  bookMetadata,
  books,
  genres,
  readingProgress,
  readingSessions,
  userBookStatus,
  userReadingDailyStats,
} from '../../db/schema';
import { computeLongestStreak, computeStreakData, formatDay } from './dashboard-widget.calculations';

type Db = NodePgDatabase<typeof schema>;

const CURRENTLY_READING_LIMIT = 3;
const DEFAULT_VIRTUAL_PAGE_COUNT = 300;

@Injectable()
export class DashboardWidgetRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async getCompletedBooksThisYear(userId: number, accessibleLibraryIds: number[]): Promise<number> {
    if (accessibleLibraryIds.length === 0) return 0;

    const yearStart = sql`date_trunc('year', current_date)`;
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(userBookStatus)
      .innerJoin(books, eq(books.id, userBookStatus.bookId))
      .where(
        and(
          eq(userBookStatus.userId, userId),
          inArray(userBookStatus.status, ['read', 'skimmed']),
          isNotNull(userBookStatus.finishedAt),
          gte(userBookStatus.finishedAt, yearStart),
          inArray(books.libraryId, accessibleLibraryIds),
        ),
      );
    return row?.count ?? 0;
  }

  async getCurrentlyReadingBooks(userId: number, accessibleLibraryIds: number[]): Promise<CurrentlyReadingWidgetData> {
    if (accessibleLibraryIds.length === 0) return { books: [] };

    const rows = await this.db
      .select({
        bookId: books.id,
        title: bookMetadata.title,
        progress: readingProgress.percentage,
        coverSource: bookMetadata.coverSource,
        lastReadAt: readingProgress.updatedAt,
        fileId: bookFiles.id,
        fileFormat: bookFiles.format,
      })
      .from(userBookStatus)
      .innerJoin(books, eq(books.id, userBookStatus.bookId))
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .leftJoin(readingProgress, and(isNotNull(bookFiles.id), eq(readingProgress.bookFileId, bookFiles.id), eq(readingProgress.userId, userId)))
      .where(
        and(
          eq(userBookStatus.userId, userId),
          inArray(userBookStatus.status, ['reading', 'rereading']),
          inArray(books.libraryId, accessibleLibraryIds),
        ),
      )
      .orderBy(desc(sql`coalesce(${readingProgress.updatedAt}, ${userBookStatus.updatedAt})`))
      .limit(CURRENTLY_READING_LIMIT);

    if (rows.length === 0) return { books: [] };

    const bookIds = rows.map((r) => r.bookId);
    const authorRows = await this.db
      .select({
        bookId: bookAuthors.bookId,
        authorName: authors.name,
      })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(inArray(bookAuthors.bookId, bookIds));

    const authorsByBookId = new Map<number, string[]>();
    for (const row of authorRows) {
      const list = authorsByBookId.get(row.bookId) ?? [];
      list.push(row.authorName);
      authorsByBookId.set(row.bookId, list);
    }

    const result: CurrentlyReadingBook[] = rows.map((row) => ({
      bookId: row.bookId,
      title: row.title,
      authors: authorsByBookId.get(row.bookId) ?? [],
      progress: row.progress ?? 0,
      hasCover: row.coverSource != null,
      fileId: row.fileId ?? null,
      fileFormat: row.fileFormat ?? null,
    }));

    return { books: result };
  }

  async getReadingStreak(userId: number, accessibleLibraryIds: number[]): Promise<ReadingStreakWidgetData> {
    if (accessibleLibraryIds.length === 0) {
      return { currentStreak: 0, longestStreak: 0, lastSevenDays: [false, false, false, false, false, false, false] };
    }

    const rows = await this.db
      .select({
        day: userReadingDailyStats.day,
        totalSeconds: sql<number>`sum(${userReadingDailyStats.readingSeconds})::int`,
      })
      .from(userReadingDailyStats)
      .where(and(eq(userReadingDailyStats.userId, userId), inArray(userReadingDailyStats.libraryId, accessibleLibraryIds)))
      .groupBy(userReadingDailyStats.day)
      .orderBy(desc(userReadingDailyStats.day));

    const readDays = new Set(rows.filter((r) => r.totalSeconds > 0).map((r) => r.day));
    return computeStreakData(readDays, new Date());
  }

  async getLibraryOverview(accessibleLibraryIds: number[]): Promise<LibraryOverviewWidgetData> {
    if (accessibleLibraryIds.length === 0) {
      return { totalBooks: 0, totalAuthors: 0, totalSeries: 0, totalStorageBytes: 0, booksAddedThisYear: 0 };
    }

    const filter = inArray(books.libraryId, accessibleLibraryIds);

    const [[booksRow], [authorsRow], [seriesRow], [storageRow], [thisYearRow]] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(distinct ${books.id})::int` })
        .from(books)
        .where(filter),
      this.db
        .select({ count: sql<number>`count(distinct ${bookAuthors.authorId})::int` })
        .from(bookAuthors)
        .innerJoin(books, eq(books.id, bookAuthors.bookId))
        .where(filter),
      this.db
        .select({ count: sql<number>`count(distinct ${bookMetadata.seriesName})::int` })
        .from(bookMetadata)
        .innerJoin(books, eq(books.id, bookMetadata.bookId))
        .where(and(isNotNull(bookMetadata.seriesName), filter)),
      this.db
        .select({ total: sql<number>`coalesce(sum(${bookFiles.sizeBytes}), 0)::bigint` })
        .from(bookFiles)
        .innerJoin(books, eq(books.id, bookFiles.bookId))
        .where(filter),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(books)
        .where(and(gte(books.addedAt, sql`date_trunc('year', current_date)`), filter)),
    ]);

    return {
      totalBooks: booksRow?.count ?? 0,
      totalAuthors: authorsRow?.count ?? 0,
      totalSeries: seriesRow?.count ?? 0,
      totalStorageBytes: Number(storageRow?.total ?? 0),
      booksAddedThisYear: thisYearRow?.count ?? 0,
    };
  }

  // ── Highlight of the Day ────────────────────────────────────────

  async getAnnotationCount(userId: number, accessibleLibraryIds: number[]): Promise<number> {
    if (accessibleLibraryIds.length === 0) return 0;

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(annotations)
      .innerJoin(books, eq(books.id, annotations.bookId))
      .where(and(eq(annotations.userId, userId), inArray(books.libraryId, accessibleLibraryIds)));

    return row?.count ?? 0;
  }

  async getAnnotationByOffset(userId: number, accessibleLibraryIds: number[], offset: number): Promise<HighlightOfTheDayWidgetData | null> {
    if (accessibleLibraryIds.length === 0) return null;

    const rows = await this.db
      .select({
        text: annotations.text,
        note: annotations.note,
        bookTitle: bookMetadata.title,
        bookId: annotations.bookId,
        coverSource: bookMetadata.coverSource,
        chapterTitle: annotations.chapterTitle,
        createdAt: annotations.createdAt,
      })
      .from(annotations)
      .innerJoin(books, eq(books.id, annotations.bookId))
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(and(eq(annotations.userId, userId), inArray(books.libraryId, accessibleLibraryIds)))
      .orderBy(annotations.id)
      .limit(1)
      .offset(offset);

    const row = rows[0];
    if (!row) return null;

    return {
      text: row.text,
      note: row.note,
      bookTitle: row.bookTitle,
      bookId: row.bookId,
      hasCover: row.coverSource != null,
      chapterTitle: row.chapterTitle,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ── Monthly Challenge (raw data) ────────────────────────────────

  async getChallengePatternData(
    userId: number,
    accessibleLibraryIds: number[],
    monthStart: Date,
    sixMonthsAgo: Date,
  ): Promise<{
    avgPageCount: number;
    uniqueGenresLast6Months: number;
    staleInProgressCount: number;
    currentStreak: number;
    topAuthorBookCount: number;
    totalBooksRead: number;
    pagesThisMonth: number;
    shortBooksCompleted: number;
    newGenresRead: number;
    oldestInProgressFinished: boolean;
    maxStreakThisMonth: number;
    newAuthorsRead: number;
    pagesReadThisMonth: number;
  }> {
    if (accessibleLibraryIds.length === 0) {
      return {
        avgPageCount: 0,
        uniqueGenresLast6Months: 0,
        staleInProgressCount: 0,
        currentStreak: 0,
        topAuthorBookCount: 0,
        totalBooksRead: 0,
        pagesThisMonth: 0,
        shortBooksCompleted: 0,
        newGenresRead: 0,
        oldestInProgressFinished: false,
        maxStreakThisMonth: 0,
        newAuthorsRead: 0,
        pagesReadThisMonth: 0,
      };
    }

    const libFilter = inArray(books.libraryId, accessibleLibraryIds);
    const presentFilter = eq(books.status, 'present');

    const authorCountsSubq = this.db
      .select({ c: sql<number>`count(${userBookStatus.bookId})::int`.as('c') })
      .from(userBookStatus)
      .innerJoin(books, eq(books.id, userBookStatus.bookId))
      .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), libFilter, presentFilter))
      .groupBy(bookAuthors.authorId)
      .as('author_counts');

    const [
      [avgRow],
      [genreRow],
      [staleRow],
      [authorRow],
      [totalRow],
      [pagesRow],
      [shortRow],
      [newGenreRow],
      [newAuthorRow],
      [sessionPagesKnownRow],
      [sessionUnknownProgressRow],
      [dailyProgressRow],
      [finishedThisMonthRow],
      thisMonthReadDays,
    ] = await Promise.all([
      this.db
        .select({ avg: sql<number>`coalesce(avg(${bookMetadata.pageCount}), 0)::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), libFilter, presentFilter)),
      this.db
        .select({ count: sql<number>`count(distinct ${bookGenres.genreId})::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .innerJoin(bookGenres, eq(bookGenres.bookId, books.id))
        .where(
          and(
            eq(userBookStatus.userId, userId),
            inArray(userBookStatus.status, ['read', 'skimmed']),
            gte(userBookStatus.finishedAt, sixMonthsAgo),
            libFilter,
            presentFilter,
          ),
        ),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .where(
          and(
            eq(userBookStatus.userId, userId),
            inArray(userBookStatus.status, ['reading', 'rereading']),
            lt(userBookStatus.updatedAt, sixMonthsAgo),
            libFilter,
            presentFilter,
          ),
        ),
      this.db.select({ count: sql<number>`coalesce(max(${authorCountsSubq.c}), 0)::int` }).from(authorCountsSubq),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), libFilter, presentFilter)),
      this.db
        .select({ total: sql<number>`coalesce(sum(${bookMetadata.pageCount}), 0)::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(
          and(
            eq(userBookStatus.userId, userId),
            inArray(userBookStatus.status, ['read', 'skimmed']),
            gte(userBookStatus.finishedAt, monthStart),
            libFilter,
            presentFilter,
          ),
        ),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(
          and(
            eq(userBookStatus.userId, userId),
            inArray(userBookStatus.status, ['read', 'skimmed']),
            gte(userBookStatus.finishedAt, monthStart),
            lt(bookMetadata.pageCount, 200),
            libFilter,
            presentFilter,
          ),
        ),
      this.db
        .select({ count: sql<number>`count(distinct ${bookGenres.genreId})::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .innerJoin(bookGenres, eq(bookGenres.bookId, books.id))
        .where(
          and(
            eq(userBookStatus.userId, userId),
            inArray(userBookStatus.status, ['read', 'skimmed']),
            gte(userBookStatus.finishedAt, monthStart),
            libFilter,
            presentFilter,
          ),
        ),
      this.db
        .select({ count: sql<number>`count(distinct ${bookAuthors.authorId})::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
        .where(
          and(
            eq(userBookStatus.userId, userId),
            inArray(userBookStatus.status, ['read', 'skimmed']),
            gte(userBookStatus.finishedAt, monthStart),
            libFilter,
            presentFilter,
          ),
        ),
      this.db
        .select({
          total: sql<number>`floor(coalesce(sum(coalesce(${bookMetadata.pageCount}, 0) * least(greatest(coalesce(${readingSessions.progressDelta}, 0), 0), 100) / 100.0), 0))::int`,
        })
        .from(readingSessions)
        .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .innerJoin(books, eq(books.id, bookFiles.bookId))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(
          and(
            eq(readingSessions.userId, userId),
            gte(readingSessions.startedAt, monthStart),
            gt(readingSessions.progressDelta, 0),
            isNotNull(bookMetadata.pageCount),
            libFilter,
            presentFilter,
          ),
        ),
      this.db
        .select({
          totalProgress: sql<number>`coalesce(sum(least(greatest(coalesce(${readingSessions.progressDelta}, 0), 0), 100)), 0)::float`,
        })
        .from(readingSessions)
        .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .innerJoin(books, eq(books.id, bookFiles.bookId))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(
          and(
            eq(readingSessions.userId, userId),
            gte(readingSessions.startedAt, monthStart),
            gt(readingSessions.progressDelta, 0),
            isNull(bookMetadata.pageCount),
            libFilter,
            presentFilter,
          ),
        ),
      this.db
        .select({
          totalProgress: sql<number>`coalesce(sum(${userReadingDailyStats.progressDelta}), 0)::float`,
        })
        .from(userReadingDailyStats)
        .where(
          and(
            eq(userReadingDailyStats.userId, userId),
            inArray(userReadingDailyStats.libraryId, accessibleLibraryIds),
            gte(userReadingDailyStats.day, formatDay(monthStart)),
          ),
        ),
      // Any book finished this month — approximates whether the oldest in-progress book was cleared
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .where(
          and(
            eq(userBookStatus.userId, userId),
            inArray(userBookStatus.status, ['read', 'skimmed']),
            gte(userBookStatus.finishedAt, monthStart),
            libFilter,
            presentFilter,
          ),
        ),
      // Reading days within this month for max-streak computation
      this.db
        .select({ day: userReadingDailyStats.day })
        .from(userReadingDailyStats)
        .where(
          and(
            eq(userReadingDailyStats.userId, userId),
            inArray(userReadingDailyStats.libraryId, accessibleLibraryIds),
            gte(userReadingDailyStats.day, formatDay(monthStart)),
            gt(userReadingDailyStats.readingSeconds, 0),
          ),
        )
        .groupBy(userReadingDailyStats.day),
    ]);

    const streakData = await this.getReadingStreak(userId, accessibleLibraryIds);
    const avgPageCount = avgRow?.avg ?? 0;
    const inferredPageCount = avgPageCount > 0 ? avgPageCount : DEFAULT_VIRTUAL_PAGE_COUNT;
    const pagesFromUnknownPageCountSessions = Math.floor(((sessionUnknownProgressRow?.totalProgress ?? 0) * inferredPageCount) / 100);
    const pagesFromSessions = (sessionPagesKnownRow?.total ?? 0) + pagesFromUnknownPageCountSessions;
    const pagesFromFinishedBooks = pagesRow?.total ?? 0;
    const pagesFromDailyProgress = Math.floor(((dailyProgressRow?.totalProgress ?? 0) * avgPageCount) / 100);
    const pagesReadThisMonth = Math.max(pagesFromSessions, pagesFromFinishedBooks, pagesFromDailyProgress, 0);
    const maxStreakThisMonth = computeLongestStreak(new Set(thisMonthReadDays.map((r) => r.day)));

    return {
      avgPageCount,
      uniqueGenresLast6Months: genreRow?.count ?? 0,
      staleInProgressCount: staleRow?.count ?? 0,
      currentStreak: streakData.currentStreak,
      maxStreakThisMonth,
      topAuthorBookCount: authorRow?.count ?? 0,
      totalBooksRead: totalRow?.count ?? 0,
      pagesThisMonth: pagesReadThisMonth,
      shortBooksCompleted: shortRow?.count ?? 0,
      newGenresRead: newGenreRow?.count ?? 0,
      oldestInProgressFinished: (finishedThisMonthRow?.count ?? 0) > 0,
      newAuthorsRead: newAuthorRow?.count ?? 0,
      pagesReadThisMonth,
    };
  }

  // ── Year Projection (raw data) ─────────────────────────────────

  async getYearProjectionData(
    userId: number,
    accessibleLibraryIds: number[],
    yearStart: Date,
    thirtyDaysAgo: Date,
  ): Promise<{
    booksCompletedYtd: number;
    pagesReadLast30Days: number;
    hoursReadLast30Days: number;
    booksCompletedLast30Days: number;
  }> {
    if (accessibleLibraryIds.length === 0) {
      return { booksCompletedYtd: 0, pagesReadLast30Days: 0, hoursReadLast30Days: 0, booksCompletedLast30Days: 0 };
    }

    const libFilter = inArray(books.libraryId, accessibleLibraryIds);
    const presentFilter = eq(books.status, 'present');

    const [[ytdRow], [last30BooksRow], [last30ReadingRow]] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .where(
          and(
            eq(userBookStatus.userId, userId),
            inArray(userBookStatus.status, ['read', 'skimmed']),
            gte(userBookStatus.finishedAt, yearStart),
            libFilter,
            presentFilter,
          ),
        ),
      this.db
        .select({
          count: sql<number>`count(*)::int`,
          pages: sql<number>`coalesce(sum(${bookMetadata.pageCount}), 0)::int`,
        })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(
          and(
            eq(userBookStatus.userId, userId),
            inArray(userBookStatus.status, ['read', 'skimmed']),
            gte(userBookStatus.finishedAt, thirtyDaysAgo),
            libFilter,
            presentFilter,
          ),
        ),
      this.db
        .select({
          hours: sql<number>`coalesce(sum(${userReadingDailyStats.readingSeconds}), 0)::real / 3600`,
        })
        .from(userReadingDailyStats)
        .where(
          and(
            eq(userReadingDailyStats.userId, userId),
            inArray(userReadingDailyStats.libraryId, accessibleLibraryIds),
            gte(userReadingDailyStats.day, thirtyDaysAgo.toISOString().slice(0, 10)),
          ),
        ),
    ]);

    return {
      booksCompletedYtd: ytdRow?.count ?? 0,
      pagesReadLast30Days: last30BooksRow?.pages ?? 0,
      hoursReadLast30Days: last30ReadingRow?.hours ?? 0,
      booksCompletedLast30Days: last30BooksRow?.count ?? 0,
    };
  }

  // ── Neglected Gems ──────────────────────────────────────────────

  async getNeglectedGems(userId: number, accessibleLibraryIds: number[], today: Date): Promise<NeglectedGemsWidgetData> {
    if (accessibleLibraryIds.length === 0) return { gems: [] };

    const booksAlreadyRead = this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .where(and(eq(userBookStatus.userId, userId), inArray(userBookStatus.status, ['read', 'skimmed'])))
      .as('already_read');

    const rows = await this.db
      .select({
        bookId: books.id,
        title: bookMetadata.title,
        coverSource: bookMetadata.coverSource,
        rating: bookMetadata.rating,
        addedAt: books.addedAt,
        genre: sql<
          string | null
        >`(select ${genres.name} from ${bookGenres} inner join ${genres} on ${genres.id} = ${bookGenres.genreId} where ${bookGenres.bookId} = ${books.id} limit 1)`,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(booksAlreadyRead, eq(booksAlreadyRead.bookId, books.id))
      .where(
        and(
          inArray(books.libraryId, accessibleLibraryIds),
          eq(books.status, 'present'),
          gte(bookMetadata.rating, 8),
          isNull(booksAlreadyRead.bookId),
        ),
      )
      .orderBy(books.addedAt)
      .limit(5);

    return {
      gems: rows.map((r) => ({
        bookId: r.bookId,
        title: r.title,
        hasCover: r.coverSource != null,
        rating: r.rating!,
        waitingDays: Math.floor((today.getTime() - new Date(r.addedAt).getTime()) / (1000 * 60 * 60 * 24)),
        genre: r.genre,
      })),
    };
  }

  // ── Reading DNA (raw data) ──────────────────────────────────────

  async getReadingDnaData(
    userId: number,
    accessibleLibraryIds: number[],
    since: Date,
  ): Promise<{
    avgPageCount: number;
    uniqueGenres: number;
    totalBooks: number;
    readingDaysRatio: number;
    peakHour: number;
  }> {
    if (accessibleLibraryIds.length === 0) {
      return { avgPageCount: 0, uniqueGenres: 0, totalBooks: 0, readingDaysRatio: 0, peakHour: 12 };
    }

    const libFilter = inArray(books.libraryId, accessibleLibraryIds);
    const presentFilter = eq(books.status, 'present');

    const [[statsRow], [genreRow], dailyRows, [peakRow]] = await Promise.all([
      this.db
        .select({
          avg: sql<number>`coalesce(avg(${bookMetadata.pageCount}), 0)::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), libFilter, presentFilter)),
      this.db
        .select({ count: sql<number>`count(distinct ${bookGenres.genreId})::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .innerJoin(bookGenres, eq(bookGenres.bookId, books.id))
        .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), libFilter, presentFilter)),
      this.db
        .select({
          day: userReadingDailyStats.day,
          seconds: sql<number>`sum(${userReadingDailyStats.readingSeconds})::int`,
        })
        .from(userReadingDailyStats)
        .where(
          and(
            eq(userReadingDailyStats.userId, userId),
            inArray(userReadingDailyStats.libraryId, accessibleLibraryIds),
            gte(userReadingDailyStats.day, since.toISOString().slice(0, 10)),
          ),
        )
        .groupBy(userReadingDailyStats.day),
      this.db
        .select({
          hour: sql<number>`extract(hour from ${readingSessions.startedAt})::int`,
          total: sql<number>`sum(${readingSessions.durationSeconds})::int`,
        })
        .from(readingSessions)
        .innerJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .innerJoin(books, eq(books.id, bookFiles.bookId))
        .where(and(eq(readingSessions.userId, userId), libFilter, presentFilter))
        .groupBy(sql`extract(hour from ${readingSessions.startedAt})`)
        .orderBy(desc(sql`sum(${readingSessions.durationSeconds})`))
        .limit(1),
    ]);

    const daysSinceLookback = Math.max(1, Math.ceil((Date.now() - since.getTime()) / (1000 * 60 * 60 * 24)));
    const activeDays = dailyRows.filter((r) => r.seconds > 0).length;

    return {
      avgPageCount: statsRow?.avg ?? 0,
      uniqueGenres: genreRow?.count ?? 0,
      totalBooks: statsRow?.total ?? 0,
      readingDaysRatio: activeDays / daysSinceLookback,
      peakHour: peakRow?.hour ?? 12,
    };
  }

  // ── The Long Wait ───────────────────────────────────────────────

  async getLongWait(userId: number, accessibleLibraryIds: number[], today: Date): Promise<LongWaitWidgetData | null> {
    if (accessibleLibraryIds.length === 0) return null;

    const booksWithProgress = this.db
      .select({ bookId: bookFiles.bookId })
      .from(readingProgress)
      .innerJoin(bookFiles, eq(bookFiles.id, readingProgress.bookFileId))
      .where(eq(readingProgress.userId, userId))
      .as('with_progress');

    const booksWithStatus = this.db
      .select({ bookId: userBookStatus.bookId })
      .from(userBookStatus)
      .where(and(eq(userBookStatus.userId, userId), notInArray(userBookStatus.status, ['unread'])))
      .as('with_status');

    const rows = await this.db
      .select({
        bookId: books.id,
        title: bookMetadata.title,
        coverSource: bookMetadata.coverSource,
        addedAt: books.addedAt,
        pageCount: bookMetadata.pageCount,
        genre: sql<
          string | null
        >`(select ${genres.name} from ${bookGenres} inner join ${genres} on ${genres.id} = ${bookGenres.genreId} where ${bookGenres.bookId} = ${books.id} limit 1)`,
        fileId: bookFiles.id,
        fileFormat: bookFiles.format,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .leftJoin(booksWithProgress, eq(booksWithProgress.bookId, books.id))
      .leftJoin(booksWithStatus, eq(booksWithStatus.bookId, books.id))
      .where(
        and(
          inArray(books.libraryId, accessibleLibraryIds),
          eq(books.status, 'present'),
          isNull(booksWithProgress.bookId),
          isNull(booksWithStatus.bookId),
        ),
      )
      .orderBy(books.addedAt)
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      bookId: row.bookId,
      title: row.title,
      hasCover: row.coverSource != null,
      addedAt: row.addedAt.toISOString(),
      waitingDays: Math.floor((today.getTime() - new Date(row.addedAt).getTime()) / (1000 * 60 * 60 * 24)),
      pageCount: row.pageCount,
      genre: row.genre,
      fileId: row.fileId ?? null,
      fileFormat: row.fileFormat ?? null,
    };
  }

  // ── Shelf Diversity Score (raw data) ────────────────────────────

  async getDiversityData(
    userId: number,
    accessibleLibraryIds: number[],
  ): Promise<{
    uniqueGenresRead: number;
    totalGenresInLibrary: number;
    uniqueAuthorsRead: number;
    totalBooksRead: number;
    publicationYears: number[];
    uniqueLanguages: number;
  }> {
    if (accessibleLibraryIds.length === 0) {
      return { uniqueGenresRead: 0, totalGenresInLibrary: 0, uniqueAuthorsRead: 0, totalBooksRead: 0, publicationYears: [], uniqueLanguages: 0 };
    }

    const libFilter = inArray(books.libraryId, accessibleLibraryIds);
    const presentFilter = eq(books.status, 'present');
    const readFilter = and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'));

    const [[genresReadRow], [totalGenresRow], [authorsRow], [booksRow], yearRows, [langRow]] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(distinct ${bookGenres.genreId})::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .innerJoin(bookGenres, eq(bookGenres.bookId, books.id))
        .where(and(readFilter, libFilter, presentFilter)),
      this.db
        .select({ count: sql<number>`count(distinct ${bookGenres.genreId})::int` })
        .from(bookGenres)
        .innerJoin(books, eq(books.id, bookGenres.bookId))
        .where(and(libFilter, presentFilter)),
      this.db
        .select({ count: sql<number>`count(distinct ${bookAuthors.authorId})::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
        .where(and(readFilter, libFilter, presentFilter)),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .where(and(readFilter, libFilter, presentFilter)),
      this.db
        .select({ year: bookMetadata.publishedYear })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(and(readFilter, libFilter, presentFilter, isNotNull(bookMetadata.publishedYear))),
      this.db
        .select({ count: sql<number>`count(distinct ${bookMetadata.language})::int` })
        .from(userBookStatus)
        .innerJoin(books, eq(books.id, userBookStatus.bookId))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(and(readFilter, libFilter, presentFilter, isNotNull(bookMetadata.language))),
    ]);

    return {
      uniqueGenresRead: genresReadRow?.count ?? 0,
      totalGenresInLibrary: totalGenresRow?.count ?? 0,
      uniqueAuthorsRead: authorsRow?.count ?? 0,
      totalBooksRead: booksRow?.count ?? 0,
      publicationYears: yearRows.map((r) => r.year!),
      uniqueLanguages: langRow?.count ?? 0,
    };
  }

  // ── Reading Rhythm (raw daily data) ─────────────────────────────

  async getReadingRhythmData(userId: number, accessibleLibraryIds: number[], since: string): Promise<{ day: string; readingSeconds: number }[]> {
    if (accessibleLibraryIds.length === 0) return [];

    const rows = await this.db
      .select({
        day: userReadingDailyStats.day,
        readingSeconds: sql<number>`sum(${userReadingDailyStats.readingSeconds})::int`,
      })
      .from(userReadingDailyStats)
      .where(
        and(
          eq(userReadingDailyStats.userId, userId),
          inArray(userReadingDailyStats.libraryId, accessibleLibraryIds),
          gte(userReadingDailyStats.day, since),
        ),
      )
      .groupBy(userReadingDailyStats.day)
      .orderBy(userReadingDailyStats.day);

    return rows;
  }
}
