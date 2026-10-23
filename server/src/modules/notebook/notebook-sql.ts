import { and, inArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { NotebookEntryKind } from '@bookorbit/types';

import { accentInsensitiveIlike } from '../../common/utils/accent-insensitive-search.utils';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import * as schema from '../../db/schema';
import {
  annotationPositions,
  annotations,
  authors,
  bookAuthors,
  bookJournalEntries,
  bookMetadata,
  bookmarks,
  books,
  userBookNotes,
} from '../../db/schema';
import type { NotebookCursor } from './notebook-cursor';
import { NOTEBOOK_KIND_RANK, hasHighlightOnlyFilter, type NotebookEntryFilters, type NotebookScope } from './notebook-filters';

type Db = NodePgDatabase<typeof schema>;

export type NotebookStatus = 'active' | 'trashed';
export type NotebookDirection = 'asc' | 'desc';
export type NotebookSortColumn = 'written' | 'edited' | 'deleted';

/** One kind's table, described once so every listing, count and deck reads it the same way. */
export interface NotebookKindSource {
  kind: NotebookEntryKind;
  rank: number;
  table: SQLWrapper;
  id: SQLWrapper;
  bookId: SQLWrapper;
  userId: SQLWrapper;
  /** When it was written; a highlight's device may backdate it. */
  writtenAt: SQL;
  editedAt: SQL;
  deletedAt: SQLWrapper | null;
  /** The entry's own text, matched by `q`. */
  ownText: SQLWrapper[];
  /** The note `hasNote` asks about; null for a kind that always counts as having one. */
  note: SQLWrapper | null;
  /** Null for a kind with no origin of its own, which counts as `web`. */
  origin: SQLWrapper | null;
  /** Conditions a row must always meet to be an entry at all. */
  always: SQL[];
}

/** Non-blank after trimming whitespace of any kind, newlines included. */
export function hasTextSql(value: SQLWrapper): SQL {
  return sql`${value} ~ '[^[:space:]]'`;
}

/** The sort timestamp as text, to the microsecond and independent of the session time zone. */
export function sortKeySql(value: SQLWrapper): SQL<string> {
  return sql<string>`to_char(${value} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export const NOTEBOOK_SOURCES: Record<NotebookEntryKind, NotebookKindSource> = {
  highlight: {
    kind: 'highlight',
    rank: NOTEBOOK_KIND_RANK.highlight,
    table: annotations,
    id: annotations.id,
    bookId: annotations.bookId,
    userId: annotations.userId,
    // Must stay the exact expression `annotations_user_created_active_idx` is built on.
    writtenAt: sql`coalesce(${annotations.sourceCreatedAt}, ${annotations.createdAt})`,
    editedAt: sql`${annotations.updatedAt}`,
    deletedAt: annotations.deletedAt,
    ownText: [annotations.text, annotations.note],
    note: annotations.note,
    origin: annotations.origin,
    always: [],
  },
  journal: {
    kind: 'journal',
    rank: NOTEBOOK_KIND_RANK.journal,
    table: bookJournalEntries,
    id: bookJournalEntries.id,
    bookId: bookJournalEntries.bookId,
    userId: bookJournalEntries.userId,
    writtenAt: sql`${bookJournalEntries.createdAt}`,
    editedAt: sql`${bookJournalEntries.updatedAt}`,
    deletedAt: bookJournalEntries.deletedAt,
    ownText: [bookJournalEntries.body, bookJournalEntries.quote],
    note: null,
    origin: null,
    always: [],
  },
  bookmark: {
    kind: 'bookmark',
    rank: NOTEBOOK_KIND_RANK.bookmark,
    table: bookmarks,
    id: bookmarks.id,
    bookId: bookmarks.bookId,
    userId: bookmarks.userId,
    writtenAt: sql`${bookmarks.createdAt}`,
    editedAt: sql`${bookmarks.updatedAt}`,
    deletedAt: bookmarks.deletedAt,
    ownText: [bookmarks.title, bookmarks.note],
    note: bookmarks.note,
    origin: bookmarks.origin,
    always: [],
  },
  review: {
    kind: 'review',
    rank: NOTEBOOK_KIND_RANK.review,
    table: userBookNotes,
    // A review is one row per (user, book), so its book id is its id.
    id: userBookNotes.bookId,
    bookId: userBookNotes.bookId,
    userId: userBookNotes.userId,
    writtenAt: sql`${userBookNotes.updatedAt}`,
    editedAt: sql`${userBookNotes.updatedAt}`,
    deletedAt: null,
    ownText: [userBookNotes.note],
    note: null,
    origin: null,
    always: [hasTextSql(userBookNotes.note)],
  },
};

export function sortColumnSql(source: NotebookKindSource, column: NotebookSortColumn): SQL {
  if (column === 'written') return source.writtenAt;
  if (column === 'edited') return source.editedAt;
  if (!source.deletedAt) throw new RangeError(`${source.kind} has no deletion time`);
  return sql`${source.deletedAt}`;
}

function sqlList(values: readonly (string | number)[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}

/**
 * Not anchored exactly: no canonical CFI, an empty one, or one whose status is anything but
 * `exact`. This is the rule the iOS notebook draws its badge by from `cfi` and `positionStatus`,
 * so the count and the badges agree. A PDF highlight has no CFI row and so counts here too.
 */
export function approximateSql(): SQL {
  return sql`not exists (
    select 1 from ${annotationPositions}
    where ${annotationPositions.annotationId} = ${annotations.id}
      and ${annotationPositions.format} = 'cfi'
      and ${annotationPositions.status} = 'exact'
      and ${annotationPositions.pos0} is not null
      and ${annotationPositions.pos0} <> ''
  )`;
}

/** The book's title or any of its authors, for a book id expression from the outer row. */
export function bookSearchSql(bookId: SQLWrapper, pattern: string): SQL {
  return sql`(
    exists (select 1 from ${bookMetadata} where ${bookMetadata.bookId} = ${bookId} and ${accentInsensitiveIlike(bookMetadata.title, pattern)})
    or exists (
      select 1 from ${bookAuthors} inner join ${authors} on ${authors.id} = ${bookAuthors.authorId}
      where ${bookAuthors.bookId} = ${bookId} and ${accentInsensitiveIlike(authors.name, pattern)}
    )
  )`;
}

export function entrySearchSql(source: NotebookKindSource, pattern: string): SQL {
  const own = source.ownText.map((column) => accentInsensitiveIlike(column, pattern));
  return sql`(${sql.join([...own, bookSearchSql(source.bookId, pattern)], sql` or `)})`;
}

/** Library access and content rules, evaluated on `books`, which every arm joins under that name. */
export function scopeSql(scope: NotebookScope, db: Db): SQL[] {
  return [inArray(books.libraryId, scope.libraryIds), ...(scope.contentFilters ? buildContentFilterClauses(scope.contentFilters, db) : [])];
}

export function statusSql(source: NotebookKindSource, status: NotebookStatus): SQL[] {
  if (!source.deletedAt) return status === 'active' ? [] : [sql`false`];
  return [status === 'active' ? sql`${source.deletedAt} is null` : sql`${source.deletedAt} is not null`];
}

/** The filter conditions for one kind. A kind a filter rules out gets a `false` rather than vanishing silently. */
export function filterSql(source: NotebookKindSource, filters: NotebookEntryFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.bookId !== undefined) conditions.push(sql`${source.bookId} = ${filters.bookId}`);
  if (filters.origins) {
    if (source.origin) conditions.push(sql`${source.origin} in (${sqlList(filters.origins)})`);
    else if (!filters.origins.includes('web')) conditions.push(sql`false`);
  }
  if (filters.hasNote && source.note) conditions.push(hasTextSql(source.note));
  if (source.kind === 'highlight') {
    if (filters.starred) conditions.push(sql`${annotations.starredAt} is not null`);
    if (filters.colors) conditions.push(sql`${annotations.color} in (${sqlList(filters.colors)})`);
    if (filters.approximate) conditions.push(approximateSql());
  } else if (hasHighlightOnlyFilter(filters)) {
    conditions.push(sql`false`);
  }
  if (filters.searchPattern) conditions.push(entrySearchSql(source, filters.searchPattern));
  return conditions;
}

/** `from <kind table> inner join books`, the shape every scoped arm reads from. */
export function scopedFromSql(source: NotebookKindSource): SQL {
  return sql`${source.table} inner join ${books} on ${books.id} = ${source.bookId}`;
}

export function armWhereSql(
  source: NotebookKindSource,
  scope: NotebookScope,
  db: Db,
  options: { status: NotebookStatus; filters?: NotebookEntryFilters; extra?: SQL[] },
): SQL[] {
  return [
    sql`${source.userId} = ${scope.userId}`,
    ...statusSql(source, options.status),
    ...source.always,
    ...scopeSql(scope, db),
    ...(options.filters ? filterSql(source, options.filters) : []),
    ...(options.extra ?? []),
  ];
}

/**
 * Rows after the cursor in the total order `(sortTs, kindRank, id)`, all descending or all
 * ascending. Within one arm the kind is fixed, so the tuple comparison collapses to a bound on the
 * timestamp for the other kinds and a `(sortTs, id)` row comparison for the cursor's own kind.
 */
export function cursorSql(source: NotebookKindSource, sortTs: SQL, cursor: NotebookCursor, direction: NotebookDirection): SQL {
  const key = sql`${cursor.key}::timestamptz`;
  const id = sql`${cursor.id}::int`;
  if (direction === 'desc') {
    if (source.rank < cursor.rank) return sql`${sortTs} <= ${key}`;
    if (source.rank > cursor.rank) return sql`${sortTs} < ${key}`;
    return sql`(${sortTs}, ${source.id}) < (${key}, ${id})`;
  }
  if (source.rank < cursor.rank) return sql`${sortTs} > ${key}`;
  if (source.rank > cursor.rank) return sql`${sortTs} >= ${key}`;
  return sql`(${sortTs}, ${source.id}) > (${key}, ${id})`;
}

export interface KeysetArm {
  source: NotebookKindSource;
  where: SQL[];
  sortTs: SQL;
}

/**
 * A UNION ALL of per-kind arms, each ordered on its own index-friendly sort and cut at `limit`
 * before the merge, so a deep page reads no more rows than the first one.
 */
export function keysetUnionSql(arms: KeysetArm[], options: { direction: NotebookDirection; limit: number; cursor?: NotebookCursor }): SQL {
  const direction = sql.raw(options.direction === 'desc' ? 'desc' : 'asc');
  const parts = arms.map(({ source, where, sortTs }) => {
    const conditions = options.cursor ? [...where, cursorSql(source, sortTs, options.cursor, options.direction)] : where;
    return sql`(
      select ${source.rank}::int as kind_rank, ${source.id} as id, ${source.bookId} as book_id, ${sortTs} as sort_ts
      from ${scopedFromSql(source)}
      where ${and(...conditions)}
      order by ${sortTs} ${direction}, ${source.id} ${direction}
      limit ${options.limit}
    )`;
  });
  return sql`
    select kind_rank, id, book_id, ${sortKeySql(sql`sort_ts`)} as sort_key
    from (${sql.join(parts, sql` union all `)}) as notebook_entries
    order by sort_ts ${direction}, kind_rank ${direction}, id ${direction}
    limit ${options.limit}
  `;
}

/** The counts behind the overview, in one statement. A kind left out by the filters counts zero. */
export function overviewSql(scope: NotebookScope, db: Db, filters: NotebookEntryFilters, kinds: readonly NotebookEntryKind[]): SQL {
  const where = (kind: NotebookEntryKind) => {
    const source = NOTEBOOK_SOURCES[kind];
    const conditions = armWhereSql(source, scope, db, { status: 'active', filters });
    return and(...(kinds.includes(kind) ? conditions : [...conditions, sql`false`]))!;
  };
  const { highlight, journal, bookmark, review } = NOTEBOOK_SOURCES;
  // `approximateSql()` as a joined row rather than a NOT EXISTS in the select list: the planner
  // prices a select-list subplan per row, which on a large library tips the statement over the JIT
  // threshold and costs far more in compilation than the count itself. At most one CFI row exists
  // per highlight, so the join cannot multiply the counts.
  return sql`
    with
      h as (
        select ${annotations.bookId} as book_id, ${annotations.color} as color, ${annotations.origin} as origin,
          ${annotations.starredAt} is not null as starred,
          coalesce(${hasTextSql(annotations.note)}, false) as has_note,
          not coalesce(cfi_position.status = 'exact' and cfi_position.pos0 <> '', false) as approximate
        from ${scopedFromSql(highlight)}
        left join ${annotationPositions} as cfi_position
          on cfi_position.annotation_id = ${annotations.id} and cfi_position.format = 'cfi'
        where ${where('highlight')}
      ),
      j as (select ${bookJournalEntries.bookId} as book_id from ${scopedFromSql(journal)} where ${where('journal')}),
      b as (
        select ${bookmarks.bookId} as book_id, coalesce(${hasTextSql(bookmarks.note)}, false) as has_note
        from ${scopedFromSql(bookmark)}
        where ${where('bookmark')}
      ),
      r as (select ${userBookNotes.bookId} as book_id from ${scopedFromSql(review)} where ${where('review')})
    select
      (select count(*) from h)::int as highlights,
      (select count(*) from j)::int as journal,
      (select count(*) from b)::int as bookmarks,
      (select count(*) from r)::int as reviews,
      (select count(*) from h where starred)::int as starred,
      ((select count(*) from h where has_note) + (select count(*) from b where has_note) + (select count(*) from j) + (select count(*) from r))::int as with_notes,
      (select count(*) from h where approximate)::int as approximate,
      (select count(*) from (select book_id from h union select book_id from j union select book_id from b union select book_id from r) as counted)::int as books,
      (
        select coalesce(json_agg(json_build_object('color', color, 'count', total) order by total desc, color), '[]'::json)
        from (select color, count(*)::int as total from h group by color) as by_color
      ) as colors,
      (
        select coalesce(json_agg(json_build_object('origin', origin, 'count', total) order by total desc, origin), '[]'::json)
        from (select origin, count(*)::int as total from h group by origin) as by_origin
      ) as origins
  `;
}

/**
 * Books with entries, newest activity first. The activity is folded per book from all four kinds
 * before the scope join, and the page is cut by the keyset `(lastActivity, bookId)`.
 */
export function bookActivitySql(scope: NotebookScope, db: Db, options: { searchPattern?: string; cursor?: NotebookCursor; limit: number }): SQL {
  const arms = Object.values(NOTEBOOK_SOURCES).map(
    (source) => sql`
      select ${source.bookId} as book_id, ${source.writtenAt} as ts, ${source.rank}::int as kind_rank
      from ${source.table}
      where ${and(sql`${source.userId} = ${scope.userId}`, ...statusSql(source, 'active'), ...source.always)}
    `,
  );
  const conditions = [...scopeSql(scope, db)];
  if (options.searchPattern) conditions.push(bookSearchSql(books.id, options.searchPattern));
  if (options.cursor) {
    conditions.push(sql`(activity.last_ts, activity.book_id) < (${options.cursor.key}::timestamptz, ${options.cursor.id}::int)`);
  }
  return sql`
    with activity as (
      select book_id, max(ts) as last_ts,
        (count(*) filter (where kind_rank = ${NOTEBOOK_KIND_RANK.highlight}))::int as highlights,
        (count(*) filter (where kind_rank = ${NOTEBOOK_KIND_RANK.journal}))::int as journal,
        (count(*) filter (where kind_rank = ${NOTEBOOK_KIND_RANK.bookmark}))::int as bookmarks,
        bool_or(kind_rank = ${NOTEBOOK_KIND_RANK.review}) as has_review
      from (${sql.join(arms, sql` union all `)}) as entries
      group by book_id
    )
    select activity.book_id, activity.highlights, activity.journal, activity.bookmarks, activity.has_review,
      ${sortKeySql(sql`activity.last_ts`)} as last_key
    from activity inner join ${books} on ${books.id} = activity.book_id
    where ${and(...conditions)}
    order by activity.last_ts desc, activity.book_id desc
    limit ${options.limit}
  `;
}

/** Each listed book's newest entry, one index probe per kind per book. */
export function latestEntryPerBookSql(userId: number, bookIds: readonly number[]): SQL {
  const page = sql.join(
    bookIds.map((bookId) => sql`(${bookId}::int)`),
    sql`, `,
  );
  const arms = Object.values(NOTEBOOK_SOURCES).map(
    (source) => sql`(
      select ${source.rank}::int as kind_rank, ${source.id} as id, ${source.bookId} as book_id, ${source.writtenAt} as sort_ts
      from ${source.table}
      where ${and(sql`${source.userId} = ${userId}`, sql`${source.bookId} = page.book_id`, ...statusSql(source, 'active'), ...source.always)}
      order by ${source.writtenAt} desc, ${source.id} desc
      limit 1
    )`,
  );
  return sql`
    select latest.kind_rank, latest.id, latest.book_id, ${sortKeySql(sql`latest.sort_ts`)} as sort_key
    from (values ${page}) as page(book_id)
    cross join lateral (
      select * from (${sql.join(arms, sql` union all `)}) as candidates
      order by sort_ts desc, kind_rank desc, id desc
      limit 1
    ) as latest
  `;
}

/**
 * The earliest write time across every kind, or null with no history. Returned in UTC so the
 * reader's zone is applied by the same calendar code that builds the day ranges, never by a
 * Postgres zone name that might be missing from the server's tz database.
 */
export function firstEntryAtSql(userId: number): SQL {
  const mins = Object.values(NOTEBOOK_SOURCES).map(
    (source) =>
      sql`(select min(${source.writtenAt}) from ${source.table} where ${and(sql`${source.userId} = ${userId}`, ...statusSql(source, 'active'), ...source.always)})`,
  );
  return sql`select ${sortKeySql(sql`least(${sql.join(mins, sql`, `)})`)} as first_at`;
}

/** Half-open `[start, end)` ranges, one per earlier year that can hold the day. */
export function inRangesSql(value: SQL, ranges: readonly { start: string; end: string }[]): SQL {
  if (ranges.length === 0) return sql`false`;
  return or(...ranges.map((range) => sql`(${value} >= ${range.start}::timestamptz and ${value} < ${range.end}::timestamptz)`))!;
}

export const REVIEW_TIER_STARRED = 0;
export const REVIEW_TIER_OLDER = 1;
export const REVIEW_TIER_RECENT = 2;

/**
 * The day's deck: at most one highlight per book, starred ones first, then ones written before
 * `olderThan`, then the rest. Inside a tier the order is an md5 of (user, date, id), so the deck
 * is the same all day and different the next.
 */
export function dailyReviewSql(scope: NotebookScope, db: Db, options: { date: string; olderThan: string; limit: number }): SQL {
  const source = NOTEBOOK_SOURCES.highlight;
  const where = armWhereSql(source, scope, db, { status: 'active', extra: [hasTextSql(annotations.text)] });
  const tier = sql`case
    when ${annotations.starredAt} is not null then ${REVIEW_TIER_STARRED}::int
    when ${source.writtenAt} < ${options.olderThan}::timestamptz then ${REVIEW_TIER_OLDER}::int
    else ${REVIEW_TIER_RECENT}::int
  end`;
  const shuffle = sql`md5(${String(scope.userId)}::text || ':' || ${options.date}::text || ':' || ${annotations.id}::text)`;
  return sql`
    select id, book_id from (
      select distinct on (${annotations.bookId}) ${annotations.id} as id, ${annotations.bookId} as book_id, ${tier} as tier, ${shuffle} as shuffle
      from ${scopedFromSql(source)}
      where ${and(...where)}
      order by ${annotations.bookId}, tier, shuffle
    ) as candidates
    order by tier, shuffle, id
    limit ${options.limit}
  `;
}

/** A shuffle of the filtered highlights that the same seed repeats. */
export function seededReviewSql(scope: NotebookScope, db: Db, options: { filters: NotebookEntryFilters; seed: number; limit: number }): SQL {
  const source = NOTEBOOK_SOURCES.highlight;
  const where = armWhereSql(source, scope, db, { status: 'active', filters: options.filters, extra: [hasTextSql(annotations.text)] });
  return sql`
    select ${annotations.id} as id, ${annotations.bookId} as book_id
    from ${scopedFromSql(source)}
    where ${and(...where)}
    order by md5(${String(scope.userId)}::text || ':' || ${String(options.seed)}::text || ':' || ${annotations.id}::text), ${annotations.id}
    limit ${options.limit}
  `;
}
