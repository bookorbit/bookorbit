import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules } from '@bookorbit/types';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { accentInsensitiveIlike, buildSearchPattern } from '../../common/utils/accent-insensitive-search.utils';
import { MAX_SERIES_TOTAL_BOOKS } from '../../common/utils/series-total-books.utils';
import { compareSeriesIndexSql, seriesIndexOrderBy } from '../../common/utils/series-index-sql.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookMetadata, books, bookSeries, bookSeriesMemberships, libraries, userBookStatus } from '../../db/schema';
import type { SeriesListSort, SortDirection } from './dto/list-series.dto';
import type { SeriesBookSort } from './dto/list-series-books.dto';

type Db = NodePgDatabase<typeof schema>;

type SeriesSummaryRow = {
  id: number;
  name: string;
  bookCount: number;
  readCount: number;
  readingCount: number;
  expectedBookCount: number | null;
  authors: string[];
  coverBookIds: number[];
  lastAddedAt: string | null;
  members: SeriesMemberRow[];
  membersTruncated: boolean;
  libraryNames: string[];
};

/** One book of a series, as the list needs it to draw the volume ladder. */
export type SeriesMemberRow = {
  bookId: number;
  seriesIndex: string | null;
  title: string | null;
  status: string | null;
};

export type SeriesFacetRow = {
  all: number;
  notStarted: number;
  inProgress: number;
  complete: number;
  hasGaps: number;
};

/**
 * Books of one series the list will read to build its ladder. Far above any real series length,
 * and only a backstop: a series past it reports its counts but no ladder detail and no gaps,
 * because naming a volume missing needs every sibling in hand.
 */
const SERIES_MEMBER_SCAN_LIMIT = 400;

export type SeriesNextBookRow = {
  bookId: number;
  title: string | null;
  seriesIndex: string | null;
  fileId: number;
  format: string | null;
};

type SeriesDetailRow = {
  id: number;
  name: string;
  bookCount: number;
  readCount: number;
  expectedBookCount: number | null;
  authors: string[];
  indices: string[];
};

@Injectable()
export class SeriesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private buildLibraryFilter(libraryIds: number[]): SQL {
    return inArray(books.libraryId, libraryIds);
  }

  private buildAuthorNameMatchCondition(pattern: string): SQL {
    return sql`${books.id} IN (
      SELECT ${bookAuthors.bookId} FROM ${bookAuthors}
      INNER JOIN ${authors} ON ${authors.id} = ${bookAuthors.authorId}
      WHERE ${accentInsensitiveIlike(authors.name, pattern)}
    )`;
  }

  async findPage(params: {
    q?: string;
    page: number;
    size: number;
    sort: SeriesListSort;
    order: SortDirection;
    libraryIds: number[];
    userId: number;
    completionStatus?: string;
    author?: string;
    contentFilters?: ContentFilterRules;
  }): Promise<{ items: SeriesSummaryRow[]; total: number; facets: SeriesFacetRow; page: number; size: number }> {
    const libraryFilter = this.buildLibraryFilter(params.libraryIds);
    const filterClauses = params.contentFilters ? buildContentFilterClauses(params.contentFilters, this.db) : [];

    const conditions: SQL[] = [libraryFilter, ...filterClauses];

    if (params.q) {
      const qPattern = buildSearchPattern(params.q);
      const authorNameMatch = this.buildAuthorNameMatchCondition(qPattern);
      conditions.push(sql`(${accentInsensitiveIlike(bookSeries.name, qPattern)} OR ${authorNameMatch})`);
    }

    if (params.author) {
      const authorPattern = buildSearchPattern(params.author);
      conditions.push(this.buildAuthorNameMatchCondition(authorPattern));
    }

    const baseWhere = and(...conditions)!;

    const bookCountExpr = sql<number>`count(distinct ${books.id})::int`;
    const readCountExpr = sql<number>`count(distinct CASE WHEN ${userBookStatus.status} = 'read' THEN ${books.id} END)::int`;
    const readingCountExpr = sql<number>`count(distinct CASE WHEN ${userBookStatus.status} = 'reading' THEN ${books.id} END)::int`;
    const lastAddedExpr = sql<string | null>`max(${books.addedAt})::text`;
    const readProgressExpr = sql<number>`
      CASE WHEN count(distinct ${books.id}) = 0 THEN 0
      ELSE (count(distinct CASE WHEN ${userBookStatus.status} = 'read' THEN ${books.id} END)::float / count(distinct ${books.id})::float)
      END`;
    const nameExpr = sql<string>`${bookSeries.name}`;

    const hasGapsExpr = this.buildHasGapsExpression(bookCountExpr);
    const completionHaving = this.buildCompletionHaving(params.completionStatus, bookCountExpr, readCountExpr, hasGapsExpr);
    const sortExpr = this.buildSortExpression(params.sort, params.order, nameExpr, bookCountExpr, lastAddedExpr, readProgressExpr);

    // Facets are counted before the completion filter, so the tab a user is standing on can
    // still show what the other tabs hold. One pass replaces the separate total query.
    const facetSource = this.db
      // Raw SQL selected through a subquery has to carry its own alias, or referencing it
      // from the outer FILTER throws before a query is ever sent.
      .select({
        bookCount: bookCountExpr.as('book_count'),
        readCount: readCountExpr.as('read_count'),
        hasGaps: hasGapsExpr.as('has_gaps'),
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.bookId, books.id))
      .innerJoin(bookSeries, eq(bookSeries.id, bookSeriesMemberships.seriesId))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, params.userId)))
      .where(baseWhere)
      .groupBy(bookSeries.id, bookSeries.name, bookSeries.expectedBookCount)
      .as('series_groups');

    const facetQuery = this.db
      .select({
        all: sql<number>`count(*)::int`,
        notStarted: sql<number>`count(*) FILTER (WHERE ${facetSource.readCount} = 0)::int`,
        inProgress: sql<number>`count(*) FILTER (WHERE ${facetSource.readCount} > 0 AND ${facetSource.readCount} < ${facetSource.bookCount})::int`,
        complete: sql<number>`count(*) FILTER (WHERE ${facetSource.readCount} = ${facetSource.bookCount})::int`,
        hasGaps: sql<number>`count(*) FILTER (WHERE ${facetSource.hasGaps})::int`,
      })
      .from(facetSource);

    const dataQuery = this.db
      .select({
        id: bookSeries.id,
        name: bookSeries.name,
        bookCount: bookCountExpr,
        readCount: readCountExpr,
        readingCount: readingCountExpr,
        expectedBookCount: bookSeries.expectedBookCount,
        lastAddedAt: lastAddedExpr,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.bookId, books.id))
      .innerJoin(bookSeries, eq(bookSeries.id, bookSeriesMemberships.seriesId))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, params.userId)))
      .where(baseWhere)
      .groupBy(bookSeries.id, bookSeries.name, bookSeries.expectedBookCount)
      .$dynamic();

    if (completionHaving) {
      dataQuery.having(completionHaving);
    }

    dataQuery.orderBy(...sortExpr);
    dataQuery.limit(params.size);
    dataQuery.offset(params.page * params.size);

    const [facetResult, seriesRows] = await Promise.all([facetQuery, dataQuery]);
    const facets: SeriesFacetRow = facetResult[0] ?? { all: 0, notStarted: 0, inProgress: 0, complete: 0, hasGaps: 0 };
    const total = this.totalForStatus(facets, params.completionStatus);

    if (seriesRows.length === 0) {
      return { items: [], total, facets, page: params.page, size: params.size };
    }

    const seriesIds = seriesRows.map((row) => row.id);
    const [authorData, coverData, memberData] = await Promise.all([
      this.fetchAuthorsForSeries(seriesIds, params.libraryIds, params.contentFilters),
      this.fetchCoverBookIds(seriesIds, params.libraryIds, params.contentFilters),
      this.fetchSeriesMembers(seriesIds, params.libraryIds, params.userId, params.contentFilters),
    ]);

    const items: SeriesSummaryRow[] = seriesRows.map((row) => {
      const members = memberData.get(row.id);
      return {
        id: row.id,
        name: row.name,
        bookCount: row.bookCount,
        readCount: row.readCount,
        readingCount: row.readingCount,
        expectedBookCount: row.expectedBookCount ?? null,
        authors: authorData.get(row.id) ?? [],
        coverBookIds: coverData.get(row.id) ?? [],
        lastAddedAt: row.lastAddedAt,
        members: members?.rows ?? [],
        membersTruncated: members?.truncated ?? false,
        libraryNames: members?.libraryNames ?? [],
      };
    });

    return { items, total, facets, page: params.page, size: params.size };
  }

  private totalForStatus(facets: SeriesFacetRow, status: string | undefined): number {
    switch (status) {
      case 'not_started':
        return facets.notStarted;
      case 'in_progress':
        return facets.inProgress;
      case 'complete':
        return facets.complete;
      case 'has_gaps':
        return facets.hasGaps;
      default:
        return facets.all;
    }
  }

  async countSeries(params: { libraryIds: number[]; contentFilters?: ContentFilterRules }): Promise<number> {
    if (params.libraryIds.length === 0) return 0;

    const filterClauses = params.contentFilters ? buildContentFilterClauses(params.contentFilters, this.db) : [];

    const [row] = await this.db
      .select({ total: sql<number>`count(distinct ${bookSeriesMemberships.seriesId})::int` })
      .from(bookSeriesMemberships)
      .innerJoin(books, eq(books.id, bookSeriesMemberships.bookId))
      .where(and(this.buildLibraryFilter(params.libraryIds), ...filterClauses));

    return Number(row?.total ?? 0);
  }

  async findDetail(params: {
    seriesId: number;
    userId: number;
    libraryIds: number[];
    contentFilters?: ContentFilterRules;
  }): Promise<SeriesDetailRow | null> {
    const libraryFilter = this.buildLibraryFilter(params.libraryIds);
    const filterClauses = params.contentFilters ? buildContentFilterClauses(params.contentFilters, this.db) : [];

    const rows = await this.db
      .select({
        id: bookSeries.id,
        name: bookSeries.name,
        expectedBookCount: bookSeries.expectedBookCount,
        bookCount: sql<number>`count(distinct ${books.id})::int`,
        readCount: sql<number>`count(distinct CASE WHEN ${userBookStatus.status} = 'read' THEN ${books.id} END)::int`,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.bookId, books.id))
      .innerJoin(bookSeries, eq(bookSeries.id, bookSeriesMemberships.seriesId))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, params.userId)))
      .where(and(eq(bookSeries.id, params.seriesId), libraryFilter, ...filterClauses))
      .groupBy(bookSeries.id, bookSeries.name, bookSeries.expectedBookCount);

    if (rows.length === 0) return null;

    const row = rows[0];

    const [authorsMap, indicesRows] = await Promise.all([
      this.fetchAuthorsForSeries([params.seriesId], params.libraryIds, params.contentFilters),
      this.db
        .select({ idx: bookSeriesMemberships.seriesIndex })
        .from(books)
        .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.bookId, books.id))
        .where(
          and(eq(bookSeriesMemberships.seriesId, params.seriesId), libraryFilter, ...filterClauses, isNotNull(bookSeriesMemberships.seriesIndex)),
        ),
    ]);

    const indices = indicesRows.map((r) => r.idx!);

    return {
      id: row.id,
      name: row.name,
      bookCount: row.bookCount,
      readCount: row.readCount,
      expectedBookCount: row.expectedBookCount ?? null,
      authors: authorsMap.get(params.seriesId) ?? [],
      indices,
    };
  }

  async findBookIds(params: {
    seriesId: number;
    page: number;
    size: number;
    sort: SeriesBookSort;
    order: SortDirection;
    libraryIds: number[];
    contentFilters?: ContentFilterRules;
  }): Promise<{ bookIds: number[]; total: number }> {
    const libraryFilter = this.buildLibraryFilter(params.libraryIds);
    const filterClauses = params.contentFilters ? buildContentFilterClauses(params.contentFilters, this.db) : [];
    const where = and(eq(bookSeriesMemberships.seriesId, params.seriesId), libraryFilter, ...filterClauses)!;

    const orderBy = this.buildBookSortExpression(params.sort, params.order);

    const [dataRows, [{ total }]] = await Promise.all([
      this.db
        .select({ id: books.id })
        .from(books)
        .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.bookId, books.id))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where)
        .orderBy(...orderBy)
        .limit(params.size)
        .offset(params.page * params.size),
      this.db
        .select({ total: count() })
        .from(books)
        .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.bookId, books.id))
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where),
    ]);

    return { bookIds: dataRows.map((r) => r.id), total: Number(total) };
  }

  /**
   * The next book of the series this user can open right now, resolved down to one file.
   * Books with no readable file of the requested formats are skipped rather than dead-ended on.
   */
  async findNextReadableBook(params: {
    seriesId: number;
    bookId: number;
    libraryIds: number[];
    formats: string[];
    contentFilters?: ContentFilterRules;
  }): Promise<SeriesNextBookRow | null> {
    if (params.formats.length === 0) return null;

    const libraryFilter = this.buildLibraryFilter(params.libraryIds);

    const [current] = await this.db
      .select({ seriesIndex: bookSeriesMemberships.seriesIndex })
      .from(bookSeriesMemberships)
      .innerJoin(books, eq(books.id, bookSeriesMemberships.bookId))
      .where(and(eq(bookSeriesMemberships.seriesId, params.seriesId), eq(bookSeriesMemberships.bookId, params.bookId), libraryFilter))
      .limit(1);

    if (!current) return null;

    // Mirrors the ascending series order, where unindexed books sort after every indexed one:
    // an indexed book can be followed by an unindexed one, an unindexed one only by another.
    const afterCurrent =
      current.seriesIndex === null
        ? and(isNull(bookSeriesMemberships.seriesIndex), gt(books.id, params.bookId))!
        : or(
            compareSeriesIndexSql(bookSeriesMemberships.seriesIndex, '>', current.seriesIndex),
            and(compareSeriesIndexSql(bookSeriesMemberships.seriesIndex, '>=', current.seriesIndex), gt(books.id, params.bookId)),
            isNull(bookSeriesMemberships.seriesIndex),
          )!;

    const filterClauses = params.contentFilters ? buildContentFilterClauses(params.contentFilters, this.db) : [];

    const [row] = await this.db
      .select({
        bookId: books.id,
        title: bookMetadata.title,
        seriesIndex: bookSeriesMemberships.seriesIndex,
        fileId: bookFiles.id,
        format: bookFiles.format,
      })
      .from(books)
      .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.bookId, books.id))
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(
        bookFiles,
        and(eq(bookFiles.bookId, books.id), eq(bookFiles.role, 'content'), inArray(sql`lower(${bookFiles.format})`, params.formats))!,
      )
      .where(and(eq(bookSeriesMemberships.seriesId, params.seriesId), eq(books.status, 'present'), libraryFilter, afterCurrent, ...filterClauses))
      .orderBy(
        ...seriesIndexOrderBy(bookSeriesMemberships.seriesIndex, 'ASC'),
        asc(books.id),
        sql`(${bookFiles.id} = ${books.primaryFileId}) DESC`,
        sql`${bookFiles.sortOrder} ASC NULLS LAST`,
        asc(bookFiles.id),
      )
      .limit(1);

    return row ?? null;
  }

  private async fetchAuthorsForSeries(
    seriesIds: number[],
    libraryIds: number[],
    contentFilters?: ContentFilterRules,
  ): Promise<Map<number, string[]>> {
    if (seriesIds.length === 0) return new Map();

    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const rows = await this.db
      .select({
        seriesId: bookSeriesMemberships.seriesId,
        authorName: authors.name,
      })
      .from(books)
      .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.bookId, books.id))
      .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(and(inArray(bookSeriesMemberships.seriesId, seriesIds), this.buildLibraryFilter(libraryIds), ...filterClauses))
      .groupBy(bookSeriesMemberships.seriesId, authors.name);

    const result = new Map<number, string[]>();
    for (const row of rows) {
      if (row.seriesId == null) continue;
      const list = result.get(row.seriesId) ?? [];
      list.push(row.authorName);
      result.set(row.seriesId, list);
    }
    return result;
  }

  private async fetchCoverBookIds(seriesIds: number[], libraryIds: number[], contentFilters?: ContentFilterRules): Promise<Map<number, number[]>> {
    if (seriesIds.length === 0) return new Map();

    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const rows = await this.db
      .select({
        seriesId: bookSeriesMemberships.seriesId,
        bookId: books.id,
        seriesIndex: bookSeriesMemberships.seriesIndex,
      })
      .from(books)
      .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.bookId, books.id))
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(
        and(
          inArray(bookSeriesMemberships.seriesId, seriesIds),
          this.buildLibraryFilter(libraryIds),
          ...filterClauses,
          isNotNull(bookMetadata.coverSource),
        ),
      )
      .orderBy(bookSeriesMemberships.seriesId, ...seriesIndexOrderBy(bookSeriesMemberships.seriesIndex, 'ASC'), asc(books.addedAt));

    const result = new Map<number, number[]>();
    for (const row of rows) {
      if (row.seriesId == null) continue;
      const list = result.get(row.seriesId) ?? [];
      if (list.length < 9) {
        list.push(row.bookId);
      }
      result.set(row.seriesId, list);
    }
    return result;
  }

  private buildCompletionHaving(
    status: string | undefined,
    bookCountExpr: SQL<number>,
    readCountExpr: SQL<number>,
    hasGapsExpr: SQL<boolean>,
  ): SQL | undefined {
    if (!status) return undefined;

    switch (status) {
      case 'not_started':
        return sql`${readCountExpr} = 0`;
      case 'in_progress':
        return sql`${readCountExpr} > 0 AND ${readCountExpr} < ${bookCountExpr}`;
      case 'complete':
        return sql`${readCountExpr} = ${bookCountExpr}`;
      case 'has_gaps':
        return sql`${hasGapsExpr}`;
      default:
        return undefined;
    }
  }

  /**
   * "This series is missing a volume", decided in SQL so the filter and its facet count can run
   * over the whole library instead of a page. It mirrors `computeSeriesGaps` branch for branch:
   * a provider total is only trusted when every book is numbered with a plain integer and none
   * of them runs past the total, and without a trusted total only interior holes are knowable.
   *
   * Indices of ten digits or more are treated as unusable rather than cast, which is where this
   * is fractionally stricter than the TypeScript: that function drops them for exceeding the
   * safe-integer range, and either way the series reports no gaps.
   */
  private buildHasGapsExpression(bookCountExpr: SQL<number>): SQL<boolean> {
    const idx = bookSeriesMemberships.seriesIndex;
    const intIdx = sql`CASE WHEN ${idx} ~ '^[0-9]{1,9}$' THEN ${idx}::int END`;

    const numberedCount = sql`count(distinct CASE WHEN ${idx} IS NOT NULL THEN ${books.id} END)`;
    const integerCount = sql`count(distinct CASE WHEN ${idx} ~ '^[0-9]{1,9}$' THEN ${books.id} END)`;
    const oversizedCount = sql`count(distinct CASE WHEN ${idx} ~ '^[0-9]{10,}$' THEN ${books.id} END)`;
    const minIdx = sql`min(${intIdx})`;
    const maxIdx = sql`max(${intIdx})`;
    const distinctIdx = sql`count(distinct ${intIdx})`;
    const expected = sql`${bookSeries.expectedBookCount}`;

    const trusted = sql`(
      ${expected} IS NOT NULL
      AND ${expected} BETWEEN 1 AND ${MAX_SERIES_TOTAL_BOOKS}
      AND ${numberedCount} = ${bookCountExpr}
      AND ${integerCount} = ${numberedCount}
      AND ${maxIdx} <= ${expected}
    )`;

    return sql<boolean>`(
      ${integerCount} > 0
      AND ${oversizedCount} = 0
      AND ${minIdx} >= 1
      AND ${maxIdx} <= ${MAX_SERIES_TOTAL_BOOKS}
      AND CASE
        WHEN ${trusted} THEN ${distinctIdx} < ${expected}
        ELSE ${integerCount} >= 2 AND ${distinctIdx} < (${maxIdx} - ${minIdx} + 1)
      END
    )`;
  }

  /**
   * Every book of the listed series in one pass, ordered the way the series reads. The ladder,
   * the shelf covers' order, the up-next volume and the gap list are all derived from this, so
   * it is fetched once per page rather than once per row.
   */
  private async fetchSeriesMembers(
    seriesIds: number[],
    libraryIds: number[],
    userId: number,
    contentFilters?: ContentFilterRules,
  ): Promise<Map<number, { rows: SeriesMemberRow[]; truncated: boolean; libraryNames: string[] }>> {
    if (seriesIds.length === 0) return new Map();

    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const orderInWindow = sql.join(
      [...seriesIndexOrderBy(bookSeriesMemberships.seriesIndex, 'ASC'), sql`${books.addedAt} ASC`, sql`${books.id} ASC`],
      sql`, `,
    );

    const ranked = this.db
      .select({
        seriesId: bookSeriesMemberships.seriesId,
        bookId: books.id,
        seriesIndex: bookSeriesMemberships.seriesIndex,
        title: bookMetadata.title,
        status: userBookStatus.status,
        libraryName: libraries.name,
        rank: sql<number>`row_number() over (partition by ${bookSeriesMemberships.seriesId} order by ${orderInWindow})`.as('rank'),
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.bookId, books.id))
      .leftJoin(libraries, eq(libraries.id, books.libraryId))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, userId)))
      .where(and(inArray(bookSeriesMemberships.seriesId, seriesIds), this.buildLibraryFilter(libraryIds), ...filterClauses))
      .as('ranked_members');

    const rows = await this.db
      .select()
      .from(ranked)
      .where(sql`${ranked.rank} <= ${SERIES_MEMBER_SCAN_LIMIT + 1}`)
      .orderBy(ranked.seriesId, ranked.rank);

    const result = new Map<number, { rows: SeriesMemberRow[]; truncated: boolean; libraryNames: string[] }>();
    for (const row of rows) {
      if (row.seriesId == null) continue;
      let entry = result.get(row.seriesId);
      if (!entry) {
        entry = { rows: [], truncated: false, libraryNames: [] };
        result.set(row.seriesId, entry);
      }
      if (entry.rows.length >= SERIES_MEMBER_SCAN_LIMIT) {
        entry.truncated = true;
        continue;
      }
      entry.rows.push({ bookId: row.bookId, seriesIndex: row.seriesIndex, title: row.title, status: row.status });
      if (row.libraryName && !entry.libraryNames.includes(row.libraryName)) entry.libraryNames.push(row.libraryName);
    }
    for (const entry of result.values()) entry.libraryNames.sort((a, b) => a.localeCompare(b));
    return result;
  }

  private buildSortExpression(
    sort: SeriesListSort,
    order: SortDirection,
    nameExpr: SQL<string>,
    bookCountExpr: SQL<number>,
    lastAddedExpr: SQL<string | null>,
    readProgressExpr: SQL<number>,
  ): SQL[] {
    const dir = order === 'asc' ? asc : desc;
    const tiebreaker = asc(nameExpr);

    switch (sort) {
      case 'bookCount':
        return [dir(bookCountExpr), tiebreaker];
      case 'lastAddedAt':
        return [dir(lastAddedExpr), tiebreaker];
      case 'readProgress':
        return [dir(readProgressExpr), tiebreaker];
      case 'name':
      default:
        return [dir(nameExpr)];
    }
  }

  private buildBookSortExpression(sort: SeriesBookSort, order: SortDirection): SQL[] {
    const dir = order === 'asc' ? asc : desc;

    switch (sort) {
      case 'title':
        return [dir(bookMetadata.title), asc(books.id)];
      case 'addedAt':
        return [dir(books.addedAt), asc(books.id)];
      case 'seriesIndex':
      default:
        return [...seriesIndexOrderBy(bookSeriesMemberships.seriesIndex, order === 'asc' ? 'ASC' : 'DESC'), asc(books.id)];
    }
  }
}
