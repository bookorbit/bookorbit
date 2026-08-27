import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, desc, eq, inArray, isNull, max, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules } from '@bookorbit/types';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { accentInsensitiveIlike, buildSearchPattern } from '../../common/utils/accent-insensitive-search.utils';
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

/** The list query alone resolves a cover fallback; detail and enrichment do not need one. */
export type AuthorListItemRow = AuthorSummaryRow & {
  coverBookId: number | null;
};

export type AuthorLetterCountRow = {
  letter: string;
  count: number;
};

type AuthorBookIdRow = {
  id: number;
};

export type AuthorDetailRow = AuthorSummaryRow & {
  birthDate: string | null;
  birthYear: number | null;
  deathDate: string | null;
  deathYear: number | null;
  website: string | null;
  genres: string[] | null;
  influences: string[] | null;
  metadataProvider: string | null;
  metadataProviderId: string | null;
};

export type AuthorEnrichmentRow = AuthorSummaryRow & {
  hasPhoto: boolean;
  birthDate: string | null;
  birthYear: number | null;
  deathDate: string | null;
  deathYear: number | null;
  website: string | null;
  genres: string[] | null;
  influences: string[] | null;
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
    hasSortName?: boolean;
    addedWithinDays?: number;
    minBookCount?: number;
    contentFilters?: ContentFilterRules;
  }): Promise<{ items: AuthorListItemRow[]; total: number; page: number; size: number }> {
    const where = this.buildAuthorWhere({
      q: params.q,
      libraryIds: params.libraryIds,
      hasPhoto: params.hasPhoto,
      hasSortName: params.hasSortName,
      addedWithinDays: params.addedWithinDays,
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
        coverBookId: this.coverBookIdExpr(params.libraryIds),
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

  async countAuthors(params: { libraryIds: number[]; contentFilters?: ContentFilterRules }): Promise<number> {
    if (params.libraryIds.length === 0) return 0;

    const [row] = await this.db
      .select({ total: sql<number>`count(distinct ${bookAuthors.authorId})::int` })
      .from(bookAuthors)
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(this.buildAuthorWhere({ libraryIds: params.libraryIds, contentFilters: params.contentFilters }));

    return Number(row?.total ?? 0);
  }

  async findById(authorId: number, libraryIds: number[], contentFilters?: ContentFilterRules): Promise<AuthorDetailRow | null> {
    if (libraryIds.length === 0) return null;

    const filterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    const [row] = await this.db
      .select({
        id: authors.id,
        name: authors.name,
        sortName: authors.sortName,
        description: authors.description,
        birthDate: authors.birthDate,
        birthYear: authors.birthYear,
        deathDate: authors.deathDate,
        deathYear: authors.deathYear,
        website: authors.website,
        genres: authors.genres,
        influences: authors.influences,
        metadataProvider: authors.metadataProvider,
        metadataProviderId: authors.metadataProviderId,
        bookCount: sql<number>`count(distinct ${books.id})::int`,
        lastAddedAt: max(books.addedAt),
      })
      .from(authors)
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(and(eq(authors.id, authorId), inArray(books.libraryId, libraryIds), ...filterClauses))
      .groupBy(
        authors.id,
        authors.name,
        authors.sortName,
        authors.description,
        authors.birthDate,
        authors.birthYear,
        authors.deathDate,
        authors.deathYear,
        authors.website,
        authors.genres,
        authors.influences,
        authors.metadataProvider,
        authors.metadataProviderId,
      )
      .limit(1);

    return row ?? null;
  }

  async findByIdForEnrichment(authorId: number): Promise<AuthorEnrichmentRow | null> {
    const [row] = await this.db
      .select({
        id: authors.id,
        name: authors.name,
        sortName: authors.sortName,
        description: authors.description,
        hasPhoto: authors.hasPhoto,
        birthDate: authors.birthDate,
        birthYear: authors.birthYear,
        deathDate: authors.deathDate,
        deathYear: authors.deathYear,
        website: authors.website,
        genres: authors.genres,
        influences: authors.influences,
        bookCount: sql<number>`count(distinct ${books.id})::int`,
        lastAddedAt: max(books.addedAt),
      })
      .from(authors)
      .leftJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .leftJoin(books, eq(books.id, bookAuthors.bookId))
      .where(eq(authors.id, authorId))
      .groupBy(
        authors.id,
        authors.name,
        authors.sortName,
        authors.description,
        authors.hasPhoto,
        authors.birthDate,
        authors.birthYear,
        authors.deathDate,
        authors.deathYear,
        authors.website,
        authors.genres,
        authors.influences,
      )
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
      birthDate: string | null;
      birthYear: number | null;
      deathDate: string | null;
      deathYear: number | null;
      website: string | null;
      genres: string[] | null;
      influences: string[] | null;
      metadataProvider: string | null;
      metadataProviderId: string | null;
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

  async findBookIdsByAuthorIds(authorIds: number[]): Promise<number[]> {
    if (authorIds.length === 0) return [];
    const rows = await this.db.selectDistinct({ bookId: bookAuthors.bookId }).from(bookAuthors).where(inArray(bookAuthors.authorId, authorIds));
    return rows.map((row) => row.bookId);
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

  /**
   * The most recently added book of theirs that actually carries cover art, scoped to
   * the libraries the caller can see. Correlated per row rather than joined, so it costs
   * one index lookup per author on the page instead of widening the grouped join.
   */
  private coverBookIdExpr(libraryIds: number[]): SQL<number | null> {
    return sql<number | null>`(
      SELECT cb.id
      FROM ${bookAuthors} cba
      JOIN ${books} cb ON cb.id = cba.book_id
      JOIN ${bookMetadata} cm ON cm.book_id = cb.id
      WHERE cba.author_id = ${authors.id}
        AND cb.library_id IN (${sql.join(
          libraryIds.map((id) => sql`${id}`),
          sql`, `,
        )})
        AND cm.cover_source IS NOT NULL
      ORDER BY cb.added_at DESC, cb.id DESC
      LIMIT 1
    )`;
  }

  /**
   * Counts per A-Z bucket for the jump rail, under the same filters as the list. One
   * grouped query, so the rail stays correct for a library the page has not scrolled
   * through yet. Anything not starting A-Z buckets to "#".
   */
  async findLetterCounts(params: {
    q?: string;
    /** Must match the field the list is ordered by, or the rail points at the wrong rows. */
    sort: Extract<AuthorListSort, 'name' | 'sortName'>;
    order: SortDirection;
    libraryIds: number[];
    hasPhoto?: boolean;
    hasSortName?: boolean;
    addedWithinDays?: number;
    minBookCount?: number;
    contentFilters?: ContentFilterRules;
  }): Promise<AuthorLetterCountRow[]> {
    if (params.libraryIds.length === 0) return [];

    const where = this.buildAuthorWhere({
      q: params.q,
      libraryIds: params.libraryIds,
      hasPhoto: params.hasPhoto,
      hasSortName: params.hasSortName,
      addedWithinDays: params.addedWithinDays,
      contentFilters: params.contentFilters,
    });
    const having = params.minBookCount !== undefined ? sql`count(distinct ${books.id}) >= ${params.minBookCount}` : undefined;

    const perAuthor = this.db
      .select({ letter: this.letterBucketExpr(params.sort).as('letter') })
      .from(authors)
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(where)
      .groupBy(authors.id, authors.sortName, authors.name)
      .having(having)
      .as('per_author');

    const rows = await this.db
      .select({ letter: perAuthor.letter, count: sql<number>`count(*)::int` })
      .from(perAuthor)
      .groupBy(perAuthor.letter)
      .orderBy(params.order === 'asc' ? asc(perAuthor.letter) : desc(perAuthor.letter));

    return rows.map((row) => ({ letter: row.letter, count: Number(row.count) }));
  }

  /**
   * First character of whichever key the list is ordered by, folded to unaccented
   * uppercase so "Sjon" and "Sjón" share a bucket. Sorting by display name and
   * bucketing by sort name would put "Ben Aaronovitch" under A in a list ordered by B.
   */
  private letterBucketExpr(sort: 'name' | 'sortName'): SQL<string> {
    const key = sort === 'sortName' ? sql`COALESCE(NULLIF(BTRIM(${authors.sortName}), ''), ${authors.name})` : sql`${authors.name}`;
    const initial = sql`UPPER(LEFT(public.bookorbit_unaccent(BTRIM(${key})), 1))`;
    return sql<string>`CASE WHEN ${initial} BETWEEN 'A' AND 'Z' THEN ${initial} ELSE '#' END`;
  }

  /**
   * Points `has_photo` back at the image store. Two statements whatever the library
   * size, so it is cheap enough to run on every boot. Returns how many rows moved in
   * each direction, which is what makes the drift visible in the log.
   *
   * `sql.param` is required: interpolating the array directly expands it to
   * `ANY(($1, $2, ...))`, which Postgres rejects, and the failure is invisible here
   * because a stale flag must not stop the app from booting.
   */
  async reconcileHasPhoto(idsWithImage: number[]): Promise<{ marked: number; cleared: number }> {
    const marked = idsWithImage.length
      ? await this.db
          .update(authors)
          .set({ hasPhoto: true })
          .where(and(eq(authors.hasPhoto, false), sql`${authors.id} = ANY(${sql.param(idsWithImage)}::int[])`))
          .returning({ id: authors.id })
      : [];

    const cleared = idsWithImage.length
      ? await this.db
          .update(authors)
          .set({ hasPhoto: false })
          .where(and(eq(authors.hasPhoto, true), sql`NOT (${authors.id} = ANY(${sql.param(idsWithImage)}::int[]))`))
          .returning({ id: authors.id })
      : await this.db.update(authors).set({ hasPhoto: false }).where(eq(authors.hasPhoto, true)).returning({ id: authors.id });

    return { marked: marked.length, cleared: cleared.length };
  }

  private buildAuthorWhere(params: {
    q?: string;
    libraryIds: number[];
    hasPhoto?: boolean;
    hasSortName?: boolean;
    addedWithinDays?: number;
    contentFilters?: ContentFilterRules;
  }): SQL {
    const clauses: SQL[] = [inArray(books.libraryId, params.libraryIds)];
    if (params.contentFilters) {
      clauses.push(...buildContentFilterClauses(params.contentFilters, this.db));
    }
    const query = params.q?.trim();
    if (query) {
      clauses.push(accentInsensitiveIlike(authors.name, buildSearchPattern(query)));
    }
    if (params.hasPhoto !== undefined) {
      clauses.push(eq(authors.hasPhoto, params.hasPhoto));
    }
    if (params.hasSortName !== undefined) {
      // An empty string is a missing sort name as far as the UI is concerned.
      const missing = sql`(${authors.sortName} IS NULL OR BTRIM(${authors.sortName}) = '')`;
      clauses.push(params.hasSortName ? (sql`NOT ${missing}` as SQL) : (missing as SQL));
    }
    if (params.addedWithinDays !== undefined) {
      clauses.push(sql`${books.addedAt} >= NOW() - MAKE_INTERVAL(days => ${params.addedWithinDays})` as SQL);
    }
    return and(...clauses)!;
  }

  private orderByDirection(
    expression:
      SQL | typeof authors.name | typeof authors.sortName | typeof bookMetadata.title | typeof bookMetadata.publishedYear | typeof books.addedAt,
    order: SortDirection,
  ) {
    return order === 'asc' ? asc(expression) : desc(expression);
  }
}
