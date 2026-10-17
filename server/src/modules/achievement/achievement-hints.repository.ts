import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ContentFilterRules, ReadStatus } from '@bookorbit/types';

import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  audiobookProgress,
  authors,
  bookAuthors,
  bookFiles,
  bookMetadata,
  books,
  readingProgress,
  readingSessions,
  userBookRatings,
  userBookStatus,
  userLibraryAccess,
  userReadingDailyStats,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** Who is asking, and so which books a hint may count and show. */
export interface HintScope {
  userId: number;
  isSuperuser: boolean;
  contentFilters?: ContentFilterRules;
}

export interface HintBookGroup {
  count: number;
  /** Best first: books already in progress, then the most recently added. At most three. */
  bookIds: number[];
  /** Titles of `bookIds`, in the same order. */
  bookTitles: (string | null)[];
}

export interface HintPeriodGroup extends HintBookGroup {
  /** First year of the decade or century. */
  period: number;
}

export interface HintLanguageGroup extends HintBookGroup {
  language: string;
}

export interface HintResumeRow {
  bookId: number;
  fileId: number | null;
  format: string | null;
}

export interface HintStalledBook extends HintResumeRow {
  title: string | null;
  percent: number | null;
  startedAt: Date | null;
  /** Every in-progress book that qualifies, not just this one. */
  total: number;
}

export interface HintNearlyFinished extends HintBookGroup {
  lead: HintResumeRow | null;
}

export interface HintAuthor extends HintBookGroup {
  authorId: number;
  name: string;
  finished: number;
}

export interface HintPageCountGroup extends HintBookGroup {
  inProgress: number;
}

const HINT_BOOK_LIMIT = 3;
// Statuses a reader has closed out. Everything else, including no status at all, is still to read.
const CLOSED_STATUSES: ReadStatus[] = ['read', 'skimmed', 'abandoned'];
const IN_PROGRESS_STATUSES: ReadStatus[] = ['reading', 'rereading', 'on_hold'];

/**
 * Queries behind the achievement "how to get it" hints. Each reads one bounded slice of the user's own
 * library or history through an index and returns counts plus at most three book ids, never a list.
 */
@Injectable()
export class AchievementHintsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async sumReadingSecondsSince(userId: number, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ value: sql<string | null>`sum(${readingSessions.durationSeconds})` })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), gte(readingSessions.startedAt, since)));
    return Number(row?.value ?? 0);
  }

  async findMonthsWithReading(userId: number, year: number): Promise<number[]> {
    const month = sql<number>`extract(month from ${userReadingDailyStats.day})::int`;
    const rows = await this.db
      .selectDistinct({ month })
      .from(userReadingDailyStats)
      .where(
        and(
          eq(userReadingDailyStats.userId, userId),
          gte(userReadingDailyStats.day, sql`${`${year}-01-01`}::date`),
          lt(userReadingDailyStats.day, sql`${`${year + 1}-01-01`}::date`),
          gt(userReadingDailyStats.sessionsCount, 0),
        ),
      );
    return rows.map((row) => Number(row.month)).sort((a, b) => a - b);
  }

  /** First years of the decades (10) or centuries (100) the user has finished a book from. */
  async findFinishedPeriods(userId: number, years: 10 | 100): Promise<number[]> {
    const period = periodOf(years);
    const rows = await this.db
      .select({ period })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, userBookStatus.bookId))
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), isNotNull(bookMetadata.publishedYear)))
      .groupBy(period);
    return rows.map((row) => Number(row.period)).sort((a, b) => a - b);
  }

  /**
   * Unfinished books grouped by a decade or century the user has not finished yet, largest first. The
   * finished periods are skipped as year ranges, so the year index only visits books in the others.
   */
  async findUnfinishedByPeriod(scope: HintScope, years: 10 | 100, finishedPeriods: number[]): Promise<HintPeriodGroup[]> {
    const period = periodOf(years);
    const rows = await this.db
      .select({ period, count: sql<number>`count(*)::int`, bookIds: topBookIds(), bookTitles: topBookTitles() })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, scope.userId)))
      .where(and(this.visibleTo(scope), stillToRead(), outsidePeriods(finishedPeriods, years)))
      .groupBy(period)
      .orderBy(desc(sql`count(*)`), asc(period));
    return rows.map((row) => ({
      period: Number(row.period),
      count: Number(row.count),
      bookIds: row.bookIds ?? [],
      bookTitles: row.bookTitles ?? [],
    }));
  }

  /** The in-progress book started before `startedBefore` that is furthest along, and how many qualify. */
  async findStalledBook(scope: HintScope, startedBefore: Date): Promise<HintStalledBook | null> {
    const percent = mergedPercent();
    const [row] = await this.db
      .select({
        bookId: books.id,
        fileId: books.primaryFileId,
        format: bookFiles.format,
        title: bookMetadata.title,
        startedAt: userBookStatus.startedAt,
        percent,
        total: sql<number>`count(*) over ()::int`,
      })
      .from(userBookStatus)
      .innerJoin(books, eq(books.id, userBookStatus.bookId))
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .leftJoin(readingProgress, and(eq(readingProgress.bookFileId, books.primaryFileId), eq(readingProgress.userId, scope.userId)))
      .leftJoin(audiobookProgress, and(eq(audiobookProgress.bookId, books.id), eq(audiobookProgress.userId, scope.userId)))
      .where(
        and(
          eq(userBookStatus.userId, scope.userId),
          inArray(userBookStatus.status, IN_PROGRESS_STATUSES),
          lt(userBookStatus.startedAt, startedBefore),
          this.visibleTo(scope),
        ),
      )
      .orderBy(sql`${percent} desc nulls last`, asc(userBookStatus.startedAt), desc(books.id))
      .limit(1);
    if (!row) return null;
    return { ...row, percent: row.percent == null ? null : Number(row.percent), total: Number(row.total) };
  }

  /** Finished books with no rating, most recently finished first. */
  async findUnratedFinished(scope: HintScope): Promise<HintBookGroup> {
    const rows = await this.db
      .select({ bookId: books.id, title: bookMetadata.title, total: sql<number>`count(*) over ()::int` })
      .from(userBookStatus)
      .innerJoin(books, eq(books.id, userBookStatus.bookId))
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(userBookRatings, and(eq(userBookRatings.bookId, books.id), eq(userBookRatings.userId, scope.userId)))
      .where(and(eq(userBookStatus.userId, scope.userId), eq(userBookStatus.status, 'read'), isNull(userBookRatings.rating), this.visibleTo(scope)))
      .orderBy(sql`${userBookStatus.finishedAt} desc nulls last`, desc(books.id))
      .limit(HINT_BOOK_LIMIT);
    return { count: Number(rows[0]?.total ?? 0), bookIds: rows.map((row) => row.bookId), bookTitles: rows.map((row) => row.title) };
  }

  /**
   * Unfinished books at or past `minPercent`, furthest first. Driven by the user's own progress rows, then
   * checked against the same percentage a book card shows: the fresher of text and audio progress.
   */
  async findNearlyFinished(scope: HintScope, minPercent: number): Promise<HintNearlyFinished> {
    const percent = mergedPercent();
    const candidates = this.db
      .select({ bookId: bookFiles.bookId })
      .from(readingProgress)
      .innerJoin(bookFiles, eq(bookFiles.id, readingProgress.bookFileId))
      .where(and(eq(readingProgress.userId, scope.userId), gte(readingProgress.percentage, minPercent), lt(readingProgress.percentage, 100)))
      .union(
        this.db
          .select({ bookId: audiobookProgress.bookId })
          .from(audiobookProgress)
          .where(
            and(eq(audiobookProgress.userId, scope.userId), gte(audiobookProgress.percentage, minPercent), lt(audiobookProgress.percentage, 100)),
          ),
      );
    const rows = await this.db
      .select({
        bookId: books.id,
        title: bookMetadata.title,
        fileId: books.primaryFileId,
        format: bookFiles.format,
        total: sql<number>`count(*) over ()::int`,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .leftJoin(readingProgress, and(eq(readingProgress.bookFileId, books.primaryFileId), eq(readingProgress.userId, scope.userId)))
      .leftJoin(audiobookProgress, and(eq(audiobookProgress.bookId, books.id), eq(audiobookProgress.userId, scope.userId)))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, scope.userId)))
      .where(and(inArray(books.id, candidates), this.visibleTo(scope), stillToRead(), gte(percent, minPercent), lt(percent, 100)))
      .orderBy(desc(percent), desc(books.id))
      .limit(HINT_BOOK_LIMIT);
    const lead = rows[0];
    return {
      count: Number(lead?.total ?? 0),
      bookIds: rows.map((row) => row.bookId),
      bookTitles: rows.map((row) => row.title),
      lead: lead ? { bookId: lead.bookId, fileId: lead.fileId, format: lead.format } : null,
    };
  }

  /** Unfinished books with a known page count inside the bounds, through the page-count index. */
  async findUnfinishedByPageCount(scope: HintScope, bounds: { below?: number; atLeast?: number }): Promise<HintPageCountGroup> {
    const conditions: SQL[] = [isNotNull(bookMetadata.pageCount), gt(bookMetadata.pageCount, 0)];
    if (bounds.below !== undefined) conditions.push(lt(bookMetadata.pageCount, bounds.below));
    if (bounds.atLeast !== undefined) conditions.push(gte(bookMetadata.pageCount, bounds.atLeast));
    const [row] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        inProgress: sql<number>`(count(*) filter (where ${inArray(userBookStatus.status, IN_PROGRESS_STATUSES)}))::int`,
        bookIds: topBookIds(),
        bookTitles: topBookTitles(),
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, scope.userId)))
      .where(and(this.visibleTo(scope), stillToRead(), ...conditions));
    return {
      count: Number(row?.count ?? 0),
      inProgress: Number(row?.inProgress ?? 0),
      bookIds: row?.bookIds ?? [],
      bookTitles: row?.bookTitles ?? [],
    };
  }

  async findUnfinishedPublishedBefore(scope: HintScope, year: number): Promise<HintBookGroup> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int`, bookIds: topBookIds(), bookTitles: topBookTitles() })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, scope.userId)))
      .where(and(this.visibleTo(scope), stillToRead(), isNotNull(bookMetadata.publishedYear), lt(bookMetadata.publishedYear, year)));
    return { count: Number(row?.count ?? 0), bookIds: row?.bookIds ?? [], bookTitles: row?.bookTitles ?? [] };
  }

  /**
   * The author worth reading more of: among authors with finished books but fewer than `target`, the one
   * whose unfinished books get closest to `target`, then the one already read most. Bounded by the
   * authors of the user's finished books.
   */
  async findAuthorToDeepen(scope: HintScope, target: number): Promise<HintAuthor | null> {
    const finishedByAuthor = this.db.$with('finished_by_author').as(
      this.db
        .select({ authorId: bookAuthors.authorId, finished: sql<number>`count(*)::int`.as('finished') })
        .from(userBookStatus)
        .innerJoin(bookAuthors, eq(bookAuthors.bookId, userBookStatus.bookId))
        .where(and(eq(userBookStatus.userId, scope.userId), eq(userBookStatus.status, 'read')))
        .groupBy(bookAuthors.authorId)
        .having(sql`count(*) < ${target}`),
    );
    const unread = sql<number>`count(${books.id})::int`;
    const [row] = await this.db
      .with(finishedByAuthor)
      .select({
        authorId: finishedByAuthor.authorId,
        name: authors.name,
        finished: finishedByAuthor.finished,
        count: unread,
        bookIds: topBookIds(),
        bookTitles: topBookTitles(),
      })
      .from(finishedByAuthor)
      .innerJoin(authors, eq(authors.id, finishedByAuthor.authorId))
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, finishedByAuthor.authorId))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, scope.userId)))
      .where(and(this.visibleTo(scope), stillToRead()))
      .groupBy(finishedByAuthor.authorId, authors.name, finishedByAuthor.finished)
      .orderBy(sql`least(${finishedByAuthor.finished} + ${unread}, ${target}) desc`, desc(finishedByAuthor.finished), desc(unread), asc(authors.name))
      .limit(1);
    if (!row) return null;
    return { ...row, finished: Number(row.finished), count: Number(row.count), bookIds: row.bookIds ?? [], bookTitles: row.bookTitles ?? [] };
  }

  /** Language values on the user's finished books, as stored and in the database's collation order. */
  async findFinishedLanguages(userId: number): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ language: bookMetadata.language })
      .from(userBookStatus)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, userBookStatus.bookId))
      .where(
        and(eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'), isNotNull(bookMetadata.language), ne(bookMetadata.language, '')),
      )
      .orderBy(asc(bookMetadata.language));
    return rows.map((row) => row.language).filter((language): language is string => language !== null);
  }

  /**
   * Unfinished books grouped by stored language, skipping `finishedLanguages` as ranges of the language
   * index. The values must come in the database's collation order, as `findFinishedLanguages` returns them.
   */
  async findUnfinishedByLanguage(scope: HintScope, finishedLanguages: string[]): Promise<HintLanguageGroup[]> {
    const rows = await this.db
      .select({ language: bookMetadata.language, count: sql<number>`count(*)::int`, bookIds: topBookIds(), bookTitles: topBookTitles() })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, scope.userId)))
      .where(and(this.visibleTo(scope), stillToRead(), ne(bookMetadata.language, ''), outsideValues(bookMetadata.language, finishedLanguages)))
      .groupBy(bookMetadata.language)
      .orderBy(desc(sql`count(*)`), asc(bookMetadata.language))
      .limit(50);
    return rows
      .filter((row): row is typeof row & { language: string } => row.language !== null)
      .map((row) => ({ language: row.language, count: Number(row.count), bookIds: row.bookIds ?? [], bookTitles: row.bookTitles ?? [] }));
  }

  /** Present books in libraries the user can open, minus anything their content filters hide. */
  private visibleTo(scope: HintScope): SQL {
    const clauses: SQL[] = [eq(books.status, 'present')];
    if (!scope.isSuperuser) {
      clauses.push(
        inArray(
          books.libraryId,
          this.db.select({ libraryId: userLibraryAccess.libraryId }).from(userLibraryAccess).where(eq(userLibraryAccess.userId, scope.userId)),
        ),
      );
      if (scope.contentFilters) clauses.push(...buildContentFilterClauses(scope.contentFilters, this.db));
    }
    return and(...clauses)!;
  }
}

/** Needs `user_book_status` left-joined for the user. */
function stillToRead(): SQL {
  return or(isNull(userBookStatus.status), notInArray(userBookStatus.status, CLOSED_STATUSES))!;
}

/** Up to three book ids, in-progress first, then newest. Needs `user_book_status` left-joined for the user. */
function topBookIds(): SQL<number[] | null> {
  return sql<number[] | null>`(array_agg(${books.id} order by ${topBookOrder()}))[1:${sql.raw(String(HINT_BOOK_LIMIT))}]`;
}

/** Titles for `topBookIds()`, in the same order. Needs `book_metadata` joined. */
function topBookTitles(): SQL<(string | null)[] | null> {
  return sql<(string | null)[] | null>`(array_agg(${bookMetadata.title} order by ${topBookOrder()}))[1:${sql.raw(String(HINT_BOOK_LIMIT))}]`;
}

function topBookOrder(): SQL {
  return sql`case when ${inArray(userBookStatus.status, IN_PROGRESS_STATUSES)} then 0 else 1 end, ${books.addedAt} desc, ${books.id} desc`;
}

// The width is inlined, not bound: Postgres cannot match a GROUP BY expression whose parameters differ from the select's.
function periodOf(years: 10 | 100): SQL<number> {
  const width = sql.raw(String(years === 100 ? 100 : 10));
  return sql<number>`(floor(${bookMetadata.publishedYear} / ${width}) * ${width})::int`;
}

/** Published years outside the given periods, as ranges the year index can serve. */
function outsidePeriods(periods: number[], years: 10 | 100): SQL {
  const ranges: SQL[] = [];
  let from: number | null = null;
  for (const start of [...new Set(periods)].sort((a, b) => a - b)) {
    if (from === null) ranges.push(lt(bookMetadata.publishedYear, start));
    else if (from < start) ranges.push(and(gte(bookMetadata.publishedYear, from), lt(bookMetadata.publishedYear, start))!);
    from = start + years;
  }
  ranges.push(from === null ? isNotNull(bookMetadata.publishedYear) : gte(bookMetadata.publishedYear, from));
  return or(...ranges)!;
}

/** A column outside the given values, as ranges between them. `sorted` must follow the column's collation. */
function outsideValues(column: typeof bookMetadata.language, sorted: string[]): SQL {
  if (sorted.length === 0) return isNotNull(column);
  const ranges: SQL[] = [lt(column, sorted[0])];
  for (let index = 1; index < sorted.length; index++) ranges.push(and(gt(column, sorted[index - 1]), lt(column, sorted[index]))!);
  ranges.push(gt(column, sorted[sorted.length - 1]));
  return or(...ranges)!;
}

/**
 * The percentage a book card shows: text progress on the primary file or audiobook progress, whichever
 * moved last. Needs both left-joined for the user.
 */
function mergedPercent(): SQL<number | null> {
  return sql<number | null>`(case
    when ${readingProgress.percentage} is not null and ${audiobookProgress.percentage} is not null
      then case when ${readingProgress.lastReadAt} >= ${audiobookProgress.updatedAt} then ${readingProgress.percentage} else ${audiobookProgress.percentage} end
    else coalesce(${readingProgress.percentage}, ${audiobookProgress.percentage})
  end)`;
}
