import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, count, desc, eq, ilike, inArray, isNotNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookMetadata, books, userBookStatus } from '../../db/schema';
import type { SeriesListSort, SortDirection } from './dto/list-series.dto';
import type { SeriesBookSort } from './dto/list-series-books.dto';

type Db = NodePgDatabase<typeof schema>;

type SeriesSummaryRow = {
  name: string;
  bookCount: number;
  readCount: number;
  authors: string[];
  coverBookIds: number[];
  lastAddedAt: string | null;
};

type SeriesDetailRow = {
  name: string;
  bookCount: number;
  readCount: number;
  authors: string[];
  indices: number[];
};

@Injectable()
export class SeriesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private normalizedSeriesName() {
    return sql<string>`lower(btrim(${bookMetadata.seriesName}))`;
  }

  private buildLibraryFilter(libraryIds: number[]): SQL {
    return inArray(books.libraryId, libraryIds);
  }

  private escapeLikePattern(s: string): string {
    return s.replace(/[\\%_]/g, '\\$&');
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
  }): Promise<{ items: SeriesSummaryRow[]; total: number; page: number; size: number }> {
    const normalized = this.normalizedSeriesName();
    const libraryFilter = this.buildLibraryFilter(params.libraryIds);

    const conditions: SQL[] = [isNotNull(bookMetadata.seriesName), sql`btrim(${bookMetadata.seriesName}) != ''`, libraryFilter];

    if (params.q) {
      conditions.push(ilike(bookMetadata.seriesName, `%${this.escapeLikePattern(params.q)}%`));
    }

    if (params.author) {
      const authorPattern = `%${this.escapeLikePattern(params.author)}%`;
      conditions.push(
        sql`${books.id} IN (
          SELECT ${bookAuthors.bookId} FROM ${bookAuthors}
          INNER JOIN ${authors} ON ${authors.id} = ${bookAuthors.authorId}
          WHERE ${ilike(authors.name, authorPattern)}
        )`,
      );
    }

    const baseWhere = and(...conditions)!;

    const bookCountExpr = sql<number>`count(distinct ${books.id})::int`;
    const readCountExpr = sql<number>`count(distinct CASE WHEN ${userBookStatus.status} = 'read' THEN ${books.id} END)::int`;
    const lastAddedExpr = sql<string | null>`max(${books.addedAt})::text`;
    const readProgressExpr = sql<number>`
      CASE WHEN count(distinct ${books.id}) = 0 THEN 0
      ELSE (count(distinct CASE WHEN ${userBookStatus.status} = 'read' THEN ${books.id} END)::float / count(distinct ${books.id})::float)
      END`;
    const displayNameExpr = sql<string>`min(btrim(${bookMetadata.seriesName}))`;

    const completionHaving = this.buildCompletionHaving(params.completionStatus, bookCountExpr, readCountExpr);

    const sortExpr = this.buildSortExpression(params.sort, params.order, displayNameExpr, bookCountExpr, lastAddedExpr, readProgressExpr);

    const baseQuery = this.db
      .select({
        name: displayNameExpr,
        bookCount: bookCountExpr,
        readCount: readCountExpr,
        lastAddedAt: lastAddedExpr,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, params.userId)))
      .where(baseWhere)
      .groupBy(normalized);

    const countQuery = this.db
      .select({ total: sql<number>`count(*)::int` })
      .from((completionHaving ? baseQuery.having(completionHaving) : baseQuery).as('series_groups'));

    const dataQuery = this.db
      .select({
        name: displayNameExpr,
        bookCount: bookCountExpr,
        readCount: readCountExpr,
        lastAddedAt: lastAddedExpr,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, params.userId)))
      .where(baseWhere)
      .groupBy(normalized)
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

    const seriesNames = seriesRows.map((r) => r.name);
    const [authorData, coverData] = await Promise.all([
      this.fetchAuthorsForSeries(seriesNames, params.libraryIds),
      this.fetchCoverBookIds(seriesNames, params.libraryIds),
    ]);

    const items: SeriesSummaryRow[] = seriesRows.map((row) => ({
      name: row.name,
      bookCount: row.bookCount,
      readCount: row.readCount,
      authors: authorData.get(row.name.toLowerCase().trim()) ?? [],
      coverBookIds: coverData.get(row.name.toLowerCase().trim()) ?? [],
      lastAddedAt: row.lastAddedAt,
    }));

    return { items, total, page: params.page, size: params.size };
  }

  async findDetail(params: { seriesName: string; userId: number; libraryIds: number[] }): Promise<SeriesDetailRow | null> {
    const libraryFilter = this.buildLibraryFilter(params.libraryIds);

    const rows = await this.db
      .select({
        displayName: sql<string>`min(btrim(${bookMetadata.seriesName}))`,
        bookCount: sql<number>`count(distinct ${books.id})::int`,
        readCount: sql<number>`count(distinct CASE WHEN ${userBookStatus.status} = 'read' THEN ${books.id} END)::int`,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, params.userId)))
      .where(and(sql`lower(btrim(${bookMetadata.seriesName})) = lower(btrim(${params.seriesName}))`, libraryFilter))
      .groupBy(this.normalizedSeriesName());

    if (rows.length === 0) return null;

    const row = rows[0];
    const normalizedName = params.seriesName.toLowerCase().trim();

    const [authorsMap, indicesRows] = await Promise.all([
      this.fetchAuthorsForSeries([row.displayName], params.libraryIds),
      this.db
        .select({ idx: bookMetadata.seriesIndex })
        .from(books)
        .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(
          and(sql`lower(btrim(${bookMetadata.seriesName})) = lower(btrim(${params.seriesName}))`, libraryFilter, isNotNull(bookMetadata.seriesIndex)),
        ),
    ]);

    const indices = indicesRows.map((r) => r.idx!);

    return {
      name: row.displayName,
      bookCount: row.bookCount,
      readCount: row.readCount,
      authors: authorsMap.get(normalizedName) ?? [],
      indices,
    };
  }

  async findBookIds(params: {
    seriesName: string;
    page: number;
    size: number;
    sort: SeriesBookSort;
    order: SortDirection;
    libraryIds: number[];
  }): Promise<{ bookIds: number[]; total: number }> {
    const libraryFilter = this.buildLibraryFilter(params.libraryIds);
    const seriesMatch = sql`lower(btrim(${bookMetadata.seriesName})) = lower(btrim(${params.seriesName}))`;
    const where = and(seriesMatch, libraryFilter)!;

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

  private async fetchAuthorsForSeries(seriesNames: string[], libraryIds: number[]): Promise<Map<string, string[]>> {
    if (seriesNames.length === 0) return new Map();

    const normalized = seriesNames.map((n) => n.toLowerCase().trim());
    const rows = await this.db
      .select({
        normalizedSeries: sql<string>`lower(btrim(${bookMetadata.seriesName}))`,
        authorName: authors.name,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(
        and(
          sql`lower(btrim(${bookMetadata.seriesName})) IN (${sql.join(
            normalized.map((n) => sql`${n}`),
            sql`, `,
          )})`,
          this.buildLibraryFilter(libraryIds),
        ),
      )
      .groupBy(sql`lower(btrim(${bookMetadata.seriesName}))`, authors.name);

    const result = new Map<string, string[]>();
    for (const row of rows) {
      const key = row.normalizedSeries;
      const list = result.get(key) ?? [];
      list.push(row.authorName);
      result.set(key, list);
    }
    return result;
  }

  private async fetchCoverBookIds(seriesNames: string[], libraryIds: number[]): Promise<Map<string, number[]>> {
    if (seriesNames.length === 0) return new Map();

    const normalized = seriesNames.map((n) => n.toLowerCase().trim());
    const rows = await this.db
      .select({
        normalizedSeries: sql<string>`lower(btrim(${bookMetadata.seriesName}))`,
        bookId: books.id,
        seriesIndex: bookMetadata.seriesIndex,
      })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(
        and(
          sql`lower(btrim(${bookMetadata.seriesName})) IN (${sql.join(
            normalized.map((n) => sql`${n}`),
            sql`, `,
          )})`,
          this.buildLibraryFilter(libraryIds),
          isNotNull(bookMetadata.coverSource),
        ),
      )
      .orderBy(sql`lower(btrim(${bookMetadata.seriesName}))`, asc(bookMetadata.seriesIndex), asc(books.addedAt));

    const result = new Map<string, number[]>();
    for (const row of rows) {
      const key = row.normalizedSeries;
      const list = result.get(key) ?? [];
      if (list.length < 9) {
        list.push(row.bookId);
      }
      result.set(key, list);
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
