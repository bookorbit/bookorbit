import { Inject, Injectable } from '@nestjs/common';
import {
  AUDIO_FORMAT_LIST,
  type ContentFilterRules,
  type AudiobookChapterSource,
  type ChapterHealthCategory,
  type ChapterLookupQueueStatus,
  type ChapterLookupReviewSummary,
} from '@bookorbit/types';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import * as schema from '../../db/schema';
import { bookMetadata, books, chapterLookupQueue } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** A list is "numbered tracks" when at least this share of its titles are. */
const NUMBERED_SHARE = 0.8;

export interface ChapterHealthRow {
  bookId: number;
  title: string | null;
  authors: string[];
  libraryName: string;
  audioFiles: number;
  chapterCount: number;
  source: AudiobookChapterSource | null;
  audibleId: string | null;
  reviewReason: string | null;
  reviewResult: ChapterLookupReviewSummary | null;
}

const FINISHED_STATUSES: ChapterLookupQueueStatus[] = ['applied', 'review', 'not_found', 'failed', 'skipped'];

@Injectable()
export class ChapterHealthRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Every audiobook in the given libraries with the facts the categories are judged on. One pass
   * over the books, their audio files and the stored lists; the titles are only read for books
   * that have a list.
   */
  private visibleBooks(libraryIds: number[], filters?: ContentFilterRules) {
    return this.db
      .select({ id: books.id })
      .from(books)
      .where(and(inArray(books.libraryId, libraryIds), eq(books.status, 'present'), ...(filters ? buildContentFilterClauses(filters, this.db) : [])));
  }

  private shaped(libraryIds: number[], filters?: ContentFilterRules) {
    const audioFormats = sql.join(
      AUDIO_FORMAT_LIST.map((format) => sql`${format}`),
      sql`, `,
    );
    return sql`
      WITH audio AS (
        SELECT f.book_id, count(*)::int AS files
        FROM book_files f
        JOIN books b ON b.id = f.book_id
        WHERE b.library_id IN (${sql.join(
          libraryIds.map((id) => sql`${id}`),
          sql`, `,
        )})
          AND b.id IN (${this.visibleBooks(libraryIds, filters)})
          AND b.status = 'present'
          AND lower(f.format) IN (${audioFormats})
        GROUP BY f.book_id
      ),
      shaped AS (
        SELECT
          a.book_id,
          a.files,
          COALESCE(m.chapter_count, 0) AS chapter_count,
          COALESCE(m.numbered_chapter_count, 0) AS numbered,
          m.chapters_source AS source,
          NULLIF(btrim(m.audible_id), '') AS audible_id,
          m.chapters_updated_at,
          q.status AS queue_status,
          q.finished_at AS queue_finished_at,
          q.reason AS queue_reason,
          q.result AS queue_result
        FROM audio a
        LEFT JOIN book_metadata m ON m.book_id = a.book_id
        LEFT JOIN chapter_lookup_queue q ON q.book_id = a.book_id
      )`;
  }

  private category(category: ChapterHealthCategory): SQL {
    switch (category) {
      case 'no_chapters':
        return sql`chapter_count <= 1 AND files = 1`;
      case 'one_per_file':
        return sql`chapter_count = 0 AND files > 1`;
      case 'numbered_tracks':
        return sql`chapter_count >= 2 AND numbered >= chapter_count * ${NUMBERED_SHARE}::numeric`;
      case 'needs_review':
        // A review is settled once the book's chapters are saved after the lookup finished.
        return sql`queue_status = 'review' AND (chapters_updated_at IS NULL OR chapters_updated_at <= queue_finished_at)`;
      case 'edited':
        return sql`source = 'manual'`;
    }
  }

  async summarize(libraryIds: number[], filters?: ContentFilterRules): Promise<Record<ChapterHealthCategory, { total: number; withAsin: number }>> {
    const categories: ChapterHealthCategory[] = ['no_chapters', 'one_per_file', 'numbered_tracks', 'needs_review', 'edited'];
    const empty = Object.fromEntries(categories.map((category) => [category, { total: 0, withAsin: 0 }])) as Record<
      ChapterHealthCategory,
      { total: number; withAsin: number }
    >;
    if (libraryIds.length === 0) return empty;
    const columns = sql.join(
      categories.flatMap((category) => [
        sql`count(*) FILTER (WHERE ${this.category(category)})::int AS ${sql.identifier(`${category}_total`)}`,
        sql`count(*) FILTER (WHERE ${this.category(category)} AND audible_id IS NOT NULL)::int AS ${sql.identifier(`${category}_asin`)}`,
      ]),
      sql`, `,
    );
    const result = await this.db.execute<Record<string, number>>(sql`${this.shaped(libraryIds, filters)} SELECT ${columns} FROM shaped`);
    const row = result.rows[0] ?? {};
    for (const category of categories) {
      empty[category] = { total: Number(row[`${category}_total`] ?? 0), withAsin: Number(row[`${category}_asin`] ?? 0) };
    }
    return empty;
  }

  async list(
    libraryIds: number[],
    category: ChapterHealthCategory,
    offset: number,
    limit: number,
    filters?: ContentFilterRules,
  ): Promise<{ rows: ChapterHealthRow[]; total: number }> {
    if (libraryIds.length === 0) return { rows: [], total: 0 };
    const pageResult = await this.db.execute<{
      full_count: number;
      book_id: number;
      title: string | null;
      authors: string[] | null;
      library_name: string;
      files: number;
      chapter_count: number;
      source: AudiobookChapterSource | null;
      audible_id: string | null;
      queue_reason: string | null;
      queue_result: ChapterLookupReviewSummary | null;
    }>(sql`${this.shaped(libraryIds, filters)}
        SELECT count(*) OVER()::int AS full_count, s.book_id, m.title, l.name AS library_name, s.files, s.chapter_count, s.source, s.audible_id, s.queue_reason, s.queue_result,
          COALESCE((
            SELECT array_agg(author.name ORDER BY book_author.display_order, author.id)
            FROM book_authors book_author
            JOIN authors author ON author.id = book_author.author_id
            WHERE book_author.book_id = s.book_id
          ), ARRAY[]::varchar[]) AS authors
        FROM (SELECT * FROM shaped WHERE ${this.category(category)}) s
        JOIN books b ON b.id = s.book_id
        JOIN libraries l ON l.id = b.library_id
        LEFT JOIN book_metadata m ON m.book_id = s.book_id
        ORDER BY lower(m.title) NULLS LAST, s.book_id
        OFFSET ${offset} LIMIT ${limit}`);
    const total =
      pageResult.rows[0]?.full_count ??
      (
        await this.db.execute<{ total: number }>(
          sql`${this.shaped(libraryIds, filters)} SELECT count(*)::int AS total FROM shaped WHERE ${this.category(category)}`,
        )
      ).rows[0]?.total ??
      0;
    return {
      total: Number(total),
      rows: pageResult.rows.map((row) => ({
        bookId: row.book_id,
        title: row.title,
        authors: row.authors ?? [],
        libraryName: row.library_name,
        audioFiles: Number(row.files),
        chapterCount: Number(row.chapter_count),
        source: row.source,
        audibleId: row.audible_id,
        reviewReason: row.queue_reason,
        reviewResult: row.queue_result,
      })),
    };
  }

  /** Books of a category that a lookup can run on, capped so one request queues a bounded batch. */
  async findLookupCandidates(libraryIds: number[], category: ChapterHealthCategory, limit: number, filters?: ContentFilterRules): Promise<number[]> {
    if (libraryIds.length === 0) return [];
    const result = await this.db.execute<{ book_id: number }>(
      sql`${this.shaped(libraryIds, filters)} SELECT book_id FROM shaped WHERE ${this.category(category)} AND audible_id IS NOT NULL AND queue_status IS NULL ORDER BY book_id LIMIT ${limit}`,
    );
    return result.rows.map((row) => Number(row.book_id));
  }

  /** Of the given books, the ones in these libraries that have an ASIN. */
  async filterLookupCandidates(libraryIds: number[], bookIds: number[], filters?: ContentFilterRules): Promise<number[]> {
    if (libraryIds.length === 0 || bookIds.length === 0) return [];
    const rows = await this.db
      .select({ bookId: books.id })
      .from(books)
      .innerJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(
        and(
          inArray(books.id, bookIds),
          ...(filters ? buildContentFilterClauses(filters, this.db) : []),
          inArray(books.libraryId, libraryIds),
          eq(books.status, 'present'),
          sql`NULLIF(btrim(${bookMetadata.audibleId}), '') IS NOT NULL`,
          sql`EXISTS (SELECT 1 FROM book_files f WHERE f.book_id = ${books.id} AND lower(f.format) IN (${sql.join(
            AUDIO_FORMAT_LIST.map((format) => sql`${format}`),
            sql`, `,
          )}))`,
        ),
      );
    return rows.map((row) => row.bookId);
  }

  /** Queues the books for this user, replacing any earlier outcome they had. */
  async enqueue(bookIds: number[], userId: number): Promise<number> {
    if (bookIds.length === 0) return 0;
    const now = new Date();
    const queued = await this.db
      .insert(chapterLookupQueue)
      .values(bookIds.map((bookId) => ({ bookId, userId, status: 'queued' as const, createdAt: now, updatedAt: now, availableAt: now })))
      .onConflictDoUpdate({
        target: chapterLookupQueue.bookId,
        setWhere: sql`${chapterLookupQueue.status} NOT IN ('queued', 'processing')`,
        set: {
          userId,
          status: 'queued',
          reason: null,
          result: null,
          attemptCount: 0,
          lastError: null,
          createdAt: now,
          updatedAt: now,
          finishedAt: null,
          availableAt: now,
        },
      })
      .returning({ bookId: chapterLookupQueue.bookId });
    return queued.length;
  }

  async stateFor(userId: number, libraryIds: number[], filters?: ContentFilterRules) {
    if (libraryIds.length === 0) return { counts: new Map<ChapterLookupQueueStatus, number>(), processing: null };
    const visible = sql`${chapterLookupQueue.bookId} IN (${this.visibleBooks(libraryIds, filters)})`;
    const rows = await this.db
      .select({
        status: sql<ChapterLookupQueueStatus>`CASE WHEN ${chapterLookupQueue.status} = 'review' AND ${bookMetadata.chaptersUpdatedAt} > ${chapterLookupQueue.finishedAt} THEN 'skipped' ELSE ${chapterLookupQueue.status} END`,
        total: sql<number>`count(*)::int`,
      })
      .from(chapterLookupQueue)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, chapterLookupQueue.bookId))
      .where(and(eq(chapterLookupQueue.userId, userId), visible))
      .groupBy(
        sql`CASE WHEN ${chapterLookupQueue.status} = 'review' AND ${bookMetadata.chaptersUpdatedAt} > ${chapterLookupQueue.finishedAt} THEN 'skipped' ELSE ${chapterLookupQueue.status} END`,
      );
    const [processing] = await this.db
      .select({ bookId: chapterLookupQueue.bookId, title: bookMetadata.title })
      .from(chapterLookupQueue)
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, chapterLookupQueue.bookId))
      .where(and(eq(chapterLookupQueue.userId, userId), eq(chapterLookupQueue.status, 'processing'), visible))
      .limit(1);
    return { counts: new Map(rows.map((row) => [row.status, Number(row.total)])), processing: processing ?? null };
  }

  async removeQueued(userId: number): Promise<number> {
    const removed = await this.db
      .delete(chapterLookupQueue)
      .where(and(eq(chapterLookupQueue.userId, userId), eq(chapterLookupQueue.status, 'queued')))
      .returning({ bookId: chapterLookupQueue.bookId });
    return removed.length;
  }

  /** Clears finished outcomes, keeping the ones that still wait for a review. */
  async removeFinished(userId: number): Promise<number> {
    const removed = await this.db
      .delete(chapterLookupQueue)
      .where(
        and(
          eq(chapterLookupQueue.userId, userId),
          inArray(chapterLookupQueue.status, FINISHED_STATUSES),
          sql`(${chapterLookupQueue.status} <> 'review' OR EXISTS (SELECT 1 FROM book_metadata m WHERE m.book_id = ${chapterLookupQueue.bookId} AND m.chapters_updated_at > ${chapterLookupQueue.finishedAt}))`,
        ),
      )
      .returning({ bookId: chapterLookupQueue.bookId });
    return removed.length;
  }

  async dismissReview(bookId: number, libraryIds: number[], filters?: ContentFilterRules): Promise<boolean> {
    if (libraryIds.length === 0) return false;
    const removed = await this.db
      .delete(chapterLookupQueue)
      .where(
        and(
          eq(chapterLookupQueue.bookId, bookId),
          eq(chapterLookupQueue.status, 'review'),
          sql`${chapterLookupQueue.bookId} IN (${this.visibleBooks(libraryIds, filters)})`,
        ),
      )
      .returning({ bookId: chapterLookupQueue.bookId });
    return removed.length > 0;
  }

  // ── Worker ──────────────────────────────────────────────────────────────────

  /** A restart leaves nothing half done: whatever was running goes back to waiting. */
  async requeueProcessing(staleOnly = false): Promise<void> {
    await this.db
      .update(chapterLookupQueue)
      .set({ status: 'queued', updatedAt: new Date() })
      .where(
        and(
          eq(chapterLookupQueue.status, 'processing'),
          ...(staleOnly ? [sql`${chapterLookupQueue.updatedAt} < now() - interval '15 minutes'`] : []),
        ),
      );
  }

  /** Takes the oldest waiting book, safe against a second worker taking the same one. */
  async claimNext(): Promise<{ bookId: number; userId: number | null; attemptCount: number; claimToken: string } | null> {
    const result = await this.db.execute<{ book_id: number; user_id: number | null; attempt_count: number; claim_token: string }>(sql`
      UPDATE chapter_lookup_queue
      SET status = 'processing', attempt_count = attempt_count + 1, updated_at = now(), claim_token = gen_random_uuid()
      WHERE book_id = (
        SELECT book_id FROM chapter_lookup_queue
        WHERE status = 'queued' AND available_at <= now()
        ORDER BY created_at, book_id LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING book_id, user_id, attempt_count, claim_token`);
    const row = result.rows[0];
    return row
      ? {
          bookId: Number(row.book_id),
          userId: row.user_id === null ? null : Number(row.user_id),
          attemptCount: Number(row.attempt_count),
          claimToken: row.claim_token,
        }
      : null;
  }

  async finish(
    bookId: number,
    outcome: { status: ChapterLookupQueueStatus; reason: string | null; result: ChapterLookupReviewSummary | null; lastError?: string | null },
    claimToken: string,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(chapterLookupQueue)
      .set({
        status: outcome.status,
        reason: outcome.reason,
        result: outcome.result,
        lastError: outcome.lastError ?? null,
        updatedAt: now,
        finishedAt: now,
      })
      .where(and(eq(chapterLookupQueue.bookId, bookId), eq(chapterLookupQueue.status, 'processing'), eq(chapterLookupQueue.claimToken, claimToken)));
  }

  /** Puts a book back to wait after a failure worth retrying; it keeps its place but is not tried before `delayMs`. */
  async retryLater(bookId: number, lastError: string, delayMs: number, claimToken: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(chapterLookupQueue)
      .set({ status: 'queued', lastError, updatedAt: now, availableAt: new Date(now.getTime() + delayMs) })
      .where(and(eq(chapterLookupQueue.bookId, bookId), eq(chapterLookupQueue.status, 'processing'), eq(chapterLookupQueue.claimToken, claimToken)));
  }
}
