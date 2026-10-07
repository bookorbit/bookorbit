import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { AUDIO_FORMAT_LIST, BOOK_FORMATS, isAudioFormat, type NotebookEntryKind } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  annotationPositions,
  annotations,
  authors,
  bookAuthors,
  bookFiles,
  bookJournalEntries,
  bookMetadata,
  bookmarks,
  books,
  libraries,
  userBookNotes,
  userBookRatings,
} from '../../db/schema';
import type { NotebookCursor } from './notebook-cursor';
import type { NotebookEntryFilters, NotebookScope } from './notebook-filters';
import type { NotebookBookmarkRow, NotebookHighlightRow, NotebookJournalRow, NotebookLabelRow, NotebookReviewRow } from './notebook-mapper';
import {
  NOTEBOOK_SOURCES,
  armWhereSql,
  bookActivitySql,
  dailyReviewSql,
  firstEntryAtSql,
  inRangesSql,
  keysetUnionSql,
  latestEntryPerBookSql,
  overviewSql,
  seededReviewSql,
  sortColumnSql,
  type NotebookDirection,
  type NotebookSortColumn,
  type NotebookStatus,
} from './notebook-sql';

type Db = NodePgDatabase<typeof schema>;

/** Where an entry sits in a listing, before its row is loaded. */
export interface NotebookEntryKey {
  kindRank: number;
  id: number;
  bookId: number;
  sortKey: string;
}

export interface NotebookOverviewRow {
  highlights: number;
  journal: number;
  bookmarks: number;
  reviews: number;
  starred: number;
  withNotes: number;
  approximate: number;
  books: number;
  colors: { color: string; count: number }[];
  origins: { origin: string; count: number }[];
}

export interface NotebookBookActivityRow {
  bookId: number;
  highlights: number;
  journal: number;
  bookmarks: number;
  hasReview: boolean;
  lastKey: string;
}

type RawKeyRow = { kind_rank: number; id: number; book_id: number; sort_key: string };

const READABLE_FORMATS = BOOK_FORMATS.filter((format) => !isAudioFormat(format));

function sqlList(values: readonly string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

/**
 * The file Open in Book opens: the book's primary file when it is readable, otherwise its best
 * readable content file by the default format priority. Audio never qualifies.
 */
function readFileSql<T>(pick: SQL): SQL<T> {
  return sql<T>`(
    select ${pick} from ${bookFiles}
    where ${bookFiles.bookId} = ${books.id}
      and ${bookFiles.role} in ('content', 'primary')
      and lower(${bookFiles.format}) in (${sqlList(READABLE_FORMATS)})
    order by coalesce(${bookFiles.id} = ${books.primaryFileId}, false) desc,
      array_position(array[${sqlList(READABLE_FORMATS)}]::text[], lower(${bookFiles.format})),
      ${bookFiles.sortOrder} asc nulls last,
      ${bookFiles.id} asc
    limit 1
  )`;
}

function toKey(row: RawKeyRow): NotebookEntryKey {
  return {
    kindRank: Number(row.kind_rank),
    id: Number(row.id),
    bookId: Number(row.book_id),
    sortKey: row.sort_key,
  };
}

@Injectable()
export class NotebookRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findEntryKeys(
    scope: NotebookScope,
    params: {
      kinds: readonly NotebookEntryKind[];
      status: NotebookStatus;
      filters?: NotebookEntryFilters;
      sortColumn: NotebookSortColumn;
      direction: NotebookDirection;
      cursor?: NotebookCursor;
      limit: number;
    },
  ): Promise<NotebookEntryKey[]> {
    if (params.kinds.length === 0 || scope.libraryIds.length === 0) return [];
    const arms = params.kinds.map((kind) => {
      const source = NOTEBOOK_SOURCES[kind];
      return {
        source,
        sortTs: sortColumnSql(source, params.sortColumn),
        where: armWhereSql(source, scope, this.db, { status: params.status, filters: params.filters }),
      };
    });
    const result = await this.db.execute<RawKeyRow>(
      keysetUnionSql(arms, { direction: params.direction, limit: params.limit, cursor: params.cursor }),
    );
    return result.rows.map(toKey);
  }

  async findOnThisDayKeys(scope: NotebookScope, params: { ranges: { start: string; end: string }[]; limit: number }): Promise<NotebookEntryKey[]> {
    if (params.ranges.length === 0 || scope.libraryIds.length === 0) return [];
    const arms = Object.values(NOTEBOOK_SOURCES).map((source) => ({
      source,
      sortTs: source.writtenAt,
      where: armWhereSql(source, scope, this.db, { status: 'active', extra: [inRangesSql(source.writtenAt, params.ranges)] }),
    }));
    const result = await this.db.execute<RawKeyRow>(keysetUnionSql(arms, { direction: 'desc', limit: params.limit }));
    return result.rows.map(toKey);
  }

  /** The reader's oldest active entry of any kind, as a sort key, or null with no history. */
  async findFirstEntryAt(userId: number): Promise<string | null> {
    const result = await this.db.execute<{ first_at: string | null }>(firstEntryAtSql(userId));
    return result.rows[0]?.first_at ?? null;
  }

  async findOverview(scope: NotebookScope, filters: NotebookEntryFilters, kinds: readonly NotebookEntryKind[]): Promise<NotebookOverviewRow> {
    const result = await this.db.execute<{
      highlights: number;
      journal: number;
      bookmarks: number;
      reviews: number;
      starred: number;
      with_notes: number;
      approximate: number;
      books: number;
      colors: { color: string; count: number }[] | null;
      origins: { origin: string; count: number }[] | null;
    }>(overviewSql(scope, this.db, filters, kinds));
    const row = result.rows[0];
    return {
      highlights: Number(row?.highlights ?? 0),
      journal: Number(row?.journal ?? 0),
      bookmarks: Number(row?.bookmarks ?? 0),
      reviews: Number(row?.reviews ?? 0),
      starred: Number(row?.starred ?? 0),
      withNotes: Number(row?.with_notes ?? 0),
      approximate: Number(row?.approximate ?? 0),
      books: Number(row?.books ?? 0),
      colors: (row?.colors ?? []).map((entry) => ({ color: entry.color, count: Number(entry.count) })),
      origins: (row?.origins ?? []).map((entry) => ({ origin: entry.origin, count: Number(entry.count) })),
    };
  }

  async findBookActivity(
    scope: NotebookScope,
    params: { searchPattern?: string; cursor?: NotebookCursor; limit: number },
  ): Promise<NotebookBookActivityRow[]> {
    if (scope.libraryIds.length === 0) return [];
    const result = await this.db.execute<{
      book_id: number;
      highlights: number;
      journal: number;
      bookmarks: number;
      has_review: boolean | null;
      last_key: string;
    }>(bookActivitySql(scope, this.db, params));
    return result.rows.map((row) => ({
      bookId: Number(row.book_id),
      highlights: Number(row.highlights),
      journal: Number(row.journal),
      bookmarks: Number(row.bookmarks),
      hasReview: row.has_review === true,
      lastKey: row.last_key,
    }));
  }

  async findLatestEntryPerBook(userId: number, bookIds: readonly number[]): Promise<NotebookEntryKey[]> {
    if (bookIds.length === 0) return [];
    const result = await this.db.execute<RawKeyRow>(latestEntryPerBookSql(userId, bookIds));
    return result.rows.map(toKey);
  }

  /** Every active highlight colour per book with its count, heaviest first. */
  async findColorMix(userId: number, bookIds: readonly number[]): Promise<{ bookId: number; color: string; count: number }[]> {
    if (bookIds.length === 0) return [];
    const total = sql<number>`count(*)::int`;
    return this.db
      .select({ bookId: annotations.bookId, color: annotations.color, count: total })
      .from(annotations)
      .where(and(eq(annotations.userId, userId), isNull(annotations.deletedAt), inArray(annotations.bookId, [...bookIds])))
      .groupBy(annotations.bookId, annotations.color)
      .orderBy(asc(annotations.bookId), desc(total), asc(annotations.color));
  }

  async findDailyReview(scope: NotebookScope, params: { date: string; olderThan: string; limit: number }): Promise<{ id: number; bookId: number }[]> {
    if (scope.libraryIds.length === 0) return [];
    const result = await this.db.execute<{ id: number; book_id: number }>(dailyReviewSql(scope, this.db, params));
    return result.rows.map((row) => ({ id: Number(row.id), bookId: Number(row.book_id) }));
  }

  async findSeededReview(
    scope: NotebookScope,
    params: { filters: NotebookEntryFilters; seed: number; limit: number },
  ): Promise<{ id: number; bookId: number }[]> {
    if (scope.libraryIds.length === 0) return [];
    const result = await this.db.execute<{ id: number; book_id: number }>(seededReviewSql(scope, this.db, params));
    return result.rows.map((row) => ({ id: Number(row.id), bookId: Number(row.book_id) }));
  }

  async findHighlights(userId: number, ids: readonly number[]): Promise<NotebookHighlightRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select({
        id: annotations.id,
        bookId: annotations.bookId,
        text: annotations.text,
        color: annotations.color,
        style: annotations.style,
        note: annotations.note,
        chapterTitle: annotations.chapterTitle,
        origin: annotations.origin,
        sourceCreatedAt: annotations.sourceCreatedAt,
        createdAt: annotations.createdAt,
        updatedAt: annotations.updatedAt,
        deletedAt: annotations.deletedAt,
        starredAt: annotations.starredAt,
        cfi: annotationPositions.pos0,
        cfiStatus: annotationPositions.status,
      })
      .from(annotations)
      .leftJoin(annotationPositions, and(eq(annotationPositions.annotationId, annotations.id), eq(annotationPositions.format, 'cfi')))
      .where(and(eq(annotations.userId, userId), inArray(annotations.id, [...ids])));
  }

  async findJournal(userId: number, ids: readonly number[]): Promise<NotebookJournalRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select({
        id: bookJournalEntries.id,
        clientId: bookJournalEntries.clientId,
        bookId: bookJournalEntries.bookId,
        body: bookJournalEntries.body,
        quote: bookJournalEntries.quote,
        chapterTitle: bookJournalEntries.chapterTitle,
        positionPercent: bookJournalEntries.positionPercent,
        cfi: bookJournalEntries.cfi,
        positionSeconds: bookJournalEntries.positionSeconds,
        createdAt: bookJournalEntries.createdAt,
        updatedAt: bookJournalEntries.updatedAt,
        deletedAt: bookJournalEntries.deletedAt,
      })
      .from(bookJournalEntries)
      .where(and(eq(bookJournalEntries.userId, userId), inArray(bookJournalEntries.id, [...ids])));
  }

  async findBookmarks(userId: number, ids: readonly number[]): Promise<NotebookBookmarkRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select({
        id: bookmarks.id,
        clientId: bookmarks.clientId,
        bookId: bookmarks.bookId,
        title: bookmarks.title,
        note: bookmarks.note,
        cfi: bookmarks.cfi,
        positionSeconds: bookmarks.positionSeconds,
        origin: bookmarks.origin,
        createdAt: bookmarks.createdAt,
        updatedAt: bookmarks.updatedAt,
        deletedAt: bookmarks.deletedAt,
      })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), inArray(bookmarks.id, [...ids])));
  }

  async findReviews(userId: number, bookIds: readonly number[]): Promise<NotebookReviewRow[]> {
    if (bookIds.length === 0) return [];
    return this.db
      .select({
        bookId: userBookNotes.bookId,
        note: userBookNotes.note,
        updatedAt: userBookNotes.updatedAt,
        rating: userBookRatings.rating,
      })
      .from(userBookNotes)
      .leftJoin(userBookRatings, and(eq(userBookRatings.userId, userBookNotes.userId), eq(userBookRatings.bookId, userBookNotes.bookId)))
      .where(and(eq(userBookNotes.userId, userId), inArray(userBookNotes.bookId, [...bookIds])));
  }

  /** One row per book for the label sidecar; cover slots are loaded separately by the cover store. */
  async findLabels(bookIds: readonly number[]): Promise<NotebookLabelRow[]> {
    if (bookIds.length === 0) return [];
    return this.db
      .select({
        id: books.id,
        title: bookMetadata.title,
        author: sql<string | null>`(
          select string_agg(${authors.name}, ', ' order by ${bookAuthors.displayOrder}, ${authors.id})
          from ${bookAuthors} inner join ${authors} on ${authors.id} = ${bookAuthors.authorId}
          where ${bookAuthors.bookId} = ${books.id}
        )`,
        coverSource: bookMetadata.coverSource,
        coverAspectRatio: libraries.coverAspectRatio,
        updatedAt: books.updatedAt,
        readFileId: readFileSql<number | null>(sql`${bookFiles.id}`),
        readFileFormat: readFileSql<string | null>(sql`lower(${bookFiles.format})`),
        hasAudio: sql<boolean>`exists (
          select 1 from ${bookFiles}
          where ${bookFiles.bookId} = ${books.id}
            and ${bookFiles.role} in ('content', 'primary')
            and lower(${bookFiles.format}) in (${sqlList(AUDIO_FORMAT_LIST)})
        )`,
      })
      .from(books)
      .innerJoin(libraries, eq(libraries.id, books.libraryId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(inArray(books.id, [...bookIds]));
  }
}
