import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, count, desc, eq, ilike, inArray, isNotNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules } from '@bookorbit/types';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookMetadata, books, bookSeries, userBookStatus } from '../../db/schema';
import type { SeriesListSort, SortDirection } from './dto/list-series.dto';
import type { SeriesBookSort } from './dto/list-series-books.dto';

type Db = NodePgDatabase<typeof schema>;

type SeriesSummaryRow = {
  id: number;
  name: string;
  bookCount: number;
  readCount: number;
  authors: string[];
  coverBookIds: number[];
  lastAddedAt: string | null;
};

type SeriesDetailRow = {
  id: number;
  name: string;
  bookCount: number;
  readCount: number;
  authors: string[];
  indices: number[];
};

@Injectable()
export class SeriesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private buildLibraryFilter(libraryIds: number[]): SQL {
    return inArray(books.libraryId, libraryIds);
  }

  private escapeLikePattern(s: string): string {
    return s.replace(/[\\%_]/g, '\\$&');
  }

  private buildAuthorNameMatchCondition(pattern: string): SQL {
    return sql`${books.id} IN (
      SELECT ${bookAuthors.bookId} FROM ${bookAuthors}
      INNER JOIN ${authors} ON ${authors.id} = ${bookAuthors.authorId}
      WHERE ${ilike(authors.name, pattern)}
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
  }): Promise<{ items: SeriesSummaryRow[]; total: number; page: number; size: number }> {
    const libraryFilter = this.buildLibraryFilter(params.libraryIds);
    const filterClauses = params.contentFilters ? buildContentFilterClauses(params.contentFilters, this.db) : [];

    const conditions: SQL[] = [isNotNull(bookMetadata.seriesId), libraryFilter, ...filterClauses];

    if (params.q) {
      const qPattern = `%${this.escapeLikePattern(params.q)}%`;
      const authorNameMatch = this.buildAuthorNameMatchCondition(qPattern);
      conditions.push(sql`(${ilike(bookSeries.name, qPattern)} OR ${authorNameMatch})`);
    }

    if (params.author) {
      const authorPattern = `%${this.escapeLikePattern(params.author)}%`;
      conditions.push(this.buildAuthorNameMatchCondition(authorPattern));
    }

    const baseWhere = and(...conditions)!;

    const bookCountExpr = sql<number>`count(distinct ${books.id})::int`;
    const readCountExpr = sql<number>`count(distinct CASE WHEN ${userBookStatus.status} = 'read' THEN ${books.id} END)::int`;
    const lastAddedExpr = sql<string | null>`max(${books.addedAt})::text`;
    const readProgressExpr = sql<number>`
      CASE WHEN count(distinct ${books.id}) = 0 THEN 0
      ELSE (count(distinct CASE WHEN ${userBookStatus.status} = 'read' THEN ${books.id} END)::float / count(distinct ${books.id})::float)
      END`;
    const nameExpr = sql<string>`${bookSeries.name}`;

    const completionHaving = this.buildCompletionHaving(params.completionStatus, bookCountExpr, readCountExpr);
    const sortExpr = this.buildSortExpression(params.sort, params.order, nameExpr, bookCountExpr, lastAddedExpr, readProgressExpr);

    const baseQuery = this.db
      .select({
        id: bookSeries.id,
        name: bookSeries.name,
        bookCount: bookCountExpr,
        readCount: readCountExpr,
        lastAddedAt: lastAddedExpr,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(bookSeries, eq(bookSeries.id, bookMetadata.seriesId))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, params.userId)))
      .where(baseWhere)
      .groupBy(bookSeries.id, bookSeries.name);

    const countQuery = this.db
      .select({ total: sql<number>`count(*)::int` })
      .from((completionHaving ? baseQuery.having(completionHaving) : baseQuery).as('series_groups'));

    const dataQuery = this.db
      .select({
        id: bookSeries.id,
        name: bookSeries.name,
        bookCount: bookCountExpr,
        readCount: readCountExpr,
        lastAddedAt: lastAddedExpr,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(bookSeries, eq(bookSeries.id, bookMetadata.seriesId))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, params.userId)))
      .where(baseWhere)
      .groupBy(bookSeries.id, bookSeries.name)
      .$dynamic();

    if (completionHaving) {
      dataQuery.having(completionHaving);
    }

    dataQuery.orderBy(...sortExpr);
    dataQuery.limit(params.size);
    dataQuery.offset(params.page * params.size);

    const [countResult, seriesRows] = await Promise.all([countQuery, dataQuery]);
    const total = countResult[0]?.total ?? 0;

    if (seriesRows.length === 0) {
      return { items: [], total, page: params.page, size: params.size };
    }

    const seriesIds = seriesRows.map((row) => row.id);
    const [authorData, coverData] = await Promise.all([
      this.fetchAuthorsForSeries(seriesIds, params.libraryIds, params.contentFilters),
      this.fetchCoverBookIds(seriesIds, params.libraryIds, params.contentFilters),
    ]);

    const items: SeriesSummaryRow[] = seriesRows.map((row) => ({
      id: row.id,
      name: row.name,
      bookCount: row.bookCount,
      readCount: row.readCount,
      authors: authorData.get(row.id) ?? [],
      coverBookIds: coverData.get(row.id) ?? [],
      lastAddedAt: row.lastAddedAt,
    }));

    return { items, total, page: params.page, size: params.size };
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
        bookCount: sql<number>`count(distinct ${books.id})::int`,
        readCount: sql<number>`count(distinct CASE WHEN ${userBookStatus.status} = 'read' THEN ${books.id} END)::int`,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(bookSeries, eq(bookSeries.id, bookMetadata.seriesId))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, params.userId)))
      .where(and(eq(bookSeries.id, params.seriesId), libraryFilter, ...filterClauses))
      .groupBy(bookSeries.id, bookSeries.name);

    if (rows.length === 0) return null;

    const row = rows[0];

    const [authorsMap, indicesRows] = await Promise.all([
      this.fetchAuthorsForSeries([params.seriesId], params.libraryIds, params.contentFilters),
      this.db
        .select({ idx: bookMetadata.seriesIndex })
        .from(books)
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(and(eq(bookMetadata.seriesId, params.seriesId), libraryFilter, ...filterClauses, isNotNull(bookMetadata.seriesIndex))),
    ]);

    const indices = indicesRows.map((r) => r.idx!);

    return {
      id: row.id,
      name: row.name,
      bookCount: row.bookCount,
      readCount: row.readCount,
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
    const where = and(eq(bookMetadata.seriesId, params.seriesId), libraryFilter, ...filterClauses)!;

    const orderBy = this.buildBookSortExpression(params.sort, params.order);

    const [dataRows, [{ total }]] = await Promise.all([
      this.db
        .select({ id: books.id })
        .from(books)
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where)
        .orderBy(...orderBy)
        .limit(params.size)
        .offset(params.page * params.size),
      this.db.select({ total: count() }).from(books).innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id)).where(where),
    ]);

    return { bookIds: dataRows.map((r) => r.id), total: Number(total) };
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
        seriesId: bookMetadata.seriesId,
        authorName: authors.name,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(and(inArray(bookMetadata.seriesId, seriesIds), this.buildLibraryFilter(libraryIds), ...filterClauses))
      .groupBy(bookMetadata.seriesId, authors.name);

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
        seriesId: bookMetadata.seriesId,
        bookId: books.id,
        seriesIndex: bookMetadata.seriesIndex,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(
        and(inArray(bookMetadata.seriesId, seriesIds), this.buildLibraryFilter(libraryIds), ...filterClauses, isNotNull(bookMetadata.coverSource)),
      )
      .orderBy(bookMetadata.seriesId, asc(bookMetadata.seriesIndex), asc(books.addedAt));

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

  private buildCompletionHaving(status: string | undefined, bookCountExpr: SQL<number>, readCountExpr: SQL<number>): SQL | undefined {
    if (!status) return undefined;

    switch (status) {
      case 'not_started':
        return sql`${readCountExpr} = 0`;
      case 'in_progress':
        return sql`${readCountExpr} > 0 AND ${readCountExpr} < ${bookCountExpr}`;
      case 'complete':
        return sql`${readCountExpr} = ${bookCountExpr}`;
      default:
        return undefined;
    }
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
        return [order === 'asc' ? sql`${bookMetadata.seriesIndex} ASC NULLS LAST` : sql`${bookMetadata.seriesIndex} DESC NULLS LAST`, asc(books.id)];
    }
  }
}
