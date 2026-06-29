import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { SQL, and, count, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  authors,
  bookAuthors,
  bookFiles,
  bookMetadata,
  bookSeries,
  bookSeriesMemberships,
  books,
  collections,
  collectionBooks,
  smartScopes,
  libraries,
  userBookStatus,
  userLibraryAccess,
} from '../../db/schema';
import { BookQueryBuilder } from '../book/book-query-builder.service';
import type { ContentFilterRules, GroupRule } from '@bookorbit/types';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';

type Db = NodePgDatabase<typeof schema>;

type OpdsBookFilters = {
  libraryId?: number;
  collectionId?: number;
  smartScopeId?: number;
  author?: string;
  series?: string;
  seriesId?: number;
  q?: string;
  readStatus?: 'unread' | 'reading' | 'finished';
  format?: string;
  ids?: number[];
};

type SeriesFilter = { seriesId: number } | { normalizedName: string };

type FetchBookEntriesOptions = {
  contextSeries?: SeriesFilter;
};

type ContextSeriesRow = {
  bookId: number;
  seriesId: number;
  seriesName: string;
  seriesIndex: number | null;
};

type OpdsSortOrder =
  | 'recent'
  | 'recent_asc'
  | 'updated'
  | 'updated_asc'
  | 'recently_read'
  | 'recently_read_asc'
  | 'title_asc'
  | 'title_desc'
  | 'author_asc'
  | 'author_desc'
  | 'series_asc'
  | 'series_desc';

const OPDS_SORT_MAP: Record<OpdsSortOrder, SQL[]> = {
  recent: [sql`${books.addedAt} DESC`, sql`${books.id} ASC`],
  recent_asc: [sql`${books.addedAt} ASC`, sql`${books.id} ASC`],
  updated: [sql`${books.updatedAt} DESC`, sql`${books.id} ASC`],
  updated_asc: [sql`${books.updatedAt} ASC`, sql`${books.id} ASC`],
  recently_read: [sql`${userBookStatus.updatedAt} DESC NULLS LAST`, sql`${books.id} ASC`],
  recently_read_asc: [sql`${userBookStatus.updatedAt} ASC NULLS LAST`, sql`${books.id} ASC`],
  title_asc: [sql`${bookMetadata.title} ASC NULLS LAST`, sql`${books.id} ASC`],
  title_desc: [sql`${bookMetadata.title} DESC NULLS LAST`, sql`${books.id} ASC`],
  author_asc: [sql`min(${authors.sortName}) ASC NULLS LAST`, sql`${bookMetadata.title} ASC NULLS LAST`, sql`${books.id} ASC`],
  author_desc: [sql`min(${authors.sortName}) DESC NULLS LAST`, sql`${bookMetadata.title} ASC NULLS LAST`, sql`${books.id} ASC`],
  series_asc: [sql`${bookMetadata.seriesName} ASC NULLS LAST`, sql`${bookMetadata.seriesIndex} ASC NULLS LAST`, sql`${books.id} ASC`],
  series_desc: [sql`${bookMetadata.seriesName} DESC NULLS LAST`, sql`${bookMetadata.seriesIndex} DESC NULLS LAST`, sql`${books.id} ASC`],
};

const READ_STATUS_BUCKETS = {
  reading: ['reading', 'rereading', 'on_hold'],
  finished: ['read', 'skimmed', 'abandoned'],
} as const;

const ACTIVE_READ_STATUSES = [...READ_STATUS_BUCKETS.reading, ...READ_STATUS_BUCKETS.finished];

const LIKE_SPECIAL_CHARS = /[%_\\]/g;

export interface OpdsBookEntry {
  id: number;
  title: string;
  folderPath: string;
  addedAt: Date;
  updatedAt: Date;
  description: string | null;
  seriesId: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  language: string | null;
  publisher: string | null;
  isbn13: string | null;
  hasCover: boolean;
  authors: string[];
  files: { id: number; format: string }[];
}

@Injectable()
export class OpdsBookService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly queryBuilder: BookQueryBuilder,
  ) {}

  async getAccessibleLibraryIds(userId: number, isSuperuser = false): Promise<number[]> {
    if (isSuperuser) {
      const rows = await this.db.select({ id: libraries.id }).from(libraries);
      return rows.map((r) => r.id);
    }
    const rows = await this.db.select({ libraryId: userLibraryAccess.libraryId }).from(userLibraryAccess).where(eq(userLibraryAccess.userId, userId));
    return rows.map((r) => r.libraryId);
  }

  async getAccessibleLibraries(userId: number, isSuperuser = false) {
    if (isSuperuser) {
      return this.db
        .select({
          id: libraries.id,
          name: libraries.name,
          bookCount: sql<number>`count(${books.id})::int`,
        })
        .from(libraries)
        .leftJoin(books, and(eq(books.libraryId, libraries.id), eq(books.status, 'present')))
        .groupBy(libraries.id)
        .orderBy(libraries.name);
    }
    return this.db
      .select({
        id: libraries.id,
        name: libraries.name,
        bookCount: sql<number>`count(${books.id})::int`,
      })
      .from(libraries)
      .innerJoin(userLibraryAccess, and(eq(userLibraryAccess.libraryId, libraries.id), eq(userLibraryAccess.userId, userId)))
      .leftJoin(books, and(eq(books.libraryId, libraries.id), eq(books.status, 'present')))
      .groupBy(libraries.id)
      .orderBy(libraries.name);
  }

  async getBooksPage(
    userId: number,
    sortOrder: OpdsSortOrder,
    page: number,
    size: number,
    filters?: OpdsBookFilters,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return { entries: [], total: 0 };

    if (filters?.ids && filters.ids.length === 0) return { entries: [], total: 0 };

    if (filters?.libraryId && !accessibleIds.includes(filters.libraryId)) {
      throw new ForbiddenException('No access to this library');
    }

    if (filters?.collectionId) {
      const [collection] = await this.db
        .select({ userId: collections.userId })
        .from(collections)
        .where(eq(collections.id, filters.collectionId))
        .limit(1);
      if (!collection || collection.userId !== userId) {
        throw new ForbiddenException('No access to this collection');
      }
    }

    if (filters?.smartScopeId) {
      return this.getBooksBySmartScope(userId, filters.smartScopeId, accessibleIds, sortOrder, page, size, contentFilters, filters.q);
    }

    const clauses: SQL[] = [inArray(books.libraryId, accessibleIds), eq(books.status, 'present')];

    if (filters?.libraryId) clauses.push(eq(books.libraryId, filters.libraryId));

    if (filters?.ids) clauses.push(inArray(books.id, filters.ids));

    if (filters?.collectionId) {
      clauses.push(
        sql`${books.id} IN (SELECT ${collectionBooks.bookId} FROM ${collectionBooks} WHERE ${collectionBooks.collectionId} = ${filters.collectionId})`,
      );
    }

    if (filters?.author) {
      clauses.push(
        sql`${books.id} IN (SELECT ${bookAuthors.bookId} FROM ${bookAuthors} INNER JOIN ${authors} ON ${authors.id} = ${bookAuthors.authorId} WHERE ${authors.name} = ${filters.author})`,
      );
    }

    const seriesFilter = this.resolveSeriesFilter(filters);
    if (seriesFilter) clauses.push(this.buildSeriesMembershipClause(seriesFilter));

    if (filters?.format) {
      const format = filters.format.trim().toLowerCase();
      if (format) {
        clauses.push(
          sql`${books.id} IN (SELECT ${bookFiles.bookId} FROM ${bookFiles} WHERE ${bookFiles.role} = 'content' AND lower(${bookFiles.format}) = ${format})`,
        );
      }
    }

    if (filters?.readStatus) {
      clauses.push(this.buildReadStatusClause(userId, filters.readStatus));
    }

    if (filters?.q) {
      const searchClause = this.buildCatalogSearchClause(filters.q);
      if (searchClause) clauses.push(searchClause);
    }

    if (!isSuperuser && contentFilters) {
      clauses.push(...buildContentFilterClauses(contentFilters, this.db));
    }

    return this.paginatedBookQuery(and(...clauses)!, sortOrder, page, size, userId, { contextSeries: seriesFilter });
  }

  private buildReadStatusClause(userId: number, readStatus: 'unread' | 'reading' | 'finished'): SQL {
    if (readStatus === 'unread') {
      return sql`${books.id} NOT IN (SELECT ${userBookStatus.bookId} FROM ${userBookStatus} WHERE ${userBookStatus.userId} = ${userId} AND ${userBookStatus.status} IN ${ACTIVE_READ_STATUSES})`;
    }
    const statuses = READ_STATUS_BUCKETS[readStatus];
    return sql`${books.id} IN (SELECT ${userBookStatus.bookId} FROM ${userBookStatus} WHERE ${userBookStatus.userId} = ${userId} AND ${userBookStatus.status} IN ${statuses})`;
  }

  private buildCatalogSearchClause(q: string): SQL | undefined {
    const term = q.trim();
    if (!term) return undefined;

    const pattern = `%${term.replace(LIKE_SPECIAL_CHARS, '\\$&')}%`;
    const existsAuthor = (() => {
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookAuthors)
        .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
        .where(and(eq(bookAuthors.bookId, books.id), ilike(authors.name, pattern))!);
      return sql`exists (${sq})`;
    })();

    const existsSeries = sql`exists (
      SELECT 1
      FROM ${bookSeriesMemberships}
      INNER JOIN ${bookSeries} ON ${bookSeries.id} = ${bookSeriesMemberships.seriesId}
      WHERE ${bookSeriesMemberships.bookId} = ${books.id}
        AND ${ilike(bookSeries.name, pattern)}
    )`;

    const clauses: SQL[] = [ilike(bookMetadata.title, pattern), existsAuthor, existsSeries, ilike(bookMetadata.seriesName, pattern)];
    const normalizedIsbn = normalizeIsbnSearchTerm(term);
    if (normalizedIsbn) {
      clauses.push(or(eq(bookMetadata.isbn13, normalizedIsbn), eq(bookMetadata.isbn10, normalizedIsbn))!);
    }

    return or(...clauses)!;
  }

  async getRecentBooksPage(
    userId: number,
    page: number,
    size: number,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return { entries: [], total: 0 };
    const clauses: SQL[] = [inArray(books.libraryId, accessibleIds), eq(books.status, 'present')];
    if (!isSuperuser && contentFilters) {
      clauses.push(...buildContentFilterClauses(contentFilters, this.db));
    }
    const where = and(...clauses);
    return this.paginatedBookQuery(where!, 'recent', page, size);
  }

  async getRandomBooks(userId: number, count: number, isSuperuser = false, contentFilters?: ContentFilterRules): Promise<OpdsBookEntry[]> {
    if (count <= 0) return [];
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return [];

    const baseClauses: SQL[] = [inArray(books.libraryId, accessibleIds), eq(books.status, 'present')];
    if (!isSuperuser && contentFilters) {
      baseClauses.push(...buildContentFilterClauses(contentFilters, this.db));
    }
    const baseFilter = and(...baseClauses)!;
    const [bounds] = await this.db
      .select({
        minId: sql<number | null>`min(${books.id})`,
        maxId: sql<number | null>`max(${books.id})`,
      })
      .from(books)
      .where(baseFilter);

    if (bounds?.minId == null || bounds.maxId == null || bounds.minId > bounds.maxId) return [];

    const range = bounds.maxId - bounds.minId + 1;
    const anchorId = bounds.minId + Math.floor(Math.random() * range);

    const firstPass = await this.db
      .select({ id: books.id })
      .from(books)
      .where(and(baseFilter, gte(books.id, anchorId)))
      .orderBy(books.id)
      .limit(count);

    const remaining = count - firstPass.length;
    const secondPass =
      remaining > 0
        ? await this.db
            .select({ id: books.id })
            .from(books)
            .where(and(baseFilter, lt(books.id, anchorId)))
            .orderBy(books.id)
            .limit(remaining)
        : [];

    const ids = [...firstPass, ...secondPass].map((row) => row.id);
    if (ids.length === 0) return [];
    return this.fetchBookEntries(ids);
  }

  async getDistinctAuthors(userId: number, isSuperuser = false, contentFilters?: ContentFilterRules): Promise<{ name: string; bookCount: number }[]> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return [];

    const filterClauses = !isSuperuser && contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    return this.db
      .select({
        name: authors.name,
        bookCount: sql<number>`count(DISTINCT ${bookAuthors.bookId})::int`,
      })
      .from(authors)
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .innerJoin(books, and(eq(books.id, bookAuthors.bookId), eq(books.status, 'present'), ...filterClauses))
      .where(inArray(books.libraryId, accessibleIds))
      .groupBy(authors.name, authors.sortName)
      .orderBy(sql`${authors.sortName} ASC NULLS LAST`);
  }

  async getDistinctSeries(
    userId: number,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ id: number; name: string; bookCount: number }[]> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return [];

    const filterClauses = !isSuperuser && contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    return this.db
      .select({
        id: bookSeries.id,
        name: bookSeries.name,
        bookCount: sql<number>`count(DISTINCT ${books.id})::int`,
      })
      .from(bookSeries)
      .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.seriesId, bookSeries.id))
      .innerJoin(books, and(eq(books.id, bookSeriesMemberships.bookId), eq(books.status, 'present'), ...filterClauses))
      .where(inArray(books.libraryId, accessibleIds))
      .groupBy(bookSeries.id, bookSeries.name)
      .orderBy(sql`${bookSeries.name} ASC`);
  }

  async getDistinctAuthorsPage(
    userId: number,
    opts: { q?: string; limit: number; offset: number },
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ items: { name: string; bookCount: number }[]; hasNext: boolean }> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return { items: [], hasNext: false };

    const filterClauses = !isSuperuser && contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const where: SQL[] = [inArray(books.libraryId, accessibleIds)];
    const term = opts.q?.trim();
    if (term) {
      where.push(ilike(authors.name, `%${term.replace(LIKE_SPECIAL_CHARS, '\\$&')}%`));
    }

    const rows = await this.db
      .select({
        name: authors.name,
        bookCount: sql<number>`count(DISTINCT ${bookAuthors.bookId})::int`,
      })
      .from(authors)
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .innerJoin(books, and(eq(books.id, bookAuthors.bookId), eq(books.status, 'present'), ...filterClauses))
      .where(and(...where))
      .groupBy(authors.name, authors.sortName)
      .orderBy(sql`${authors.sortName} ASC NULLS LAST`)
      .limit(opts.limit + 1)
      .offset(opts.offset);

    const hasNext = rows.length > opts.limit;
    return { items: hasNext ? rows.slice(0, opts.limit) : rows, hasNext };
  }

  async getDistinctSeriesPage(
    userId: number,
    opts: { q?: string; limit: number; offset: number },
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ items: { id: number; name: string; bookCount: number }[]; hasNext: boolean }> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return { items: [], hasNext: false };

    const filterClauses = !isSuperuser && contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const where: SQL[] = [inArray(books.libraryId, accessibleIds)];
    const term = opts.q?.trim();
    if (term) {
      where.push(ilike(bookSeries.name, `%${term.replace(LIKE_SPECIAL_CHARS, '\\$&')}%`));
    }

    const rows = await this.db
      .select({
        id: bookSeries.id,
        name: bookSeries.name,
        bookCount: sql<number>`count(DISTINCT ${books.id})::int`,
      })
      .from(bookSeries)
      .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.seriesId, bookSeries.id))
      .innerJoin(books, and(eq(books.id, bookSeriesMemberships.bookId), eq(books.status, 'present'), ...filterClauses))
      .where(and(...where))
      .groupBy(bookSeries.id, bookSeries.name)
      .orderBy(sql`${bookSeries.name} ASC`)
      .limit(opts.limit + 1)
      .offset(opts.offset);

    const hasNext = rows.length > opts.limit;
    return { items: hasNext ? rows.slice(0, opts.limit) : rows, hasNext };
  }

  async getUserCollections(userId: number) {
    return this.db
      .select({
        id: collections.id,
        name: collections.name,
        bookCount: sql<number>`count(${collectionBooks.bookId})::int`,
      })
      .from(collections)
      .leftJoin(collectionBooks, eq(collectionBooks.collectionId, collections.id))
      .where(eq(collections.userId, userId))
      .groupBy(collections.id)
      .orderBy(collections.name);
  }

  async getUserSmartScopes(userId: number) {
    return this.db
      .select({
        id: smartScopes.id,
        name: smartScopes.name,
        icon: smartScopes.icon,
      })
      .from(smartScopes)
      .where(eq(smartScopes.userId, userId))
      .orderBy(smartScopes.name);
  }

  async validateBookAccess(bookId: number, userId: number, isSuperuser = false, contentFilters?: ContentFilterRules): Promise<void> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    const [row] = await this.db.select({ libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);
    if (!row || !accessibleIds.includes(row.libraryId)) {
      throw new ForbiddenException('No access to this book');
    }
    if (!isSuperuser && contentFilters) {
      const filterClauses = buildContentFilterClauses(contentFilters, this.db);
      if (filterClauses.length > 0) {
        const [filtered] = await this.db
          .select({ id: books.id })
          .from(books)
          .where(and(eq(books.id, bookId), ...filterClauses))
          .limit(1);
        if (!filtered) throw new ForbiddenException('No access to this book');
      }
    }
  }

  async getBookFiles(bookId: number, fileId?: number): Promise<{ absolutePath: string; format: string; title: string; authorName: string } | null> {
    const fileQuery = this.db
      .select({
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        title: bookMetadata.title,
      })
      .from(bookFiles)
      .leftJoin(books, eq(books.id, bookFiles.bookId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, bookFiles.bookId))
      .where(fileId ? and(eq(bookFiles.id, fileId), eq(bookFiles.bookId, bookId)) : and(eq(books.id, bookId), eq(bookFiles.id, books.primaryFileId)))
      .limit(1);

    const [file] = await fileQuery;
    if (!file) return null;

    const [authorRow] = await this.db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(eq(bookAuthors.bookId, bookId))
      .orderBy(bookAuthors.displayOrder)
      .limit(1);

    return {
      absolutePath: file.absolutePath,
      format: file.format ?? 'unknown',
      title: file.title ?? `book-${bookId}`,
      authorName: authorRow?.name ?? '',
    };
  }

  private async getBooksBySmartScope(
    userId: number,
    smartScopeId: number,
    accessibleIds: number[],
    sortOrder: OpdsSortOrder,
    page: number,
    size: number,
    contentFilters?: ContentFilterRules,
    q?: string,
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    const [smartScope] = await this.db.select().from(smartScopes).where(eq(smartScopes.id, smartScopeId)).limit(1);
    if (!smartScope) return { entries: [], total: 0 };
    if (!smartScope.isPublic && smartScope.userId !== userId) return { entries: [], total: 0 };

    const where = this.queryBuilder.buildWhere(smartScope.filter as GroupRule | null, {
      accessibleLibraryIds: accessibleIds,
      userId,
      contentFilters,
    });
    const statusClause = eq(books.status, 'present');
    const searchClause = q?.trim() ? this.buildCatalogSearchClause(q) : undefined;
    const combinedWhere = and(...([where, statusClause, searchClause].filter(Boolean) as SQL[]));
    return this.paginatedBookQuery(combinedWhere!, sortOrder, page, size, userId);
  }

  private async paginatedBookQuery(
    where: SQL,
    sortOrder: OpdsSortOrder,
    page: number,
    size: number,
    userId?: number,
    options: FetchBookEntriesOptions = {},
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    const offset = (page - 1) * size;
    const needsAuthorJoin = sortOrder === 'author_asc' || sortOrder === 'author_desc';
    const needsStatusJoin = (sortOrder === 'recently_read' || sortOrder === 'recently_read_asc') && userId !== undefined;
    const needsContextSeriesJoin = options.contextSeries !== undefined && (sortOrder === 'series_asc' || sortOrder === 'series_desc');
    const orderClauses = needsContextSeriesJoin ? this.buildContextSeriesOrder(sortOrder) : OPDS_SORT_MAP[sortOrder];

    const buildIdQuery = () => {
      if (needsContextSeriesJoin) {
        const query = this.db
          .select({ id: books.id })
          .from(books)
          .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
          .innerJoin(bookSeriesMemberships, this.buildContextSeriesMembershipJoin(options.contextSeries!));

        if ('normalizedName' in options.contextSeries!) {
          return query
            .innerJoin(
              bookSeries,
              and(eq(bookSeries.id, bookSeriesMemberships.seriesId), eq(bookSeries.normalizedName, options.contextSeries.normalizedName))!,
            )
            .where(where)
            .orderBy(...orderClauses)
            .limit(size)
            .offset(offset);
        }

        return query
          .where(where)
          .orderBy(...orderClauses)
          .limit(size)
          .offset(offset);
      }
      if (needsAuthorJoin) {
        return this.db
          .select({ id: books.id })
          .from(books)
          .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
          .leftJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
          .leftJoin(authors, eq(authors.id, bookAuthors.authorId))
          .where(where)
          .groupBy(books.id, bookMetadata.title, bookMetadata.seriesName, bookMetadata.seriesIndex)
          .orderBy(...orderClauses)
          .limit(size)
          .offset(offset);
      }
      if (needsStatusJoin) {
        return this.db
          .select({ id: books.id })
          .from(books)
          .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
          .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, userId!)))
          .where(where)
          .orderBy(...orderClauses)
          .limit(size)
          .offset(offset);
      }
      return this.db
        .select({ id: books.id })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where)
        .orderBy(...orderClauses)
        .limit(size)
        .offset(offset);
    };

    const [idRows, [{ total }]] = await Promise.all([
      buildIdQuery(),
      this.db.select({ total: count() }).from(books).leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id)).where(where),
    ]);

    if (idRows.length === 0) return { entries: [], total: Number(total) };

    const entries = await this.fetchBookEntries(
      idRows.map((r) => r.id),
      options,
    );
    return { entries, total: Number(total) };
  }

  private async fetchBookEntries(bookIds: number[], options: FetchBookEntriesOptions = {}): Promise<OpdsBookEntry[]> {
    if (bookIds.length === 0) return [];

    const [metaRows, authorRows, fileRows, contextSeriesRows] = await Promise.all([
      this.db
        .select({
          id: books.id,
          folderPath: books.folderPath,
          addedAt: books.addedAt,
          bookUpdatedAt: books.updatedAt,
          title: bookMetadata.title,
          description: bookMetadata.description,
          seriesId: bookMetadata.seriesId,
          seriesName: bookMetadata.seriesName,
          seriesIndex: bookMetadata.seriesIndex,
          language: bookMetadata.language,
          publisher: bookMetadata.publisher,
          isbn13: bookMetadata.isbn13,
          coverSource: bookMetadata.coverSource,
        })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(inArray(books.id, bookIds)),
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, bookIds))
        .orderBy(bookAuthors.displayOrder),
      this.db
        .select({ bookId: books.id, id: bookFiles.id, format: bookFiles.format, role: bookFiles.role })
        .from(bookFiles)
        .innerJoin(books, eq(books.id, bookFiles.bookId))
        .where(and(inArray(bookFiles.bookId, bookIds), eq(bookFiles.role, 'content')))
        .orderBy(sql`case when ${bookFiles.id} = ${books.primaryFileId} then 0 else 1 end`, bookFiles.sortOrder, bookFiles.id),
      options.contextSeries ? this.fetchContextSeriesRows(bookIds, options.contextSeries) : Promise.resolve<ContextSeriesRow[]>([]),
    ]);

    const authorsByBook = new Map<number, string[]>();
    for (const row of authorRows) {
      const list = authorsByBook.get(row.bookId) ?? [];
      list.push(row.name);
      authorsByBook.set(row.bookId, list);
    }

    const filesByBook = new Map<number, { id: number; format: string }[]>();
    for (const row of fileRows) {
      if (row.role !== 'content') continue;
      const list = filesByBook.get(row.bookId) ?? [];
      list.push({ id: row.id, format: row.format ?? 'unknown' });
      filesByBook.set(row.bookId, list);
    }

    const idOrder = new Map(bookIds.map((id, i) => [id, i]));
    const contextSeriesByBook = new Map(contextSeriesRows.map((row) => [row.bookId, row]));

    return metaRows
      .map((row) => {
        const contextSeries = contextSeriesByBook.get(row.id);
        return {
          id: row.id,
          title: row.title ?? row.folderPath.split('/').pop() ?? 'Untitled',
          folderPath: row.folderPath,
          addedAt: row.addedAt,
          updatedAt: row.bookUpdatedAt,
          description: row.description,
          seriesId: contextSeries?.seriesId ?? row.seriesId,
          seriesName: contextSeries?.seriesName ?? row.seriesName,
          seriesIndex: contextSeries?.seriesIndex ?? row.seriesIndex,
          language: row.language,
          publisher: row.publisher,
          isbn13: row.isbn13,
          hasCover: row.coverSource !== null,
          authors: authorsByBook.get(row.id) ?? [],
          files: filesByBook.get(row.id) ?? [],
        };
      })
      .sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
  }

  private resolveSeriesFilter(filters?: OpdsBookFilters): SeriesFilter | undefined {
    if (filters?.seriesId !== undefined) return { seriesId: filters.seriesId };

    const catalogSeriesId = parseCatalogSeriesId(filters?.series);
    if (catalogSeriesId !== undefined) return { seriesId: catalogSeriesId };

    const normalizedName = normalizeSeriesNameFilter(filters?.series);
    return normalizedName ? { normalizedName } : undefined;
  }

  private buildSeriesMembershipClause(filter: SeriesFilter): SQL {
    if ('seriesId' in filter) {
      return sql`${books.id} IN (
        SELECT ${bookSeriesMemberships.bookId}
        FROM ${bookSeriesMemberships}
        WHERE ${bookSeriesMemberships.seriesId} = ${filter.seriesId}
      )`;
    }

    return sql`${books.id} IN (
      SELECT ${bookSeriesMemberships.bookId}
      FROM ${bookSeriesMemberships}
      INNER JOIN ${bookSeries} ON ${bookSeries.id} = ${bookSeriesMemberships.seriesId}
      WHERE ${bookSeries.normalizedName} = ${filter.normalizedName}
    )`;
  }

  private buildContextSeriesMembershipJoin(filter: SeriesFilter): SQL {
    if ('seriesId' in filter) {
      return and(eq(bookSeriesMemberships.bookId, books.id), eq(bookSeriesMemberships.seriesId, filter.seriesId))!;
    }

    return eq(bookSeriesMemberships.bookId, books.id);
  }

  private buildContextSeriesOrder(sortOrder: OpdsSortOrder): SQL[] {
    const direction = sortOrder === 'series_desc' ? 'DESC' : 'ASC';
    return [
      sql`${bookSeriesMemberships.seriesIndex} ${sql.raw(direction)} NULLS LAST`,
      sql`${bookMetadata.title} ASC NULLS LAST`,
      sql`${books.id} ASC`,
    ];
  }

  private fetchContextSeriesRows(bookIds: number[], filter: SeriesFilter): Promise<ContextSeriesRow[]> {
    const conditions: SQL[] = [inArray(bookSeriesMemberships.bookId, bookIds)];
    if ('seriesId' in filter) {
      conditions.push(eq(bookSeriesMemberships.seriesId, filter.seriesId));
    } else {
      conditions.push(eq(bookSeries.normalizedName, filter.normalizedName));
    }

    return this.db
      .select({
        bookId: bookSeriesMemberships.bookId,
        seriesId: bookSeriesMemberships.seriesId,
        seriesName: bookSeries.name,
        seriesIndex: bookSeriesMemberships.seriesIndex,
      })
      .from(bookSeriesMemberships)
      .innerJoin(bookSeries, eq(bookSeries.id, bookSeriesMemberships.seriesId))
      .where(and(...conditions))
      .orderBy(bookSeriesMemberships.displayOrder, bookSeriesMemberships.seriesId);
  }
}

function normalizeIsbnSearchTerm(value: string): string {
  return value.replace(/[^0-9Xx]/g, '').toUpperCase();
}

function parseCatalogSeriesId(value: string | null | undefined): number | undefined {
  const match = /^series:(\d+)$/.exec(value?.trim() ?? '');
  if (!match) return undefined;
  const id = Number.parseInt(match[1]!, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

function normalizeSeriesNameFilter(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}
