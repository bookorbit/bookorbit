import { Inject, Injectable, Optional } from '@nestjs/common';
import { SQL, and, asc, count, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { SUPPORTED_BOOK_FORMATS } from '../upload/upload-validator.service';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ContentFilterRules, JumpBucketsResponse, SortSpec } from '@bookorbit/types';
import { isAudioFormat } from '@bookorbit/types';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { SeriesIdentityService } from '../../common/services/series-identity.service';
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
  koboSyncSettings,
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
type MetadataUpdateExecutor = Pick<Db, 'update' | 'insert'>;
type MetadataReadExecutor = Pick<Db, 'select'>;
type JsonObj = Record<string, unknown>;

type CollapsedRawRow = {
  id: number;
  status: string;
  primary_file_id: number | null;
  folder_path: string;
  added_at: string;
  updated_at: string;
  title: string | null;
  series_id: number | null;
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
  first_volume_book_id: number | null;
  latest_volume_book_id: number | null;
  first_unread_book_id: number | null;
  total_count: string;
};
type PatternMetadataRow = {
  bookId: number;
  title: string | null;
  subtitle: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  seriesId: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  isbn13: string | null;
  authors: string[];
};

const PROGRESS_EPSILON = 0.0001;

// Shared between the collapsed listing query and the collapsed jump-buckets
// query: both must pick the exact same series representative or bucket indexes
// drift from listing offsets. Guarded by the jump-buckets invariant e2e test.
const COLLAPSE_GROUP_KEY_SQL = `base.library_id, COALESCE(base.series_id::text, 'book_' || base.id::text)`;
const COLLAPSE_REPRESENTATIVE_PICK_SQL = `${COLLAPSE_GROUP_KEY_SQL},
          base.series_index ASC NULLS LAST,
          base.added_at ASC,
          base.id ASC`;

type JumpBucketRawRow = {
  bucket: string;
  item_index: number | string;
  total: number | string;
};

@Injectable()
export class BookRepository {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() private readonly seriesIdentity?: SeriesIdentityService,
  ) {}

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
        seriesId: bookMetadata.seriesId,
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
      seriesId: number | null;
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
      firstVolumeBookId: number | null;
      latestVolumeBookId: number | null;
      firstUnreadBookId: number | null;
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
      WITH base_rows AS (
        SELECT
          books.id,
          books.library_id,
          books.status,
          books.primary_file_id,
          books.primary_author_sort_name,
          books.folder_path,
          books.added_at,
          books.updated_at,
          book_metadata.title,
          book_metadata.series_id,
          book_metadata.series_name,
          book_metadata.series_index,
          book_metadata.published_year,
          book_metadata.language,
          book_metadata.cover_source,
          book_metadata.locked_fields,
          book_metadata.publisher,
          book_metadata.page_count,
          book_metadata.subtitle,
          book_metadata.isbn13,
          book_metadata.metadata_score,
          NULLIF(lower(btrim(book_metadata.series_name)), '') AS norm_series
        FROM books
        LEFT JOIN book_metadata ON book_metadata.book_id = books.id
        WHERE ${whereFragment}
      ),
      series_agg AS (
        SELECT
          base.series_id,
          base.library_id,
          COUNT(*) AS book_count,
          SUM(CASE WHEN user_book_status.status = 'read' THEN 1 ELSE 0 END) AS read_count,
          MAX(base.added_at) AS latest_added_at
        FROM base_rows base
        LEFT JOIN user_book_status ON user_book_status.book_id = base.id AND user_book_status.user_id = ${userId}
        WHERE base.series_id IS NOT NULL
        GROUP BY base.series_id, base.library_id
      ),
      series_cover_candidates AS (
        SELECT
          base.series_id,
          base.library_id,
          base.id,
          base.series_index,
          base.added_at,
          ROW_NUMBER() OVER (
            PARTITION BY base.series_id, base.library_id
            ORDER BY base.series_index ASC NULLS LAST, base.added_at ASC, base.id ASC
          ) AS rn
        FROM base_rows base
        WHERE base.series_id IS NOT NULL
      ),
      series_covers AS (
        SELECT
          scc.series_id,
          scc.library_id,
          COALESCE(
            ARRAY_AGG(scc.id ORDER BY scc.series_index ASC NULLS LAST, scc.added_at ASC, scc.id ASC) FILTER (WHERE scc.rn <= 4),
            ARRAY[]::int[]
          ) AS cover_book_ids
        FROM series_cover_candidates scc
        GROUP BY scc.series_id, scc.library_id
      ),
      series_first_volume AS (
        SELECT scc.series_id, scc.library_id, scc.id AS first_volume_book_id
        FROM series_cover_candidates scc
        WHERE scc.rn = 1
      ),
      series_latest_volume AS (
        SELECT slv.series_id, slv.library_id, slv.id AS latest_volume_book_id
        FROM (
          SELECT
            base.series_id,
            base.library_id,
            base.id,
            ROW_NUMBER() OVER (
              PARTITION BY base.series_id, base.library_id
              ORDER BY base.series_index DESC NULLS LAST, base.added_at DESC, base.id DESC
            ) AS rn
          FROM base_rows base
          WHERE base.series_id IS NOT NULL
        ) slv
        WHERE slv.rn = 1
      ),
      series_first_unread AS (
        SELECT sfu.series_id, sfu.library_id, sfu.id AS first_unread_book_id
        FROM (
          SELECT
            base.series_id,
            base.library_id,
            base.id,
            ROW_NUMBER() OVER (
              PARTITION BY base.series_id, base.library_id
              ORDER BY base.series_index ASC NULLS LAST, base.added_at ASC, base.id ASC
            ) AS rn
          FROM base_rows base
          LEFT JOIN user_book_status ubs ON ubs.book_id = base.id AND ubs.user_id = ${userId}
          WHERE base.series_id IS NOT NULL
            AND ubs.status IS DISTINCT FROM 'read'
        ) sfu
        WHERE sfu.rn = 1
      ),
      representatives AS (
        SELECT DISTINCT ON (${sql.raw(COLLAPSE_GROUP_KEY_SQL)})
          base.id,
          base.status,
          base.primary_file_id,
          base.folder_path,
          base.added_at,
          base.updated_at,
          base.title,
          base.series_id,
          base.series_name,
          base.series_index,
          base.published_year,
          base.language,
          ubr.rating,
          base.cover_source,
          base.locked_fields,
          base.publisher,
          base.page_count,
          base.subtitle,
          base.isbn13,
          base.metadata_score,
          base.primary_author_sort_name AS author_sort_name,
          COALESCE(base.norm_series, lower(base.title)) AS sort_title,
          COALESCE(sa.latest_added_at, base.added_at) AS sort_added_at,
          sa.book_count,
          sa.read_count,
          sc.cover_book_ids,
          sfv.first_volume_book_id,
          slv2.latest_volume_book_id,
          sfu2.first_unread_book_id
        FROM base_rows base
        LEFT JOIN user_book_ratings ubr ON ubr.book_id = base.id AND ubr.user_id = ${userId}
        LEFT JOIN series_agg sa
          ON sa.series_id = base.series_id
          AND sa.library_id = base.library_id
        LEFT JOIN series_covers sc
          ON sc.series_id = sa.series_id
          AND sc.library_id = sa.library_id
        LEFT JOIN series_first_volume sfv
          ON sfv.series_id = base.series_id
          AND sfv.library_id = base.library_id
        LEFT JOIN series_latest_volume slv2
          ON slv2.series_id = base.series_id
          AND slv2.library_id = base.library_id
        LEFT JOIN series_first_unread sfu2
          ON sfu2.series_id = base.series_id
          AND sfu2.library_id = base.library_id
        ORDER BY ${sql.raw(COLLAPSE_REPRESENTATIVE_PICK_SQL)}
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
      seriesId: r.series_id,
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
      firstVolumeBookId: r.first_volume_book_id ?? null,
      latestVolumeBookId: r.latest_volume_book_id ?? null,
      firstUnreadBookId: r.first_unread_book_id ?? null,
    }));

    const bookRefs = mappedRows.map((row) => ({ id: row.id, primaryFileId: row.primaryFileId ?? null }));
    const enrichment = await this.enrichBookIds(bookRefs, userId);

    return { rows: mappedRows, ...enrichment, total };
  }

  async findJumpBuckets(opts: { where: SQL | undefined; bucketExpr: SQL; orderBy: SQL[] }): Promise<JumpBucketsResponse> {
    const visibleWhere = this.visibleWhere(opts.where);
    const result = await this.db.execute<JumpBucketRawRow>(sql`
      WITH ordered AS (
        SELECT
          ${opts.bucketExpr} AS bucket,
          (ROW_NUMBER() OVER (ORDER BY ${sql.join(opts.orderBy, sql`, `)}) - 1) AS item_index
        FROM ${books}
        LEFT JOIN ${bookMetadata} ON ${bookMetadata.bookId} = ${books.id}
        WHERE ${visibleWhere}
      )
      SELECT bucket, min(item_index)::int AS item_index, (SELECT count(*) FROM ordered)::int AS total
      FROM ordered
      WHERE bucket IS NOT NULL
      GROUP BY bucket
      ORDER BY min(item_index)
    `);

    return this.mapJumpBucketRows(result.rows);
  }

  // The representatives CTE mirrors findCardsCollapsed's representative
  // selection (same group key, same pick order) but only projects the columns
  // buildCollapseOrderBy can reference as aliases or via r.* correlated
  // subqueries.
  async findJumpBucketsCollapsed(opts: { where: SQL | undefined; bucketExpr: SQL; sort: SortSpec[]; userId: number }): Promise<JumpBucketsResponse> {
    const whereFragment = this.visibleWhere(opts.where);
    const orderBy = BookQueryBuilder.buildCollapseOrderBy(opts.sort, opts.userId);
    const result = await this.db.execute<JumpBucketRawRow>(sql`
      WITH base_rows AS (
        SELECT
          books.id,
          books.library_id,
          books.primary_file_id,
          books.primary_author_sort_name,
          books.added_at,
          books.updated_at,
          book_metadata.title,
          book_metadata.series_id,
          book_metadata.series_name,
          book_metadata.series_index,
          book_metadata.published_year,
          book_metadata.publisher,
          book_metadata.page_count,
          NULLIF(lower(btrim(book_metadata.series_name)), '') AS norm_series
        FROM books
        LEFT JOIN book_metadata ON book_metadata.book_id = books.id
        WHERE ${whereFragment}
      ),
      series_latest AS (
        SELECT
          base.series_id,
          base.library_id,
          MAX(base.added_at) AS latest_added_at
        FROM base_rows base
        WHERE base.series_id IS NOT NULL
        GROUP BY base.series_id, base.library_id
      ),
      representatives AS (
        SELECT DISTINCT ON (${sql.raw(COLLAPSE_GROUP_KEY_SQL)})
          base.id,
          base.primary_file_id,
          base.updated_at,
          base.series_index,
          base.published_year,
          base.publisher,
          base.page_count,
          ubr.rating,
          base.primary_author_sort_name AS author_sort_name,
          COALESCE(base.norm_series, lower(base.title)) AS sort_title,
          COALESCE(sl.latest_added_at, base.added_at) AS sort_added_at
        FROM base_rows base
        LEFT JOIN user_book_ratings ubr ON ubr.book_id = base.id AND ubr.user_id = ${opts.userId}
        LEFT JOIN series_latest sl
          ON sl.series_id = base.series_id
          AND sl.library_id = base.library_id
        ORDER BY ${sql.raw(COLLAPSE_REPRESENTATIVE_PICK_SQL)}
      ),
      ordered AS (
        SELECT
          ${opts.bucketExpr} AS bucket,
          (ROW_NUMBER() OVER (ORDER BY ${sql.raw(orderBy)}) - 1) AS item_index
        FROM representatives r
      )
      SELECT bucket, min(item_index)::int AS item_index, (SELECT count(*) FROM ordered)::int AS total
      FROM ordered
      WHERE bucket IS NOT NULL
      GROUP BY bucket
      ORDER BY min(item_index)
    `);

    return this.mapJumpBucketRows(result.rows);
  }

  private mapJumpBucketRows(rows: JumpBucketRawRow[]): JumpBucketsResponse {
    return {
      buckets: rows.map((row) => ({
        key: row.bucket,
        label: row.bucket,
        index: Number(row.item_index),
      })),
      total: rows.length > 0 ? Number(rows[0].total) : 0,
    };
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

  async checkBookPassesContentFilters(bookId: number, contentFilters: ContentFilterRules): Promise<boolean> {
    const filterClauses = buildContentFilterClauses(contentFilters, this.db);
    if (filterClauses.length === 0) return true;

    const [row] = await this.db
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.id, bookId), ...filterClauses))
      .limit(1);
    return !!row;
  }

  async findFileById(fileId: number) {
    const [file] = await this.db
      .select({
        id: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        role: bookFiles.role,
        bookId: bookFiles.bookId,
        libraryId: books.libraryId,
        fileHash: bookFiles.fileHash,
        sizeBytes: bookFiles.sizeBytes,
        durationSeconds: bookFiles.durationSeconds,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(bookFiles.id, fileId))
      .limit(1);
    return file ?? null;
  }

  async deleteBookFile(fileId: number): Promise<void> {
    await this.db.delete(bookFiles).where(eq(bookFiles.id, fileId));
  }

  async updateBookFile(fileId: number, data: { format?: string | null; role?: string; absolutePath?: string; sizeBytes?: number }): Promise<void> {
    await this.db
      .update(bookFiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(bookFiles.id, fileId));
  }

  async updateBookPrimaryFile(bookId: number, primaryFileId: number | null): Promise<void> {
    await this.db.update(books).set({ primaryFileId, updatedAt: new Date() }).where(eq(books.id, bookId));
  }

  async findFilesForBook(bookId: number) {
    return this.db
      .select({
        id: bookFiles.id,
        role: bookFiles.role,
      })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId));
  }

  async findBookBase(bookId: number) {
    const [row] = await this.db.select().from(books).where(eq(books.id, bookId)).limit(1);
    return row ?? null;
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
        koboLocationSource: readingProgress.koboLocationSource,
        koboLocationType: readingProgress.koboLocationType,
        koboLocationValue: readingProgress.koboLocationValue,
        koboContentSourceProgressPercent: readingProgress.koboContentSourceProgressPercent,
        koreaderProgress: readingProgress.koreaderProgress,
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

  async searchAcrossLibraries(libraryIds: number[], q: string, limit: number, contentFilters?: ContentFilterRules) {
    if (libraryIds.length === 0) return [];

    const pattern = '%' + q + '%';

    const matchedAuthors = this.db
      .selectDistinct({ bookId: bookAuthors.bookId })
      .from(bookAuthors)
      .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(sql`${authors.name} ILIKE ${pattern}`)
      .as('matched_authors');

    const contentFilterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    const rows = await this.db
      .select({
        id: books.id,
        title: bookMetadata.title,
        seriesId: bookMetadata.seriesId,
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
          ...contentFilterClauses,
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

  async findRecommendationTitlesByBookIds(
    bookIds: number[],
  ): Promise<{ id: number; title: string | null; hasCover: boolean; authors: string[]; isAudiobook: boolean }[]> {
    if (bookIds.length === 0) return [];

    const [rows, authorRows] = await Promise.all([
      this.db
        .select({ id: books.id, title: bookMetadata.title, coverSource: bookMetadata.coverSource, primaryFormat: bookFiles.format })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
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
      isAudiobook: r.primaryFormat != null ? isAudioFormat(r.primaryFormat) : false,
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
          seriesId: bookMetadata.seriesId,
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

  async findAuthorsByBookIds(bookIds: number[], executor: MetadataReadExecutor = this.db): Promise<Map<number, string[]>> {
    if (bookIds.length === 0) return new Map();
    const rows = await executor
      .select({ bookId: bookAuthors.bookId, name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(inArray(bookAuthors.bookId, bookIds))
      .orderBy(asc(bookAuthors.bookId), asc(bookAuthors.displayOrder));
    const result = new Map<number, string[]>();
    for (const row of rows) {
      const existing = result.get(row.bookId) ?? [];
      existing.push(row.name);
      result.set(row.bookId, existing);
    }
    return result;
  }

  async findGenresByBookIds(bookIds: number[], executor: MetadataReadExecutor = this.db): Promise<Map<number, string[]>> {
    if (bookIds.length === 0) return new Map();
    const rows = await executor
      .select({ bookId: bookGenres.bookId, name: genres.name })
      .from(bookGenres)
      .innerJoin(genres, eq(bookGenres.genreId, genres.id))
      .where(inArray(bookGenres.bookId, bookIds));
    const result = new Map<number, string[]>();
    for (const row of rows) {
      const existing = result.get(row.bookId) ?? [];
      existing.push(row.name);
      result.set(row.bookId, existing);
    }
    return result;
  }

  async findNarratorsByBookIds(bookIds: number[], executor: MetadataReadExecutor = this.db): Promise<Map<number, string[]>> {
    if (bookIds.length === 0) return new Map();
    const rows = await executor
      .select({ bookId: bookNarrators.bookId, name: narrators.name })
      .from(bookNarrators)
      .innerJoin(narrators, eq(bookNarrators.narratorId, narrators.id))
      .where(inArray(bookNarrators.bookId, bookIds))
      .orderBy(asc(bookNarrators.bookId), asc(bookNarrators.displayOrder));
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
    const patch = (await this.seriesIdentity?.resolveMetadataPatch(fields, executor)) ?? fields;
    await executor.update(bookMetadata).set(patch).where(eq(bookMetadata.bookId, bookId));
    await executor.update(books).set({ updatedAt: new Date() }).where(eq(books.id, bookId));
  }

  async bulkUpdateMetadataFields(
    bookIds: number[],
    fields: Partial<typeof bookMetadata.$inferInsert>,
    executor: MetadataUpdateExecutor = this.db,
  ): Promise<void> {
    if (bookIds.length === 0) return;
    const patch = (await this.seriesIdentity?.resolveMetadataPatch(fields, executor)) ?? fields;
    await executor.update(bookMetadata).set(patch).where(inArray(bookMetadata.bookId, bookIds));
    await executor.update(books).set({ updatedAt: new Date() }).where(inArray(books.id, bookIds));
  }

  async upsertProgress(
    userId: number,
    fileId: number,
    cfi: string | null,
    pageNumber: number | null,
    percentage: number,
    positionSeconds?: number | null,
    koboLocationSource?: string | null,
    koboLocationType?: string | null,
    koboLocationValue?: string | null,
    koboContentSourceProgressPercent?: number | null,
    koreaderProgress?: string | null,
  ) {
    const now = new Date();
    const normalizedKoboLocationSource = this.normalizeKoboLocationPart(koboLocationSource);
    const normalizedKoboLocationType = this.normalizeKoboLocationPart(koboLocationType);
    const normalizedKoboLocationValue = this.normalizeKoboLocationPart(koboLocationValue);
    const normalizedKoboContentSourceProgressPercent = this.clampNullableProgressPercentage(koboContentSourceProgressPercent);
    const normalizedKoreaderProgress = this.normalizeKoreaderProgress(koreaderProgress);
    await this.db
      .insert(readingProgress)
      .values({
        userId,
        bookFileId: fileId,
        cfi,
        pageNumber,
        percentage,
        positionSeconds: positionSeconds ?? null,
        koboLocationSource: normalizedKoboLocationSource,
        koboLocationType: normalizedKoboLocationType,
        koboLocationValue: normalizedKoboLocationValue,
        koboContentSourceProgressPercent: normalizedKoboContentSourceProgressPercent,
        koreaderProgress: normalizedKoreaderProgress,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [readingProgress.bookFileId, readingProgress.userId],
        set: {
          cfi,
          pageNumber,
          percentage,
          positionSeconds: positionSeconds ?? null,
          koboLocationSource: normalizedKoboLocationSource,
          koboLocationType: normalizedKoboLocationType,
          koboLocationValue: normalizedKoboLocationValue,
          koboContentSourceProgressPercent: normalizedKoboContentSourceProgressPercent,
          koreaderProgress: normalizedKoreaderProgress,
          updatedAt: now,
        },
      });
  }

  async syncKoboReadingStateFromProgress(
    userId: number,
    fileId: number,
    percentage: number,
    koboLocationSource?: string | null,
    koboLocationType?: string | null,
    koboLocationValue?: string | null,
    koboContentSourceProgressPercent?: number | null,
  ): Promise<boolean> {
    const [file] = await this.db
      .select({
        bookId: bookFiles.bookId,
        primaryFileId: books.primaryFileId,
        format: bookFiles.format,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(bookFiles.id, fileId))
      .limit(1);

    if (!file || file.primaryFileId !== fileId || file.format !== 'epub') return false;

    const clampedPercentage = this.clampProgressPercentage(percentage);
    const normalizedKoboLocationSource = this.normalizeKoboLocationPart(koboLocationSource);
    const normalizedKoboLocationType = this.normalizeKoboLocationPart(koboLocationType);
    const normalizedKoboLocationValue = this.normalizeKoboLocationPart(koboLocationValue);
    const normalizedKoboContentSourceProgressPercent = this.clampNullableProgressPercentage(koboContentSourceProgressPercent);
    if (!normalizedKoboLocationSource || normalizedKoboLocationType !== 'KoboSpan' || !normalizedKoboLocationValue) return false;

    const now = new Date();
    const nowIso = now.toISOString();

    const [existing] = await this.db
      .select({
        entitlementId: koboReadingStates.entitlementId,
        createdAtKobo: koboReadingStates.createdAtKobo,
        currentBookmark: koboReadingStates.currentBookmark,
        statistics: koboReadingStates.statistics,
        statusInfo: koboReadingStates.statusInfo,
      })
      .from(koboReadingStates)
      .where(and(eq(koboReadingStates.userId, userId), eq(koboReadingStates.bookId, file.bookId)))
      .limit(1);

    const existingBookmark = this.asJsonObj(existing?.currentBookmark);
    if (
      this.isKoboBookmarkCurrent(
        existingBookmark,
        clampedPercentage,
        normalizedKoboLocationSource,
        normalizedKoboLocationType,
        normalizedKoboLocationValue,
        normalizedKoboContentSourceProgressPercent,
      )
    ) {
      return true;
    }

    const currentBookmark: JsonObj = {
      ...(existingBookmark ?? {}),
      LastModified: nowIso,
      ProgressPercent: clampedPercentage,
      Location: {
        Source: normalizedKoboLocationSource,
        Type: normalizedKoboLocationType,
        Value: normalizedKoboLocationValue,
      },
    };
    if (normalizedKoboContentSourceProgressPercent !== null) {
      currentBookmark.ContentSourceProgressPercent = normalizedKoboContentSourceProgressPercent;
    } else {
      delete currentBookmark.ContentSourceProgressPercent;
    }
    const statusInfo = {
      ...(this.asJsonObj(existing?.statusInfo) ?? {}),
      LastModified: nowIso,
      Status: this.deriveKoboStatus(clampedPercentage),
    };
    const statistics = this.asJsonObj(existing?.statistics) ?? { LastModified: nowIso };

    await this.db
      .insert(koboReadingStates)
      .values({
        userId,
        bookId: file.bookId,
        entitlementId: existing?.entitlementId ?? String(file.bookId),
        createdAtKobo: existing?.createdAtKobo ?? nowIso,
        lastModifiedKobo: nowIso,
        priorityTimestamp: nowIso,
        currentBookmark,
        statistics,
        statusInfo,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [koboReadingStates.userId, koboReadingStates.bookId],
        set: {
          lastModifiedKobo: nowIso,
          priorityTimestamp: nowIso,
          currentBookmark,
          statistics,
          statusInfo,
          updatedAt: now,
        },
      });

    await this.markKoboSnapshotBookUnsyncedForReadingState(userId, file.bookId);
    return true;
  }

  async isKoboTwoWayProgressSyncEnabled(userId: number): Promise<boolean> {
    const [settings] = await this.db
      .select({ twoWayProgressSync: koboSyncSettings.twoWayProgressSync })
      .from(koboSyncSettings)
      .where(eq(koboSyncSettings.userId, userId))
      .limit(1);
    return settings?.twoWayProgressSync === true;
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

  private clampProgressPercentage(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
  }

  private clampNullableProgressPercentage(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? this.clampProgressPercentage(value) : null;
  }

  private normalizeKoboLocationPart(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeKoreaderProgress(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.startsWith('/body/DocFragment[') ? trimmed : null;
  }

  private asJsonObj(value: unknown): JsonObj | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as JsonObj;
  }

  private extractKoboPercent(bookmark: JsonObj | null): number | null {
    const candidate = bookmark?.ProgressPercent;
    return typeof candidate === 'number' ? this.clampProgressPercentage(candidate) : null;
  }

  private extractKoboContentSourceProgressPercent(bookmark: JsonObj | null): number | null {
    const candidate = bookmark?.ContentSourceProgressPercent;
    return typeof candidate === 'number' ? this.clampProgressPercentage(candidate) : null;
  }

  private isKoboBookmarkCurrent(
    bookmark: JsonObj | null,
    percentage: number,
    koboLocationSource: string | null,
    koboLocationType: string | null,
    koboLocationValue: string | null,
    koboContentSourceProgressPercent: number | null,
  ): boolean {
    const existingPercent = this.extractKoboPercent(bookmark);
    if (existingPercent === null || Math.abs(existingPercent - percentage) >= PROGRESS_EPSILON) return false;

    if (!koboLocationSource || !koboLocationType || !koboLocationValue) return !this.hasNonInternalBookmarkFields(bookmark);

    const location = this.asJsonObj(bookmark?.Location);
    if (location?.Source !== koboLocationSource || location.Type !== koboLocationType || location.Value !== koboLocationValue) return false;

    if (koboContentSourceProgressPercent === null) {
      return this.extractKoboContentSourceProgressPercent(bookmark) === null;
    }
    const existingSourcePercent = this.extractKoboContentSourceProgressPercent(bookmark);
    return existingSourcePercent !== null && Math.abs(existingSourcePercent - koboContentSourceProgressPercent) < PROGRESS_EPSILON;
  }

  private hasNonInternalBookmarkFields(bookmark: JsonObj | null): boolean {
    if (!bookmark) return false;
    return Object.keys(bookmark).some((key) => key !== 'LastModified' && key !== 'ProgressPercent');
  }

  private deriveKoboStatus(percentage: number): string {
    if (percentage >= 100) return 'Finished';
    return percentage > 0 ? 'Reading' : 'ReadyToRead';
  }

  private async markKoboSnapshotBookUnsyncedForReadingState(userId: number, bookId: number): Promise<void> {
    await this.db.execute(sql`
      UPDATE ${koboSnapshotBooks} AS sb
      SET synced = false,
          is_new = false
      FROM ${koboLibrarySnapshots} AS snap
      WHERE snap.id = sb.snapshot_id
        AND snap.user_id = ${userId}
        AND sb.book_id = ${bookId}
        AND sb.pending_delete = false
        AND sb.removed_by_device = false
    `);
  }
}
