import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, desc, eq, ilike, inArray, isNull, max, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules } from '@bookorbit/types';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { DB } from '../../db';
import { refreshPrimaryAuthorSortNamesForAuthors, refreshPrimaryAuthorSortNamesForBooks } from '../../db/book-author-sort-key';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookMetadata, books } from '../../db/schema';
import { AuthorBookSort } from './dto/list-author-books.dto';
import { AuthorListSort, SortDirection } from './dto/list-authors.dto';

type Db = NodePgDatabase<typeof schema>;

type AuthorSummaryRow = {
  id: number;
  name: string;
  sortName: string | null;
  description: string | null;
  bookCount: number;
  lastAddedAt: Date | null;
};

type AuthorBookIdRow = {
  id: number;
};

@Injectable()
export class AuthorsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findPage(params: {
    q?: string;
    page: number;
    size: number;
    sort: AuthorListSort;
    order: SortDirection;
    libraryIds: number[];
    hasPhoto?: boolean;
    minBookCount?: number;
    contentFilters?: ContentFilterRules;
  }): Promise<{ items: AuthorSummaryRow[]; total: number; page: number; size: number }> {
    const where = this.buildAuthorWhere({
      q: params.q,
      libraryIds: params.libraryIds,
      hasPhoto: params.hasPhoto,
      contentFilters: params.contentFilters,
    });
    const bookCountExpr = sql<number>`count(distinct ${books.id})`;
    const lastAddedExpr = max(books.addedAt);

    const sortNameExpr = sql`COALESCE(${authors.sortName}, ${authors.name})`;

    const orderBy =
      params.sort === 'bookCount'
        ? this.orderByDirection(bookCountExpr, params.order)
        : params.sort === 'lastAddedAt'
          ? this.orderByDirection(lastAddedExpr, params.order)
          : params.sort === 'lastEnrichedAt'
            ? params.order === 'asc'
              ? sql`${authors.lastEnrichedAt} ASC NULLS LAST`
              : sql`${authors.lastEnrichedAt} DESC NULLS LAST`
            : params.sort === 'sortName'
              ? this.orderByDirection(sortNameExpr, params.order)
              : this.orderByDirection(authors.name, params.order);

    const having = params.minBookCount !== undefined ? sql`count(distinct ${books.id}) >= ${params.minBookCount}` : undefined;

    const dataQuery = this.db
      .select({
        id: authors.id,
        name: authors.name,
        sortName: authors.sortName,
        description: authors.description,
        bookCount: sql<number>`count(distinct ${books.id})::int`,
        lastAddedAt: lastAddedExpr,
      })
      .from(authors)
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(where)
      .groupBy(authors.id, authors.name, authors.sortName, authors.description)
      .having(having)
      .orderBy(orderBy, sql`${sortNameExpr} ASC`, asc(authors.name))
      .limit(params.size)
      .offset(params.page * params.size);

    // When minBookCount is set, HAVING must be applied per-author before counting,
    // which requires a subquery. For the common case, use the cheaper scalar count.
    const countQuery = having
      ? this.db
          .select({ total: sql<number>`count(*)::int` })
          .from(
            this.db
              .select({ id: authors.id })
              .from(authors)
              .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
              .innerJoin(books, eq(books.id, bookAuthors.bookId))
              .where(where)
              .groupBy(authors.id)
              .having(having)
              .as('filtered_authors'),
          )
      : this.db
          .select({ total: sql<number>`count(distinct ${authors.id})::int` })
          .from(authors)
          .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
          .innerJoin(books, eq(books.id, bookAuthors.bookId))
          .where(where);

    const [items, [{ total }]] = await Promise.all([dataQuery, countQuery]);

    return { items, total: Number(total), page: params.page, size: params.size };
  }

  async findById(authorId: number, libraryIds: number[], contentFilters?: ContentFilterRules): Promise<AuthorSummaryRow | null> {
    if (libraryIds.length === 0) return null;

    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    const [row] = await this.db
      .select({
        id: authors.id,
        name: authors.name,
        sortName: authors.sortName,
        description: authors.description,
        bookCount: sql<number>`count(distinct ${books.id})::int`,
        lastAddedAt: max(books.addedAt),
      })
      .from(authors)
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(and(eq(authors.id, authorId), inArray(books.libraryId, libraryIds), ...filterClauses))
      .groupBy(authors.id, authors.name, authors.sortName, authors.description)
      .limit(1);

    return row ?? null;
  }

  async findByIdForEnrichment(authorId: number): Promise<AuthorSummaryRow | null> {
    const [row] = await this.db
      .select({
        id: authors.id,
        name: authors.name,
        sortName: authors.sortName,
        description: authors.description,
        bookCount: sql<number>`count(distinct ${books.id})::int`,
        lastAddedAt: max(books.addedAt),
      })
      .from(authors)
      .leftJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .leftJoin(books, eq(books.id, bookAuthors.bookId))
      .where(eq(authors.id, authorId))
      .groupBy(authors.id, authors.name, authors.sortName, authors.description)
      .limit(1);
    return row ?? null;
  }

  async findBookIdsPage(params: {
    authorId: number;
    page: number;
    size: number;
    sort: AuthorBookSort;
    order: SortDirection;
    libraryIds: number[];
    contentFilters?: ContentFilterRules;
  }): Promise<{ bookIds: number[]; total: number; page: number; size: number }> {
    if (params.libraryIds.length === 0) {
      return { bookIds: [], total: 0, page: params.page, size: params.size };
    }

    const filterClauses = params.contentFilters ? buildContentFilterClauses(params.contentFilters, this.db) : [];
    const where = and(eq(bookAuthors.authorId, params.authorId), inArray(books.libraryId, params.libraryIds), ...filterClauses);

    const sortExpr = params.sort === 'title' ? bookMetadata.title : params.sort === 'publishedYear' ? bookMetadata.publishedYear : books.addedAt;

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({ id: books.id })
        .from(books)
        .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where)
        .orderBy(this.orderByDirection(sortExpr, params.order), asc(books.id))
        .limit(params.size)
        .offset(params.page * params.size),
      this.db
        .select({ total: sql<number>`count(distinct ${books.id})::int` })
        .from(books)
        .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
        .where(where),
    ]);

    return { bookIds: rows.map((row: AuthorBookIdRow) => row.id), total: Number(total), page: params.page, size: params.size };
  }

  async updateAuthorById(
    authorId: number,
    values: Partial<{
      name: string;
      sortName: string | null;
      description: string | null;
      hasPhoto: boolean;
      lastEnrichedAt: Date | null;
    }>,
  ) {
    const [updated] = await this.db.update(authors).set(values).where(eq(authors.id, authorId)).returning({
      id: authors.id,
      name: authors.name,
      sortName: authors.sortName,
      description: authors.description,
      hasPhoto: authors.hasPhoto,
      lastEnrichedAt: authors.lastEnrichedAt,
    });
    if (updated && (values.name !== undefined || values.sortName !== undefined)) {
      await refreshPrimaryAuthorSortNamesForAuthors(this.db, [authorId]);
    }
    return updated ?? null;
  }

  async updateAuthorDescriptionIfEmpty(authorId: number, description: string): Promise<boolean> {
    const updated = await this.db
      .update(authors)
      .set({ description })
      .where(and(eq(authors.id, authorId), or(isNull(authors.description), eq(sql`btrim(${authors.description})`, ''))))
      .returning({ id: authors.id });
    return updated.length > 0;
  }

  async findVisibleAuthorIds(authorIds: number[], libraryIds: number[]): Promise<number[]> {
    if (authorIds.length === 0 || libraryIds.length === 0) return [];
    const rows = await this.db
      .selectDistinct({ id: authors.id })
      .from(authors)
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(and(inArray(authors.id, authorIds), inArray(books.libraryId, libraryIds)));
    return rows.map((row) => row.id);
  }

  async countDistinctBooks(authorIds: number[]): Promise<number> {
    if (authorIds.length === 0) return 0;
    const [{ total }] = await this.db
      .select({ total: sql<number>`count(distinct ${bookAuthors.bookId})::int` })
      .from(bookAuthors)
      .where(inArray(bookAuthors.authorId, authorIds));
    return Number(total);
  }

  async findRelatedLibraryIds(authorIds: number[]): Promise<number[]> {
    if (authorIds.length === 0) return [];
    const rows = await this.db
      .selectDistinct({ libraryId: books.libraryId })
      .from(bookAuthors)
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(inArray(bookAuthors.authorId, authorIds));
    return rows.map((row) => row.libraryId);
  }

  async mergeAuthors(targetAuthorId: number, sourceAuthorIds: number[]): Promise<void> {
    if (sourceAuthorIds.length === 0) return;

    await this.db.transaction(async (tx) => {
      const sourceRelations = await tx
        .select({
          bookId: bookAuthors.bookId,
          displayOrder: bookAuthors.displayOrder,
        })
        .from(bookAuthors)
        .where(inArray(bookAuthors.authorId, sourceAuthorIds));

      if (sourceRelations.length > 0) {
        await tx
          .insert(bookAuthors)
          .values(
            sourceRelations.map((row) => ({
              bookId: row.bookId,
              authorId: targetAuthorId,
              displayOrder: row.displayOrder,
            })),
          )
          .onConflictDoNothing();
      }

      await tx.delete(bookAuthors).where(inArray(bookAuthors.authorId, sourceAuthorIds));
      await tx.delete(authors).where(inArray(authors.id, sourceAuthorIds));
      await refreshPrimaryAuthorSortNamesForBooks(
        tx,
        sourceRelations.map((row) => row.bookId),
      );
    });
  }

  async deleteAuthors(authorIds: number[]): Promise<void> {
    if (authorIds.length === 0) return;

    await this.db.transaction(async (tx) => {
      const relations = await tx
        .select({
          bookId: bookAuthors.bookId,
        })
        .from(bookAuthors)
        .where(inArray(bookAuthors.authorId, authorIds));
      await tx.delete(bookAuthors).where(inArray(bookAuthors.authorId, authorIds));
      await tx.delete(authors).where(inArray(authors.id, authorIds));
      await refreshPrimaryAuthorSortNamesForBooks(
        tx,
        relations.map((row) => row.bookId),
      );
    });
  }

  private buildAuthorWhere(params: { q?: string; libraryIds: number[]; hasPhoto?: boolean; contentFilters?: ContentFilterRules }): SQL {
    const clauses: SQL[] = [inArray(books.libraryId, params.libraryIds)];
    if (params.contentFilters) {
      clauses.push(...buildContentFilterClauses(params.contentFilters, this.db));
    }
    const query = params.q?.trim();
    if (query) {
      clauses.push(ilike(authors.name, `%${escapeLikePattern(query)}%`));
    }
    if (params.hasPhoto !== undefined) {
      clauses.push(eq(authors.hasPhoto, params.hasPhoto));
    }
    return and(...clauses)!;
  }

  private orderByDirection(
    expression:
      | SQL
      | typeof authors.name
      | typeof authors.sortName
      | typeof bookMetadata.title
      | typeof bookMetadata.publishedYear
      | typeof books.addedAt,
    order: SortDirection,
  ) {
    return order === 'asc' ? asc(expression) : desc(expression);
  }
}

function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}
