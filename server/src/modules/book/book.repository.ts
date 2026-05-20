import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, asc, count, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { SUPPORTED_BOOK_FORMATS } from '../upload/upload-validator.service';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { SortSpec } from '@bookorbit/types';
import { BookQueryBuilder } from './book-query-builder.service';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  authors,
  bookAuthors,
  bookFiles,
  bookGenres,
  bookMetadata,
  bookNarrators,
  books,
  bookTags,
  collectionBooks,
  collections,
  genres,
  koboLibrarySnapshots,
  koboReadingStates,
  koboSnapshotBooks,
  libraries,
  narrators,
  audiobookProgress,
  readingProgress,
  userBookRatings,
  tags,
  userBookStatus,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type MetadataUpdateExecutor = Pick<Db, 'update'>;
type MetadataReadExecutor = Pick<Db, 'select'>;

type CollapsedRawRow = {
  id: number;
  status: string;
  primary_file_id: number | null;
  folder_path: string;
  added_at: string;
  updated_at: string;
  title: string | null;
  series_name: string | null;
  series_index: number | null;
  published_year: number | null;
  language: string | null;
  rating: number | null;
  metadata_score: number | null;
  cover_source: string | null;
  locked_fields: string[] | null;
  subtitle: string | null;
  isbn13: string | null;
  publisher: string | null;
  page_count: number | null;
  sort_title: string | null;
  sort_added_at: string | null;
  book_count: string | null;
  read_count: string | null;
  cover_book_ids: number[] | null;
  total_count: string;
};
type PatternMetadataRow = {
  bookId: number;
  title: string | null;
  subtitle: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  seriesName: string | null;
  seriesIndex: number | null;
  isbn13: string | null;
  authors: string[];
};

@Injectable()
export class BookRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private visibleWhere(where: SQL | undefined): SQL {
    return where ? and(where, ne(books.status, 'processing'))! : ne(books.status, 'processing');
  }

  async withTransaction<T>(callback: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => callback(tx));
  }

  async findCards(opts: { where: SQL | undefined; orderBy: SQL[]; limit: number; offset: number; userId: number }) {
    const { where, orderBy, limit, offset, userId } = opts;
    const visibleWhere = this.visibleWhere(where);

    const rows = await this.db
      .select({
        id: books.id,
        status: books.status,
        primaryFileId: books.primaryFileId,
        folderPath: books.folderPath,
        addedAt: books.addedAt,
        updatedAt: books.updatedAt,
        title: bookMetadata.title,
        seriesName: bookMetadata.seriesName,
        seriesIndex: bookMetadata.seriesIndex,
        publishedYear: bookMetadata.publishedYear,
        language: bookMetadata.language,
        rating: userBookRatings.rating,
        coverSource: bookMetadata.coverSource,
        lockedFields: bookMetadata.lockedFields,
        subtitle: bookMetadata.subtitle,
        publisher: bookMetadata.publisher,
        pageCount: bookMetadata.pageCount,
        isbn13: bookMetadata.isbn13,
        metadataScore: bookMetadata.metadataScore,
        _total: sql<number>`count(*) over()`.as('_total'),
      })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(userBookRatings, and(eq(userBookRatings.bookId, books.id), eq(userBookRatings.userId, userId)))
      .where(visibleWhere)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const total = rows.length > 0 ? rows[0]._total : await this.countWhere(visibleWhere);

    const bookRefs = rows.map((r) => ({ id: r.id, primaryFileId: r.primaryFileId ?? null }));
    const enrichment = await this.enrichBookIds(bookRefs, userId);

    return { rows, ...enrichment, total: Number(total) };
  }

  private async enrichBookIds(bookRefs: Array<{ id: number; primaryFileId: number | null }>, userId: number) {
    const bookIds = bookRefs.map((book) => book.id);
    const primaryFileIds = bookRefs.map((book) => book.primaryFileId).filter((id): id is number => id != null);

    if (bookIds.length === 0) {
      return {
        authorRows: [] as { bookId: number; name: string }[],
        fileRows: [] as { bookId: number; id: number; format: string | null; role: string; sizeBytes: number | null }[],
        genreRows: [] as { bookId: number; name: string }[],
        tagRows: [] as { bookId: number; name: string }[],
        progressRows: [] as { bookFileId: number; percentage: number }[],
        statusRows: [] as {
          bookId: number;
          status: string;
          source: string;
          startedAt: Date | null;
          finishedAt: Date | null;
          updatedAt: Date;
        }[],
        narratorRows: [] as { bookId: number; name: string }[],
      };
    }

    const [authorRows, fileRows, genreRows, tagRows, narratorRows, statusRows, fileProgressRows, audiobookProgressRows] = await Promise.all([
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, bookIds))
        .orderBy(bookAuthors.displayOrder),
      this.db
        .select({ bookId: bookFiles.bookId, id: bookFiles.id, format: bookFiles.format, role: bookFiles.role, sizeBytes: bookFiles.sizeBytes })
        .from(bookFiles)
        .where(inArray(bookFiles.bookId, bookIds)),
      this.db
        .select({ bookId: bookGenres.bookId, name: genres.name })
        .from(bookGenres)
        .innerJoin(genres, eq(genres.id, bookGenres.genreId))
        .where(inArray(bookGenres.bookId, bookIds)),
      this.db
        .select({ bookId: bookTags.bookId, name: tags.name })
        .from(bookTags)
        .innerJoin(tags, eq(tags.id, bookTags.tagId))
        .where(inArray(bookTags.bookId, bookIds)),
      this.db
        .select({ bookId: bookNarrators.bookId, name: narrators.name })
        .from(bookNarrators)
        .innerJoin(narrators, eq(narrators.id, bookNarrators.narratorId))
        .where(inArray(bookNarrators.bookId, bookIds))
        .orderBy(bookNarrators.displayOrder),
      this.db
        .select({
          bookId: userBookStatus.bookId,
          status: userBookStatus.status,
          source: userBookStatus.source,
          startedAt: userBookStatus.startedAt,
          finishedAt: userBookStatus.finishedAt,
          updatedAt: userBookStatus.updatedAt,
        })
        .from(userBookStatus)
        .where(and(eq(userBookStatus.userId, userId), inArray(userBookStatus.bookId, bookIds))),
      primaryFileIds.length > 0
        ? this.db
            .select({
              bookFileId: readingProgress.bookFileId,
              percentage: readingProgress.percentage,
              updatedAt: readingProgress.updatedAt,
            })
            .from(readingProgress)
            .where(and(eq(readingProgress.userId, userId), inArray(readingProgress.bookFileId, primaryFileIds)))
        : Promise.resolve([] as { bookFileId: number; percentage: number; updatedAt: Date }[]),
      this.db
        .select({
          bookId: audiobookProgress.bookId,
          percentage: audiobookProgress.percentage,
          updatedAt: audiobookProgress.updatedAt,
        })
        .from(audiobookProgress)
        .where(and(eq(audiobookProgress.userId, userId), inArray(audiobookProgress.bookId, bookIds))),
    ]);

    const fileProgressById = new Map(fileProgressRows.map((row) => [row.bookFileId, row]));
    const audiobookProgressByBookId = new Map(audiobookProgressRows.map((row) => [row.bookId, row]));
    const progressRows = bookRefs.flatMap((book) => {
      if (book.primaryFileId == null) return [];

      const fileProgress = fileProgressById.get(book.primaryFileId);
      const audioProgress = audiobookProgressByBookId.get(book.id);
      if (!fileProgress && !audioProgress) return [];

      const mergedPercentage =
        fileProgress && audioProgress
          ? fileProgress.updatedAt >= audioProgress.updatedAt
            ? fileProgress.percentage
            : audioProgress.percentage
          : (fileProgress?.percentage ?? audioProgress?.percentage ?? null);

      return [{ bookFileId: book.primaryFileId, percentage: mergedPercentage }];
    });

    return { authorRows, fileRows, genreRows, tagRows, progressRows, statusRows, narratorRows };
  }

  async findCardsByBookIds(bookIds: number[], userId: number) {
    if (bookIds.length === 0) {
      return {
        rows: [],
        authorRows: [],
        fileRows: [],
        genreRows: [],
        tagRows: [],
        progressRows: [],
        statusRows: [],
        narratorRows: [],
        total: 0,
      };
    }

    return this.findCards({
      where: inArray(books.id, bookIds),
      orderBy: [],
      limit: bookIds.length,
      offset: 0,
      userId,
    });
  }

  async findCardsCollapsed(opts: { where: SQL | undefined; sort: SortSpec[]; limit: number; offset: number; userId: number }): Promise<{
    rows: Array<{
      id: number;
      status: string;
      primaryFileId: number | null;
      folderPath: string;
      addedAt: Date;
      updatedAt: Date;
      title: string | null;
      seriesName: string | null;
      seriesIndex: number | null;
      publishedYear: number | null;
      language: string | null;
      rating: number | null;
      metadataScore: number | null;
      coverSource: string | null;
      lockedFields: string[] | null;
      subtitle: string | null;
      publisher: string | null;
      pageCount: number | null;
      isbn13: string | null;
      bookCount: number | null;
      readCount: number | null;
      coverBookIds: number[] | null;
      seriesLatestAddedAt: Date | null;
    }>;
    authorRows: { bookId: number; name: string }[];
    fileRows: { bookId: number; id: number; format: string | null; role: string; sizeBytes: number | null }[];
    genreRows: { bookId: number; name: string }[];
    tagRows: { bookId: number; name: string }[];
    progressRows: { bookFileId: number; percentage: number | null }[];
    statusRows: {
      bookId: number;
      status: string;
      source: string;
      startedAt: Date | null;
      finishedAt: Date | null;
      updatedAt: Date;
    }[];
    narratorRows: { bookId: number; name: string }[];
    total: number;
  }> {
    const { where, sort, limit, offset, userId } = opts;
    const whereFragment = this.visibleWhere(where);
    const orderBy = BookQueryBuilder.buildCollapseOrderBy(sort, userId);

    const result = await this.db.execute<CollapsedRawRow>(sql`
      WITH series_agg AS (
        SELECT
          NULLIF(lower(btrim(book_metadata.series_name)), '') AS norm_series,
          books.library_id,
          COUNT(*) AS book_count,
          SUM(CASE WHEN user_book_status.status = 'read' THEN 1 ELSE 0 END) AS read_count,
          MAX(books.added_at) AS latest_added_at
        FROM books
        LEFT JOIN book_metadata ON book_metadata.book_id = books.id
        LEFT JOIN user_book_status ON user_book_status.book_id = books.id AND user_book_status.user_id = ${userId}
        WHERE ${whereFragment}
          AND NULLIF(lower(btrim(book_metadata.series_name)), '') IS NOT NULL
        GROUP BY NULLIF(lower(btrim(book_metadata.series_name)), ''), books.library_id
      ),
      series_covers AS (
        SELECT
          sa.norm_series,
          sa.library_id,
          covers.cover_book_ids
        FROM series_agg sa
        CROSS JOIN LATERAL (
          SELECT COALESCE(
            ARRAY_AGG(sub.id ORDER BY sub.series_index ASC NULLS LAST, sub.added_at ASC),
            ARRAY[]::int[]
          ) AS cover_book_ids
          FROM (
            SELECT b2.id, bm2.series_index, b2.added_at
            FROM books b2
            JOIN book_metadata bm2 ON bm2.book_id = b2.id
            WHERE NULLIF(lower(btrim(bm2.series_name)), '') = sa.norm_series
              AND b2.library_id = sa.library_id
            ORDER BY bm2.series_index ASC NULLS LAST, b2.added_at ASC
            LIMIT 4
          ) sub
        ) covers
      ),
      representatives AS (
        SELECT DISTINCT ON (books.library_id, COALESCE(NULLIF(lower(btrim(book_metadata.series_name)), ''), 'book_' || books.id::text))
          books.id,
          books.status,
          books.primary_file_id,
          books.folder_path,
          books.added_at,
          books.updated_at,
          book_metadata.title,
          book_metadata.series_name,
          book_metadata.series_index,
          book_metadata.published_year,
          book_metadata.language,
          ubr.rating,
          book_metadata.cover_source,
          book_metadata.locked_fields,
          book_metadata.publisher,
          book_metadata.page_count,
          book_metadata.subtitle,
          book_metadata.isbn13,
          book_metadata.metadata_score,
          books.updated_at,
          COALESCE(NULLIF(lower(btrim(book_metadata.series_name)), ''), lower(book_metadata.title)) AS sort_title,
          COALESCE(sa.latest_added_at, books.added_at) AS sort_added_at,
          sa.book_count,
          sa.read_count,
          sc.cover_book_ids
        FROM books
        LEFT JOIN book_metadata ON book_metadata.book_id = books.id
        LEFT JOIN user_book_ratings ubr ON ubr.book_id = books.id AND ubr.user_id = ${userId}
        LEFT JOIN series_agg sa
          ON sa.norm_series = NULLIF(lower(btrim(book_metadata.series_name)), '')
          AND sa.library_id = books.library_id
        LEFT JOIN series_covers sc
          ON sc.norm_series = sa.norm_series
          AND sc.library_id = sa.library_id
        WHERE ${whereFragment}
        ORDER BY
          books.library_id,
          COALESCE(NULLIF(lower(btrim(book_metadata.series_name)), ''), 'book_' || books.id::text),
          book_metadata.series_index ASC NULLS LAST,
          books.added_at ASC,
          books.id ASC
      )
      SELECT r.*,
        COUNT(*) OVER () AS total_count
      FROM representatives r
      ORDER BY ${sql.raw(orderBy)}
      LIMIT ${limit} OFFSET ${offset}
    `);

    const rawRows = result.rows as CollapsedRawRow[];
    const total = rawRows.length > 0 ? Number(rawRows[0].total_count) : 0;

    const mappedRows = rawRows.map((r) => ({
      id: r.id,
      status: r.status,
      primaryFileId: r.primary_file_id,
      folderPath: r.folder_path,
      addedAt: new Date(r.added_at),
      updatedAt: new Date(r.updated_at),
      title: r.title,
      seriesName: r.series_name,
      seriesIndex: r.series_index,
      publishedYear: r.published_year,
      language: r.language,
      rating: r.rating,
      metadataScore: r.metadata_score !== null ? Number(r.metadata_score) : null,
      coverSource: r.cover_source,
      lockedFields: r.locked_fields,
      subtitle: r.subtitle,
      publisher: r.publisher,
      pageCount: r.page_count !== null ? Number(r.page_count) : null,
      isbn13: r.isbn13,
      bookCount: r.book_count !== null ? Number(r.book_count) : null,
      readCount: r.read_count !== null ? Number(r.read_count) : null,
      coverBookIds: r.cover_book_ids,
      seriesLatestAddedAt: r.sort_added_at ? new Date(r.sort_added_at) : null,
    }));

    const bookRefs = mappedRows.map((row) => ({ id: row.id, primaryFileId: row.primaryFileId ?? null }));
    const enrichment = await this.enrichBookIds(bookRefs, userId);

    return { rows: mappedRows, ...enrichment, total };
  }

  async findById(id: number) {
    const [book] = await this.db
      .select()
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .leftJoin(libraries, eq(libraries.id, books.libraryId))
      .where(eq(books.id, id))
      .limit(1);

    if (!book) return null;

    const [authorRows, genreRows, tagRows, fileRows, narratorRows] = await Promise.all([
      this.db
        .select({ id: authors.id, name: authors.name, sortName: authors.sortName })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(eq(bookAuthors.bookId, id))
        .orderBy(bookAuthors.displayOrder),
      this.db.select({ name: genres.name }).from(bookGenres).innerJoin(genres, eq(genres.id, bookGenres.genreId)).where(eq(bookGenres.bookId, id)),
      this.db.select({ name: tags.name }).from(bookTags).innerJoin(tags, eq(tags.id, bookTags.tagId)).where(eq(bookTags.bookId, id)),
      this.db
        .select({
          id: bookFiles.id,
          format: bookFiles.format,
          role: bookFiles.role,
          sizeBytes: bookFiles.sizeBytes,
          absolutePath: bookFiles.absolutePath,
          createdAt: bookFiles.createdAt,
          durationSeconds: bookFiles.durationSeconds,
        })
        .from(bookFiles)
        .where(eq(bookFiles.bookId, id))
        .orderBy(asc(bookFiles.sortOrder), asc(bookFiles.id)),
      this.db
        .select({ id: narrators.id, name: narrators.name, sortName: narrators.sortName, displayOrder: bookNarrators.displayOrder })
        .from(bookNarrators)
        .innerJoin(narrators, eq(narrators.id, bookNarrators.narratorId))
        .where(eq(bookNarrators.bookId, id))
        .orderBy(bookNarrators.displayOrder),
    ]);

    return { book, authorRows, genreRows, tagRows, fileRows, narratorRows };
  }

  async findRatingByBookAndUser(bookId: number, userId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ rating: userBookRatings.rating })
      .from(userBookRatings)
      .where(and(eq(userBookRatings.bookId, bookId), eq(userBookRatings.userId, userId)))
      .limit(1);
    return row?.rating ?? null;
  }

  async findCollectionsByBookId(bookId: number, userId: number): Promise<{ id: number; name: string }[]> {
    return this.db
      .select({ id: collections.id, name: collections.name })
      .from(collectionBooks)
      .innerJoin(collections, and(eq(collections.id, collectionBooks.collectionId), eq(collections.userId, userId)))
      .where(eq(collectionBooks.bookId, bookId))
      .orderBy(collections.name);
  }

  async findLibraryIdByBookId(bookId: number): Promise<number | null> {
    const [row] = await this.db.select({ libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);
    return row?.libraryId ?? null;
  }

  async findFileById(fileId: number) {
    const [file] = await this.db
      .select({
        id: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        bookId: bookFiles.bookId,
        libraryId: books.libraryId,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(bookFiles.id, fileId))
      .limit(1);
    return file ?? null;
  }

  async findProgress(userId: number, fileId: number) {
    const [row] = await this.db
      .select()
      .from(readingProgress)
      .where(and(eq(readingProgress.bookFileId, fileId), eq(readingProgress.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async findProgressByBook(userId: number, bookId: number) {
    return this.db
      .select({
        fileId: bookFiles.id,
        cfi: readingProgress.cfi,
        pageNumber: readingProgress.pageNumber,
        percentage: readingProgress.percentage,
        updatedAt: readingProgress.updatedAt,
      })
      .from(bookFiles)
      .leftJoin(readingProgress, and(eq(readingProgress.bookFileId, bookFiles.id), eq(readingProgress.userId, userId)))
      .where(eq(bookFiles.bookId, bookId))
      .orderBy(asc(bookFiles.sortOrder), asc(bookFiles.id));
  }

  async findKoboReadingState(userId: number, bookId: number) {
    const [row] = await this.db
      .select({
        createdAtKobo: koboReadingStates.createdAtKobo,
        lastModifiedKobo: koboReadingStates.lastModifiedKobo,
        priorityTimestamp: koboReadingStates.priorityTimestamp,
        currentBookmark: koboReadingStates.currentBookmark,
        statistics: koboReadingStates.statistics,
        statusInfo: koboReadingStates.statusInfo,
        updatedAt: koboReadingStates.updatedAt,
      })
      .from(koboReadingStates)
      .where(and(eq(koboReadingStates.userId, userId), eq(koboReadingStates.bookId, bookId)))
      .limit(1);
    return row ?? null;
  }

  async findKoboSnapshotState(userId: number, bookId: number) {
    const [row] = await this.db
      .select({
        snapshotId: koboLibrarySnapshots.id,
        snapshotUpdatedAt: koboLibrarySnapshots.updatedAt,
        synced: koboSnapshotBooks.synced,
        pendingDelete: koboSnapshotBooks.pendingDelete,
        isNew: koboSnapshotBooks.isNew,
        removedByDevice: koboSnapshotBooks.removedByDevice,
        fileHash: koboSnapshotBooks.fileHash,
        metadataHash: koboSnapshotBooks.metadataHash,
      })
      .from(koboLibrarySnapshots)
      .leftJoin(koboSnapshotBooks, and(eq(koboSnapshotBooks.snapshotId, koboLibrarySnapshots.id), eq(koboSnapshotBooks.bookId, bookId)))
      .where(eq(koboLibrarySnapshots.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async findKoboSyncCollectionNamesForBook(userId: number, bookId: number): Promise<string[]> {
    const rows = await this.db
      .select({ name: collections.name })
      .from(collectionBooks)
      .innerJoin(collections, and(eq(collections.id, collectionBooks.collectionId), eq(collections.userId, userId), eq(collections.syncToKobo, true)))
      .where(eq(collectionBooks.bookId, bookId));
    return rows.map((r) => r.name);
  }

  async searchAcrossLibraries(libraryIds: number[], q: string, limit: number) {
    if (libraryIds.length === 0) return [];

    const pattern = '%' + q + '%';

    const matchedAuthors = this.db
      .selectDistinct({ bookId: bookAuthors.bookId })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(sql`${authors.name} ILIKE ${pattern}`)
      .as('matched_authors');

    const rows = await this.db
      .select({
        id: books.id,
        title: bookMetadata.title,
        seriesName: bookMetadata.seriesName,
        libraryId: books.libraryId,
        libraryName: libraries.name,
      })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .leftJoin(matchedAuthors, eq(matchedAuthors.bookId, books.id))
      .where(
        and(
          inArray(books.libraryId, libraryIds),
          ne(books.status, 'processing'),
          or(sql`${bookMetadata.title} ILIKE ${pattern}`, sql`${bookMetadata.seriesName} ILIKE ${pattern}`, isNotNull(matchedAuthors.bookId)),
        ),
      )
      .orderBy(bookMetadata.title)
      .limit(limit);

    const bookIds = rows.map((r) => r.id);

    const authorRows =
      bookIds.length > 0
        ? await this.db
            .select({ bookId: bookAuthors.bookId, name: authors.name })
            .from(bookAuthors)
            .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
            .where(inArray(bookAuthors.bookId, bookIds))
            .orderBy(bookAuthors.displayOrder)
        : [];

    const authorsByBook = new Map<number, string[]>();
    for (const row of authorRows) {
      const list = authorsByBook.get(row.bookId) ?? [];
      list.push(row.name);
      authorsByBook.set(row.bookId, list);
    }

    const formatRows =
      bookIds.length > 0
        ? await this.db
            .select({ bookId: bookFiles.bookId, format: bookFiles.format })
            .from(bookFiles)
            .where(and(inArray(bookFiles.bookId, bookIds), inArray(bookFiles.format, [...SUPPORTED_BOOK_FORMATS])))
        : [];

    const formatsByBook = new Map<number, string[]>();
    for (const row of formatRows) {
      if (row.format) {
        const list = formatsByBook.get(row.bookId) ?? [];
        if (!list.includes(row.format)) list.push(row.format);
        formatsByBook.set(row.bookId, list);
      }
    }

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      seriesName: r.seriesName,
      authors: authorsByBook.get(r.id) ?? [],
      libraryId: r.libraryId,
      libraryName: r.libraryName,
      formats: formatsByBook.get(r.id) ?? [],
    }));
  }

  async countWhere(where: SQL | undefined): Promise<number> {
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(books)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(this.visibleWhere(where));
    return Number(total);
  }

  async findLibraryIdsByBookIds(bookIds: number[]): Promise<{ id: number; libraryId: number }[]> {
    if (bookIds.length === 0) return [];
    return this.db.select({ id: books.id, libraryId: books.libraryId }).from(books).where(inArray(books.id, bookIds));
  }

  async findRecommendationTitlesByBookIds(bookIds: number[]): Promise<{ id: number; title: string | null; hasCover: boolean; authors: string[] }[]> {
    if (bookIds.length === 0) return [];

    const [rows, authorRows] = await Promise.all([
      this.db
        .select({ id: books.id, title: bookMetadata.title, coverSource: bookMetadata.coverSource })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(inArray(books.id, bookIds)),
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, bookIds)),
    ]);

    const authorsByBook = new Map<number, string[]>();
    for (const row of authorRows) {
      const names = authorsByBook.get(row.bookId) ?? [];
      names.push(row.name);
      authorsByBook.set(row.bookId, names);
    }

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      hasCover: r.coverSource !== null,
      authors: authorsByBook.get(r.id) ?? [],
    }));
  }

  async findPatternMetadataByBookIds(bookIds: number[]): Promise<PatternMetadataRow[]> {
    if (bookIds.length === 0) return [];

    const [metaRows, authorRows] = await Promise.all([
      this.db
        .select({
          bookId: books.id,
          title: bookMetadata.title,
          subtitle: bookMetadata.subtitle,
          publisher: bookMetadata.publisher,
          publishedYear: bookMetadata.publishedYear,
          language: bookMetadata.language,
          seriesName: bookMetadata.seriesName,
          seriesIndex: bookMetadata.seriesIndex,
          isbn13: bookMetadata.isbn13,
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
    ]);

    const authorsByBookId = new Map<number, string[]>();
    for (const row of authorRows) {
      const list = authorsByBookId.get(row.bookId) ?? [];
      list.push(row.name);
      authorsByBookId.set(row.bookId, list);
    }

    return metaRows.map((row) => ({ ...row, authors: authorsByBookId.get(row.bookId) ?? [] }));
  }

  async findAllIds(): Promise<number[]> {
    const rows = await this.db.select({ id: books.id }).from(books);
    return rows.map((r) => r.id);
  }

  async findIdsByWhere(where: SQL | undefined): Promise<number[]> {
    const rows = await this.db.select({ id: books.id }).from(books).where(this.visibleWhere(where));
    return rows.map((r) => r.id);
  }

  async findPrimaryFile(bookId: number): Promise<{ absolutePath: string; format: string | null } | null> {
    const [row] = await this.db
      .select({ absolutePath: bookFiles.absolutePath, format: bookFiles.format })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(eq(books.id, bookId))
      .limit(1);
    return row ?? null;
  }

  async findPrimaryFilesByBookIds(
    bookIds: number[],
  ): Promise<{ bookId: number; absolutePath: string; format: string | null; sizeBytes: number | null }[]> {
    if (bookIds.length === 0) return [];
    return this.db
      .select({ bookId: books.id, absolutePath: bookFiles.absolutePath, format: bookFiles.format, sizeBytes: bookFiles.sizeBytes })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .where(inArray(books.id, bookIds))
      .orderBy(asc(books.id));
  }

  async findAllFilesByBookIds(
    bookIds: number[],
  ): Promise<{ bookId: number; absolutePath: string; format: string | null; sizeBytes: number | null; sortOrder: number }[]> {
    if (bookIds.length === 0) return [];
    return this.db
      .select({
        bookId: bookFiles.bookId,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        sizeBytes: bookFiles.sizeBytes,
        sortOrder: bookFiles.sortOrder,
      })
      .from(bookFiles)
      .where(inArray(bookFiles.bookId, bookIds))
      .orderBy(asc(bookFiles.bookId), asc(bookFiles.sortOrder), asc(bookFiles.id));
  }

  async deleteByIds(bookIds: number[]): Promise<void> {
    await this.db.delete(books).where(inArray(books.id, bookIds));
  }

  async bulkSetRating(bookIds: number[], rating: number | null, userId: number): Promise<void> {
    if (bookIds.length === 0) return;
    if (rating === null) {
      await this.db.delete(userBookRatings).where(and(eq(userBookRatings.userId, userId), inArray(userBookRatings.bookId, bookIds)));
      return;
    }

    await this.db
      .insert(userBookRatings)
      .values(bookIds.map((bookId) => ({ userId, bookId, rating })))
      .onConflictDoUpdate({
        target: [userBookRatings.userId, userBookRatings.bookId],
        set: { rating, updatedAt: new Date() },
      });
  }

  async findTagsByBookIds(bookIds: number[], executor: MetadataReadExecutor = this.db): Promise<Map<number, string[]>> {
    if (bookIds.length === 0) return new Map();
    const rows = await executor
      .select({ bookId: bookTags.bookId, name: tags.name })
      .from(bookTags)
      .innerJoin(tags, eq(bookTags.tagId, tags.id))
      .where(inArray(bookTags.bookId, bookIds));
    const result = new Map<number, string[]>();
    for (const row of rows) {
      const existing = result.get(row.bookId) ?? [];
      existing.push(row.name);
      result.set(row.bookId, existing);
    }
    return result;
  }

  async updateMetadataFields(
    bookId: number,
    fields: Partial<typeof bookMetadata.$inferInsert>,
    executor: MetadataUpdateExecutor = this.db,
  ): Promise<void> {
    await executor.update(bookMetadata).set(fields).where(eq(bookMetadata.bookId, bookId));
  }

  async bulkUpdateMetadataFields(
    bookIds: number[],
    fields: Partial<typeof bookMetadata.$inferInsert>,
    executor: MetadataUpdateExecutor = this.db,
  ): Promise<void> {
    if (bookIds.length === 0) return;
    await executor.update(bookMetadata).set(fields).where(inArray(bookMetadata.bookId, bookIds));
  }

  async upsertProgress(
    userId: number,
    fileId: number,
    cfi: string | null,
    pageNumber: number | null,
    percentage: number,
    positionSeconds?: number | null,
  ) {
    const now = new Date();
    await this.db
      .insert(readingProgress)
      .values({ userId, bookFileId: fileId, cfi, pageNumber, percentage, positionSeconds: positionSeconds ?? null, updatedAt: now })
      .onConflictDoUpdate({
        target: [readingProgress.bookFileId, readingProgress.userId],
        set: { cfi, pageNumber, percentage, positionSeconds: positionSeconds ?? null, updatedAt: now },
      });
  }

  async clearFileProgress(userId: number, fileId: number): Promise<void> {
    await this.db.delete(readingProgress).where(and(eq(readingProgress.userId, userId), eq(readingProgress.bookFileId, fileId)));
    await this.db.delete(audiobookProgress).where(and(eq(audiobookProgress.userId, userId), eq(audiobookProgress.currentFileId, fileId)));
  }

  async findAudioProgress(userId: number, bookId: number) {
    const [row] = await this.db
      .select()
      .from(audiobookProgress)
      .where(and(eq(audiobookProgress.userId, userId), eq(audiobookProgress.bookId, bookId)))
      .limit(1);
    return row ?? null;
  }

  async upsertAudioProgress(userId: number, bookId: number, currentFileId: number, positionSeconds: number, percentage: number) {
    const now = new Date();
    const [row] = await this.db
      .insert(audiobookProgress)
      .values({ userId, bookId, currentFileId, positionSeconds, percentage, updatedAt: now })
      .onConflictDoUpdate({
        target: [audiobookProgress.userId, audiobookProgress.bookId],
        set: { currentFileId, positionSeconds, percentage, updatedAt: now },
      })
      .returning();
    return row;
  }
}
