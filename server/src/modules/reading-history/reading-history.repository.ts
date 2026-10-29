import { Inject, Injectable } from '@nestjs/common';
import { type SQL, and, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  ContentFilterRules,
  ReadingAttemptOutcome,
  ReadingHistoryItem,
  ReadingHistoryJournalEntry,
  ReadingHistoryMark,
  ReadingHistoryMonth,
  ReadingHistoryRecord,
  ReadingHistorySort,
  ReadingSessionSource,
  ReadingSessionSourceBucket,
} from '@bookorbit/types';
import { READING_HISTORY_UNDATED_MONTH } from '@bookorbit/types';

import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  annotations,
  authors,
  bookAuthors,
  bookFiles,
  bookJournalEntries,
  bookMetadata,
  books,
  readingAttempts,
  readingSessions,
  userBookRatings,
  userLibraryAccess,
  userReadingDailyStats,
} from '../../db/schema';
import { finishedReadScope } from '../user-book-status/finished-read-scope';

/** Who is asking and what they may see. `libraryIds` null means every library (a superuser). */
export interface ReadingHistoryScope {
  userId: number;
  libraryIds: number[] | null;
  contentFilters: ContentFilterRules | undefined;
  timeZone: string;
}

/** A span of local days, `from` inclusive and `until` exclusive. Both null means all time. */
export interface ReadingHistoryPeriod {
  from: string | null;
  until: string | null;
}

export interface ReadingHistoryListFilter {
  period: ReadingHistoryPeriod;
  outcomes: ReadingAttemptOutcome[];
  search: string | null;
  bookId: number | null;
  sort: ReadingHistorySort;
}

type Row = Record<string, unknown>;

const num = (value: unknown): number => (value == null ? 0 : Number(value));
const numOrNull = (value: unknown): number | null => (value == null ? null : Number(value));
const str = (value: unknown): string | null => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null);
// Dates are selected as text: node-postgres would turn a `date` into a Date at local midnight.
const day = (value: unknown): string | null => (typeof value === 'string' ? value.slice(0, 10) : null);
const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === 'string' || typeof value === 'number' ? new Date(value).toISOString() : null;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Finished reads (completed, skimmed or abandoned attempts) and the numbers built on them.
 *
 * Every query numbers a reader's finishes per book first: `read_number` says which finish of the
 * book a read was, ordered the way the apps order attempts (by the day it began, else ended, with
 * undated reads first), and `latest_completed` marks the book's most recent finish, the one the
 * book's own rating belongs to. A read whose book was deleted is its own book.
 */
@Injectable()
export class ReadingHistoryRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async getAccessibleLibraryIds(userId: number, isSuperuser: boolean): Promise<number[] | null> {
    if (isSuperuser) return null;
    const rows = await this.db
      .select({ libraryId: userLibraryAccess.libraryId })
      .from(userLibraryAccess)
      .where(sql`${userLibraryAccess.userId} = ${userId}`);
    return rows.map((row) => row.libraryId);
  }

  private numbered(userId: number): SQL {
    return sql`numbered as (
      select ra.id,
        case when ra.outcome = 'completed' then row_number() over (
          partition by coalesce(ra.book_id, -ra.id), ra.outcome = 'completed'
          order by coalesce(ra.started_on, ra.ended_on) nulls first, ra.id
        ) end as read_number,
        count(*) filter (where ra.outcome = 'completed') over (partition by coalesce(ra.book_id, -ra.id)) as completed_reads,
        ra.outcome = 'completed' and row_number() over (
          partition by coalesce(ra.book_id, -ra.id), ra.outcome = 'completed'
          order by ra.ended_on desc nulls last, ra.id desc
        ) = 1 as latest_completed
      from ${readingAttempts} ra
      where ra.user_id = ${userId} and ra.outcome is not null and ra.deleted_at is null
    )`;
  }

  /** Joins every query shares: the numbering, the book if it still exists, and its metadata. */
  private readonly joins = sql`
    from ${readingAttempts}
    join numbered on numbered.id = ${readingAttempts.id}
    left join ${books} on ${books.id} = ${readingAttempts.bookId}
    left join ${bookMetadata} on ${bookMetadata.bookId} = ${readingAttempts.bookId}`;

  private readonly pages = sql`coalesce(${bookMetadata.pageCount}, ${readingAttempts.bookPageCountSnapshot})`;

  private rating(userId: number): SQL {
    return sql`coalesce(${readingAttempts.rating}, case when numbered.latest_completed then (
      select ${userBookRatings.rating} from ${userBookRatings}
      where ${userBookRatings.userId} = ${userId} and ${userBookRatings.bookId} = ${readingAttempts.bookId}
    ) end)`;
  }

  private scopeClause(scope: ReadingHistoryScope): SQL {
    const contentFilters = scope.contentFilters ? buildContentFilterClauses(scope.contentFilters, this.db) : [];
    return finishedReadScope(scope.libraryIds, contentFilters);
  }

  private periodClause(period: ReadingHistoryPeriod): SQL | undefined {
    if (!period.from || !period.until) return undefined;
    return sql`${readingAttempts.endedOn} >= ${period.from} and ${readingAttempts.endedOn} < ${period.until}`;
  }

  private outcomeClause(outcomes: ReadingAttemptOutcome[]): SQL {
    if (outcomes.length === 0) return sql`false`;
    return sql`${readingAttempts.outcome} in (${sql.join(
      outcomes.map((outcome) => sql`${outcome}`),
      sql`, `,
    )})`;
  }

  private searchClause(search: string | null): SQL | undefined {
    if (!search) return undefined;
    const pattern = `%${escapeLike(search)}%`;
    return sql`(
      coalesce(${bookMetadata.title}, ${readingAttempts.bookTitleSnapshot}) ilike ${pattern}
      or exists (
        select 1 from ${bookAuthors} join ${authors} on ${authors.id} = ${bookAuthors.authorId}
        where ${bookAuthors.bookId} = ${readingAttempts.bookId} and ${authors.name} ilike ${pattern}
      )
      or ${readingAttempts.bookAuthorsSnapshot} ilike ${pattern}
    )`;
  }

  private listWhere(scope: ReadingHistoryScope, filter: ReadingHistoryListFilter): SQL {
    return and(
      sql`${readingAttempts.userId} = ${scope.userId}`,
      sql`${readingAttempts.deletedAt} is null`,
      this.outcomeClause(filter.outcomes),
      this.periodClause(filter.period),
      this.searchClause(filter.search),
      filter.bookId === null ? undefined : sql`${readingAttempts.bookId} = ${filter.bookId}`,
      this.scopeClause(scope),
    )!;
  }

  /** The local-day window a read spans, as instants: from the day it began (or ended) to the end of the day it ended. */
  private windowStart(timeZone: string): SQL {
    return sql`(coalesce(${readingAttempts.startedOn}, ${readingAttempts.endedOn})::timestamp at time zone ${timeZone})`;
  }

  private windowEnd(timeZone: string): SQL {
    return sql`((${readingAttempts.endedOn} + 1)::timestamp at time zone ${timeZone})`;
  }

  async list(scope: ReadingHistoryScope, filter: ReadingHistoryListFilter, offset: number, limit: number): Promise<ReadingHistoryItem[]> {
    const order =
      filter.sort === 'oldest'
        ? sql`${readingAttempts.endedOn} asc nulls last, ${readingAttempts.id} asc`
        : sql`${readingAttempts.endedOn} desc nulls last, ${readingAttempts.id} desc`;
    const start = this.windowStart(scope.timeZone);
    const end = this.windowEnd(scope.timeZone);
    // The page's ids are chosen first, from cheap columns only, so deep pages do not pay for the
    // authors, sessions and marks of every row they skip.
    const result = await this.db.execute(sql`
      with ${this.numbered(scope.userId)},
      page as (
        select ${readingAttempts.id} as id
        ${this.joins}
        where ${this.listWhere(scope, filter)}
        order by ${order}
        limit ${limit} offset ${offset}
      )
      select
        ${readingAttempts.id} as id,
        ${readingAttempts.bookId} as book_id,
        coalesce(${bookMetadata.title}, ${readingAttempts.bookTitleSnapshot}) as title,
        case when ${readingAttempts.bookId} is null then coalesce(${readingAttempts.bookAuthorsSnapshot}::json, '[]'::json)
          else coalesce((
            select json_agg(${authors.name} order by ${bookAuthors.displayOrder})
            from ${bookAuthors} join ${authors} on ${authors.id} = ${bookAuthors.authorId}
            where ${bookAuthors.bookId} = ${readingAttempts.bookId}
          ), '[]'::json) end as authors,
        ${bookMetadata.seriesName} as series_name,
        ${bookMetadata.seriesIndex} as series_index,
        coalesce((select ${bookFiles.format} from ${bookFiles} where ${bookFiles.id} = ${books.primaryFileId}), ${readingAttempts.bookFormatSnapshot}) as format,
        ${this.pages} as page_count,
        ${bookMetadata.updatedAt} as cover_version,
        ${readingAttempts.startedOn}::text as started_on,
        ${readingAttempts.endedOn}::text as ended_on,
        ${readingAttempts.outcome} as outcome,
        numbered.read_number,
        numbered.completed_reads,
        st.sessions,
        st.seconds,
        st.sources,
        st.max_progress,
        ${this.rating(scope.userId)} as rating,
        case when ${readingAttempts.bookId} is null or ${readingAttempts.endedOn} is null then 0 else (
          select count(*) from ${annotations}
          where ${annotations.userId} = ${scope.userId} and ${annotations.bookId} = ${readingAttempts.bookId}
            and ${annotations.deletedAt} is null
            and coalesce(${annotations.sourceCreatedAt}, ${annotations.createdAt}) >= ${start}
            and coalesce(${annotations.sourceCreatedAt}, ${annotations.createdAt}) < ${end}
        ) end as highlight_count,
        case when ${readingAttempts.bookId} is null or ${readingAttempts.endedOn} is null then 0 else (
          select count(*) from ${bookJournalEntries}
          where ${bookJournalEntries.userId} = ${scope.userId} and ${bookJournalEntries.bookId} = ${readingAttempts.bookId}
            and ${bookJournalEntries.deletedAt} is null
            and ${bookJournalEntries.createdAt} >= ${start} and ${bookJournalEntries.createdAt} < ${end}
        ) end as journal_count,
        ${readingAttempts.bookRemovedAt} as removed_at
      from page
      join ${readingAttempts} on ${readingAttempts.id} = page.id
      join numbered on numbered.id = ${readingAttempts.id}
      left join ${books} on ${books.id} = ${readingAttempts.bookId}
      left join ${bookMetadata} on ${bookMetadata.bookId} = ${readingAttempts.bookId}
      left join lateral (
        select count(*)::int as sessions,
          coalesce(sum(${readingSessions.durationSeconds}), 0)::int as seconds,
          coalesce(array_agg(distinct ${readingSessions.source}) filter (where ${readingSessions.source} is not null), '{}') as sources,
          max(${readingSessions.endProgress}) as max_progress
        from ${readingSessions} where ${readingSessions.attemptId} = ${readingAttempts.id}
      ) st on true
      order by ${order}
    `);
    return (result.rows as Row[]).map((row) => ({
      id: num(row.id),
      bookId: numOrNull(row.book_id),
      title: str(row.title),
      authors: Array.isArray(row.authors) ? (row.authors as unknown[]).map(String) : [],
      seriesName: str(row.series_name),
      seriesIndex: str(row.series_index),
      format: str(row.format),
      pageCount: numOrNull(row.page_count),
      coverVersion: iso(row.cover_version),
      startedOn: day(row.started_on),
      endedOn: day(row.ended_on),
      outcome: row.outcome as ReadingAttemptOutcome,
      readNumber: numOrNull(row.read_number),
      completedReads: num(row.completed_reads),
      progressPercent: row.outcome === 'completed' ? null : numOrNull(row.max_progress),
      sessions: num(row.sessions),
      seconds: num(row.seconds),
      sources: parsePgArray(row.sources) as ReadingSessionSource[],
      rating: numOrNull(row.rating),
      highlightCount: num(row.highlight_count),
      journalCount: num(row.journal_count),
      removedAt: row.book_id == null ? iso(row.removed_at) : null,
    }));
  }

  async count(scope: ReadingHistoryScope, filter: ReadingHistoryListFilter): Promise<number> {
    const result = await this.db.execute(sql`
      with ${this.numbered(scope.userId)}
      select count(*)::int as total ${this.joins}
      where ${this.listWhere(scope, filter)}
    `);
    return num((result.rows[0] as Row | undefined)?.total);
  }

  /** The list's months in list order, with what each month's header shows. */
  async months(scope: ReadingHistoryScope, filter: ReadingHistoryListFilter): Promise<ReadingHistoryMonth[]> {
    const monthExpr = sql`coalesce(to_char(${readingAttempts.endedOn}, 'YYYY-MM'), ${READING_HISTORY_UNDATED_MONTH})`;
    const result = await this.db.execute(sql`
      with ${this.numbered(scope.userId)}
      select ${monthExpr} as month,
        count(*)::int as reads,
        count(*) filter (where ${readingAttempts.outcome} = 'completed')::int as completed,
        count(*) filter (where numbered.read_number > 1)::int as rereads,
        coalesce(sum(${this.pages}) filter (where ${readingAttempts.outcome} = 'completed'), 0)::int as pages,
        coalesce(sum(st.seconds), 0)::int as seconds
      ${this.joins}
      left join (
        select ${readingSessions.attemptId} as attempt_id, sum(${readingSessions.durationSeconds}) as seconds
        from ${readingSessions}
        where ${readingSessions.userId} = ${scope.userId} and ${readingSessions.attemptId} is not null
        group by ${readingSessions.attemptId}
      ) st on st.attempt_id = ${readingAttempts.id}
      where ${this.listWhere(scope, filter)}
      group by 1
    `);
    const rows = (result.rows as Row[]).map((row) => ({
      month: String(row.month),
      reads: num(row.reads),
      completed: num(row.completed),
      rereads: num(row.rereads),
      pages: num(row.pages),
      seconds: num(row.seconds),
    }));
    const dated = rows.filter((row) => row.month !== READING_HISTORY_UNDATED_MONTH);
    dated.sort((a, b) => (filter.sort === 'oldest' ? a.month.localeCompare(b.month) : b.month.localeCompare(a.month)));
    return [...dated, ...rows.filter((row) => row.month === READING_HISTORY_UNDATED_MONTH)];
  }

  /** Completed-read totals for a period: reads, distinct books, rereads, pages, ratings. */
  async totals(scope: ReadingHistoryScope, period: ReadingHistoryPeriod) {
    const result = await this.db.execute(sql`
      with ${this.numbered(scope.userId)}
      select count(*) filter (where ${readingAttempts.outcome} = 'completed')::int as reads,
        count(distinct coalesce(${readingAttempts.bookId}, -${readingAttempts.id})) filter (where ${readingAttempts.outcome} = 'completed')::int as books,
        count(*) filter (where numbered.read_number > 1)::int as rereads,
        coalesce(sum(${this.pages}) filter (where ${readingAttempts.outcome} = 'completed'), 0)::int as pages,
        avg(${this.rating(scope.userId)}) filter (where ${readingAttempts.outcome} = 'completed')::float as average_rating,
        count(${this.rating(scope.userId)}) filter (where ${readingAttempts.outcome} = 'completed')::int as rated,
        count(*) filter (where ${readingAttempts.outcome} = 'skimmed')::int as skimmed,
        count(*) filter (where ${readingAttempts.outcome} = 'abandoned')::int as abandoned
      ${this.joins}
      where ${and(sql`${readingAttempts.userId} = ${scope.userId}`, this.periodClause(period), this.scopeClause(scope))}
    `);
    const row = (result.rows[0] ?? {}) as Row;
    return {
      reads: num(row.reads),
      books: num(row.books),
      rereads: num(row.rereads),
      pages: num(row.pages),
      averageRating: row.average_rating == null ? null : Math.round(Number(row.average_rating) * 10) / 10,
      ratedReads: num(row.rated),
      notCounted: num(row.skimmed) + num(row.abandoned),
      outcomes: { completed: num(row.reads), skimmed: num(row.skimmed), abandoned: num(row.abandoned) },
    };
  }

  /** Completed reads and rereads per month of a period, by the month they ended. */
  async completedByMonth(scope: ReadingHistoryScope, period: ReadingHistoryPeriod): Promise<{ month: number; reads: number; rereads: number }[]> {
    const result = await this.db.execute(sql`
      with ${this.numbered(scope.userId)}
      select extract(month from ${readingAttempts.endedOn})::int as month,
        count(*)::int as reads,
        count(*) filter (where numbered.read_number > 1)::int as rereads
      ${this.joins}
      where ${and(sql`${readingAttempts.userId} = ${scope.userId}`, sql`${readingAttempts.outcome} = 'completed'`, this.periodClause(period), this.scopeClause(scope))}
      group by 1
    `);
    return (result.rows as Row[]).map((row) => ({ month: num(row.month), reads: num(row.reads), rereads: num(row.rereads) }));
  }

  /** Reading time per month of a period, from every session the reader logged, finished or not. */
  async readingTimeByMonth(scope: ReadingHistoryScope, period: ReadingHistoryPeriod): Promise<{ month: number; seconds: number; days: number }[]> {
    const libraryClause =
      scope.libraryIds === null
        ? undefined
        : scope.libraryIds.length === 0
          ? sql`false`
          : sql`${userReadingDailyStats.libraryId} in (${sql.join(
              scope.libraryIds.map((id) => sql`${id}`),
              sql`, `,
            )})`;
    const result = await this.db.execute(sql`
      select extract(month from ${userReadingDailyStats.day})::int as month,
        coalesce(sum(${userReadingDailyStats.readingSeconds}), 0)::int as seconds,
        count(distinct ${userReadingDailyStats.day}) filter (where ${userReadingDailyStats.readingSeconds} > 0)::int as days
      from ${userReadingDailyStats}
      where ${and(
        sql`${userReadingDailyStats.userId} = ${scope.userId}`,
        period.from && period.until
          ? sql`${userReadingDailyStats.day} >= ${period.from} and ${userReadingDailyStats.day} < ${period.until}`
          : undefined,
        libraryClause,
      )}
      group by 1
    `);
    return (result.rows as Row[]).map((row) => ({ month: num(row.month), seconds: num(row.seconds), days: num(row.days) }));
  }

  async readingTimeTotal(scope: ReadingHistoryScope, period: ReadingHistoryPeriod): Promise<{ seconds: number; days: number }> {
    const libraryClause =
      scope.libraryIds === null
        ? undefined
        : scope.libraryIds.length === 0
          ? sql`false`
          : sql`${userReadingDailyStats.libraryId} in (${sql.join(
              scope.libraryIds.map((id) => sql`${id}`),
              sql`, `,
            )})`;
    const result = await this.db.execute(sql`
      select coalesce(sum(${userReadingDailyStats.readingSeconds}), 0)::bigint as seconds,
        count(distinct ${userReadingDailyStats.day}) filter (where ${userReadingDailyStats.readingSeconds} > 0)::int as days
      from ${userReadingDailyStats}
      where ${and(
        sql`${userReadingDailyStats.userId} = ${scope.userId}`,
        period.from && period.until
          ? sql`${userReadingDailyStats.day} >= ${period.from} and ${userReadingDailyStats.day} < ${period.until}`
          : undefined,
        libraryClause,
      )}
    `);
    const row = (result.rows[0] ?? {}) as Row;
    return { seconds: num(row.seconds), days: num(row.days) };
  }

  /** The completed read of a period that ranks first by `order`, with `value` as its figure. */
  private async record(
    scope: ReadingHistoryScope,
    period: ReadingHistoryPeriod,
    value: SQL,
    extra: SQL | undefined,
    order: SQL,
  ): Promise<ReadingHistoryRecord | null> {
    const result = await this.db.execute(sql`
      with ${this.numbered(scope.userId)}
      select ${readingAttempts.id} as id, ${readingAttempts.bookId} as book_id,
        coalesce(${bookMetadata.title}, ${readingAttempts.bookTitleSnapshot}) as title,
        ${bookMetadata.updatedAt} as cover_version, ${readingAttempts.bookRemovedAt} as removed_at,
        ${value} as value
      ${this.joins}
      where ${and(sql`${readingAttempts.userId} = ${scope.userId}`, sql`${readingAttempts.outcome} = 'completed'`, this.periodClause(period), this.scopeClause(scope), extra)}
      order by ${order}
      limit 1
    `);
    const row = result.rows[0] as Row | undefined;
    if (!row) return null;
    return {
      item: {
        id: num(row.id),
        bookId: numOrNull(row.book_id),
        title: str(row.title),
        coverVersion: iso(row.cover_version),
        removedAt: row.book_id == null ? iso(row.removed_at) : null,
      },
      value: Number(row.value),
    };
  }

  async records(scope: ReadingHistoryScope, period: ReadingHistoryPeriod) {
    const span = sql`(${readingAttempts.endedOn} - ${readingAttempts.startedOn} + 1)`;
    const dated = sql`${readingAttempts.startedOn} is not null and ${readingAttempts.endedOn} is not null`;
    const [longestBook, longestRead, fastest, mostReread] = await Promise.all([
      this.record(scope, period, this.pages, sql`${this.pages} is not null`, sql`${this.pages} desc, ${readingAttempts.endedOn} desc nulls last`),
      this.record(scope, period, span, dated, sql`${span} desc, ${readingAttempts.endedOn} desc`),
      this.record(
        scope,
        period,
        sql`round(${this.pages}::numeric / ${span})`,
        and(dated, sql`${this.pages} is not null`),
        sql`${this.pages}::numeric / ${span} desc, ${readingAttempts.endedOn} desc`,
      ),
      this.record(
        scope,
        period,
        sql`count(*) over (partition by coalesce(${readingAttempts.bookId}, -${readingAttempts.id}))`,
        undefined,
        sql`count(*) over (partition by coalesce(${readingAttempts.bookId}, -${readingAttempts.id})) desc, ${readingAttempts.endedOn} desc nulls last, ${readingAttempts.id} desc`,
      ),
    ]);
    return { longestBook, longestRead, fastest, mostReread: mostReread && mostReread.value > 1 ? mostReread : null };
  }

  async formats(scope: ReadingHistoryScope, period: ReadingHistoryPeriod): Promise<{ format: string; reads: number }[]> {
    const format = sql`coalesce((select ${bookFiles.format} from ${bookFiles} where ${bookFiles.id} = ${books.primaryFileId}), ${readingAttempts.bookFormatSnapshot})`;
    const result = await this.db.execute(sql`
      with ${this.numbered(scope.userId)}
      select ${format} as format, count(*)::int as reads
      ${this.joins}
      where ${and(sql`${readingAttempts.userId} = ${scope.userId}`, sql`${readingAttempts.outcome} = 'completed'`, this.periodClause(period), this.scopeClause(scope))}
      group by 1 order by 2 desc
    `);
    return (result.rows as Row[]).filter((row) => row.format != null).map((row) => ({ format: String(row.format), reads: num(row.reads) }));
  }

  /** How many completed reads of the period had a session from each app or device, bucketed as the charts bucket them. */
  async sources(scope: ReadingHistoryScope, period: ReadingHistoryPeriod): Promise<{ source: ReadingSessionSourceBucket; reads: number }[]> {
    const bucket = sql`case when ${readingSessions.source} in ('ios', 'watchos', 'android', 'koreader', 'kobo') then ${readingSessions.source} else 'bookorbit' end`;
    const result = await this.db.execute(sql`
      with ${this.numbered(scope.userId)}
      select ${bucket} as source, count(distinct ${readingAttempts.id})::int as reads
      ${this.joins}
      join ${readingSessions} on ${readingSessions.attemptId} = ${readingAttempts.id}
      where ${and(sql`${readingAttempts.userId} = ${scope.userId}`, sql`${readingAttempts.outcome} = 'completed'`, this.periodClause(period), this.scopeClause(scope))}
      group by 1 order by 2 desc
    `);
    return (result.rows as Row[]).map((row) => ({ source: String(row.source) as ReadingSessionSourceBucket, reads: num(row.reads) }));
  }

  /** Completed reads per year, newest first, plus how many have no finish date. */
  async years(scope: ReadingHistoryScope): Promise<{ years: { year: number; reads: number }[]; undated: number }> {
    const result = await this.db.execute(sql`
      with ${this.numbered(scope.userId)}
      select extract(year from ${readingAttempts.endedOn})::int as year, count(*)::int as reads
      ${this.joins}
      where ${and(sql`${readingAttempts.userId} = ${scope.userId}`, sql`${readingAttempts.outcome} = 'completed'`, this.scopeClause(scope))}
      group by 1
    `);
    const rows = result.rows as Row[];
    return {
      years: rows
        .filter((row) => row.year != null)
        .map((row) => ({ year: num(row.year), reads: num(row.reads) }))
        .sort((a, b) => b.year - a.year),
      undated: num(rows.find((row) => row.year == null)?.reads),
    };
  }

  /** The day a reader's `target`-th completed read of a year ended, if they got that far. */
  async goalMetOn(scope: ReadingHistoryScope, period: ReadingHistoryPeriod, target: number): Promise<string | null> {
    const result = await this.db.execute(sql`
      with ${this.numbered(scope.userId)}
      select ${readingAttempts.endedOn}::text as ended_on
      ${this.joins}
      where ${and(sql`${readingAttempts.userId} = ${scope.userId}`, sql`${readingAttempts.outcome} = 'completed'`, this.periodClause(period), this.scopeClause(scope))}
      order by ${readingAttempts.endedOn} asc, ${readingAttempts.id} asc
      offset ${target - 1} limit 1
    `);
    return day((result.rows[0] as Row | undefined)?.ended_on);
  }

  /** A reader's own finished read, with what the rating and marks endpoints need. */
  async findOwnedRead(userId: number, attemptId: number) {
    const result = await this.db.execute(sql`
      with ${this.numbered(userId)}
      select ${readingAttempts.id} as id, ${readingAttempts.bookId} as book_id, ${readingAttempts.startedOn}::text as started_on,
        ${readingAttempts.endedOn}::text as ended_on, numbered.latest_completed
      from ${readingAttempts} join numbered on numbered.id = ${readingAttempts.id}
      where ${readingAttempts.id} = ${attemptId} and ${readingAttempts.userId} = ${userId}
    `);
    const row = result.rows[0] as Row | undefined;
    if (!row) return null;
    return {
      id: num(row.id),
      bookId: numOrNull(row.book_id),
      startedOn: day(row.started_on),
      endedOn: day(row.ended_on),
      latestCompleted: row.latest_completed === true,
    };
  }

  async setReadRating(userId: number, attemptId: number, rating: number | null): Promise<void> {
    await this.db.execute(
      sql`update ${readingAttempts} set rating = ${rating} where ${readingAttempts.id} = ${attemptId} and ${readingAttempts.userId} = ${userId}`,
    );
  }

  /** The first few highlights and journal entries made during a read, and how many in all. */
  async marks(
    userId: number,
    read: { bookId: number; startedOn: string | null; endedOn: string },
    timeZone: string,
    limit: { highlights: number; journal: number },
  ) {
    const start = sql`(${read.startedOn ?? read.endedOn}::date::timestamp at time zone ${timeZone})`;
    const end = sql`((${read.endedOn}::date + 1)::timestamp at time zone ${timeZone})`;
    const markedAt = sql`coalesce(${annotations.sourceCreatedAt}, ${annotations.createdAt})`;
    const highlightWhere = sql`${annotations.userId} = ${userId} and ${annotations.bookId} = ${read.bookId} and ${annotations.deletedAt} is null
      and ${markedAt} >= ${start} and ${markedAt} < ${end}`;
    const journalWhere = sql`${bookJournalEntries.userId} = ${userId} and ${bookJournalEntries.bookId} = ${read.bookId} and ${bookJournalEntries.deletedAt} is null
      and ${bookJournalEntries.createdAt} >= ${start} and ${bookJournalEntries.createdAt} < ${end}`;
    const [highlights, highlightCount, journal, journalCount] = await Promise.all([
      this.db.execute(sql`
        select ${annotations.id} as id, ${annotations.text} as text, ${annotations.note} as note, ${annotations.color} as color,
          ${annotations.chapterTitle} as chapter_title, ${markedAt} as created_at
        from ${annotations} where ${highlightWhere}
        order by (${annotations.note} is not null) desc, ${annotations.starredAt} desc nulls last, ${markedAt} asc
        limit ${limit.highlights}
      `),
      this.db.execute(sql`select count(*)::int as n from ${annotations} where ${highlightWhere}`),
      this.db.execute(sql`
        select ${bookJournalEntries.id} as id, ${bookJournalEntries.body} as body, ${bookJournalEntries.chapterTitle} as chapter_title,
          ${bookJournalEntries.createdAt} as created_at
        from ${bookJournalEntries} where ${journalWhere}
        order by ${bookJournalEntries.createdAt} asc
        limit ${limit.journal}
      `),
      this.db.execute(sql`select count(*)::int as n from ${bookJournalEntries} where ${journalWhere}`),
    ]);
    return {
      highlights: (highlights.rows as Row[]).map((row): ReadingHistoryMark => ({
        id: num(row.id),
        text: String(row.text),
        note: str(row.note),
        color: String(row.color),
        chapterTitle: str(row.chapter_title),
        createdAt: iso(row.created_at) ?? '',
      })),
      highlightCount: num((highlightCount.rows[0] as Row | undefined)?.n),
      journal: (journal.rows as Row[]).map((row): ReadingHistoryJournalEntry => ({
        id: num(row.id),
        body: String(row.body),
        chapterTitle: str(row.chapter_title),
        createdAt: iso(row.created_at) ?? '',
      })),
      journalCount: num((journalCount.rows[0] as Row | undefined)?.n),
    };
  }
}

/** node-postgres returns a text[] of an aggregate as a JS array, but an empty literal as `{}`. */
function parsePgArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || value === '{}' || value === '') return [];
  return value
    .replace(/^\{|\}$/g, '')
    .split(',')
    .map((part) => part.replace(/^"|"$/g, ''));
}
