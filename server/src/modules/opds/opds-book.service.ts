import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { SQL, type SQLWrapper, type Subquery, and, count, eq, exists, gt, inArray, not, notExists, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import { accentInsensitiveIlike, buildSearchPattern } from '../../common/utils/accent-insensitive-search.utils';
import * as schema from '../../db/schema';
import {
  authors,
  bookAuthors,
  bookFiles,
  bookMetadata,
  bookSeries,
  bookSeriesMemberships,
  books,
  collectionBooks,
  smartScopes,
  libraries,
  readingProgress,
  userBookStatus,
  userLibraryAccess,
} from '../../db/schema';
import { BookQueryBuilder } from '../book/book-query-builder.service';
import { isAudioFormat, type ContentFilterRules, type GroupRule } from '@bookorbit/types';
import { rankFileRowsByBook, rankFilesByFormatPriority } from '../../common/utils/primary-file-selection.utils';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { excludeAudioOnlyBooks } from '../../common/utils/audio-only-book-sql.utils';
import { seriesIndexOrderBy } from '../../common/utils/series-index-sql.utils';
import { OpdsCollectionRepository } from './opds-collection.repository';

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
  excludeAudioOnly?: boolean;
};

/** Narrows a catalog query to what one reader's device can use. Absent keeps every book. */
export interface CatalogVisibilityOptions {
  excludeAudioOnly?: boolean;
}

type SeriesFilter = { seriesId: number } | { normalizedName: string };

type FetchBookEntriesOptions = {
  contextSeries?: SeriesFilter;
  // paginatedBookQuery only: the first row, in place of (page - 1) * size.
  offset?: number;
};

type ContextSeriesRow = {
  bookId: number;
  seriesId: number;
  seriesName: string;
  seriesIndex: string | null;
};

type OpdsSortOrder =
  | 'recent'
  | 'recent_asc'
  | 'updated'
  | 'updated_asc'
  | 'recently_read'
  | 'recently_read_asc'
  | 'last_read'
  | 'last_read_asc'
  | 'title_asc'
  | 'title_desc'
  | 'author_asc'
  | 'author_desc'
  | 'published_asc'
  | 'published_desc'
  | 'series_asc'
  | 'series_desc';

// Sorts that need the reader in their ORDER BY are built per query.
type LastReadSortOrder = 'last_read' | 'last_read_asc';

const OPDS_SORT_MAP: Record<Exclude<OpdsSortOrder, LastReadSortOrder>, SQL[]> = {
  recent: [sql`${books.addedAt} DESC`, sql`${books.id} ASC`],
  recent_asc: [sql`${books.addedAt} ASC`, sql`${books.id} ASC`],
  updated: [sql`${books.updatedAt} DESC`, sql`${books.id} ASC`],
  updated_asc: [sql`${books.updatedAt} ASC`, sql`${books.id} ASC`],
  recently_read: [sql`${userBookStatus.updatedAt} DESC NULLS LAST`, sql`${books.id} ASC`],
  recently_read_asc: [sql`${userBookStatus.updatedAt} ASC NULLS LAST`, sql`${books.id} ASC`],
  title_asc: [sql`${bookMetadata.title} ASC NULLS LAST`, sql`${books.id} ASC`],
  title_desc: [sql`${bookMetadata.title} DESC NULLS LAST`, sql`${books.id} ASC`],
  author_asc: [sql`${books.primaryAuthorSortName} ASC NULLS LAST`, sql`${bookMetadata.title} ASC NULLS LAST`, sql`${books.id} ASC`],
  author_desc: [sql`${books.primaryAuthorSortName} DESC NULLS LAST`, sql`${bookMetadata.title} ASC NULLS LAST`, sql`${books.id} ASC`],
  published_asc: [
    sql`coalesce(${bookMetadata.publishedDate}, make_date(${bookMetadata.publishedYear}, 1, 1)) ASC NULLS LAST`,
    sql`${bookMetadata.title} ASC NULLS LAST`,
    sql`${books.id} ASC`,
  ],
  published_desc: [
    sql`coalesce(${bookMetadata.publishedDate}, make_date(${bookMetadata.publishedYear}, 1, 1)) DESC NULLS LAST`,
    sql`${bookMetadata.title} ASC NULLS LAST`,
    sql`${books.id} ASC`,
  ],
  series_asc: [sql`${bookMetadata.seriesName} ASC NULLS LAST`, ...seriesIndexOrderBy(bookMetadata.seriesIndex, 'ASC'), sql`${books.id} ASC`],
  series_desc: [sql`${bookMetadata.seriesName} DESC NULLS LAST`, ...seriesIndexOrderBy(bookMetadata.seriesIndex, 'DESC'), sql`${books.id} ASC`],
};

const READ_STATUS_BUCKETS = {
  reading: ['reading', 'rereading', 'on_hold'],
  finished: ['read', 'skimmed', 'abandoned'],
} as const;

const ACTIVE_READ_STATUSES = [...READ_STATUS_BUCKETS.reading, ...READ_STATUS_BUCKETS.finished];

const CATALOG_PREVIEW_LIMIT = 3;
const SERIES_MEMBER_STATE_LIMIT = 40;
const SERIES_AUTHOR_NAME_LIMIT = 2;

export type CatalogListSort = 'name' | 'name_desc' | 'books';
export type CatalogListFilter = 'reading' | 'finished';
export type CatalogReadBucket = 'reading' | 'finished' | 'unread';
export type CatalogBucketSortOrder = Extract<OpdsSortOrder, 'title_asc' | 'title_desc' | 'author_asc' | 'author_desc'>;

export interface CatalogJumpBucketRow {
  key: string;
  index: number;
}

export interface OpdsPreviewBookRow {
  id: number;
  title: string;
  hasCover: boolean;
  seriesIndex: string | null;
  addedAt: Date;
  updatedAt: Date;
}

export interface OpdsAuthorPageRow {
  id: number;
  name: string;
  bookCount: number;
  hasPhoto: boolean;
  letter: string;
  readingCount: number;
  finishedCount: number;
  seriesName: string | null;
  previews: OpdsPreviewBookRow[];
}

export interface OpdsSeriesPageRow {
  id: number;
  name: string;
  bookCount: number;
  expectedCount: number | null;
  letter: string;
  readingCount: number;
  finishedCount: number;
  authorNames: string[];
  memberStates: CatalogReadBucket[];
  previews: OpdsPreviewBookRow[];
}

export interface OpdsCatalogListPage<T> {
  items: T[];
  hasNext: boolean;
  total: number;
  buckets: CatalogJumpBucketRow[];
}

export interface OpdsBookSummary {
  total: number;
  reading: number;
  finished: number;
  previews: OpdsPreviewBookRow[];
}

export interface OpdsVisibleAuthor {
  id: number;
  name: string;
  description: string | null;
  birthYear: number | null;
  deathYear: number | null;
  hasPhoto: boolean;
}

export function readStatusBucket(status: string | null | undefined): CatalogReadBucket {
  if (!status) return 'unread';
  if ((READ_STATUS_BUCKETS.reading as readonly string[]).includes(status)) return 'reading';
  if ((READ_STATUS_BUCKETS.finished as readonly string[]).includes(status)) return 'finished';
  return 'unread';
}

/** "A" to "Z" after folding accents, "#" for everything else, so a jump rail never shows a letter it cannot reach. */
function latinJumpBucketExpr(key: SQLWrapper): SQL<string> {
  const initial = sql`upper(left(public.bookorbit_unaccent(btrim(${key})), 1))`;
  return sql<string>`CASE WHEN ${initial} ~ '^[A-Z]$' THEN ${initial} ELSE '#' END`;
}

// Matches the web author list: a blank sort name falls back to the display name.
const AUTHOR_SORT_KEY = sql`COALESCE(NULLIF(BTRIM(${authors.sortName}), ''), ${authors.name})`;
const AUTHOR_SORT_COLLATION_KEY = sql`lower(public.bookorbit_unaccent(btrim(${AUTHOR_SORT_KEY})))`;
const BOOK_COUNT_EXPR = sql`count(DISTINCT ${books.id})`;
const READING_COUNT_EXPR = sql`count(DISTINCT ${books.id}) FILTER (WHERE ${userBookStatus.status} IN ${READ_STATUS_BUCKETS.reading})`;
const FINISHED_COUNT_EXPR = sql`count(DISTINCT ${books.id}) FILTER (WHERE ${userBookStatus.status} IN ${READ_STATUS_BUCKETS.finished})`;

function authorListOrder(sort: CatalogListSort): SQL[] {
  switch (sort) {
    case 'name_desc':
      return [sql`${AUTHOR_SORT_COLLATION_KEY} DESC`, sql`${authors.name} DESC`, sql`${authors.id} ASC`];
    case 'books':
      return [sql`${BOOK_COUNT_EXPR} DESC`, sql`${AUTHOR_SORT_COLLATION_KEY} ASC`, sql`${authors.name} ASC`, sql`${authors.id} ASC`];
    default:
      return [sql`${AUTHOR_SORT_COLLATION_KEY} ASC`, sql`${authors.name} ASC`, sql`${authors.id} ASC`];
  }
}

function seriesListOrder(sort: CatalogListSort): SQL[] {
  switch (sort) {
    case 'name_desc':
      return [sql`${bookSeries.name} DESC`, sql`${bookSeries.id} ASC`];
    case 'books':
      return [sql`${BOOK_COUNT_EXPR} DESC`, sql`${bookSeries.name} ASC`, sql`${bookSeries.id} ASC`];
    default:
      return [sql`${bookSeries.name} ASC`, sql`${bookSeries.id} ASC`];
  }
}

function joinOrder(order: SQL[]): SQL {
  return sql.join(order, sql`, `);
}

export interface OpdsBookEntry {
  id: number;
  title: string;
  folderPath: string;
  addedAt: Date;
  updatedAt: Date;
  description: string | null;
  seriesId: number | null;
  seriesName: string | null;
  seriesIndex: string | null;
  language: string | null;
  publisher: string | null;
  isbn13: string | null;
  hasCover: boolean;
  authors: string[];
  allFiles?: { id: number; format: string; mediaOverlayAvailable: boolean; contentVersion: string }[];
  files: { id: number; format: string }[];
}

export interface OpdsManifestFileRow {
  id: number;
  format: string;
  mediaOverlayAvailable: boolean;
  sizeBytes: number | null;
  fileHash: string | null;
  filename: string | null;
  contentVersion: Date;
}

export interface OpdsManifestBookRow {
  id: number;
  libraryName: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  seriesName: string | null;
  seriesIndex: string | null;
  language: string | null;
  publisher: string | null;
  publishedYear: number | null;
  isbn10: string | null;
  isbn13: string | null;
  files: OpdsManifestFileRow[];
}

/**
 * A read-along EPUB downloads over OPDS without its audio, so beside a plain EPUB of the same book
 * it would be a second link to the same text. The plain one stands for both.
 */
function isRedundantReadAlong(
  row: { bookId: number; id: number; format: string | null; mediaOverlayAvailable: boolean },
  rows: readonly { bookId: number; id: number; format: string | null; mediaOverlayAvailable: boolean }[],
): boolean {
  if (row.format?.toLowerCase() !== 'epub' || !row.mediaOverlayAvailable) return false;
  return rows.some(
    (other) => other.bookId === row.bookId && other.id !== row.id && other.format?.toLowerCase() === 'epub' && !other.mediaOverlayAvailable,
  );
}

@Injectable()
export class OpdsBookService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly queryBuilder: BookQueryBuilder,
    private readonly collectionRepository: OpdsCollectionRepository,
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
    // The first row to return; defaults to the start of page.
    offset?: number,
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    const scope = await this.buildCatalogScope(userId, filters, isSuperuser, contentFilters);
    if (!scope) return { entries: [], total: 0 };
    return this.paginatedBookQuery(scope.where, sortOrder, page, size, userId, { contextSeries: scope.contextSeries, offset });
  }

  // Resolves authorization and every catalog filter into one where clause. The
  // interactive list and the bulk manifest share it so their membership cannot
  // drift apart. Returns null when the scope is provably empty.
  private async buildCatalogScope(
    userId: number,
    filters: OpdsBookFilters | undefined,
    isSuperuser: boolean,
    contentFilters: ContentFilterRules | undefined,
  ): Promise<{ where: SQL; contextSeries?: SeriesFilter } | null> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return null;

    if (filters?.ids && filters.ids.length === 0) return null;

    if (filters?.libraryId && !accessibleIds.includes(filters.libraryId)) {
      throw new ForbiddenException('No access to this library');
    }

    if (filters?.collectionId) {
      const [collection] = await this.collectionRepository.findById(filters.collectionId);
      if (!collection || (collection.userId !== userId && !collection.isPublic)) {
        throw new ForbiddenException('No access to this collection');
      }
    }

    if (filters?.smartScopeId) {
      const where = await this.buildSmartScopeWhere(userId, filters.smartScopeId, accessibleIds, contentFilters, filters.q);
      if (!where) return null;
      return { where: filters.excludeAudioOnly ? and(where, excludeAudioOnlyBooks())! : where };
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

    if (filters?.excludeAudioOnly) clauses.push(excludeAudioOnlyBooks());

    return { where: and(...clauses)!, contextSeries: seriesFilter };
  }

  // Content filters bind every reader but a superuser; the audio-only exclusion is the reader's own
  // choice, so it applies to superusers too.
  private bookVisibilityClauses(isSuperuser: boolean, contentFilters: ContentFilterRules | undefined, options: CatalogVisibilityOptions): SQL[] {
    return [
      ...(!isSuperuser && contentFilters ? buildContentFilterClauses(contentFilters, this.db) : []),
      ...(options.excludeAudioOnly ? [excludeAudioOnlyBooks()] : []),
    ];
  }

  // Cursor page for the KOReader bulk download manifest. Ordering by the
  // immutable book id keeps pagination stable while the library changes
  // underneath a long bulk run: a concurrently added book gets a higher id, so
  // no already-returned row can repeat and no earlier row can be skipped.
  async getBookManifestPage(
    userId: number,
    opts: { filters?: OpdsBookFilters; afterId?: number; limit: number },
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<{ rows: OpdsManifestBookRow[]; hasNext: boolean }> {
    const scope = await this.buildCatalogScope(userId, opts.filters, isSuperuser, contentFilters);
    if (!scope) return { rows: [], hasNext: false };

    const clauses: SQL[] = [scope.where];
    if (opts.afterId !== undefined) clauses.push(gt(books.id, opts.afterId));

    const idRows = await this.db
      .select({ id: books.id })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(and(...clauses)!)
      .orderBy(books.id)
      .limit(opts.limit + 1);

    const hasNext = idRows.length > opts.limit;
    const ids = idRows.slice(0, opts.limit).map((row) => row.id);
    return { rows: await this.fetchManifestRows(ids), hasNext };
  }

  private async fetchManifestRows(bookIds: number[]): Promise<OpdsManifestBookRow[]> {
    if (bookIds.length === 0) return [];

    const [metaRows, authorRows, fileRows] = await Promise.all([
      this.db
        .select({
          id: books.id,
          folderPath: books.folderPath,
          libraryName: libraries.name,
          title: bookMetadata.title,
          subtitle: bookMetadata.subtitle,
          seriesName: bookMetadata.seriesName,
          seriesIndex: bookMetadata.seriesIndex,
          language: bookMetadata.language,
          publisher: bookMetadata.publisher,
          publishedYear: bookMetadata.publishedYear,
          isbn10: bookMetadata.isbn10,
          isbn13: bookMetadata.isbn13,
        })
        .from(books)
        .innerJoin(libraries, eq(libraries.id, books.libraryId))
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(inArray(books.id, bookIds)),
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, bookIds))
        .orderBy(bookAuthors.displayOrder),
      this.db
        .select({
          bookId: books.id,
          id: bookFiles.id,
          format: bookFiles.format,
          mediaOverlayAvailable: bookFiles.mediaOverlayAvailable,
          sizeBytes: bookFiles.sizeBytes,
          fileHash: bookFiles.fileHash,
          absolutePath: bookFiles.absolutePath,
          updatedAt: bookFiles.updatedAt,
        })
        .from(bookFiles)
        .innerJoin(books, eq(books.id, bookFiles.bookId))
        .where(and(inArray(bookFiles.bookId, bookIds), eq(bookFiles.role, 'content')))
        .orderBy(sql`case when ${bookFiles.id} = ${books.primaryFileId} then 0 else 1 end`, bookFiles.sortOrder, bookFiles.id),
    ]);

    const authorsByBook = new Map<number, string[]>();
    for (const row of authorRows) {
      const list = authorsByBook.get(row.bookId) ?? [];
      list.push(row.name);
      authorsByBook.set(row.bookId, list);
    }

    const filesByBook = new Map<number, OpdsManifestFileRow[]>();
    for (const row of fileRows) {
      const list = filesByBook.get(row.bookId) ?? [];
      list.push({
        id: row.id,
        format: row.format ?? 'unknown',
        mediaOverlayAvailable: row.mediaOverlayAvailable,
        sizeBytes: row.sizeBytes,
        fileHash: row.fileHash,
        // Only the basename leaves the server; the stored absolute path never does.
        filename: row.absolutePath.split('/').pop() ?? null,
        contentVersion: row.updatedAt,
      });
      filesByBook.set(row.bookId, list);
    }

    const idOrder = new Map(bookIds.map((id, index) => [id, index]));
    return metaRows
      .map((row) => ({
        id: row.id,
        libraryName: row.libraryName,
        title: row.title ?? row.folderPath.split('/').pop() ?? 'Untitled',
        subtitle: row.subtitle,
        authors: authorsByBook.get(row.id) ?? [],
        seriesName: row.seriesName,
        seriesIndex: row.seriesIndex,
        language: row.language,
        publisher: row.publisher,
        publishedYear: row.publishedYear,
        isbn10: row.isbn10,
        isbn13: row.isbn13,
        files: filesByBook.get(row.id) ?? [],
      }))
      .sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));
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

    const pattern = buildSearchPattern(term);
    const existsAuthor = (() => {
      const sq = this.db
        .select({ one: sql`1` })
        .from(bookAuthors)
        .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
        .where(and(eq(bookAuthors.bookId, books.id), accentInsensitiveIlike(authors.name, pattern))!);
      return sql`exists (${sq})`;
    })();

    const existsSeries = sql`exists (
      SELECT 1
      FROM ${bookSeriesMemberships}
      INNER JOIN ${bookSeries} ON ${bookSeries.id} = ${bookSeriesMemberships.seriesId}
      WHERE ${bookSeriesMemberships.bookId} = ${books.id}
        AND ${accentInsensitiveIlike(bookSeries.name, pattern)}
    )`;

    const clauses: SQL[] = [
      accentInsensitiveIlike(bookMetadata.title, pattern),
      existsAuthor,
      existsSeries,
      accentInsensitiveIlike(bookMetadata.seriesName, pattern),
    ];
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

  async getRandomBooks(
    userId: number,
    count: number,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
    options: CatalogVisibilityOptions = {},
  ): Promise<OpdsBookEntry[]> {
    if (count <= 0) return [];
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return [];

    const baseFilter = and(
      inArray(books.libraryId, accessibleIds),
      eq(books.status, 'present'),
      ...this.bookVisibilityClauses(isSuperuser, contentFilters, options),
    )!;
    const idRows = await this.db
      .select({ id: books.id })
      .from(books)
      .where(baseFilter)
      .orderBy(sql`random()`)
      .limit(count);

    const ids = idRows.map((row) => row.id);
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
    opts: { q?: string; limit: number; offset: number; sort?: CatalogListSort; filter?: CatalogListFilter } & CatalogVisibilityOptions,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<OpdsCatalogListPage<OpdsAuthorPageRow>> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return { items: [], hasNext: false, total: 0, buckets: [] };

    const filterClauses = this.bookVisibilityClauses(isSuperuser, contentFilters, opts);
    const sort = opts.sort ?? 'name';
    const order = authorListOrder(sort);
    const letter = latinJumpBucketExpr(AUTHOR_SORT_KEY);
    const where: SQL[] = [inArray(books.libraryId, accessibleIds)];
    const term = opts.q?.trim();
    if (term) {
      where.push(accentInsensitiveIlike(authors.name, buildSearchPattern(term)));
    }
    const having =
      opts.filter === 'reading' ? sql`${READING_COUNT_EXPR} > 0` : opts.filter === 'finished' ? sql`${FINISHED_COUNT_EXPR} > 0` : undefined;
    const bookJoin = and(eq(books.id, bookAuthors.bookId), eq(books.status, 'present'), ...filterClauses)!;
    const statusJoin = and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, userId))!;

    const ranked = this.db
      .select({
        letter: sql<string>`${letter}`.as('letter'),
        rn: sql<number>`(row_number() OVER (ORDER BY ${joinOrder(order)}) - 1)::int`.as('rn'),
      })
      .from(authors)
      .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
      .innerJoin(books, bookJoin)
      .leftJoin(userBookStatus, statusJoin)
      .where(and(...where))
      .groupBy(authors.id)
      .having(having)
      .as('ranked');

    const [rows, summary] = await Promise.all([
      this.db
        .select({
          id: authors.id,
          name: authors.name,
          hasPhoto: authors.hasPhoto,
          letter: sql<string>`${letter}`,
          bookCount: sql<number>`${BOOK_COUNT_EXPR}::int`,
          readingCount: sql<number>`${READING_COUNT_EXPR}::int`,
          finishedCount: sql<number>`${FINISHED_COUNT_EXPR}::int`,
        })
        .from(authors)
        .innerJoin(bookAuthors, eq(bookAuthors.authorId, authors.id))
        .innerJoin(books, bookJoin)
        .leftJoin(userBookStatus, statusJoin)
        .where(and(...where))
        .groupBy(authors.id)
        .having(having)
        .orderBy(...order)
        .limit(opts.limit + 1)
        .offset(opts.offset),
      this.summarizeRankedLetters(ranked),
    ]);

    const hasNext = rows.length > opts.limit;
    const pageRows = hasNext ? rows.slice(0, opts.limit) : rows;
    const authorIds = pageRows.map((row) => row.id);
    const [seriesNames, previews] = await Promise.all([
      this.findTopSeriesNameByAuthor(authorIds, accessibleIds, filterClauses),
      this.findAuthorPreviewRows(userId, authorIds, accessibleIds, filterClauses),
    ]);

    return {
      items: pageRows.map((row) => ({
        ...row,
        seriesName: seriesNames.get(row.id) ?? null,
        previews: previews.get(row.id) ?? [],
      })),
      hasNext,
      total: summary.total,
      buckets: summary.buckets,
    };
  }

  async getDistinctSeriesPage(
    userId: number,
    opts: { q?: string; limit: number; offset: number; sort?: CatalogListSort; filter?: CatalogListFilter } & CatalogVisibilityOptions,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<OpdsCatalogListPage<OpdsSeriesPageRow>> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return { items: [], hasNext: false, total: 0, buckets: [] };

    const filterClauses = this.bookVisibilityClauses(isSuperuser, contentFilters, opts);
    const sort = opts.sort ?? 'name';
    const order = seriesListOrder(sort);
    const letter = latinJumpBucketExpr(bookSeries.name);
    const where: SQL[] = [inArray(books.libraryId, accessibleIds)];
    const term = opts.q?.trim();
    if (term) {
      where.push(accentInsensitiveIlike(bookSeries.name, buildSearchPattern(term)));
    }
    // "reading" is a series under way: a book in progress, or some but not all finished.
    const having =
      opts.filter === 'reading'
        ? sql`(${READING_COUNT_EXPR} > 0 OR (${FINISHED_COUNT_EXPR} > 0 AND ${FINISHED_COUNT_EXPR} < ${BOOK_COUNT_EXPR}))`
        : opts.filter === 'finished'
          ? sql`${FINISHED_COUNT_EXPR} = ${BOOK_COUNT_EXPR}`
          : undefined;
    const bookJoin = and(eq(books.id, bookSeriesMemberships.bookId), eq(books.status, 'present'), ...filterClauses)!;
    const statusJoin = and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, userId))!;

    const ranked = this.db
      .select({
        letter: sql<string>`${letter}`.as('letter'),
        rn: sql<number>`(row_number() OVER (ORDER BY ${joinOrder(order)}) - 1)::int`.as('rn'),
      })
      .from(bookSeries)
      .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.seriesId, bookSeries.id))
      .innerJoin(books, bookJoin)
      .leftJoin(userBookStatus, statusJoin)
      .where(and(...where))
      .groupBy(bookSeries.id)
      .having(having)
      .as('ranked');

    const [rows, summary] = await Promise.all([
      this.db
        .select({
          id: bookSeries.id,
          name: bookSeries.name,
          expectedCount: bookSeries.expectedBookCount,
          letter: sql<string>`${letter}`,
          bookCount: sql<number>`${BOOK_COUNT_EXPR}::int`,
          readingCount: sql<number>`${READING_COUNT_EXPR}::int`,
          finishedCount: sql<number>`${FINISHED_COUNT_EXPR}::int`,
        })
        .from(bookSeries)
        .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.seriesId, bookSeries.id))
        .innerJoin(books, bookJoin)
        .leftJoin(userBookStatus, statusJoin)
        .where(and(...where))
        .groupBy(bookSeries.id)
        .having(having)
        .orderBy(...order)
        .limit(opts.limit + 1)
        .offset(opts.offset),
      this.summarizeRankedLetters(ranked),
    ]);

    const hasNext = rows.length > opts.limit;
    const pageRows = hasNext ? rows.slice(0, opts.limit) : rows;
    const members = await this.findSeriesMembers(
      userId,
      pageRows.map((row) => row.id),
      accessibleIds,
      filterClauses,
    );

    return {
      items: pageRows.map((row) => {
        const member = members.get(row.id);
        return {
          ...row,
          authorNames: member?.authorNames ?? [],
          memberStates: member?.memberStates ?? [],
          previews: member?.previews ?? [],
        };
      }),
      hasNext,
      total: summary.total,
      buckets: summary.buckets,
    };
  }

  // Letter buckets read off the list's own row numbering, so each index is the
  // offset of the first row with that letter whatever the order does with
  // punctuation or with letters that fold to "#".
  private async summarizeRankedLetters(
    ranked: Subquery & { letter: SQL.Aliased<string>; rn: SQL.Aliased<number> },
  ): Promise<{ total: number; buckets: CatalogJumpBucketRow[] }> {
    const rows = await this.db
      .select({
        key: ranked.letter,
        index: sql<number>`min(${ranked.rn})::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(ranked)
      .groupBy(ranked.letter)
      .orderBy(sql`min(${ranked.rn})`);
    return {
      total: rows.reduce((sum, row) => sum + Number(row.count), 0),
      buckets: rows.map((row) => ({ key: row.key, index: Number(row.index) })),
    };
  }

  private async findTopSeriesNameByAuthor(authorIds: number[], accessibleIds: number[], filterClauses: SQL[]): Promise<Map<number, string>> {
    if (authorIds.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([bookAuthors.authorId], { authorId: bookAuthors.authorId, name: bookSeries.name })
      .from(bookAuthors)
      .innerJoin(books, and(eq(books.id, bookAuthors.bookId), eq(books.status, 'present'), ...filterClauses))
      .innerJoin(bookSeriesMemberships, eq(bookSeriesMemberships.bookId, books.id))
      .innerJoin(bookSeries, eq(bookSeries.id, bookSeriesMemberships.seriesId))
      .where(and(inArray(bookAuthors.authorId, authorIds), inArray(books.libraryId, accessibleIds)))
      .groupBy(bookAuthors.authorId, bookSeries.id)
      .orderBy(bookAuthors.authorId, sql`${BOOK_COUNT_EXPR} DESC`, bookSeries.name, bookSeries.id);
    return new Map(rows.map((row) => [row.authorId, row.name]));
  }

  // Up to `limit` books per author: in progress first by latest progress, then
  // finished by finish date, then the rest newest first. One windowed query
  // for the whole page.
  private async findAuthorPreviewRows(
    userId: number,
    authorIds: number[],
    accessibleIds: number[],
    filterClauses: SQL[],
    limit = CATALOG_PREVIEW_LIMIT,
  ): Promise<Map<number, OpdsPreviewBookRow[]>> {
    if (authorIds.length === 0) return new Map();
    const isReading = sql`${userBookStatus.status} IN ${READ_STATUS_BUCKETS.reading}`;
    const isFinished = sql`${userBookStatus.status} IN ${READ_STATUS_BUCKETS.finished}`;
    const latestProgress = sql`(
      SELECT max(${readingProgress.updatedAt})
      FROM ${readingProgress}
      INNER JOIN ${bookFiles} ON ${bookFiles.id} = ${readingProgress.bookFileId}
      WHERE ${bookFiles.bookId} = ${books.id} AND ${readingProgress.userId} = ${userId}
    )`;
    const tier = sql`CASE WHEN ${isReading} THEN 0 WHEN ${isFinished} THEN 1 ELSE 2 END`;
    const recency = sql`CASE
      WHEN ${isReading} THEN COALESCE(${latestProgress}, ${userBookStatus.updatedAt})
      WHEN ${isFinished} THEN COALESCE(${userBookStatus.finishedAt}, ${userBookStatus.updatedAt})
      ELSE ${books.addedAt}
    END`;

    const ranked = this.db
      .select({
        groupId: sql<number>`${bookAuthors.authorId}`.as('group_id'),
        bookId: sql<number>`${books.id}`.as('preview_book_id'),
        rn: sql<number>`(row_number() OVER (PARTITION BY ${bookAuthors.authorId} ORDER BY ${tier}, ${recency} DESC NULLS LAST, ${books.id} DESC))::int`.as(
          'rn',
        ),
      })
      .from(bookAuthors)
      .innerJoin(books, and(eq(books.id, bookAuthors.bookId), eq(books.status, 'present'), ...filterClauses))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, userId)))
      .where(and(inArray(bookAuthors.authorId, authorIds), inArray(books.libraryId, accessibleIds)))
      .as('ranked');

    const rows = await this.db
      .select({
        groupId: ranked.groupId,
        id: books.id,
        title: bookMetadata.title,
        folderPath: books.folderPath,
        coverSource: bookMetadata.coverSource,
        seriesIndex: bookMetadata.seriesIndex,
        addedAt: books.addedAt,
        updatedAt: books.updatedAt,
      })
      .from(ranked)
      .innerJoin(books, eq(books.id, ranked.bookId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(sql`${ranked.rn} <= ${limit}`)
      .orderBy(ranked.groupId, ranked.rn);

    const byAuthor = new Map<number, OpdsPreviewBookRow[]>();
    for (const row of rows) {
      const list = byAuthor.get(row.groupId) ?? [];
      list.push(mapPreviewRow(row));
      byAuthor.set(row.groupId, list);
    }
    return byAuthor;
  }

  // Every visible book of each series in reading order, capped, with this
  // reader's status. The first rows double as the preview covers.
  private async findSeriesMembers(
    userId: number,
    seriesIds: number[],
    accessibleIds: number[],
    filterClauses: SQL[],
  ): Promise<Map<number, { authorNames: string[]; memberStates: CatalogReadBucket[]; previews: OpdsPreviewBookRow[] }>> {
    if (seriesIds.length === 0) return new Map();
    const memberOrder = [
      ...seriesIndexOrderBy(bookSeriesMemberships.seriesIndex, 'ASC'),
      sql`${bookMetadata.title} ASC NULLS LAST`,
      sql`${books.id} ASC`,
    ];

    const ranked = this.db
      .select({
        seriesId: sql<number>`${bookSeriesMemberships.seriesId}`.as('member_series_id'),
        bookId: sql<number>`${books.id}`.as('member_book_id'),
        seriesIndex: sql<string | null>`${bookSeriesMemberships.seriesIndex}`.as('member_series_index'),
        status: sql<string | null>`${userBookStatus.status}`.as('member_status'),
        rn: sql<number>`(row_number() OVER (PARTITION BY ${bookSeriesMemberships.seriesId} ORDER BY ${joinOrder(memberOrder)}))::int`.as('member_rn'),
      })
      .from(bookSeriesMemberships)
      .innerJoin(books, and(eq(books.id, bookSeriesMemberships.bookId), eq(books.status, 'present'), ...filterClauses))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, userId)))
      .where(and(inArray(bookSeriesMemberships.seriesId, seriesIds), inArray(books.libraryId, accessibleIds)))
      .as('members');

    const firstAuthor = sql<string | null>`(
      SELECT ${authors.name}
      FROM ${bookAuthors}
      INNER JOIN ${authors} ON ${authors.id} = ${bookAuthors.authorId}
      WHERE ${bookAuthors.bookId} = ${ranked.bookId}
      ORDER BY ${bookAuthors.displayOrder} ASC, ${bookAuthors.authorId} ASC
      LIMIT 1
    )`;

    const rows = await this.db
      .select({
        seriesId: ranked.seriesId,
        id: books.id,
        seriesIndex: ranked.seriesIndex,
        status: ranked.status,
        title: bookMetadata.title,
        folderPath: books.folderPath,
        coverSource: bookMetadata.coverSource,
        addedAt: books.addedAt,
        updatedAt: books.updatedAt,
        firstAuthor,
      })
      .from(ranked)
      .innerJoin(books, eq(books.id, ranked.bookId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(sql`${ranked.rn} <= ${SERIES_MEMBER_STATE_LIMIT}`)
      .orderBy(ranked.seriesId, ranked.rn);

    const bySeries = new Map<number, { authorNames: string[]; memberStates: CatalogReadBucket[]; previews: OpdsPreviewBookRow[] }>();
    for (const row of rows) {
      const entry = bySeries.get(row.seriesId) ?? { authorNames: [], memberStates: [], previews: [] };
      entry.memberStates.push(readStatusBucket(row.status));
      if (entry.previews.length < CATALOG_PREVIEW_LIMIT) entry.previews.push(mapPreviewRow(row));
      if (row.firstAuthor && entry.authorNames.length < SERIES_AUTHOR_NAME_LIMIT && !entry.authorNames.includes(row.firstAuthor)) {
        entry.authorNames.push(row.firstAuthor);
      }
      bySeries.set(row.seriesId, entry);
    }
    return bySeries;
  }

  /**
   * Total, reading and finished counts plus the newest books of one catalog
   * scope. The scope is the one getBooksPage pages through, so these numbers
   * always agree with the list they summarise.
   */
  async summarizeBooks(
    userId: number,
    filters: OpdsBookFilters,
    previewLimit: number,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<OpdsBookSummary> {
    const scope = await this.buildCatalogScope(userId, filters, isSuperuser, contentFilters);
    if (!scope) return { total: 0, reading: 0, finished: 0, previews: [] };

    const [[counts], previewRows] = await Promise.all([
      this.db
        .select({
          total: sql<number>`count(*)::int`,
          reading: sql<number>`(count(*) FILTER (WHERE ${this.buildReadStatusClause(userId, 'reading')}))::int`,
          finished: sql<number>`(count(*) FILTER (WHERE ${this.buildReadStatusClause(userId, 'finished')}))::int`,
        })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(scope.where),
      previewLimit > 0
        ? this.db
            .select({
              id: books.id,
              title: bookMetadata.title,
              folderPath: books.folderPath,
              coverSource: bookMetadata.coverSource,
              seriesIndex: bookMetadata.seriesIndex,
              addedAt: books.addedAt,
              updatedAt: books.updatedAt,
            })
            .from(books)
            .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
            .where(scope.where)
            .orderBy(...OPDS_SORT_MAP.recent)
            .limit(previewLimit)
        : Promise.resolve([]),
    ]);

    return {
      total: Number(counts?.total ?? 0),
      reading: Number(counts?.reading ?? 0),
      finished: Number(counts?.finished ?? 0),
      previews: previewRows.map(mapPreviewRow),
    };
  }

  // Offsets into the list getBooksPage would return for the same filters and
  // sort, numbered by the very same ORDER BY.
  async getBookJumpBuckets(
    userId: number,
    sortOrder: CatalogBucketSortOrder,
    filters: OpdsBookFilters,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<CatalogJumpBucketRow[]> {
    const scope = await this.buildCatalogScope(userId, filters, isSuperuser, contentFilters);
    if (!scope) return [];

    const key = sortOrder === 'title_asc' || sortOrder === 'title_desc' ? bookMetadata.title : books.primaryAuthorSortName;
    const ranked = this.db
      .select({
        letter: sql<string>`${latinJumpBucketExpr(key)}`.as('letter'),
        rn: sql<number>`(row_number() OVER (ORDER BY ${joinOrder(OPDS_SORT_MAP[sortOrder])}) - 1)::int`.as('rn'),
      })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(scope.where)
      .as('ranked');
    return (await this.summarizeRankedLetters(ranked)).buckets;
  }

  /**
   * An author this reader can see: one with at least one present book in a
   * library they can open that their content filters let through.
   */
  async findVisibleAuthor(
    userId: number,
    lookup: { id: number } | { name: string },
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
  ): Promise<OpdsVisibleAuthor | null> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return null;

    const filterClauses = !isSuperuser && contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const visibleBook = this.db
      .select({ one: sql`1` })
      .from(bookAuthors)
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(and(eq(bookAuthors.authorId, authors.id), inArray(books.libraryId, accessibleIds), eq(books.status, 'present'), ...filterClauses));

    const [row] = await this.db
      .select({
        id: authors.id,
        name: authors.name,
        description: authors.description,
        birthYear: authors.birthYear,
        deathYear: authors.deathYear,
        hasPhoto: authors.hasPhoto,
      })
      .from(authors)
      .where(and('id' in lookup ? eq(authors.id, lookup.id) : eq(authors.name, lookup.name), sql`exists (${visibleBook})`))
      .limit(1);
    return row ?? null;
  }

  async getUserCollections(userId: number, isSuperuser = false, contentFilters?: ContentFilterRules, options: CatalogVisibilityOptions = {}) {
    return this.collectionRepository.findVisibleForUser(
      userId,
      isSuperuser,
      contentFilters,
      options.excludeAudioOnly ? [excludeAudioOnlyBooks()] : [],
    );
  }

  // Badge counts only need the totals, so these skip the per-entity book counts
  // their list siblings compute. Counting collections through getUserCollections
  // would aggregate over collection_books just to read the row count back.
  async countUserCollections(userId: number): Promise<number> {
    return this.collectionRepository.countVisibleForUser(userId);
  }

  async countUserSmartScopes(userId: number): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(smartScopes)
      .where(or(eq(smartScopes.userId, userId), eq(smartScopes.isPublic, true)));
    return Number(row?.total ?? 0);
  }

  // Badge totals for a narrowed catalog. They join books exactly as the author and series pages do,
  // so a badge always agrees with the list it opens.
  async countVisibleAuthors(
    userId: number,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
    options: CatalogVisibilityOptions = {},
  ): Promise<number> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return 0;
    const [row] = await this.db
      .select({ total: sql<number>`count(DISTINCT ${bookAuthors.authorId})::int` })
      .from(bookAuthors)
      .innerJoin(
        books,
        and(eq(books.id, bookAuthors.bookId), eq(books.status, 'present'), ...this.bookVisibilityClauses(isSuperuser, contentFilters, options)),
      )
      .where(inArray(books.libraryId, accessibleIds));
    return Number(row?.total ?? 0);
  }

  async countVisibleSeries(
    userId: number,
    isSuperuser = false,
    contentFilters?: ContentFilterRules,
    options: CatalogVisibilityOptions = {},
  ): Promise<number> {
    const accessibleIds = await this.getAccessibleLibraryIds(userId, isSuperuser);
    if (accessibleIds.length === 0) return 0;
    const [row] = await this.db
      .select({ total: sql<number>`count(DISTINCT ${bookSeriesMemberships.seriesId})::int` })
      .from(bookSeriesMemberships)
      .innerJoin(
        books,
        and(
          eq(books.id, bookSeriesMemberships.bookId),
          eq(books.status, 'present'),
          ...this.bookVisibilityClauses(isSuperuser, contentFilters, options),
        ),
      )
      .where(inArray(books.libraryId, accessibleIds));
    return Number(row?.total ?? 0);
  }

  /**
   * The libraries among `libraryIds` that hold present books but none outside audio: what a reader
   * hiding audiobook-only books would only ever see empty. A library with no books is not one.
   */
  async findAudioOnlyLibraryIds(libraryIds: number[]): Promise<number[]> {
    if (libraryIds.length === 0) return [];
    const presentBook = (extra?: SQL) =>
      this.db
        .select({ one: sql`1` })
        .from(books)
        .where(and(eq(books.libraryId, libraries.id), eq(books.status, 'present'), extra));
    const rows = await this.db
      .select({ id: libraries.id })
      .from(libraries)
      .where(and(inArray(libraries.id, libraryIds), exists(presentBook()), notExists(presentBook(excludeAudioOnlyBooks()))));
    return rows.map((row) => row.id);
  }

  /** The books among `bookIds` whose content files are all audio. */
  async findAudioOnlyBookIds(bookIds: number[]): Promise<Set<number>> {
    const ids = [...new Set(bookIds)];
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .where(and(inArray(books.id, ids), not(excludeAudioOnlyBooks())));
    return new Set(rows.map((row) => row.id));
  }

  // The scope is shared with getBooksPage so a count can never disagree with the
  // list it labels, but nothing is fetched or hydrated to produce it.
  async countBooks(userId: number, filters?: OpdsBookFilters, isSuperuser = false, contentFilters?: ContentFilterRules): Promise<number> {
    const scope = await this.buildCatalogScope(userId, filters, isSuperuser, contentFilters);
    if (!scope) return 0;
    const [row] = await this.db.select({ total: count() }).from(books).leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id)).where(scope.where);
    return Number(row?.total ?? 0);
  }

  async getUserSmartScopes(userId: number) {
    return this.db
      .select({
        id: smartScopes.id,
        name: smartScopes.name,
        icon: smartScopes.icon,
      })
      .from(smartScopes)
      .where(or(eq(smartScopes.userId, userId), eq(smartScopes.isPublic, true)))
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

  /**
   * The file a download serves: the one asked for when it is a content file, otherwise the edition an
   * OPDS reader can open, the primary unless that is an audiobook with a readable edition beside it.
   */
  async getBookFiles(
    bookId: number,
    fileId?: number,
    original = false,
  ): Promise<{
    id: number;
    contentVersion: string;
    mtime: Date | null;
    sizeBytes: number | null;
    ino: bigint;
    absolutePath: string;
    format: string;
    readAlong: boolean;
    title: string;
    authorName: string;
  } | null> {
    const candidates = await this.db
      .select({
        id: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        updatedAt: bookFiles.updatedAt,
        mtime: bookFiles.mtime,
        ino: bookFiles.ino,
        format: bookFiles.format,
        role: bookFiles.role,
        sizeBytes: bookFiles.sizeBytes,
        mediaOverlayAvailable: bookFiles.mediaOverlayAvailable,
        title: bookMetadata.title,
        primaryFileId: books.primaryFileId,
        formatPriority: libraries.formatPriority,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .leftJoin(libraries, eq(libraries.id, books.libraryId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, bookFiles.bookId))
      .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.role, 'content')))
      .orderBy(bookFiles.sortOrder, bookFiles.id);

    const first = candidates[0];
    if (!first) return null;
    const file = fileId
      ? candidates.find((candidate) => candidate.id === fileId)
      : (() => {
          const ranked = rankFilesByFormatPriority(candidates, first.formatPriority as string[] | null, first.primaryFileId);
          const selected = ranked.find((candidate) => candidate.format != null && !isAudioFormat(candidate.format)) ?? ranked[0];
          return original && selected?.format?.toLowerCase() === 'epub'
            ? (ranked.find((candidate) => candidate.format?.toLowerCase() === 'epub' && candidate.mediaOverlayAvailable) ?? selected)
            : selected;
        })();
    if (!file) return null;

    const [authorRow] = await this.db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(eq(bookAuthors.bookId, bookId))
      .orderBy(bookAuthors.displayOrder)
      .limit(1);

    return {
      id: file.id,
      contentVersion: file.updatedAt.toISOString(),
      mtime: file.mtime,
      sizeBytes: file.sizeBytes,
      ino: file.ino,
      absolutePath: file.absolutePath,
      format: file.format ?? 'unknown',
      readAlong: file.format?.toLowerCase() === 'epub' && file.mediaOverlayAvailable,
      title: file.title ?? `book-${bookId}`,
      authorName: authorRow?.name ?? '',
    };
  }

  private async buildSmartScopeWhere(
    userId: number,
    smartScopeId: number,
    accessibleIds: number[],
    contentFilters?: ContentFilterRules,
    q?: string,
  ): Promise<SQL | null> {
    const [smartScope] = await this.db.select().from(smartScopes).where(eq(smartScopes.id, smartScopeId)).limit(1);
    if (!smartScope) return null;
    if (!smartScope.isPublic && smartScope.userId !== userId) return null;

    const where = this.queryBuilder.buildWhere(smartScope.filter as GroupRule | null, {
      accessibleLibraryIds: accessibleIds,
      userId,
      contentFilters,
    });
    const statusClause = eq(books.status, 'present');
    const searchClause = q?.trim() ? this.buildCatalogSearchClause(q) : undefined;
    return and(...([where, statusClause, searchClause].filter(Boolean) as SQL[]))!;
  }

  // When this reader last opened each book: one aggregate over their own
  // progress rows, joined in, so the cost follows what they have read rather
  // than the size of the library.
  private lastReadByBook(userId: number) {
    return this.db
      .select({ bookId: bookFiles.bookId, lastReadAt: sql<Date>`max(${readingProgress.lastReadAt})`.as('last_read_at') })
      .from(readingProgress)
      .innerJoin(bookFiles, eq(bookFiles.id, readingProgress.bookFileId))
      .where(eq(readingProgress.userId, userId))
      .groupBy(bookFiles.bookId)
      .as('last_read');
  }

  // last_read: newest opened first, then the books never opened in the order
  // their status last changed.
  private sortClauses(sortOrder: OpdsSortOrder, lastRead?: ReturnType<OpdsBookService['lastReadByBook']>): SQL[] {
    if (sortOrder !== 'last_read' && sortOrder !== 'last_read_asc') return OPDS_SORT_MAP[sortOrder];
    if (!lastRead) return OPDS_SORT_MAP[sortOrder === 'last_read' ? 'recent' : 'recent_asc'];
    const dir = sortOrder === 'last_read' ? sql`DESC` : sql`ASC`;
    return [sql`${lastRead.lastReadAt} ${dir} NULLS LAST`, sql`${userBookStatus.updatedAt} ${dir} NULLS LAST`, sql`${books.id} ASC`];
  }

  private async paginatedBookQuery(
    where: SQL,
    sortOrder: OpdsSortOrder,
    page: number,
    size: number,
    userId?: number,
    options: FetchBookEntriesOptions = {},
  ): Promise<{ entries: OpdsBookEntry[]; total: number }> {
    const offset = options.offset ?? (page - 1) * size;
    const byLastRead = sortOrder === 'last_read' || sortOrder === 'last_read_asc';
    const needsStatusJoin = (sortOrder === 'recently_read' || sortOrder === 'recently_read_asc' || byLastRead) && userId !== undefined;
    const needsContextSeriesJoin = options.contextSeries !== undefined && (sortOrder === 'series_asc' || sortOrder === 'series_desc');
    const lastRead = byLastRead && userId !== undefined ? this.lastReadByBook(userId) : undefined;
    const orderClauses = needsContextSeriesJoin ? this.buildContextSeriesOrder(sortOrder) : this.sortClauses(sortOrder, lastRead);

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
      if (lastRead) {
        return this.db
          .select({ id: books.id })
          .from(books)
          .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
          .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, userId!)))
          .leftJoin(lastRead, eq(lastRead.bookId, books.id))
          .where(where)
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
          primaryFileId: books.primaryFileId,
          formatPriority: libraries.formatPriority,
        })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .leftJoin(libraries, eq(libraries.id, books.libraryId))
        .where(inArray(books.id, bookIds)),
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, bookIds))
        .orderBy(bookAuthors.displayOrder),
      this.db
        .select({
          bookId: books.id,
          id: bookFiles.id,
          format: bookFiles.format,
          role: bookFiles.role,
          sizeBytes: bookFiles.sizeBytes,
          mediaOverlayAvailable: bookFiles.mediaOverlayAvailable,
          contentVersion: bookFiles.updatedAt,
        })
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

    const rankedFileRows = rankFileRowsByBook(
      fileRows,
      new Map(metaRows.map((row) => [row.id, { formatPriority: row.formatPriority as string[] | null, primaryFileId: row.primaryFileId }])),
    );
    const allFilesByBook = new Map<number, NonNullable<OpdsBookEntry['allFiles']>>();
    for (const row of rankedFileRows) {
      const files = allFilesByBook.get(row.bookId) ?? [];
      files.push({
        id: row.id,
        format: row.format ?? 'unknown',
        mediaOverlayAvailable: row.mediaOverlayAvailable,
        contentVersion: row.contentVersion.toISOString(),
      });
      allFilesByBook.set(row.bookId, files);
    }
    const filesByBook = new Map<number, { id: number; format: string }[]>();
    for (const row of rankedFileRows) {
      if (row.role !== 'content' || isRedundantReadAlong(row, rankedFileRows)) continue;
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
          allFiles: allFilesByBook.get(row.id) ?? [],
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
    return [...seriesIndexOrderBy(bookSeriesMemberships.seriesIndex, direction), sql`${bookMetadata.title} ASC NULLS LAST`, sql`${books.id} ASC`];
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

function mapPreviewRow(row: {
  id: number;
  title: string | null;
  folderPath: string;
  coverSource: string | null;
  seriesIndex: string | null;
  addedAt: Date;
  updatedAt: Date;
}): OpdsPreviewBookRow {
  return {
    id: row.id,
    title: row.title ?? row.folderPath.split('/').pop() ?? 'Untitled',
    hasCover: row.coverSource !== null,
    seriesIndex: row.seriesIndex,
    addedAt: row.addedAt,
    updatedAt: row.updatedAt,
  };
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
