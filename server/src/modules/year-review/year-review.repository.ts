import { Inject, Injectable } from '@nestjs/common';
import { type SQL, and, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ContentFilterRules, YearReviewBook, YearReviewFinishedBook } from '@bookorbit/types';

import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  annotations,
  authors,
  bookAuthors,
  bookGenres,
  bookMetadata,
  books,
  genres,
  readingAttempts,
  readingSessions,
  userBookRatings,
} from '../../db/schema';
import { finishedReadScope } from '../user-book-status/finished-read-scope';
import type { YearSessionInput } from './year-review.calculations';

/** Who is asking and what they may see. `libraryIds` null means every library (a superuser). */
export interface YearReviewScope {
  userId: number;
  libraryIds: number[] | null;
  contentFilters: ContentFilterRules | undefined;
}

/** The year as instants (`start` inclusive, `end` exclusive) and as local days (`until` exclusive). */
export interface YearReviewWindow {
  start: Date;
  end: Date;
  from: string;
  until: string;
}

export interface YearReviewSessionRow extends YearSessionInput {
  id: number;
}

export interface YearReviewHighlightRow {
  annotationId: number;
  bookId: number;
  text: string;
  note: string | null;
  chapterTitle: string | null;
  color: string;
  createdAt: string;
  starred: boolean;
}

type Row = Record<string, unknown>;

const num = (value: unknown): number => (value == null ? 0 : Number(value));
const numOrNull = (value: unknown): number | null => (value == null ? null : Number(value));
const str = (value: unknown): string | null => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null);
const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === 'string' || typeof value === 'number' ? new Date(value).toISOString() : null;
const names = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

/** How many ids go into one `in (...)` list. */
const ID_CHUNK = 500;

@Injectable()
export class YearReviewRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private libraryClause(libraryIds: number[] | null): SQL | undefined {
    if (libraryIds === null) return undefined;
    if (libraryIds.length === 0) return sql`false`;
    return sql`${books.libraryId} in (${sql.join(
      libraryIds.map((id) => sql`${id}`),
      sql`, `,
    )})`;
  }

  private contentClauses(scope: YearReviewScope): SQL[] {
    return scope.contentFilters ? buildContentFilterClauses(scope.contentFilters, this.db) : [];
  }

  /** Sessions overlapping the window, by id, the way Activity pages through them. */
  async getSessionPage(scope: YearReviewScope, window: YearReviewWindow, afterId: number, limit: number): Promise<YearReviewSessionRow[]> {
    const rows = await this.db
      .select({
        id: readingSessions.id,
        bookId: readingSessions.bookId,
        sessionType: readingSessions.sessionType,
        startedAt: readingSessions.startedAt,
        endedAt: readingSessions.endedAt,
        durationSeconds: readingSessions.durationSeconds,
        progressDelta: readingSessions.progressDelta,
      })
      .from(readingSessions)
      .innerJoin(books, sql`${books.id} = ${readingSessions.bookId}`)
      .where(
        and(
          sql`${readingSessions.userId} = ${scope.userId}`,
          sql`${readingSessions.id} > ${afterId}`,
          sql`${readingSessions.startedAt} < ${window.end}`,
          sql`${readingSessions.endedAt} > ${window.start}`,
          this.libraryClause(scope.libraryIds),
        ),
      )
      .orderBy(readingSessions.id)
      .limit(limit);
    return rows;
  }

  /** Each book finished in the window once, at its first finish there, oldest first. */
  async getFinishedBooks(scope: YearReviewScope, window: YearReviewWindow): Promise<YearReviewFinishedBook[]> {
    const result = await this.db.execute(sql`
      select distinct on (coalesce(${readingAttempts.bookId}, -${readingAttempts.id}))
        ${readingAttempts.id} as id,
        ${readingAttempts.bookId} as book_id,
        coalesce(${bookMetadata.title}, ${readingAttempts.bookTitleSnapshot}) as title,
        case when ${readingAttempts.bookId} is null then coalesce(${readingAttempts.bookAuthorsSnapshot}::json, '[]'::json)
          else coalesce((
            select json_agg(${authors.name} order by ${bookAuthors.displayOrder})
            from ${bookAuthors} join ${authors} on ${authors.id} = ${bookAuthors.authorId}
            where ${bookAuthors.bookId} = ${readingAttempts.bookId}
          ), '[]'::json) end as authors,
        ${bookMetadata.coverSource} is not null as has_cover,
        ${bookMetadata.updatedAt} as cover_version,
        ${readingAttempts.endedOn}::text as ended_on,
        coalesce(${bookMetadata.pageCount}, ${readingAttempts.bookPageCountSnapshot}) as page_count,
        coalesce(${readingAttempts.rating}, ${userBookRatings.rating}) as rating
      from ${readingAttempts}
      left join ${books} on ${books.id} = ${readingAttempts.bookId}
      left join ${bookMetadata} on ${bookMetadata.bookId} = ${readingAttempts.bookId}
      left join ${userBookRatings} on ${userBookRatings.userId} = ${scope.userId} and ${userBookRatings.bookId} = ${readingAttempts.bookId}
      where ${and(
        sql`${readingAttempts.userId} = ${scope.userId}`,
        sql`${readingAttempts.outcome} = 'completed'`,
        sql`${readingAttempts.deletedAt} is null`,
        sql`${readingAttempts.endedOn} >= ${window.from}`,
        sql`${readingAttempts.endedOn} < ${window.until}`,
        finishedReadScope(scope.libraryIds, this.contentClauses(scope)),
      )}
      order by coalesce(${readingAttempts.bookId}, -${readingAttempts.id}), ${readingAttempts.endedOn}, ${readingAttempts.id}
    `);
    return (result.rows as Row[])
      .map((row) => ({
        attemptId: num(row.id),
        bookId: numOrNull(row.book_id),
        title: str(row.title),
        authors: names(row.authors),
        hasCover: row.book_id != null && row.has_cover === true,
        coverVersion: row.book_id == null ? null : iso(row.cover_version),
        endedOn: String(row.ended_on).slice(0, 10),
        pageCount: numOrNull(row.page_count),
        rating: numOrNull(row.rating),
      }))
      .sort((a, b) => a.endedOn.localeCompare(b.endedOn) || a.attemptId - b.attemptId)
      .map((book) => ({
        bookId: book.bookId,
        title: book.title,
        authors: book.authors,
        hasCover: book.hasCover,
        coverVersion: book.coverVersion,
        endedOn: book.endedOn,
        pageCount: book.pageCount,
        rating: book.rating,
      }));
  }

  /** Title, authors and cover of each book, keyed by id. */
  async getBooks(bookIds: readonly number[]): Promise<Map<number, YearReviewBook>> {
    const byId = new Map<number, YearReviewBook>();
    for (const chunk of chunks(bookIds)) {
      const result = await this.db.execute(sql`
        select ${books.id} as book_id,
          ${bookMetadata.title} as title,
          coalesce((
            select json_agg(${authors.name} order by ${bookAuthors.displayOrder})
            from ${bookAuthors} join ${authors} on ${authors.id} = ${bookAuthors.authorId}
            where ${bookAuthors.bookId} = ${books.id}
          ), '[]'::json) as authors,
          ${bookMetadata.coverSource} is not null as has_cover,
          ${bookMetadata.updatedAt} as cover_version
        from ${books}
        left join ${bookMetadata} on ${bookMetadata.bookId} = ${books.id}
        where ${books.id} in (${sql.join(
          chunk.map((id) => sql`${id}`),
          sql`, `,
        )})
      `);
      for (const row of result.rows as Row[]) {
        const bookId = num(row.book_id);
        byId.set(bookId, {
          bookId,
          title: str(row.title),
          authors: names(row.authors),
          hasCover: row.has_cover === true,
          coverVersion: iso(row.cover_version),
        });
      }
    }
    return byId;
  }

  async getGenresByBook(bookIds: readonly number[]): Promise<Map<number, string[]>> {
    const byBook = new Map<number, string[]>();
    for (const chunk of chunks(bookIds)) {
      const rows = await this.db
        .select({ bookId: bookGenres.bookId, name: genres.name })
        .from(bookGenres)
        .innerJoin(genres, sql`${genres.id} = ${bookGenres.genreId}`)
        .where(
          sql`${bookGenres.bookId} in (${sql.join(
            chunk.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
      for (const row of rows) byBook.set(row.bookId, [...(byBook.get(row.bookId) ?? []), row.name]);
    }
    return byBook;
  }

  async getAuthorsByBook(bookIds: readonly number[]): Promise<Map<number, Array<{ authorId: number; name: string; hasPhoto: boolean }>>> {
    const byBook = new Map<number, Array<{ authorId: number; name: string; hasPhoto: boolean }>>();
    for (const chunk of chunks(bookIds)) {
      const rows = await this.db
        .select({ bookId: bookAuthors.bookId, authorId: authors.id, name: authors.name, hasPhoto: authors.hasPhoto })
        .from(bookAuthors)
        .innerJoin(authors, sql`${authors.id} = ${bookAuthors.authorId}`)
        .where(
          sql`${bookAuthors.bookId} in (${sql.join(
            chunk.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
      for (const row of rows) {
        byBook.set(row.bookId, [...(byBook.get(row.bookId) ?? []), { authorId: row.authorId, name: row.name, hasPhoto: row.hasPhoto }]);
      }
    }
    return byBook;
  }

  /** Highlights made in the window, what the year's highlights are drawn from. */
  private highlightWhere(scope: YearReviewScope, window: YearReviewWindow): SQL {
    const madeAt = sql`coalesce(${annotations.sourceCreatedAt}, ${annotations.createdAt})`;
    return and(
      sql`${annotations.userId} = ${scope.userId}`,
      sql`${annotations.deletedAt} is null`,
      sql`${annotations.style} <> 'strikethrough'`,
      sql`char_length(btrim(${annotations.text})) > 0`,
      sql`${madeAt} >= ${window.start}`,
      sql`${madeAt} < ${window.end}`,
      this.libraryClause(scope.libraryIds),
      ...this.contentClauses(scope),
    )!;
  }

  async countHighlights(scope: YearReviewScope, window: YearReviewWindow): Promise<{ highlights: number; notes: number }> {
    const result = await this.db.execute(sql`
      select count(*)::int as highlights,
        count(*) filter (where char_length(btrim(coalesce(${annotations.note}, ''))) > 0)::int as notes
      from ${annotations}
      join ${books} on ${books.id} = ${annotations.bookId}
      where ${this.highlightWhere(scope, window)}
    `);
    const row = (result.rows[0] ?? {}) as Row;
    return { highlights: num(row.highlights), notes: num(row.notes) };
  }

  /**
   * One highlight to stand for the year: one the reader starred, then one of a length that reads
   * as a quotation, then one they wrote a note on, from the book they marked most.
   */
  async pickHighlight(scope: YearReviewScope, window: YearReviewWindow): Promise<YearReviewHighlightRow | null> {
    const result = await this.db.execute(sql`
      with year_marks as (
        select ${annotations.id} as id, ${annotations.bookId} as book_id, ${annotations.text} as text,
          ${annotations.note} as note, ${annotations.chapterTitle} as chapter_title, ${annotations.color} as color,
          coalesce(${annotations.sourceCreatedAt}, ${annotations.createdAt}) as made_at, ${annotations.starredAt} as starred_at,
          count(*) over (partition by ${annotations.bookId}) as book_marks
        from ${annotations}
        join ${books} on ${books.id} = ${annotations.bookId}
        where ${this.highlightWhere(scope, window)}
      )
      select * from year_marks
      order by (starred_at is not null) desc,
        (char_length(btrim(text)) between 40 and 320) desc,
        (char_length(btrim(coalesce(note, ''))) > 0) desc,
        book_marks desc,
        starred_at desc nulls last,
        id
      limit 1
    `);
    const row = result.rows[0] as Row | undefined;
    if (!row) return null;
    return {
      annotationId: num(row.id),
      bookId: num(row.book_id),
      text: String(row.text).trim(),
      note: str(row.note)?.trim() || null,
      chapterTitle: str(row.chapter_title),
      color: str(row.color) ?? 'yellow',
      createdAt: iso(row.made_at) ?? new Date(0).toISOString(),
      starred: row.starred_at != null,
    };
  }

  async mostHighlightedBook(scope: YearReviewScope, window: YearReviewWindow): Promise<{ bookId: number; highlights: number } | null> {
    const result = await this.db.execute(sql`
      select ${annotations.bookId} as book_id, count(*)::int as highlights
      from ${annotations}
      join ${books} on ${books.id} = ${annotations.bookId}
      where ${this.highlightWhere(scope, window)}
      group by ${annotations.bookId}
      order by count(*) desc, max(coalesce(${annotations.sourceCreatedAt}, ${annotations.createdAt})) desc
      limit 1
    `);
    const row = result.rows[0] as Row | undefined;
    return row ? { bookId: num(row.book_id), highlights: num(row.highlights) } : null;
  }
}

function chunks(ids: readonly number[]): number[][] {
  const unique = [...new Set(ids)];
  const out: number[][] = [];
  for (let index = 0; index < unique.length; index += ID_CHUNK) out.push(unique.slice(index, index + ID_CHUNK));
  return out;
}
