import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { BookDuplicateMatchReason } from '@bookorbit/types';

import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import type { RequestUser } from '../../common/types/request-user';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  bookDuplicateGroupMembers,
  bookDuplicateGroups,
  bookDuplicatePairs,
  bookDuplicateScanKeys,
  bookDuplicateScans,
  bookFiles,
  bookMetadata,
  books,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type ScanRow = typeof bookDuplicateScans.$inferSelect;

const BOOK_DUPLICATE_SCAN_LOCK_NAMESPACE = 1_112_493_899;

type PreviewRow = {
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
};

@Injectable()
export class BookDuplicatesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  private scopeWhere(libraryIds: number[], user: RequestUser): SQL {
    if (libraryIds.length === 0) return sql`false`;
    const clauses: SQL[] = [inArray(books.libraryId, libraryIds), ne(books.status, 'processing')];
    if (!user.isSuperuser) clauses.push(...buildContentFilterClauses(user.contentFilters, this.db));
    return and(...clauses)!;
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
    await this.db.execute(sql`
      INSERT INTO ${bookDuplicateScanKeys} (scan_id, book_id, kind, value)
      SELECT
        CAST(${scanId} AS integer),
        ${books.id},
        'file_hash',
        array_to_string(
          array_agg(
            lower(btrim(${bookFiles.fileHash})) || ':' || ${bookFiles.sizeBytes}::text
            ORDER BY lower(btrim(${bookFiles.fileHash})), ${bookFiles.sizeBytes}, ${bookFiles.id}
          ),
          chr(30)
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
    `);
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
    await this.db.execute(sql`
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
              SELECT DISTINCT CASE
                WHEN lower(coalesce(f.format, '')) IN ('m4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac') THEN 'audiobook'
                WHEN lower(coalesce(f.format, '')) IN ('cbz', 'cbr', 'cb7', 'cbx') THEN 'comic'
                WHEN lower(coalesce(f.format, '')) IN ('epub', 'pdf', 'mobi', 'azw', 'azw3', 'fb2', 'kepub') THEN 'ebook'
                ELSE 'unknown'
              END AS family
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
        eligible.title_key || chr(31) || array_to_string(eligible.author_keys, chr(30)) || chr(31) || family
      FROM eligible
      CROSS JOIN LATERAL unnest(eligible.families) AS family
      WHERE eligible.title_key <> '' AND cardinality(eligible.author_keys) > 0
      ON CONFLICT DO NOTHING
    `);
  }

  async createExactPairs(scanId: number): Promise<void> {
    await this.db.execute(sql`
      WITH keyed AS (
        SELECT
          kind,
          value,
          book_id,
          min(book_id) OVER (PARTITION BY kind, value) AS anchor_id
        FROM ${bookDuplicateScanKeys}
        WHERE scan_id = ${scanId}
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
      ON CONFLICT (scan_id, book_id_a, book_id_b) DO UPDATE
      SET reasons = ARRAY(
        SELECT DISTINCT reason
        FROM unnest(book_duplicate_pairs.reasons || EXCLUDED.reasons) AS reason
        ORDER BY reason
      )
    `);
  }

  async createFuzzyPairs(scanId: number, libraryIds: number[], user: RequestUser, similarityPercent: number): Promise<void> {
    const scope = this.scopeWhere(libraryIds, user);
    const threshold = similarityPercent / 100;
    await this.db.execute(sql`
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
              SELECT DISTINCT CASE
                WHEN lower(coalesce(f.format, '')) IN ('m4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac') THEN 'audiobook'
                WHEN lower(coalesce(f.format, '')) IN ('cbz', 'cbr', 'cb7', 'cbx') THEN 'comic'
                WHEN lower(coalesce(f.format, '')) IN ('epub', 'pdf', 'mobi', 'azw', 'azw3', 'fb2', 'kepub') THEN 'ebook'
                ELSE 'unknown'
              END AS family
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
      ON CONFLICT (scan_id, book_id_a, book_id_b) DO UPDATE
      SET
        reasons = ARRAY(
          SELECT DISTINCT reason
          FROM unnest(book_duplicate_pairs.reasons || EXCLUDED.reasons) AS reason
          ORDER BY reason
        ),
        title_similarity = GREATEST(book_duplicate_pairs.title_similarity, EXCLUDED.title_similarity)
    `);
  }

  async finalizeGroups(scanId: number): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`CREATE TEMP TABLE tmp_book_duplicate_components (book_id integer PRIMARY KEY, root_id integer NOT NULL) ON COMMIT DROP`);
      await tx.execute(sql`
        INSERT INTO tmp_book_duplicate_components (book_id, root_id)
        SELECT book_id, book_id
        FROM (
          SELECT book_id_a AS book_id FROM ${bookDuplicatePairs} WHERE scan_id = ${scanId}
          UNION
          SELECT book_id_b AS book_id FROM ${bookDuplicatePairs} WHERE scan_id = ${scanId}
        ) endpoints
      `);

      for (;;) {
        const result = await tx.execute(sql`
          WITH neighbor_roots AS (
            SELECT component.book_id, min(neighbor.root_id) AS new_root
            FROM tmp_book_duplicate_components component
            JOIN ${bookDuplicatePairs} pair
              ON pair.scan_id = ${scanId}
              AND (pair.book_id_a = component.book_id OR pair.book_id_b = component.book_id)
            JOIN tmp_book_duplicate_components neighbor
              ON neighbor.book_id = CASE WHEN pair.book_id_a = component.book_id THEN pair.book_id_b ELSE pair.book_id_a END
            GROUP BY component.book_id
          )
          UPDATE tmp_book_duplicate_components component
          SET root_id = neighbor_roots.new_root
          FROM neighbor_roots
          WHERE component.book_id = neighbor_roots.book_id
            AND neighbor_roots.new_root < component.root_id
        `);
        if ((result.rowCount ?? 0) === 0) break;
      }

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
          WHERE pair.scan_id = ${scanId}
          GROUP BY component.root_id
        )
        INSERT INTO ${bookDuplicateGroups} (scan_id, root_book_id, reasons, max_title_similarity, member_count)
        SELECT CAST(${scanId} AS integer), member_counts.root_id, reason_stats.reasons, reason_stats.max_title_similarity, member_counts.member_count
        FROM member_counts
        JOIN reason_stats USING (root_id)
      `);

      await tx.execute(sql`
        INSERT INTO ${bookDuplicateGroupMembers} (group_id, scan_id, book_id)
        SELECT duplicate_group.id, CAST(${scanId} AS integer), component.book_id
        FROM tmp_book_duplicate_components component
        JOIN ${bookDuplicateGroups} duplicate_group
          ON duplicate_group.scan_id = ${scanId}
          AND duplicate_group.root_book_id = component.root_id
      `);

      await tx.execute(sql`
        UPDATE ${bookDuplicatePairs} pair
        SET group_id = duplicate_group.id
        FROM tmp_book_duplicate_components component
        JOIN ${bookDuplicateGroups} duplicate_group
          ON duplicate_group.scan_id = ${scanId}
          AND duplicate_group.root_book_id = component.root_id
        WHERE pair.scan_id = ${scanId}
          AND component.book_id = pair.book_id_a
      `);

      const [row] = await tx.select({ count: count() }).from(bookDuplicateGroups).where(eq(bookDuplicateGroups.scanId, scanId));
      return row?.count ?? 0;
    });
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

  async findGroups(scanId: number, page: number, pageSize: number, libraryIds: number[], user: RequestUser, reason?: BookDuplicateMatchReason) {
    const accessibleGroupIds = this.db
      .select({ groupId: bookDuplicateGroupMembers.groupId })
      .from(bookDuplicateGroupMembers)
      .innerJoin(books, eq(books.id, bookDuplicateGroupMembers.bookId))
      .where(and(eq(bookDuplicateGroupMembers.scanId, scanId), this.scopeWhere(libraryIds, user)))
      .groupBy(bookDuplicateGroupMembers.groupId)
      .having(sql`count(*) >= 2`);
    const reasonFilter = reason ? sql`${reason} = ANY(${bookDuplicateGroups.reasons})` : sql`true`;
    const where = and(eq(bookDuplicateGroups.scanId, scanId), inArray(bookDuplicateGroups.id, accessibleGroupIds), reasonFilter)!;
    const [countRow] = await this.db.select({ count: count() }).from(bookDuplicateGroups).where(where);
    const groups = await this.db
      .select()
      .from(bookDuplicateGroups)
      .where(where)
      .orderBy(desc(bookDuplicateGroups.memberCount), bookDuplicateGroups.id)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { groups, total: countRow?.count ?? 0 };
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
        (${bookMetadata.coverSource} IS NOT NULL) AS has_cover
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
}
