import { and, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';

import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import * as schema from '../../db/schema';
import type { NotebookCursor } from './notebook-cursor';
import { toNotebookFilters, type NotebookScope } from './notebook-filters';
import {
  NOTEBOOK_SOURCES,
  armWhereSql,
  bookActivitySql,
  cursorSql,
  dailyReviewSql,
  filterSql,
  inRangesSql,
  keysetUnionSql,
  overviewSql,
  seededReviewSql,
  sortColumnSql,
  statusSql,
} from './notebook-sql';

const db = drizzle.mock({ schema });
const dialect = new PgDialect();
const scope: NotebookScope = { userId: 7, libraryIds: [1, 2] };

function render(fragment: SQL | SQL[]) {
  const query = dialect.sqlToQuery(Array.isArray(fragment) ? (and(...fragment) ?? (fragment[0] as SQL)) : fragment);
  return { sql: query.sql.replace(/\s+/g, ' '), params: query.params };
}

describe('filterSql', () => {
  it('rules other kinds out while a highlight-only filter is set', () => {
    for (const kind of ['journal', 'bookmark', 'review'] as const) {
      expect(render(filterSql(NOTEBOOK_SOURCES[kind], { starred: true })).sql).toContain('false');
    }
    const highlight = render(filterSql(NOTEBOOK_SOURCES.highlight, { starred: true, colors: ['#FACC15', 'yellow'] }));
    expect(highlight.sql).toContain('"annotations"."starred_at" is not null');
    expect(highlight.sql).toContain('"annotations"."color" in ($1, $2)');
    expect(highlight.params).toEqual(['#FACC15', 'yellow']);
  });

  it('asks highlights and bookmarks for a non-blank note and lets journal entries and reviews through', () => {
    expect(render(filterSql(NOTEBOOK_SOURCES.highlight, { hasNote: true })).sql).toBe(`"annotations"."note" ~ '[^[:space:]]'`);
    expect(render(filterSql(NOTEBOOK_SOURCES.bookmark, { hasNote: true })).sql).toBe(`"bookmarks"."note" ~ '[^[:space:]]'`);
    expect(filterSql(NOTEBOOK_SOURCES.journal, { hasNote: true })).toEqual([]);
    expect(filterSql(NOTEBOOK_SOURCES.review, { hasNote: true })).toEqual([]);
  });

  it('filters origins on highlights and bookmarks and treats journal entries and reviews as web', () => {
    const highlight = render(filterSql(NOTEBOOK_SOURCES.highlight, { origins: ['kobo'] }));
    expect(highlight.sql).toBe('"annotations"."origin" in ($1)');
    expect(highlight.params).toEqual(['kobo']);
    expect(render(filterSql(NOTEBOOK_SOURCES.bookmark, { origins: ['koreader'] })).sql).toBe('"bookmarks"."origin" in ($1)');
    expect(render(filterSql(NOTEBOOK_SOURCES.journal, { origins: ['kobo'] })).sql).toBe('false');
    expect(filterSql(NOTEBOOK_SOURCES.review, { origins: ['web', 'kobo'] })).toEqual([]);
  });

  it('counts a highlight as approximate unless an exact, non-empty CFI anchors it', () => {
    const { sql } = render(filterSql(NOTEBOOK_SOURCES.highlight, { approximate: true }));
    expect(sql).toContain('not exists');
    expect(sql).toContain(`"annotation_positions"."format" = 'cfi'`);
    expect(sql).toContain(`"annotation_positions"."status" = 'exact'`);
    expect(sql).toContain(`"annotation_positions"."pos0" <> ''`);
  });

  it('matches q against the entry text, the book title and its authors, with the pattern escaped and bound', () => {
    const { searchPattern } = toNotebookFilters({ q: '50%_off' });
    const { sql, params } = render(filterSql(NOTEBOOK_SOURCES.journal, { searchPattern }));
    expect(sql).toContain('public.bookorbit_unaccent("book_journal_entries"."body") ILIKE public.bookorbit_unaccent($1)');
    expect(sql).toContain('public.bookorbit_unaccent("book_journal_entries"."quote") ILIKE');
    expect(sql).toContain('public.bookorbit_unaccent("book_metadata"."title") ILIKE');
    expect(sql).toContain('public.bookorbit_unaccent("authors"."name") ILIKE');
    expect(sql).toContain('"book_authors"."book_id" = "book_journal_entries"."book_id"');
    expect(sql).not.toContain('50%_off');
    expect(params.every((param) => param === '%50\\%\\_off%')).toBe(true);
  });

  it('pins the book id on every kind, using the book id as the review id', () => {
    expect(render(filterSql(NOTEBOOK_SOURCES.review, { bookId: 4 })).sql).toBe('"user_book_notes"."book_id" = $1');
  });
});

describe('statusSql', () => {
  it('splits active and trashed rows on deleted_at, and gives reviews no trash', () => {
    expect(render(statusSql(NOTEBOOK_SOURCES.highlight, 'trashed')).sql).toBe('"annotations"."deleted_at" is not null');
    expect(render(statusSql(NOTEBOOK_SOURCES.bookmark, 'active')).sql).toBe('"bookmarks"."deleted_at" is null');
    expect(statusSql(NOTEBOOK_SOURCES.review, 'active')).toEqual([]);
    expect(render(statusSql(NOTEBOOK_SOURCES.review, 'trashed')).sql).toBe('false');
  });
});

describe('armWhereSql', () => {
  it('scopes every arm to the user, the accessible libraries and the content rules', () => {
    const { sql, params } = render(
      armWhereSql(NOTEBOOK_SOURCES.bookmark, { ...scope, contentFilters: { ...EMPTY_CONTENT_FILTER_RULES, excludeTagIds: [9] } }, db, {
        status: 'active',
      }),
    );
    expect(sql).toContain('"bookmarks"."user_id" = $1');
    expect(sql).toContain('"books"."library_id" in ($2, $3)');
    expect(sql).toContain('not exists (select 1 from "book_tags" where ("book_tags"."book_id" = "books"."id"');
    expect(params).toEqual([7, 1, 2, 9]);
  });

  it('only counts a review whose text is not blank', () => {
    expect(render(armWhereSql(NOTEBOOK_SOURCES.review, scope, db, { status: 'active' })).sql).toContain(`"user_book_notes"."note" ~ '[^[:space:]]'`);
  });
});

describe('cursorSql', () => {
  const ts = sortColumnSql(NOTEBOOK_SOURCES.journal, 'written');
  const cursor: NotebookCursor = { scope: 'newest', key: '2026-01-02T03:04:05.678901Z', rank: 1, id: 30 };

  it('descends: earlier kinds may tie on time, the same kind compares (time, id), later kinds must be older', () => {
    expect(render(cursorSql(NOTEBOOK_SOURCES.highlight, NOTEBOOK_SOURCES.highlight.writtenAt, cursor, 'desc')).sql).toBe(
      'coalesce("annotations"."source_created_at", "annotations"."created_at") <= $1::timestamptz',
    );
    const same = render(cursorSql(NOTEBOOK_SOURCES.journal, ts, cursor, 'desc'));
    expect(same.sql).toBe('("book_journal_entries"."created_at", "book_journal_entries"."id") < ($1::timestamptz, $2::int)');
    expect(same.params).toEqual(['2026-01-02T03:04:05.678901Z', 30]);
    expect(render(cursorSql(NOTEBOOK_SOURCES.bookmark, NOTEBOOK_SOURCES.bookmark.writtenAt, cursor, 'desc')).sql).toBe(
      '"bookmarks"."created_at" < $1::timestamptz',
    );
  });

  it('mirrors every bound when ascending', () => {
    expect(render(cursorSql(NOTEBOOK_SOURCES.highlight, NOTEBOOK_SOURCES.highlight.writtenAt, cursor, 'asc')).sql).toContain('> $1::timestamptz');
    expect(render(cursorSql(NOTEBOOK_SOURCES.journal, ts, cursor, 'asc')).sql).toContain(') > ($1::timestamptz, $2::int)');
    expect(render(cursorSql(NOTEBOOK_SOURCES.review, NOTEBOOK_SOURCES.review.writtenAt, cursor, 'asc')).sql).toBe(
      '"user_book_notes"."updated_at" >= $1::timestamptz',
    );
  });
});

describe('sortColumnSql', () => {
  it('uses the write time, the edit time or the deletion time', () => {
    expect(render(sortColumnSql(NOTEBOOK_SOURCES.highlight, 'edited')).sql).toBe('"annotations"."updated_at"');
    expect(render(sortColumnSql(NOTEBOOK_SOURCES.journal, 'deleted')).sql).toBe('"book_journal_entries"."deleted_at"');
    expect(render(sortColumnSql(NOTEBOOK_SOURCES.review, 'written')).sql).toBe('"user_book_notes"."updated_at"');
    expect(() => sortColumnSql(NOTEBOOK_SOURCES.review, 'deleted')).toThrow(RangeError);
  });
});

describe('keysetUnionSql', () => {
  const arms = (['highlight', 'bookmark'] as const).map((kind) => ({
    source: NOTEBOOK_SOURCES[kind],
    sortTs: NOTEBOOK_SOURCES[kind].writtenAt,
    where: armWhereSql(NOTEBOOK_SOURCES[kind], scope, db, { status: 'active' }),
  }));

  it('limits each arm on the index order before the merge and renders the key to the microsecond', () => {
    const { sql } = render(keysetUnionSql(arms, { direction: 'desc', limit: 41 }));
    expect(sql).toContain('order by coalesce("annotations"."source_created_at", "annotations"."created_at") desc, "annotations"."id" desc limit $');
    expect(sql).toContain('order by "bookmarks"."created_at" desc, "bookmarks"."id" desc limit $');
    expect(sql).toContain(' union all ');
    expect(sql).toContain(`to_char(sort_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_key`);
    expect(sql).toContain('order by sort_ts desc, kind_rank desc, id desc limit $');
  });

  it('adds the cursor bound to every arm', () => {
    const cursor: NotebookCursor = { scope: 'oldest', key: '2026-01-02T03:04:05.000000Z', rank: 0, id: 3 };
    const { sql } = render(keysetUnionSql(arms, { direction: 'asc', limit: 5, cursor }));
    expect(sql).toContain('"annotations"."created_at"), "annotations"."id") > ($');
    expect(sql).toContain('"bookmarks"."created_at" >= ');
    expect(sql).toContain('order by sort_ts asc, kind_rank asc, id asc');
  });

  it('never hands a time zone name to Postgres', () => {
    expect(render(keysetUnionSql(arms, { direction: 'desc', limit: 20 })).sql).not.toMatch(/at time zone \$/);
  });
});

describe('inRangesSql', () => {
  it('is false with no ranges and a half-open OR of ranges otherwise', () => {
    expect(render(inRangesSql(NOTEBOOK_SOURCES.bookmark.writtenAt, [])).sql).toBe('false');
    const { sql, params } = render(
      inRangesSql(NOTEBOOK_SOURCES.bookmark.writtenAt, [
        { start: '2025-10-03T22:00:00.000Z', end: '2025-10-04T22:00:00.000Z' },
        { start: '2024-10-03T22:00:00.000Z', end: '2024-10-04T22:00:00.000Z' },
      ]),
    );
    expect(sql).toBe(
      '(("bookmarks"."created_at" >= $1::timestamptz and "bookmarks"."created_at" < $2::timestamptz) or ("bookmarks"."created_at" >= $3::timestamptz and "bookmarks"."created_at" < $4::timestamptz))',
    );
    expect(params).toHaveLength(4);
  });
});

describe('overviewSql', () => {
  it('counts every kind in one statement and zeroes a kind the filters leave out', () => {
    const { sql } = render(overviewSql(scope, db, { starred: true }, ['highlight']));
    for (const name of ['highlights', 'journal', 'bookmarks', 'reviews', 'starred', 'with_notes', 'approximate', 'books', 'colors', 'origins']) {
      expect(sql).toContain(` as ${name}`);
    }
    const journalCte = sql.slice(sql.indexOf('j as ('), sql.indexOf('b as ('));
    expect(journalCte).toContain('and false');
  });
});

describe('bookActivitySql', () => {
  it('folds activity per book, scopes on books and pages by (last activity, book id)', () => {
    const cursor: NotebookCursor = { scope: 'books', key: '2026-01-02T03:04:05.000000Z', rank: 0, id: 12 };
    const { sql } = render(bookActivitySql(scope, db, { limit: 31, cursor, searchPattern: '%tolk%' }));
    expect(sql).toContain('group by book_id');
    expect(sql).toContain('bool_or(kind_rank = $');
    expect(sql).toContain('"books"."library_id" in (');
    expect(sql).toContain('(activity.last_ts, activity.book_id) < (');
    expect(sql).toContain('"book_metadata"."book_id" = "books"."id"');
    expect(sql).toContain('order by activity.last_ts desc, activity.book_id desc');
  });
});

describe('review decks', () => {
  it('orders the daily deck by tier, then a hash of user, date and id, one per book', () => {
    const first = render(dailyReviewSql(scope, db, { date: '2026-10-04', olderThan: '2026-09-04T00:00:00.000Z', limit: 10 }));
    const again = render(dailyReviewSql(scope, db, { date: '2026-10-04', olderThan: '2026-09-04T00:00:00.000Z', limit: 10 }));
    const nextDay = render(dailyReviewSql(scope, db, { date: '2026-10-05', olderThan: '2026-09-05T00:00:00.000Z', limit: 10 }));
    expect(first).toEqual(again);
    expect(nextDay.params).not.toEqual(first.params);
    expect(first.sql).toContain('select distinct on ("annotations"."book_id")');
    expect(first.sql).toContain(`md5($`);
    expect(first.sql).toContain(`"annotations"."text" ~ '[^[:space:]]'`);
    expect(first.sql).toContain('order by tier, shuffle, id');
    expect(first.params).toEqual(expect.arrayContaining(['7', '2026-10-04']));
  });

  it('shuffles the filtered highlights by a hash of user, seed and id', () => {
    const { sql, params } = render(seededReviewSql(scope, db, { filters: { colors: ['blue'] }, seed: -42, limit: 200 }));
    expect(sql).toContain('"annotations"."color" in (');
    expect(sql).toContain('order by md5($');
    expect(params).toEqual(expect.arrayContaining(['7', '-42', 'blue', 200]));
  });
});
