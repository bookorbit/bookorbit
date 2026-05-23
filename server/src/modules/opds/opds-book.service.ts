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
  books,
  collections,
  collectionBooks,
  smartScopes,
  libraries,
  userLibraryAccess,
} from '../../db/schema';
import { BookQueryBuilder } from '../book/book-query-builder.service';
import type { ContentFilterRules, GroupRule } from '@bookorbit/types';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';

type Db = NodePgDatabase<typeof schema>;

type OpdsSortOrder = 'recent' | 'title_asc' | 'title_desc' | 'author_asc' | 'author_desc' | 'series_asc' | 'series_desc';

const OPDS_SORT_MAP: Record<OpdsSortOrder, SQL[]> = {
  recent: [sql`${books.addedAt} DESC`, sql`${books.id} ASC`],
  title_asc: [sql`${bookMetadata.title} ASC NULLS LAST`, sql`${books.id} ASC`],
  title_desc: [sql`${bookMetadata.title} DESC NULLS LAST`, sql`${books.id} ASC`],
  author_asc: [sql`min(${authors.sortName}) ASC NULLS LAST`, sql`${bookMetadata.title} ASC NULLS LAST`, sql`${books.id} ASC`],
  author_desc: [sql`min(${authors.sortName}) DESC NULLS LAST`, sql`${bookMetadata.title} ASC NULLS LAST`, sql`${books.id} ASC`],
  series_asc: [sql`${bookMetadata.seriesName} ASC NULLS LAST`, sql`${bookMetadata.seriesIndex} ASC NULLS LAST`, sql`${books.id} ASC`],
  series_desc: [sql`${bookMetadata.seriesName} DESC NULLS LAST`, sql`${bookMetadata.seriesIndex} DESC NULLS LAST`, sql`${books.id} ASC`],
};

const LIKE_SPECIAL_CHARS = /[%_\\]/g;

export interface OpdsBookEntry {
  id: number;
  title: string;
  folderPath: string;
  addedAt: Date;
  updatedAt: Date;
  description: string | null;
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
    filters?: { libraryId?: number; collectionId?: number; smartScopeId?: number; author?: string; series?: string; q?: string },
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return { entries: [], total: 0 };

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
      return this.getBooksBySmartScope(userId, filters.smartScopeId, accessibleIds, sortOrder, page, size, contentFilters);
    }

    const clauses: SQL[] = [inArray(books.libraryId, accessibleIds), eq(books.status, 'present')];

    if (filters?.libraryId) clauses.push(eq(books.libraryId, filters.libraryId));

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

    if (filters?.series) {
      clauses.push(eq(bookMetadata.seriesName, filters.series));
    }

    if (filters?.q) {
      const searchClause = this.buildCatalogSearchClause(filters.q);
      if (searchClause) clauses.push(searchClause);
    }

    if (!isSuperuser && contentFilters) {
      clauses.push(...buildContentFilterClauses(contentFilters, this.db));
    }

    return this.paginatedBookQuery(and(...clauses)!, sortOrder, page, size);
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

    const clauses: SQL[] = [ilike(bookMetadata.title, pattern), existsAuthor, ilike(bookMetadata.seriesName, pattern)];
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
  ): Promise<{ name: string | null; bookCount: number }[]> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return [];

    const filterClauses = !isSuperuser && contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    return this.db
      .select({
        name: bookMetadata.seriesName,
        bookCount: sql<number>`count(DISTINCT ${books.id})::int`,
      })
      .from(bookMetadata)
      .innerJoin(books, and(eq(books.id, bookMetadata.bookId), eq(books.status, 'present'), ...filterClauses))
      .where(and(inArray(books.libraryId, accessibleIds), sql`${bookMetadata.seriesName} IS NOT NULL`))
      .groupBy(bookMetadata.seriesName)
      .orderBy(sql`${bookMetadata.seriesName} ASC`);
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
    const combinedWhere = where ? and(where, statusClause) : statusClause;
    return this.paginatedBookQuery(combinedWhere!, sortOrder, page, size);
  }

  private async paginatedBookQuery(
    where: SQL,
    sortOrder: OpdsSortOrder,
    page: number,
    size: number,
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    const offset = (page - 1) * size;
    const needsAuthorJoin = sortOrder === 'author_asc' || sortOrder === 'author_desc';
    const orderClauses = OPDS_SORT_MAP[sortOrder];

    const [idRows, [{ total }]] = await Promise.all([
      needsAuthorJoin
        ? this.db
            .select({ id: books.id })
            .from(books)
            .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
            .leftJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
            .leftJoin(authors, eq(authors.id, bookAuthors.authorId))
            .where(where)
            .groupBy(books.id, bookMetadata.title, bookMetadata.seriesName, bookMetadata.seriesIndex)
            .orderBy(...orderClauses)
            .limit(size)
            .offset(offset)
        : this.db
            .select({ id: books.id })
            .from(books)
            .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
            .where(where)
            .orderBy(...orderClauses)
            .limit(size)
            .offset(offset),
      this.db.select({ total: count() }).from(books).leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id)).where(where),
    ]);

    if (idRows.length === 0) return { entries: [], total: Number(total) };

    const entries = await this.fetchBookEntries(idRows.map((r) => r.id));
    return { entries, total: Number(total) };
  }

  private async fetchBookEntries(bookIds: number[]): Promise<OpdsBookEntry[]> {
    if (bookIds.length === 0) return [];

    const [metaRows, authorRows, fileRows] = await Promise.all([
      this.db
        .select({
          id: books.id,
          folderPath: books.folderPath,
          addedAt: books.addedAt,
          bookUpdatedAt: books.updatedAt,
          title: bookMetadata.title,
          description: bookMetadata.description,
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
        .from(books)
        .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
        .where(inArray(books.id, bookIds)),
    ]);

    const authorsByBook = new Map<number, string[]>();
    for (const row of authorRows) {
      const list = authorsByBook.get(row.bookId) ?? [];
      list.push(row.name);
      authorsByBook.set(row.bookId, list);
    }

    const filesByBook = new Map<number, { id: number; format: string }[]>();
    for (const row of fileRows) {
      const list = filesByBook.get(row.bookId) ?? [];
      list.push({ id: row.id, format: row.format ?? 'unknown' });
      filesByBook.set(row.bookId, list);
    }

    const idOrder = new Map(bookIds.map((id, i) => [id, i]));

    return metaRows
      .map((row) => ({
        id: row.id,
        title: row.title ?? row.folderPath.split('/').pop() ?? 'Untitled',
        folderPath: row.folderPath,
        addedAt: row.addedAt,
        updatedAt: row.bookUpdatedAt,
        description: row.description,
        seriesName: row.seriesName,
        seriesIndex: row.seriesIndex,
        language: row.language,
        publisher: row.publisher,
        isbn13: row.isbn13,
        hasCover: row.coverSource !== null,
        authors: authorsByBook.get(row.id) ?? [],
        files: filesByBook.get(row.id) ?? [],
      }))
      .sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
  }
}

function normalizeIsbnSearchTerm(value: string): string {
  return value.replace(/[^0-9Xx]/g, '').toUpperCase();
}
