import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { BookDuplicateGroupSort, BookDuplicateKind, BookDuplicateMatchReason, BookDuplicateSortOrder } from '@bookorbit/types';

import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import type { RequestUser } from '../../common/types/request-user';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { afterPosition, keysetOrder, microseconds, type JobKey, type JobPosition, type KeysetColumns } from '../jobs/job-keyset';
import type { EditionFactsRow } from './book-duplicate-editions';
import { groupDuplicatePairs } from './book-duplicate-grouping';
import { crossFormatTitleSql, mediaFamilySql } from './book-duplicate-normalize';
import {
  bookDuplicateDismissals,
  bookDuplicateGroupMembers,
  bookDuplicateGroups,
  bookDuplicatePairs,
  bookDuplicateScanKeys,
  bookDuplicateScans,
  bookFiles,
  bookLinks,
  bookMetadata,
  books,
  bookSeriesMemberships,
  libraries,
  users,
} from '../../db/schema';

export type Db = NodePgDatabase<typeof schema>;

export interface DismissalRow {
  kind: string;
  bookIdA: number;
  bookIdB: number;
  titleA: string | null;
  titleB: string | null;
  editionNameA: string | null;
  editionNameB: string | null;
  publisherA: string | null;
  publisherB: string | null;
  publishedYearA: number | null;
  publishedYearB: number | null;
  libraryIdA: number | null;
  libraryIdB: number | null;
  libraryNameA: string | null;
  libraryNameB: string | null;
  createdAt: Date;
}
type ScanRow = typeof bookDuplicateScans.$inferSelect;

const BOOK_DUPLICATE_SCAN_LOCK_NAMESPACE = 1_112_493_899;

export interface DuplicateScanPageQuery {
  view: 'queue' | 'needs-you' | 'failed' | 'history';
  /** One account's scans; null for everyone's. Scans always have an owner. */
  ownerId: number | null;
  /** Failed scans that finished at or before this have aged into History. */
  cutoffAt: Date;
  after: JobPosition | null;
  typeIndex: number;
  limit: number;
}

const SCAN_PAGE_COLUMNS = {
  id: bookDuplicateScans.id,
  userId: bookDuplicateScans.userId,
  libraryIds: bookDuplicateScans.libraryIds,
  requestedLibraryId: bookDuplicateScans.requestedLibraryId,
  status: bookDuplicateScans.status,
  processedBooks: bookDuplicateScans.processedBooks,
  totalBooks: bookDuplicateScans.totalBooks,
  errorCode: bookDuplicateScans.errorCode,
  createdAt: bookDuplicateScans.createdAt,
  completedAt: bookDuplicateScans.completedAt,
};

export type DuplicateScanPageRow = Pick<ScanRow, keyof typeof SCAN_PAGE_COLUMNS> & {
  requesterName: string | null;
  /** 1-based place among queued scans, which one worker runs oldest first; 0 otherwise. */
  rank: number;
  key: JobKey;
};

export interface DuplicateScanCounts {
  queue: number;
  failed: number;
  running: number;
  queued: number;
}

/** When a scan ended, never null, so no row drops out of a keyset comparison. */
const SCAN_FINISH = sql`coalesce(${bookDuplicateScans.completedAt}, ${bookDuplicateScans.createdAt})`;

// Whole-library scan statements run in the background on the request pool, whose 30s statement
// timeout a large library can outlast, so they get a wider but still finite budget of their own.
const SCAN_STATEMENT_TIMEOUT_MS = 10 * 60 * 1000;
// ANALYZE queues behind a running VACUUM of the table; matching proceeds on older statistics instead.
const SCAN_KEYS_ANALYZE_LOCK_TIMEOUT_MS = 5 * 1000;
const SET_SCAN_STATEMENT_TIMEOUT = sql.raw(`SET LOCAL statement_timeout = ${SCAN_STATEMENT_TIMEOUT_MS}`);

export type OtherFormatBookRow = {
  id: number;
  title: string | null;
  hardcover_id: string | null;
  open_library_id: string | null;
  series_id: number | null;
  series_index: string | null;
  formats: string[];
  authors: string[];
  narrators: string[];
};

export type PreviewRow = {
  group_id: number;
  id: number;
  title: string | null;
  subtitle: string | null;
  authors: string[];
  library_id: number;
  library_name: string;
  folder_path: string;
  status: string;
  files: { id: number; format: string | null; sizeBytes: number | null; path: string | null }[];
  isbn10: string | null;
  isbn13: string | null;
  metadata_score: number | null;
  read_status: {
    status: string;
    source: string;
    startedAt: string | null;
    finishedAt: string | null;
    updatedAt: string;
  } | null;
  reading_progress: number | null;
  collections: { id: number; name: string }[];
  added_at: Date;
  updated_at: Date | null;
  has_cover: boolean;
  book_per_file: boolean;
};

/** The books a user's scan covers: their accessible libraries, minus anything their content filters hide. */
export function duplicateScopeWhere(db: Db, libraryIds: number[], user: RequestUser): SQL {
  if (libraryIds.length === 0) return sql`false`;
  const clauses: SQL[] = [inArray(books.libraryId, libraryIds), ne(books.status, 'processing')];
  if (!user.isSuperuser) clauses.push(...buildContentFilterClauses(user.contentFilters, db));
  return and(...clauses)!;
}

/**
 * The groups of a scan still waiting on a decision: two or more visible members that are not yet
 * editions of one work, and a pair the user has not dismissed. Grouping or dismissing takes a group
 * off the list at once, wherever it was done, instead of at the next scan.
 */
export function openDuplicateGroupWhere(db: Db, scanId: number, libraryIds: number[], user: RequestUser): SQL {
  const separateWorks = db
    .select({ groupId: bookDuplicateGroupMembers.groupId })
    .from(bookDuplicateGroupMembers)
    .innerJoin(books, eq(books.id, bookDuplicateGroupMembers.bookId))
    .leftJoin(bookLinks, eq(bookLinks.bookId, bookDuplicateGroupMembers.bookId))
    .where(and(eq(bookDuplicateGroupMembers.scanId, scanId), duplicateScopeWhere(db, libraryIds, user)))
    .groupBy(bookDuplicateGroupMembers.groupId)
    .having(sql`count(DISTINCT COALESCE('link:' || ${bookLinks.groupId}, 'book:' || ${books.id})) >= 2`);
  const undismissed = sql`EXISTS (
    SELECT 1
    FROM ${bookDuplicatePairs} pair
    WHERE pair.group_id = ${bookDuplicateGroups.id}
      AND NOT EXISTS (
        SELECT 1
        FROM ${bookDuplicateDismissals} dismissal
        WHERE dismissal.user_id = ${user.id}
          AND dismissal.kind = pair.kind
          AND dismissal.book_id_a = pair.book_id_a
          AND dismissal.book_id_b = pair.book_id_b
      )
  )`;
  return and(inArray(bookDuplicateGroups.id, separateWorks), undismissed)!;
}

@Injectable()
export class BookDuplicatesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private scopeWhere(libraryIds: number[], user: RequestUser): SQL {
    return duplicateScopeWhere(this.db, libraryIds, user);
  }

  /** Runs one whole-library scan statement under the scan's statement budget rather than the pool's. */
  private withScanBudget<T>(run: (db: Pick<Db, 'execute'>) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(SET_SCAN_STATEMENT_TIMEOUT);
      return run(tx);
    });
  }

  async findActiveForUser(userId: number): Promise<ScanRow | null> {
    const [row] = await this.db
      .select()
      .from(bookDuplicateScans)
      .where(and(eq(bookDuplicateScans.userId, userId), inArray(bookDuplicateScans.status, ['queued', 'running'])))
      .orderBy(desc(bookDuplicateScans.createdAt))
      .limit(1);
    return row ?? null;
  }

  async createScanUnlessActive(values: {
    userId: number;
    libraryIds: number[];
    requestedLibraryId: number | null;
    similarityPercent: number;
  }): Promise<ScanRow | null> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOOK_DUPLICATE_SCAN_LOCK_NAMESPACE}, ${values.userId})`);
      const [active] = await tx
        .select()
        .from(bookDuplicateScans)
        .where(and(eq(bookDuplicateScans.userId, values.userId), inArray(bookDuplicateScans.status, ['queued', 'running'])))
        .limit(1);
      if (active) return null;

      const [row] = await tx.insert(bookDuplicateScans).values(values).returning();
      return row!;
    });
  }

  async findScan(scanId: number): Promise<ScanRow | null> {
    const [row] = await this.db.select().from(bookDuplicateScans).where(eq(bookDuplicateScans.id, scanId)).limit(1);
    return row ?? null;
  }

  async markInterruptedScansFailed(): Promise<void> {
    await this.db.transaction(async (tx) => {
      const interruptedScanIds = tx
        .select({ id: bookDuplicateScans.id })
        .from(bookDuplicateScans)
        .where(inArray(bookDuplicateScans.status, ['queued', 'running']));
      await tx.delete(bookDuplicatePairs).where(inArray(bookDuplicatePairs.scanId, interruptedScanIds));
      await tx.delete(bookDuplicateGroups).where(inArray(bookDuplicateGroups.scanId, interruptedScanIds));
      await tx.delete(bookDuplicateScanKeys).where(inArray(bookDuplicateScanKeys.scanId, interruptedScanIds));
      await tx
        .update(bookDuplicateScans)
        .set({ status: 'failed', errorCode: 'scan_interrupted', completedAt: new Date() })
        .where(inArray(bookDuplicateScans.status, ['queued', 'running']));
    });
  }

  async updateScan(scanId: number, values: Partial<Omit<typeof bookDuplicateScans.$inferInsert, 'id' | 'userId'>>): Promise<void> {
    await this.db.update(bookDuplicateScans).set(values).where(eq(bookDuplicateScans.id, scanId));
  }

  async deleteOlderScans(userId: number, keepScanId: number): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM ${bookDuplicateScans}
      WHERE ${bookDuplicateScans.userId} = ${userId}
        AND ${bookDuplicateScans.id} <> ${keepScanId}
        AND ${bookDuplicateScans.status} NOT IN ('queued', 'running')
    `);
  }

  async countScopedBooks(libraryIds: number[], user: RequestUser): Promise<number> {
    const [row] = await this.db.select({ count: count() }).from(books).where(this.scopeWhere(libraryIds, user));
    return row?.count ?? 0;
  }

  async insertFileHashKeys(scanId: number, libraryIds: number[], user: RequestUser): Promise<void> {
    const scope = this.scopeWhere(libraryIds, user);
    // A chapterized audiobook can have enough content files for the raw signature to
    // exceed PostgreSQL's btree tuple limit, so only its fixed-size digest is indexed.
    await this.withScanBudget((db) =>
      db.execute(sql`
      INSERT INTO ${bookDuplicateScanKeys} (scan_id, book_id, kind, value)
      SELECT
        CAST(${scanId} AS integer),
        ${books.id},
        'file_hash',
        md5(
          array_to_string(
            array_agg(
              lower(btrim(${bookFiles.fileHash})) || ':' || ${bookFiles.sizeBytes}::text
              ORDER BY lower(btrim(${bookFiles.fileHash})), ${bookFiles.sizeBytes}, ${bookFiles.id}
            ),
            chr(30)
          )
        )
      FROM ${books}
      JOIN ${bookFiles} ON ${bookFiles.bookId} = ${books.id}
      WHERE ${scope}
        AND ${bookFiles.role} = 'content'
      GROUP BY ${books.id}
      HAVING count(*) > 0
        AND count(*) = count(NULLIF(btrim(${bookFiles.fileHash}), ''))
        AND count(*) = count(${bookFiles.sizeBytes})
      ON CONFLICT DO NOTHING
    `),
    );
  }

  async findIsbnBatch(
    libraryIds: number[],
    user: RequestUser,
    afterBookId: number,
    limit: number,
  ): Promise<{ id: number; isbn10: string | null; isbn13: string | null; formats: (string | null)[] }[]> {
    const scope = this.scopeWhere(libraryIds, user);
    const result = await this.db.execute<{ id: number; isbn10: string | null; isbn13: string | null; formats: (string | null)[] }>(sql`
      SELECT
        ${books.id} AS id,
        ${bookMetadata.isbn10} AS isbn10,
        ${bookMetadata.isbn13} AS isbn13,
        COALESCE(
          ARRAY_AGG(DISTINCT ${bookFiles.format}) FILTER (WHERE ${bookFiles.role} = 'content'),
          ARRAY[NULL]::varchar[]
        ) AS formats
      FROM ${books}
      JOIN ${bookMetadata} ON ${bookMetadata.bookId} = ${books.id}
      LEFT JOIN ${bookFiles} ON ${bookFiles.bookId} = ${books.id}
      WHERE ${scope}
        AND ${books.id} > ${afterBookId}
        AND (${bookMetadata.isbn10} IS NOT NULL OR ${bookMetadata.isbn13} IS NOT NULL)
      GROUP BY ${books.id}, ${bookMetadata.isbn10}, ${bookMetadata.isbn13}
      ORDER BY ${books.id}
      LIMIT ${limit}
    `);
    return result.rows;
  }

  async insertIsbnKeys(values: { scanId: number; bookId: number; value: string }[]): Promise<void> {
    if (values.length === 0) return;
    await this.db
      .insert(bookDuplicateScanKeys)
      .values(values.map((value) => ({ ...value, kind: 'isbn' })))
      .onConflictDoNothing();
  }

  async insertExactMetadataKeys(scanId: number, libraryIds: number[], user: RequestUser): Promise<void> {
    const scope = this.scopeWhere(libraryIds, user);
    // Long titles and author lists can exceed PostgreSQL's btree tuple limit, so only
    // the fixed-size digest of the normalized metadata signature is indexed.
    await this.withScanBudget((db) =>
      db.execute(sql`
      WITH eligible AS (
        SELECT
          ${books.id} AS book_id,
          lower(btrim(regexp_replace(regexp_replace(public.bookorbit_unaccent(coalesce(${bookMetadata.title}, '')), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))) AS title_key,
          ARRAY(
            SELECT DISTINCT lower(btrim(regexp_replace(regexp_replace(public.bookorbit_unaccent(a.name), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))) AS author_key
            FROM book_authors ba
            JOIN authors a ON a.id = ba.author_id
            WHERE ba.book_id = ${books.id}
              AND lower(btrim(regexp_replace(regexp_replace(public.bookorbit_unaccent(a.name), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))) <> ''
            ORDER BY author_key
          ) AS author_keys,
          CASE
            WHEN EXISTS (SELECT 1 FROM book_files existing_file WHERE existing_file.book_id = ${books.id} AND existing_file.role = 'content')
            THEN ARRAY(
              SELECT DISTINCT ${mediaFamilySql(sql`f.format`)} AS family
              FROM book_files f
              WHERE f.book_id = ${books.id} AND f.role = 'content'
              ORDER BY family
            )
            ELSE ARRAY['unknown']::text[]
          END AS families
        FROM ${books}
        JOIN ${bookMetadata} ON ${bookMetadata.bookId} = ${books.id}
        WHERE ${scope}
      )
      INSERT INTO ${bookDuplicateScanKeys} (scan_id, book_id, kind, value)
      SELECT
        CAST(${scanId} AS integer),
        eligible.book_id,
        'exact_metadata',
        md5(eligible.title_key || chr(31) || array_to_string(eligible.author_keys, chr(30)) || chr(31) || family)
      FROM eligible
      CROSS JOIN LATERAL unnest(eligible.families) AS family
      WHERE eligible.title_key <> '' AND cardinality(eligible.author_keys) > 0
      ON CONFLICT DO NOTHING
    `),
    );
  }

  async createExactPairs(scanId: number): Promise<void> {
    await this.withScanBudget((db) =>
      db.execute(sql`
      WITH keyed AS (
        SELECT
          kind,
          value,
          book_id,
          min(book_id) OVER (PARTITION BY kind, value) AS anchor_id
        FROM ${bookDuplicateScanKeys}
        WHERE scan_id = ${scanId}
          AND kind IN ('file_hash', 'isbn', 'exact_metadata')
      ), candidate_pairs AS (
        SELECT
          anchor_id AS book_id_a,
          book_id AS book_id_b,
          CASE kind
            WHEN 'file_hash' THEN 'file_hash'
            WHEN 'isbn' THEN 'isbn'
            ELSE 'exact_metadata'
          END AS reason
        FROM keyed
        WHERE anchor_id < book_id
      )
      INSERT INTO ${bookDuplicatePairs} (scan_id, book_id_a, book_id_b, reasons)
      SELECT CAST(${scanId} AS integer), book_id_a, book_id_b, array_agg(DISTINCT reason ORDER BY reason)
      FROM candidate_pairs
      GROUP BY book_id_a, book_id_b
      ON CONFLICT (scan_id, kind, book_id_a, book_id_b) DO UPDATE
      SET reasons = ARRAY(
        SELECT DISTINCT reason
        FROM unnest(book_duplicate_pairs.reasons || EXCLUDED.reasons) AS reason
        ORDER BY reason
      )
    `),
    );
  }

  async createFuzzyPairs(scanId: number, libraryIds: number[], user: RequestUser, similarityPercent: number): Promise<void> {
    const scope = this.scopeWhere(libraryIds, user);
    const threshold = similarityPercent / 100;
    await this.withScanBudget((db) =>
      db.execute(sql`
      WITH eligible AS (
        SELECT
          ${books.id} AS book_id,
          ${bookMetadata.title} AS raw_title,
          lower(btrim(regexp_replace(regexp_replace(public.bookorbit_unaccent(coalesce(${bookMetadata.title}, '')), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))) AS title_key,
          ARRAY(
            SELECT DISTINCT lower(btrim(regexp_replace(regexp_replace(public.bookorbit_unaccent(a.name), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))) AS author_key
            FROM book_authors ba
            JOIN authors a ON a.id = ba.author_id
            WHERE ba.book_id = ${books.id}
              AND lower(btrim(regexp_replace(regexp_replace(public.bookorbit_unaccent(a.name), '[^[:alnum:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g'))) <> ''
            ORDER BY author_key
          ) AS author_keys,
          CASE
            WHEN EXISTS (SELECT 1 FROM book_files existing_file WHERE existing_file.book_id = ${books.id} AND existing_file.role = 'content')
            THEN ARRAY(
              SELECT DISTINCT ${mediaFamilySql(sql`f.format`)} AS family
              FROM book_files f
              WHERE f.book_id = ${books.id} AND f.role = 'content'
              ORDER BY family
            )
            ELSE ARRAY['unknown']::text[]
          END AS families
        FROM ${books}
        JOIN ${bookMetadata} ON ${bookMetadata.bookId} = ${books.id}
        WHERE ${scope}
          AND ${bookMetadata.title} IS NOT NULL
          AND btrim(${bookMetadata.title}) <> ''
      ), blocked AS (
        SELECT DISTINCT
          eligible.book_id,
          eligible.raw_title,
          eligible.title_key,
          author_key,
          family
        FROM eligible
        CROSS JOIN LATERAL unnest(eligible.author_keys) AS author_key
        CROSS JOIN LATERAL unnest(eligible.families) AS family
        WHERE author_key <> ''
      ), fuzzy_pairs AS (
        SELECT
          a.book_id AS book_id_a,
          b.book_id AS book_id_b,
          max(similarity(a.title_key, b.title_key)) AS title_similarity
        FROM blocked a
        JOIN blocked b ON a.book_id < b.book_id
          AND a.author_key = b.author_key
          AND a.family = b.family
          AND public.bookorbit_unaccent(a.raw_title) % public.bookorbit_unaccent(b.raw_title)
        WHERE similarity(a.title_key, b.title_key) >= ${threshold}
        GROUP BY a.book_id, b.book_id
      )
      INSERT INTO ${bookDuplicatePairs} (scan_id, book_id_a, book_id_b, reasons, title_similarity)
      SELECT CAST(${scanId} AS integer), book_id_a, book_id_b, ARRAY['fuzzy_metadata']::text[], title_similarity
      FROM fuzzy_pairs
      ON CONFLICT (scan_id, kind, book_id_a, book_id_b) DO UPDATE
      SET
        reasons = ARRAY(
          SELECT DISTINCT reason
          FROM unnest(book_duplicate_pairs.reasons || EXCLUDED.reasons) AS reason
          ORDER BY reason
        ),
        title_similarity = GREATEST(book_duplicate_pairs.title_similarity, EXCLUDED.title_similarity)
    `),
    );
  }

  /**
   * Removes pairs whose books hold different positions in one series: they are different volumes,
   * not copies, whatever their titles, ISBNs or work ids say. A matching file hash is the one exception.
   */
  async deleteSeriesConflictPairs(scanId: number): Promise<number> {
    const result = await this.withScanBudget((db) =>
      db.execute(sql`
      DELETE FROM ${bookDuplicatePairs} pair
      WHERE pair.scan_id = ${scanId}
        AND NOT ('file_hash' = ANY(pair.reasons))
        AND EXISTS (
          SELECT 1
          FROM ${bookSeriesMemberships} membership_a
          JOIN ${bookSeriesMemberships} membership_b ON membership_b.series_id = membership_a.series_id
          WHERE membership_a.book_id = pair.book_id_a
            AND membership_b.book_id = pair.book_id_b
            AND membership_a.series_index IS NOT NULL
            AND membership_b.series_index IS NOT NULL
            AND membership_a.series_index::numeric <> membership_b.series_index::numeric
        )
    `),
    );
    return result.rowCount ?? 0;
  }

  async finalizeGroups(scanId: number): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.execute(SET_SCAN_STATEMENT_TIMEOUT);
      const pairs = await tx.execute<{ book_id_a: number; book_id_b: number; reasons: string[]; title_similarity: number | null }>(sql`
        SELECT book_id_a, book_id_b, reasons, title_similarity
        FROM ${bookDuplicatePairs}
        WHERE scan_id = ${scanId} AND kind = 'duplicate'
      `);
      const positions = await tx.execute<{ book_id: number; series_id: number; series_index: string | null }>(sql`
        SELECT membership.book_id, membership.series_id, membership.series_index
        FROM ${bookSeriesMemberships} membership
        WHERE membership.series_index IS NOT NULL
          AND membership.book_id IN (
            SELECT book_id_a FROM ${bookDuplicatePairs} WHERE scan_id = ${scanId} AND kind = 'duplicate'
            UNION
            SELECT book_id_b FROM ${bookDuplicatePairs} WHERE scan_id = ${scanId} AND kind = 'duplicate'
          )
      `);
      const roots = groupDuplicatePairs(
        pairs.rows.map((row) => ({
          bookIdA: row.book_id_a,
          bookIdB: row.book_id_b,
          reasons: row.reasons,
          titleSimilarity: row.title_similarity === null ? null : Number(row.title_similarity),
        })),
        positions.rows.map((row) => ({ bookId: row.book_id, seriesId: row.series_id, seriesIndex: row.series_index })),
      );

      await tx.execute(sql`CREATE TEMP TABLE tmp_book_duplicate_components (book_id integer PRIMARY KEY, root_id integer NOT NULL) ON COMMIT DROP`);
      await tx.execute(sql`
        INSERT INTO tmp_book_duplicate_components (book_id, root_id)
        SELECT * FROM unnest(${sql.param([...roots.keys()])}::int[], ${sql.param([...roots.values()])}::int[])
      `);
      // A pair the grouping refused to join, such as a series-less copy matching two volumes, would
      // otherwise land in one endpoint's group without the other book.
      await tx.execute(sql`
        DELETE FROM ${bookDuplicatePairs} pair
        WHERE pair.scan_id = ${scanId}
          AND pair.kind = 'duplicate'
          AND NOT EXISTS (
            SELECT 1
            FROM tmp_book_duplicate_components component_a
            JOIN tmp_book_duplicate_components component_b ON component_b.root_id = component_a.root_id
            WHERE component_a.book_id = pair.book_id_a AND component_b.book_id = pair.book_id_b
          )
      `);

      await tx.execute(sql`
        WITH member_counts AS (
          SELECT root_id, count(*)::integer AS member_count
          FROM tmp_book_duplicate_components
          GROUP BY root_id
        ), reason_stats AS (
          SELECT
            component.root_id,
            array_agg(DISTINCT reason ORDER BY reason) AS reasons,
            max(pair.title_similarity) AS max_title_similarity
          FROM ${bookDuplicatePairs} pair
          JOIN tmp_book_duplicate_components component ON component.book_id = pair.book_id_a
          CROSS JOIN LATERAL unnest(pair.reasons) AS reason
          WHERE pair.scan_id = ${scanId} AND pair.kind = 'duplicate'
          GROUP BY component.root_id
        ), member_bytes AS (
          SELECT
            component.root_id,
            component.book_id,
            COALESCE((
              SELECT sum(member_file.size_bytes)
              FROM ${bookFiles} member_file
              WHERE member_file.book_id = component.book_id AND member_file.role = 'content'
            ), 0)::bigint AS bytes
          FROM tmp_book_duplicate_components component
        ), byte_stats AS (
          SELECT root_id, sum(bytes)::bigint AS total_bytes, max(bytes)::bigint AS max_bytes
          FROM member_bytes
          GROUP BY root_id
        )
        INSERT INTO ${bookDuplicateGroups}
          (scan_id, root_book_id, reasons, max_title_similarity, member_count, confidence, member_bytes_total, member_bytes_max)
        SELECT
          CAST(${scanId} AS integer),
          member_counts.root_id,
          reason_stats.reasons,
          reason_stats.max_title_similarity,
          member_counts.member_count,
          CASE
            WHEN 'file_hash' = ANY(reason_stats.reasons) THEN 4
            WHEN 'isbn' = ANY(reason_stats.reasons) THEN 3
            WHEN 'exact_metadata' = ANY(reason_stats.reasons) THEN 2
            ELSE 1
          END,
          byte_stats.total_bytes,
          byte_stats.max_bytes
        FROM member_counts
        JOIN reason_stats USING (root_id)
        JOIN byte_stats USING (root_id)
      `);

      await tx.execute(sql`
        INSERT INTO ${bookDuplicateGroupMembers} (group_id, scan_id, book_id)
        SELECT duplicate_group.id, CAST(${scanId} AS integer), component.book_id
        FROM tmp_book_duplicate_components component
        JOIN ${bookDuplicateGroups} duplicate_group
          ON duplicate_group.scan_id = ${scanId}
          AND duplicate_group.kind = 'duplicate'
          AND duplicate_group.root_book_id = component.root_id
      `);

      await tx.execute(sql`
        UPDATE ${bookDuplicatePairs} pair
        SET group_id = duplicate_group.id
        FROM tmp_book_duplicate_components component
        JOIN ${bookDuplicateGroups} duplicate_group
          ON duplicate_group.scan_id = ${scanId}
          AND duplicate_group.kind = 'duplicate'
          AND duplicate_group.root_book_id = component.root_id
        WHERE pair.scan_id = ${scanId}
          AND pair.kind = 'duplicate'
          AND component.book_id = pair.book_id_a
      `);

      const [row] = await tx
        .select({ count: count() })
        .from(bookDuplicateGroups)
        .where(and(eq(bookDuplicateGroups.scanId, scanId), eq(bookDuplicateGroups.kind, 'duplicate')));
      return row?.count ?? 0;
    });
  }

  /** One batch of the facts the other-format pass keys on: the book's media, title, people, work ids and series. */
  async findOtherFormatBatch(libraryIds: number[], user: RequestUser, afterBookId: number, limit: number): Promise<OtherFormatBookRow[]> {
    const scope = this.scopeWhere(libraryIds, user);
    const result = await this.db.execute<OtherFormatBookRow>(sql`
      SELECT
        ${books.id} AS id,
        ${bookMetadata.title} AS title,
        ${bookMetadata.hardcoverId} AS hardcover_id,
        ${bookMetadata.openLibraryId} AS open_library_id,
        ${bookMetadata.seriesId} AS series_id,
        ${bookMetadata.seriesIndex} AS series_index,
        ARRAY(
          SELECT DISTINCT lower(f.format)
          FROM book_files f
          WHERE f.book_id = ${books.id} AND f.role = 'content' AND f.format IS NOT NULL
        ) AS formats,
        ARRAY(
          SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id WHERE ba.book_id = ${books.id}
        ) AS authors,
        ARRAY(
          SELECT n.name FROM book_narrators bn JOIN narrators n ON n.id = bn.narrator_id WHERE bn.book_id = ${books.id}
        ) AS narrators
      FROM ${books}
      JOIN ${bookMetadata} ON ${bookMetadata.bookId} = ${books.id}
      WHERE ${scope}
        AND ${books.id} > ${afterBookId}
      ORDER BY ${books.id}
      LIMIT ${limit}
    `);
    return result.rows;
  }

  async insertScanKeys(values: { scanId: number; bookId: number; kind: string; value: string }[]): Promise<void> {
    if (values.length === 0) return;
    await this.db.insert(bookDuplicateScanKeys).values(values).onConflictDoNothing();
  }

  /** Refresh planner statistics while the scan-key table is populated, before cross-format matching. */
  async analyzeScanKeys(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL lock_timeout = ${SCAN_KEYS_ANALYZE_LOCK_TIMEOUT_MS}`));
      await tx.execute(sql`ANALYZE ${bookDuplicateScanKeys}`);
    });
  }

  /**
   * Pairs an ebook with an audiobook that share a work id, a title and a person, or a series
   * position and a similar title. Each key carries its side (`e|` or `a|`), so only a cross-media
   * pair can form. Books already linked together are left out: they are resolved.
   */
  async createOtherFormatPairs(scanId: number, similarityPercent: number): Promise<number> {
    const threshold = similarityPercent / 100;
    const titleA = crossFormatTitleSql(sql`metadata_a.title`);
    const titleB = crossFormatTitleSql(sql`metadata_b.title`);
    const result = await this.withScanBudget((db) =>
      db.execute(sql`
      WITH matched AS (
        SELECT DISTINCT
          least(ebook_keys.book_id, audio_keys.book_id) AS book_id_a,
          greatest(ebook_keys.book_id, audio_keys.book_id) AS book_id_b,
          ebook_keys.kind
        FROM ${bookDuplicateScanKeys} ebook_keys
        JOIN ${bookDuplicateScanKeys} audio_keys
          ON audio_keys.scan_id = ebook_keys.scan_id
          AND audio_keys.kind = ebook_keys.kind
          AND audio_keys.value = 'a|' || substr(ebook_keys.value, 3)
        WHERE ebook_keys.scan_id = ${scanId}
          AND ebook_keys.kind IN ('of_work', 'of_title', 'of_series')
          AND ebook_keys.value LIKE 'e|%'
          AND audio_keys.book_id <> ebook_keys.book_id
      ), scored AS (
        SELECT
          matched.book_id_a,
          matched.book_id_b,
          CASE matched.kind WHEN 'of_work' THEN 'same_work' WHEN 'of_title' THEN 'title_author' ELSE 'series_position' END AS reason,
          CASE WHEN matched.kind = 'of_series' THEN similarity(${titleA}, ${titleB}) ELSE NULL END AS title_similarity
        FROM matched
        JOIN ${bookMetadata} metadata_a ON metadata_a.book_id = matched.book_id_a
        JOIN ${bookMetadata} metadata_b ON metadata_b.book_id = matched.book_id_b
      )
      INSERT INTO ${bookDuplicatePairs} (scan_id, kind, book_id_a, book_id_b, reasons, title_similarity)
      SELECT
        CAST(${scanId} AS integer),
        'other_format',
        scored.book_id_a,
        scored.book_id_b,
        array_agg(DISTINCT scored.reason ORDER BY scored.reason),
        max(scored.title_similarity)
      FROM scored
      WHERE (scored.reason <> 'series_position' OR scored.title_similarity >= ${threshold})
        AND NOT EXISTS (
          SELECT 1
          FROM book_links link_a
          JOIN book_links link_b ON link_b.group_id = link_a.group_id
          WHERE link_a.book_id = scored.book_id_a AND link_b.book_id = scored.book_id_b
        )
      GROUP BY scored.book_id_a, scored.book_id_b
      ON CONFLICT (scan_id, kind, book_id_a, book_id_b) DO NOTHING
    `),
    );
    return result.rowCount ?? 0;
  }

  /**
   * Candidate editions found by work id alone: two books of one medium sharing a Hardcover or Open
   * Library work id, read from the other-format keys, whose side prefix already names the medium. A
   * pair the duplicate passes found is left to them; the edition pass decides both kinds.
   */
  async createSameMediumWorkPairs(scanId: number): Promise<number> {
    const result = await this.withScanBudget((db) =>
      db.execute(sql`
      WITH matched AS (
        SELECT DISTINCT
          first_key.book_id AS book_id_a,
          second_key.book_id AS book_id_b
        FROM ${bookDuplicateScanKeys} first_key
        JOIN ${bookDuplicateScanKeys} second_key
          ON second_key.scan_id = first_key.scan_id
          AND second_key.kind = first_key.kind
          AND second_key.value = first_key.value
          AND second_key.book_id > first_key.book_id
        WHERE first_key.scan_id = ${scanId}
          AND first_key.kind = 'of_work'
      )
      INSERT INTO ${bookDuplicatePairs} (scan_id, kind, book_id_a, book_id_b, reasons)
      SELECT CAST(${scanId} AS integer), 'other_edition', matched.book_id_a, matched.book_id_b, ARRAY['same_work']::text[]
      FROM matched
      WHERE NOT EXISTS (
        SELECT 1
        FROM ${bookDuplicatePairs} existing
        WHERE existing.scan_id = ${scanId}
          AND existing.kind = 'duplicate'
          AND existing.book_id_a = matched.book_id_a
          AND existing.book_id_b = matched.book_id_b
      )
      ON CONFLICT (scan_id, kind, book_id_a, book_id_b) DO NOTHING
    `),
    );
    return result.rowCount ?? 0;
  }

  /** Books already linked together are resolved, so their pairs leave every kind, identical files included. */
  async deleteLinkedPairs(scanId: number): Promise<number> {
    const result = await this.withScanBudget((db) =>
      db.execute(sql`
      DELETE FROM ${bookDuplicatePairs} pair
      WHERE pair.scan_id = ${scanId}
        AND EXISTS (
          SELECT 1
          FROM book_links link_a
          JOIN book_links link_b ON link_b.group_id = link_a.group_id
          WHERE link_a.book_id = pair.book_id_a AND link_b.book_id = pair.book_id_b
        )
    `),
    );
    return result.rowCount ?? 0;
  }

  /**
   * One batch of the pairs the edition pass judges, in key order: duplicates not proven by identical
   * files or a shared ISBN, and the work-id candidates. A pair is in at most one of the two kinds.
   */
  async findEditionCandidatePairs(
    scanId: number,
    after: { bookIdA: number; bookIdB: number } | null,
    limit: number,
  ): Promise<{ book_id_a: number; book_id_b: number; kind: 'duplicate' | 'other_edition'; reasons: string[] }[]> {
    const afterClause = after ? sql`AND (pair.book_id_a, pair.book_id_b) > (${after.bookIdA}::integer, ${after.bookIdB}::integer)` : sql``;
    const result = await this.db.execute<{ book_id_a: number; book_id_b: number; kind: 'duplicate' | 'other_edition'; reasons: string[] }>(sql`
      SELECT pair.book_id_a, pair.book_id_b, pair.kind, pair.reasons
      FROM ${bookDuplicatePairs} pair
      WHERE pair.scan_id = ${scanId}
        AND (
          pair.kind = 'other_edition'
          OR (pair.kind = 'duplicate' AND NOT ('file_hash' = ANY(pair.reasons)) AND NOT ('isbn' = ANY(pair.reasons)))
        )
        ${afterClause}
      ORDER BY pair.book_id_a, pair.book_id_b
      LIMIT ${limit}
    `);
    return result.rows;
  }

  /** The facts that tell one edition from another, for the books of one batch of pairs. */
  async findEditionFacts(bookIds: number[]): Promise<EditionFactsRow[]> {
    if (bookIds.length === 0) return [];
    const result = await this.db.execute<EditionFactsRow>(sql`
      SELECT
        ${books.id} AS id,
        ${bookMetadata.isbn10} AS isbn10,
        ${bookMetadata.isbn13} AS isbn13,
        ${bookMetadata.hardcoverId} AS hardcover_id,
        ${bookMetadata.hardcoverEditionId} AS hardcover_edition_id,
        ${bookMetadata.openLibraryId} AS open_library_id,
        ${bookMetadata.publisher} AS publisher,
        COALESCE(extract(year FROM ${bookMetadata.publishedDate})::integer, ${bookMetadata.publishedYear}) AS published_year,
        ARRAY(
          SELECT DISTINCT lower(f.format)
          FROM book_files f
          WHERE f.book_id = ${books.id} AND f.role = 'content' AND f.format IS NOT NULL
        ) AS formats,
        ARRAY(
          SELECT n.name FROM book_narrators bn JOIN narrators n ON n.id = bn.narrator_id WHERE bn.book_id = ${books.id}
        ) AS narrators
      FROM ${books}
      LEFT JOIN ${bookMetadata} ON ${bookMetadata.bookId} = ${books.id}
      WHERE ${books.id} = ANY(${sql.param(bookIds)}::int[])
    `);
    return result.rows;
  }

  /** Moves duplicates that differ as editions to other editions, and drops work-id candidates that do not. */
  async applyEditionOutcomes(
    scanId: number,
    reclassified: { bookIdA: number; bookIdB: number; sameWork: boolean }[],
    dropped: { bookIdA: number; bookIdB: number }[],
  ): Promise<void> {
    if (reclassified.length > 0) {
      await this.db.execute(sql`
        UPDATE ${bookDuplicatePairs} pair
        SET
          kind = 'other_edition',
          reasons = CASE WHEN outcome.same_work THEN ARRAY['same_work', 'title_author']::text[] ELSE ARRAY['title_author']::text[] END
        FROM unnest(
          ${sql.param(reclassified.map((pair) => pair.bookIdA))}::int[],
          ${sql.param(reclassified.map((pair) => pair.bookIdB))}::int[],
          ${sql.param(reclassified.map((pair) => pair.sameWork))}::boolean[]
        ) AS outcome(book_id_a, book_id_b, same_work)
        WHERE pair.scan_id = ${scanId}
          AND pair.kind = 'duplicate'
          AND pair.book_id_a = outcome.book_id_a
          AND pair.book_id_b = outcome.book_id_b
      `);
    }
    if (dropped.length > 0) {
      await this.db.execute(sql`
        DELETE FROM ${bookDuplicatePairs} pair
        USING unnest(
          ${sql.param(dropped.map((pair) => pair.bookIdA))}::int[],
          ${sql.param(dropped.map((pair) => pair.bookIdB))}::int[]
        ) AS outcome(book_id_a, book_id_b)
        WHERE pair.scan_id = ${scanId}
          AND pair.kind = 'other_edition'
          AND pair.book_id_a = outcome.book_id_a
          AND pair.book_id_b = outcome.book_id_b
      `);
    }
  }

  /** Every other-format pair becomes a group of its own: pairs never chain, so one book can sit in several. */
  async finalizeOtherFormatGroups(scanId: number): Promise<number> {
    return this.finalizePairGroups(scanId, 'other_format');
  }

  /** Other editions are pairs too: one recording can be an edition of several others without joining them. */
  async finalizeOtherEditionGroups(scanId: number): Promise<number> {
    return this.finalizePairGroups(scanId, 'other_edition');
  }

  private async finalizePairGroups(scanId: number, kind: 'other_format' | 'other_edition'): Promise<number> {
    const result = await this.withScanBudget((db) =>
      db.execute(sql`
      WITH numbered AS (
        SELECT
          nextval(pg_get_serial_sequence('book_duplicate_groups', 'id'))::integer AS group_id,
          pair.book_id_a,
          pair.book_id_b,
          pair.reasons,
          pair.title_similarity
        FROM ${bookDuplicatePairs} pair
        WHERE pair.scan_id = ${scanId} AND pair.kind = ${kind}
      ), inserted_groups AS (
        INSERT INTO ${bookDuplicateGroups}
          (id, scan_id, root_book_id, kind, reasons, max_title_similarity, member_count, confidence, member_bytes_total, member_bytes_max)
        SELECT
          numbered.group_id,
          CAST(${scanId} AS integer),
          numbered.book_id_a,
          ${kind},
          numbered.reasons,
          numbered.title_similarity,
          2,
          CASE
            WHEN 'same_work' = ANY(numbered.reasons) THEN 3
            WHEN 'title_author' = ANY(numbered.reasons) THEN 2
            ELSE 1
          END,
          0,
          0
        FROM numbered
        RETURNING id
      ), inserted_members AS (
        INSERT INTO ${bookDuplicateGroupMembers} (group_id, scan_id, book_id)
        SELECT group_id, CAST(${scanId} AS integer), book_id_a FROM numbered
        UNION ALL
        SELECT group_id, CAST(${scanId} AS integer), book_id_b FROM numbered
        RETURNING group_id
      )
      UPDATE ${bookDuplicatePairs} pair
      SET group_id = numbered.group_id
      FROM numbered
      WHERE pair.scan_id = ${scanId}
        AND pair.kind = ${kind}
        AND pair.book_id_a = numbered.book_id_a
        AND pair.book_id_b = numbered.book_id_b
    `),
    );
    return result.rowCount ?? 0;
  }

  async deleteScanKeys(scanId: number): Promise<void> {
    await this.db.delete(bookDuplicateScanKeys).where(eq(bookDuplicateScanKeys.scanId, scanId));
  }

  async deleteScanArtifacts(scanId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(bookDuplicatePairs).where(eq(bookDuplicatePairs.scanId, scanId));
      await tx.delete(bookDuplicateGroups).where(eq(bookDuplicateGroups.scanId, scanId));
      await tx.delete(bookDuplicateScanKeys).where(eq(bookDuplicateScanKeys.scanId, scanId));
    });
  }

  async findGroups(
    scanId: number,
    page: number,
    pageSize: number,
    libraryIds: number[],
    user: RequestUser,
    reason: BookDuplicateMatchReason | undefined,
    sortBy: BookDuplicateGroupSort,
    order: BookDuplicateSortOrder,
    kind: BookDuplicateKind = 'duplicate',
  ) {
    const open = openDuplicateGroupWhere(this.db, scanId, libraryIds, user);
    const reasonFilter = reason ? sql`${reason} = ANY(${bookDuplicateGroups.reasons})` : sql`true`;
    const where = and(eq(bookDuplicateGroups.scanId, scanId), eq(bookDuplicateGroups.kind, kind), open, reasonFilter)!;
    const [countRow] = await this.db.select({ count: count() }).from(bookDuplicateGroups).where(where);
    const kindRows = await this.db
      .select({ kind: bookDuplicateGroups.kind, count: count() })
      .from(bookDuplicateGroups)
      .where(and(eq(bookDuplicateGroups.scanId, scanId), open))
      .groupBy(bookDuplicateGroups.kind);
    const kindTotals: Record<BookDuplicateKind, number> = { duplicate: 0, other_format: 0, other_edition: 0 };
    for (const row of kindRows) kindTotals[row.kind as BookDuplicateKind] = row.count;
    const groups = await this.db
      .select({
        id: bookDuplicateGroups.id,
        kind: bookDuplicateGroups.kind,
        reasons: bookDuplicateGroups.reasons,
        maxTitleSimilarity: bookDuplicateGroups.maxTitleSimilarity,
        memberCount: bookDuplicateGroups.memberCount,
        memberBytesTotal: bookDuplicateGroups.memberBytesTotal,
        memberBytesMax: bookDuplicateGroups.memberBytesMax,
      })
      .from(bookDuplicateGroups)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, bookDuplicateGroups.rootBookId))
      .where(where)
      .orderBy(...this.groupOrderBy(sortBy, order))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { groups, total: countRow?.count ?? 0, kindTotals };
  }

  private groupOrderBy(sortBy: BookDuplicateGroupSort, order: BookDuplicateSortOrder): SQL[] {
    const direction = order === 'asc' ? asc : desc;
    const reclaimable = sql`(${bookDuplicateGroups.memberBytesTotal} - ${bookDuplicateGroups.memberBytesMax})`;
    const tiebreak = sql`${bookDuplicateGroups.id} asc`;
    switch (sortBy) {
      case 'copies':
        return [direction(bookDuplicateGroups.memberCount), desc(reclaimable), tiebreak];
      case 'confidence':
        return [direction(bookDuplicateGroups.confidence), desc(reclaimable), tiebreak];
      case 'title':
        return [direction(sql`lower(coalesce(${bookMetadata.title}, ''))`), tiebreak];
      default:
        return [direction(reclaimable), desc(bookDuplicateGroups.memberCount), tiebreak];
    }
  }

  /**
   * Pairs the user has already judged, removed before groups are formed so a dismissal survives
   * a rescan and does not just hide a group that keeps coming back.
   */
  async deleteDismissedPairs(scanId: number, userId: number): Promise<number> {
    const result = await this.db.execute(sql`
      DELETE FROM ${bookDuplicatePairs} pair
      USING ${bookDuplicateDismissals} dismissal
      WHERE pair.scan_id = ${scanId}
        AND dismissal.user_id = ${userId}
        AND dismissal.kind = pair.kind
        AND dismissal.book_id_a = pair.book_id_a
        AND dismissal.book_id_b = pair.book_id_b
    `);
    return result.rowCount ?? 0;
  }

  async computeScanTotals(scanId: number): Promise<{ totalExtraCopies: number; totalReclaimableBytes: number }> {
    const [row] = await this.db
      .select({
        extraCopies: sql<string>`COALESCE(sum(${bookDuplicateGroups.memberCount} - 1), 0)`,
        reclaimable: sql<string>`COALESCE(sum(${bookDuplicateGroups.memberBytesTotal} - ${bookDuplicateGroups.memberBytesMax}), 0)`,
      })
      .from(bookDuplicateGroups)
      .where(and(eq(bookDuplicateGroups.scanId, scanId), eq(bookDuplicateGroups.kind, 'duplicate')));
    return { totalExtraCopies: Number(row?.extraCopies ?? 0), totalReclaimableBytes: Number(row?.reclaimable ?? 0) };
  }

  async findGroupKind(scanId: number, groupId: number): Promise<BookDuplicateKind | null> {
    const [row] = await this.db
      .select({ kind: bookDuplicateGroups.kind })
      .from(bookDuplicateGroups)
      .where(and(eq(bookDuplicateGroups.scanId, scanId), eq(bookDuplicateGroups.id, groupId)))
      .limit(1);
    return (row?.kind as BookDuplicateKind | undefined) ?? null;
  }

  async findGroupMemberIds(scanId: number, groupId: number): Promise<number[]> {
    const rows = await this.db
      .select({ bookId: bookDuplicateGroupMembers.bookId })
      .from(bookDuplicateGroupMembers)
      .where(and(eq(bookDuplicateGroupMembers.scanId, scanId), eq(bookDuplicateGroupMembers.groupId, groupId)));
    return rows.map((row) => row.bookId);
  }

  async insertDismissals(userId: number, kind: BookDuplicateKind, pairs: { bookIdA: number; bookIdB: number }[]): Promise<void> {
    if (pairs.length === 0) return;
    await this.db
      .insert(bookDuplicateDismissals)
      .values(pairs.map((pair) => ({ userId, kind, bookIdA: pair.bookIdA, bookIdB: pair.bookIdB })))
      .onConflictDoNothing();
  }

  async deleteDismissal(userId: number, kind: BookDuplicateKind, bookIdA: number, bookIdB: number): Promise<number> {
    const result = await this.db
      .delete(bookDuplicateDismissals)
      .where(
        and(
          eq(bookDuplicateDismissals.userId, userId),
          eq(bookDuplicateDismissals.kind, kind),
          eq(bookDuplicateDismissals.bookIdA, bookIdA),
          eq(bookDuplicateDismissals.bookIdB, bookIdB),
        ),
      );
    return result.rowCount ?? 0;
  }

  async listDismissals(userId: number, limit: number): Promise<DismissalRow[]> {
    const metadataA = alias(bookMetadata, 'metadata_a');
    const metadataB = alias(bookMetadata, 'metadata_b');
    const bookA = alias(books, 'book_a');
    const bookB = alias(books, 'book_b');
    const libraryA = alias(libraries, 'library_a');
    const libraryB = alias(libraries, 'library_b');
    const rows = await this.db
      .select({
        kind: bookDuplicateDismissals.kind,
        bookIdA: bookDuplicateDismissals.bookIdA,
        bookIdB: bookDuplicateDismissals.bookIdB,
        titleA: metadataA.title,
        titleB: metadataB.title,
        editionNameA: metadataA.editionName,
        editionNameB: metadataB.editionName,
        publisherA: metadataA.publisher,
        publisherB: metadataB.publisher,
        publishedYearA: metadataA.publishedYear,
        publishedYearB: metadataB.publishedYear,
        libraryIdA: bookA.libraryId,
        libraryIdB: bookB.libraryId,
        libraryNameA: libraryA.name,
        libraryNameB: libraryB.name,
        createdAt: bookDuplicateDismissals.createdAt,
      })
      .from(bookDuplicateDismissals)
      .leftJoin(metadataA, eq(metadataA.bookId, bookDuplicateDismissals.bookIdA))
      .leftJoin(metadataB, eq(metadataB.bookId, bookDuplicateDismissals.bookIdB))
      .leftJoin(bookA, eq(bookA.id, bookDuplicateDismissals.bookIdA))
      .leftJoin(bookB, eq(bookB.id, bookDuplicateDismissals.bookIdB))
      .leftJoin(libraryA, eq(libraryA.id, bookA.libraryId))
      .leftJoin(libraryB, eq(libraryB.id, bookB.libraryId))
      .where(eq(bookDuplicateDismissals.userId, userId))
      .orderBy(desc(bookDuplicateDismissals.createdAt))
      .limit(limit);
    return rows;
  }

  async findPairs(groupIds: number[]) {
    if (groupIds.length === 0) return [];
    return this.db.select().from(bookDuplicatePairs).where(inArray(bookDuplicatePairs.groupId, groupIds));
  }

  async findCandidatePreviews(groupIds: number[], libraryIds: number[], user: RequestUser): Promise<PreviewRow[]> {
    if (groupIds.length === 0 || libraryIds.length === 0) return [];
    const scope = this.scopeWhere(libraryIds, user);
    const result = await this.db.execute<PreviewRow>(sql`
      SELECT
        member.group_id,
        ${books.id} AS id,
        ${bookMetadata.title} AS title,
        ${bookMetadata.subtitle} AS subtitle,
        COALESCE((
          SELECT array_agg(author.name ORDER BY book_author.display_order, author.id)
          FROM book_authors book_author
          JOIN authors author ON author.id = book_author.author_id
          WHERE book_author.book_id = ${books.id}
        ), ARRAY[]::varchar[]) AS authors,
        ${books.libraryId} AS library_id,
        library.name AS library_name,
        COALESCE((
          SELECT min(path_file.rel_path)
          FROM book_files path_file
          WHERE path_file.book_id = ${books.id}
            AND path_file.role = 'content'
            AND path_file.rel_path IS NOT NULL
        ), '') AS folder_path,
        ${books.status} AS status,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', file.id,
            'format', file.format,
            'sizeBytes', file.size_bytes,
            'path', file.rel_path
          ) ORDER BY file.sort_order NULLS LAST, file.id)
          FROM book_files file
          WHERE file.book_id = ${books.id} AND file.role = 'content'
        ), '[]'::jsonb) AS files,
        ${bookMetadata.isbn10} AS isbn10,
        ${bookMetadata.isbn13} AS isbn13,
        ${bookMetadata.metadataScore} AS metadata_score,
        CASE WHEN read_status.book_id IS NULL THEN NULL ELSE jsonb_build_object(
          'status', read_status.status,
          'source', read_status.source,
          'startedAt', read_status.started_at,
          'finishedAt', read_status.finished_at,
          'updatedAt', read_status.updated_at
        ) END AS read_status,
        GREATEST(
          (
            SELECT max(progress.percentage)
            FROM reading_progress progress
            JOIN book_files progress_file ON progress_file.id = progress.book_file_id
            WHERE progress_file.book_id = ${books.id} AND progress.user_id = ${user.id}
          ),
          (
            SELECT audio_progress.percentage
            FROM audiobook_progress audio_progress
            WHERE audio_progress.book_id = ${books.id} AND audio_progress.user_id = ${user.id}
          )
        ) AS reading_progress,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', collection.id, 'name', collection.name) ORDER BY collection.name)
          FROM collection_books membership
          JOIN collections collection ON collection.id = membership.collection_id
          WHERE membership.book_id = ${books.id} AND collection.user_id = ${user.id}
        ), '[]'::jsonb) AS collections,
        ${books.addedAt} AS added_at,
        ${books.updatedAt} AS updated_at,
        (${bookMetadata.coverSource} IS NOT NULL) AS has_cover,
        (library.organization_mode = 'book_per_file') AS book_per_file
      FROM ${bookDuplicateGroupMembers} member
      JOIN ${books} ON ${books.id} = member.book_id
      JOIN libraries library ON library.id = ${books.libraryId}
      LEFT JOIN ${bookMetadata} ON ${bookMetadata.bookId} = ${books.id}
      LEFT JOIN user_book_status read_status ON read_status.book_id = ${books.id} AND read_status.user_id = ${user.id}
      WHERE member.group_id IN (${sql.join(
        groupIds.map((id) => sql`${id}`),
        sql`, `,
      )})
        AND ${scope}
      ORDER BY member.group_id, ${bookMetadata.metadataScore} DESC NULLS LAST, ${books.id}
    `);
    return result.rows;
  }

  /** A page of scans for the Jobs area, in the view's keyset order. Nothing waits on a person, so Needs you is empty. */
  async pageForJobs(query: DuplicateScanPageQuery): Promise<DuplicateScanPageRow[]> {
    if (query.view === 'needs-you') return [];
    return query.view === 'queue' ? await this.scanQueuePage(query) : await this.settledScanPage(query);
  }

  /** How many scans each Jobs-area view holds, failed ones measured from `cutoffAt`. */
  async countForJobs(ownerId: number | null, cutoffAt: Date): Promise<DuplicateScanCounts> {
    const [row] = await this.db
      .select({
        running: sql<number>`count(*) filter (where ${bookDuplicateScans.status} = 'running')`.mapWith(Number),
        queued: sql<number>`count(*) filter (where ${bookDuplicateScans.status} = 'queued')`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${this.failedScanShown(cutoffAt)})`.mapWith(Number),
      })
      .from(bookDuplicateScans)
      .where(and(inArray(bookDuplicateScans.status, ['queued', 'running', 'failed']), this.scanOwned(ownerId)));
    const running = row?.running ?? 0;
    const queued = row?.queued ?? 0;
    return { queue: running + queued, failed: row?.failed ?? 0, running, queued };
  }

  /** Who owns each scan that exists, for answering actions on ids a client sent. */
  async findScanOwners(scanIds: readonly number[]): Promise<Map<number, number>> {
    if (scanIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: bookDuplicateScans.id, userId: bookDuplicateScans.userId })
      .from(bookDuplicateScans)
      .where(inArray(bookDuplicateScans.id, [...scanIds]));
    return new Map(rows.map((row) => [row.id, row.userId]));
  }

  /** Library names by id, for naming what a scan covered. */
  async findLibraryNames(libraryIds: readonly number[]): Promise<Map<number, string>> {
    if (libraryIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: libraries.id, name: libraries.name })
      .from(libraries)
      .where(inArray(libraries.id, [...libraryIds]));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /** The running scan, then queued ones in the order the worker takes them. */
  private async scanQueuePage(query: DuplicateScanPageQuery): Promise<DuplicateScanPageRow[]> {
    // Aliased: drizzle renders column references unqualified, which inside a subquery would bind to the wrong row.
    const line = this.db
      .$with('scan_line')
      .as(
        this.db
          .select({ lineId: sql<number>`scan_order.id`.as('line_id'), place: sql<number>`scan_order.place`.as('place') })
          .from(
            sql`(select q.id, row_number() over (order by q.created_at, q.id) as place from book_duplicate_scans q where q.status = 'queued') scan_order`,
          ),
      );
    const group = sql<number>`case when ${bookDuplicateScans.status} = 'running' then 0 else 1 end`;
    const rank = sql<number>`case when ${bookDuplicateScans.status} = 'queued' then coalesce(${line.place}, 2147483647) else 0 end`;
    const at = microseconds(sql`${bookDuplicateScans.createdAt}`);
    const columns: KeysetColumns = {
      prefix: [
        { kind: 'number', expr: group },
        { kind: 'number', expr: rank },
      ],
      suffix: [{ kind: 'number', expr: at }],
      id: { kind: 'number', expr: sql`${bookDuplicateScans.id}` },
    };
    const rows = await this.db
      .with(line)
      .select({
        ...SCAN_PAGE_COLUMNS,
        group: sql<number>`${group}`.mapWith(Number),
        rank: sql<number>`${rank}`.mapWith(Number),
        at,
        requesterName: users.name,
      })
      .from(bookDuplicateScans)
      .leftJoin(line, eq(line.lineId, bookDuplicateScans.id))
      .leftJoin(users, eq(users.id, bookDuplicateScans.userId))
      .where(
        and(
          inArray(bookDuplicateScans.status, ['queued', 'running']),
          this.scanOwned(query.ownerId),
          query.after ? afterPosition(columns, 'queue', query.after, query.typeIndex) : undefined,
        ),
      )
      .orderBy(...keysetOrder(columns, 'queue'))
      .limit(query.limit);
    return rows.map(({ group: band, rank: place, at: since, ...row }) => ({
      ...row,
      rank: place,
      key: { prefix: [band, place], suffix: [since], id: row.id },
    }));
  }

  /** Failed and History by when the scan ended, newest first. */
  private async settledScanPage(query: DuplicateScanPageQuery): Promise<DuplicateScanPageRow[]> {
    const columns: KeysetColumns = {
      prefix: [{ kind: 'time', expr: SCAN_FINISH }],
      suffix: [],
      id: { kind: 'number', expr: sql`${bookDuplicateScans.id}` },
    };
    const shown =
      query.view === 'failed'
        ? this.failedScanShown(query.cutoffAt)
        : or(eq(bookDuplicateScans.status, 'completed'), and(eq(bookDuplicateScans.status, 'failed'), lte(SCAN_FINISH, query.cutoffAt)));
    const rows = await this.db
      .select({ ...SCAN_PAGE_COLUMNS, finish: microseconds(SCAN_FINISH), requesterName: users.name })
      .from(bookDuplicateScans)
      .leftJoin(users, eq(users.id, bookDuplicateScans.userId))
      .where(and(shown, this.scanOwned(query.ownerId), query.after ? afterPosition(columns, query.view, query.after, query.typeIndex) : undefined))
      .orderBy(...keysetOrder(columns, query.view))
      .limit(query.limit);
    return rows.map(({ finish, ...row }) => ({ ...row, rank: 0, key: { prefix: [finish], suffix: [], id: row.id } }));
  }

  /** Failed and finished after the cutoff: what the Failed view still shows. */
  private failedScanShown(cutoffAt: Date): SQL {
    return and(eq(bookDuplicateScans.status, 'failed'), sql`${SCAN_FINISH} > ${cutoffAt}`)!;
  }

  private scanOwned(ownerId: number | null): SQL | undefined {
    return ownerId === null ? undefined : eq(bookDuplicateScans.userId, ownerId);
  }
}
