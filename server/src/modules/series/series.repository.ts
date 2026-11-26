import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { type ContentFilterRules, type SeriesUnit, type SeriesUnitClass, seriesUnitClass } from '@bookorbit/types';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { accentInsensitiveIlike, buildSearchPattern } from '../../common/utils/accent-insensitive-search.utils';
import { compareSeriesIndexSql, seriesIndexOrderBy } from '../../common/utils/series-index-sql.utils';
import { seriesUnitClassFilter } from '../../common/utils/series-unit.utils';
import { DB } from '../../db';
import { workKeySql } from '../../db/book-work-key';
import { LINK_FOLDED_BY_PREFERENCE_SQL, LINK_FOLDED_COUNT_SQL, linkMembersCte } from '../../db/link-collapse-sql';
import { seriesHasGapsSql } from '../../db/series-gaps-sql';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookFiles, bookMetadata, books, bookSeries, bookSeriesMemberships, libraries, userBookStatus } from '../../db/schema';
import type { SeriesListSort, SortDirection } from './dto/list-series.dto';
import type { SeriesBookSort } from './dto/list-series-books.dto';

type Db = NodePgDatabase<typeof schema>;

type SeriesSummaryRow = {
  id: number;
  name: string;
  bookCount: number;
  /** Books counted once per work: linked editions count as one. */
  workCount: number;
  readCount: number;
  readingCount: number;
  chapterCount: number;
  issueCount: number;
  chapterReadCount: number;
  expectedBookCount: number | null;
  authors: string[];
  coverBookIds: number[];
  lastAddedAt: string | null;
  members: SeriesMemberRow[];
  membersTruncated: boolean;
  libraryNames: string[];
};

export type SeriesVolumeMember = {
  seriesIndex: string | null;
  unit: SeriesUnit | null;
  status: string | null;
};

/** One book of a series, as the list needs it to draw the volume ladder. */
export type SeriesMemberRow = SeriesVolumeMember & {
  bookId: number;
  title: string | null;
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
  seriesUnit: SeriesUnit | null;
  fileId: number;
  format: string | null;
};

type SeriesDetailRow = {
  id: number;
  name: string;
  bookCount: number;
  workCount: number;
  readCount: number;
  expectedBookCount: number | null;
  authors: string[];
  indices: string[];
  members: SeriesVolumeMember[];
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

    const hasGapsExpr = seriesHasGapsSql();
    const completionHaving = this.buildCompletionHaving(params.completionStatus, bookCountExpr, readCountExpr, hasGapsExpr);
    const sortExpr = this.buildSortExpression(params.sort, params.order, nameExpr, bookCountExpr, lastAddedExpr, readProgressExpr, params.q);

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
        chapterCount: sql<number>`count(distinct CASE WHEN ${bookSeriesMemberships.seriesUnit} = 'chapter' THEN ${books.id} END)::int`,
        issueCount: sql<number>`count(distinct CASE WHEN ${bookSeriesMemberships.seriesUnit} = 'issue' THEN ${books.id} END)::int`,
        chapterReadCount: sql<number>`count(distinct CASE WHEN ${userBookStatus.status} = 'read' AND ${bookSeriesMemberships.seriesUnit} IN ('chapter', 'issue') THEN ${books.id} END)::int`,
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
    const [authorData, coverData, memberData, workCounts] = await Promise.all([
      this.fetchAuthorsForSeries(seriesIds, params.libraryIds, params.contentFilters),
      this.fetchCoverBookIds(seriesIds, params.libraryIds, params.contentFilters),
      this.fetchSeriesMembers(seriesIds, params.libraryIds, params.userId, params.contentFilters),
      this.fetchWorkCounts(seriesIds, params.libraryIds, params.contentFilters),
    ]);

    const items: SeriesSummaryRow[] = seriesRows.map((row) => {
      const members = memberData.get(row.id);
      return {
        id: row.id,
        name: row.name,
        bookCount: row.bookCount,
        workCount: workCounts.get(row.id) ?? row.bookCount,
        readCount: row.readCount,
        readingCount: row.readingCount,
        chapterCount: Number(row.chapterCount),
        issueCount: Number(row.issueCount),
        chapterReadCount: Number(row.chapterReadCount),
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
        workCount: sql<number>`count(distinct ${workKeySql(books.id)})::int`,
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

    const [authorsMap, memberRows] = await Promise.all([
      this.fetchAuthorsForSeries([params.seriesId], params.libraryIds, params.contentFilters),
      this.db
        .select({
          seriesIndex: bookSeriesMemberships.seriesIndex,
          unit: bookSeriesMemberships.seriesUnit,
          status: userBookStatus.status,
        })
        .from(books)
        .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.bookId, books.id))
        .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, params.userId)))
        .where(and(eq(bookSeriesMemberships.seriesId, params.seriesId), libraryFilter, ...filterClauses)),
    ]);

    const indices = memberRows.map((row) => row.seriesIndex).filter((index): index is string => index !== null);

    return {
      id: row.id,
      name: row.name,
      bookCount: row.bookCount,
      workCount: row.workCount,
      readCount: row.readCount,
      expectedBookCount: row.expectedBookCount ?? null,
      authors: authorsMap.get(params.seriesId) ?? [],
      indices,
      members: memberRows,
    };
  }

  /** Books the viewer can see: these libraries, under their content filters. */
  buildVisibleBooksWhere(libraryIds: number[], contentFilters?: ContentFilterRules): SQL {
    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    return and(this.buildLibraryFilter(libraryIds), ...filterClauses)!;
  }

  async findBookIds(params: {
    seriesId: number;
    page: number;
    size: number;
    sort: SeriesBookSort;
    order: SortDirection;
    libraryIds: number[];
    contentFilters?: ContentFilterRules;
    /** Fold linked editions into the one this user read last, else the main one. */
    collapseLinked?: { userId: number };
    /** Only volumes (with unclassified books) or only chapters and issues; omitted lists all. */
    unitClass?: SeriesUnitClass;
  }): Promise<{ bookIds: number[]; total: number; bookTotal: number }> {
    const libraryFilter = this.buildLibraryFilter(params.libraryIds);
    const filterClauses = params.contentFilters ? buildContentFilterClauses(params.contentFilters, this.db) : [];
    const orderBy = this.buildBookSortExpression(params.sort, params.order);
    if (params.collapseLinked) {
      return this.findBookIdsLinkCollapsed({ ...params, userId: params.collapseLinked.userId, filterClauses, orderBy });
    }
    const unitFilter = params.unitClass ? seriesUnitClassFilter(bookSeriesMemberships.seriesUnit, params.unitClass) : undefined;
    const where = and(eq(bookSeriesMemberships.seriesId, params.seriesId), unitFilter, libraryFilter, ...filterClauses)!;

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

    return { bookIds: dataRows.map((r) => r.id), total: Number(total), bookTotal: Number(total) };
  }

  /**
   * {@link findBookIds} with linked editions folded. Membership moves into an `IN` subquery so the
   * same predicate can feed `linkMembersCte`, which reads only books and their metadata; only
   * editions in this series compete, and the card keeps its representative's series position.
   */
  private async findBookIdsLinkCollapsed(params: {
    seriesId: number;
    page: number;
    size: number;
    libraryIds: number[];
    userId: number;
    filterClauses: SQL[];
    orderBy: SQL[];
    unitClass?: SeriesUnitClass;
  }): Promise<{ bookIds: number[]; total: number; bookTotal: number }> {
    const unitFilter = params.unitClass ? sql` AND ${seriesUnitClassFilter(sql.raw('bsm.series_unit'), params.unitClass)}` : sql``;
    const inSeries = sql`${books.id} IN (SELECT bsm.book_id FROM book_series_memberships bsm WHERE bsm.series_id = ${params.seriesId}${unitFilter})`;
    const visibleWhere = and(inSeries, this.buildLibraryFilter(params.libraryIds), ...params.filterClauses)!;
    const members = linkMembersCte(visibleWhere, params.userId);
    const [page, counts] = await Promise.all([
      this.db.execute<{ id: number }>(sql`
        WITH ${members}
        page AS (
          SELECT ${books.id} AS id
          FROM ${books}
          INNER JOIN ${bookSeriesMemberships} ON ${bookSeriesMemberships.bookId} = ${books.id} AND ${bookSeriesMemberships.seriesId} = ${params.seriesId}
          LEFT JOIN ${bookMetadata} ON ${bookMetadata.bookId} = ${books.id}
          WHERE ${visibleWhere} AND ${LINK_FOLDED_BY_PREFERENCE_SQL}
          ORDER BY ${sql.join(params.orderBy, sql`, `)}
          LIMIT ${params.size} OFFSET ${params.page * params.size}
        )
        SELECT id FROM page
      `),
      this.db.execute<{ book_total: string; folded_count: string }>(sql`
        WITH ${members}
        counted AS (
          SELECT count(*) AS book_total
          FROM ${books}
          LEFT JOIN ${bookMetadata} ON ${bookMetadata.bookId} = ${books.id}
          WHERE ${visibleWhere}
        )
        SELECT counted.book_total, ${LINK_FOLDED_COUNT_SQL} AS folded_count FROM counted
      `),
    ]);
    const bookTotal = Number(counts.rows[0]?.book_total ?? 0);
    const total = bookTotal - Number(counts.rows[0]?.folded_count ?? 0);
    return { bookIds: page.rows.map((row) => Number(row.id)), total, bookTotal };
  }

  /** Works behind each series' books: linked editions count once. One grouped query for the page. */
  private async fetchWorkCounts(seriesIds: number[], libraryIds: number[], contentFilters?: ContentFilterRules): Promise<Map<number, number>> {
    if (seriesIds.length === 0) return new Map();
    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const rows = await this.db
      .select({
        seriesId: bookSeriesMemberships.seriesId,
        workCount: sql<number>`count(distinct ${workKeySql(books.id)})::int`,
      })
      .from(books)
      .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.bookId, books.id))
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(and(inArray(bookSeriesMemberships.seriesId, seriesIds), this.buildLibraryFilter(libraryIds), ...filterClauses))
      .groupBy(bookSeriesMemberships.seriesId);
    return new Map(rows.map((row) => [row.seriesId, Number(row.workCount)]));
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
      .select({ seriesIndex: bookSeriesMemberships.seriesIndex, unit: bookSeriesMemberships.seriesUnit })
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

    // A volume leads to the next volume and a chapter to the next chapter, never across (v1 to c1).
    const sameClass = seriesUnitClassFilter(bookSeriesMemberships.seriesUnit, seriesUnitClass(current.unit));
    const filterClauses = params.contentFilters ? buildContentFilterClauses(params.contentFilters, this.db) : [];

    const [row] = await this.db
      .select({
        bookId: books.id,
        title: bookMetadata.title,
        seriesIndex: bookSeriesMemberships.seriesIndex,
        seriesUnit: bookSeriesMemberships.seriesUnit,
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
      .where(
        and(
          eq(bookSeriesMemberships.seriesId, params.seriesId),
          eq(books.status, 'present'),
          libraryFilter,
          sameClass,
          afterCurrent,
          ...filterClauses,
        ),
      )
      .orderBy(
        ...seriesIndexOrderBy(bookSeriesMemberships.seriesIndex, bookSeriesMemberships.seriesUnit, 'ASC'),
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
      .orderBy(
        bookSeriesMemberships.seriesId,
        ...seriesIndexOrderBy(bookSeriesMemberships.seriesIndex, bookSeriesMemberships.seriesUnit, 'ASC'),
        asc(books.addedAt),
      );

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
      [
        ...seriesIndexOrderBy(bookSeriesMemberships.seriesIndex, bookSeriesMemberships.seriesUnit, 'ASC'),
        sql`${books.addedAt} ASC`,
        sql`${books.id} ASC`,
      ],
      sql`, `,
    );

    const ranked = this.db
      .select({
        seriesId: bookSeriesMemberships.seriesId,
        bookId: books.id,
        seriesIndex: bookSeriesMemberships.seriesIndex,
        unit: bookSeriesMemberships.seriesUnit,
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
      entry.rows.push({ bookId: row.bookId, seriesIndex: row.seriesIndex, unit: row.unit ?? null, title: row.title, status: row.status });
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
    query?: string,
  ): SQL[] {
    const dir = order === 'asc' ? asc : desc;
    const tiebreaker = asc(nameExpr);

    switch (sort) {
      case 'relevance': {
        if (!query) return [asc(nameExpr)];
        const authorScore = sql`COALESCE(max((
          SELECT max(${seriesSearchScore(authors.name, query, 800, 680, 520, 340)})
          FROM ${bookAuthors}
          INNER JOIN ${authors} ON ${authors.id} = ${bookAuthors.authorId}
          WHERE ${bookAuthors.bookId} = ${books.id}
        )), 0)`;
        const score = sql`GREATEST(${seriesSearchScore(bookSeries.name, query, 1000, 820, 620, 400)}, ${authorScore})`;
        return [dir(score), tiebreaker];
      }
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
        return [
          ...seriesIndexOrderBy(bookSeriesMemberships.seriesIndex, bookSeriesMemberships.seriesUnit, order === 'asc' ? 'ASC' : 'DESC'),
          asc(books.id),
        ];
    }
  }
}

function seriesSearchScore(
  value: typeof authors.name | typeof bookSeries.name,
  query: string,
  exact: number,
  prefix: number,
  contains: number,
  fuzzy: number,
): SQL {
  const normalizedValue = sql`lower(public.bookorbit_unaccent(COALESCE(${value}, '')))`;
  const normalizedQuery = sql`lower(public.bookorbit_unaccent(${query}))`;
  return sql`CASE
    WHEN ${normalizedValue} = ${normalizedQuery} THEN ${exact}
    WHEN ${normalizedValue} LIKE ${normalizedQuery} || '%' THEN ${prefix}
    WHEN ${normalizedValue} LIKE '%' || ${normalizedQuery} || '%' THEN ${contains}
    ELSE similarity(${normalizedValue}, ${normalizedQuery}) * ${fuzzy}
  END`;
}
