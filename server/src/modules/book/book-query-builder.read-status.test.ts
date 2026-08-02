import { drizzle } from 'drizzle-orm/node-postgres';

import type { GroupRule, RuleOperator } from '@bookorbit/types';

import * as schema from '../../db/schema';
import { books } from '../../db/schema';
import { BookQueryBuilder } from './book-query-builder.service';
import { BookSortBuilder } from './book-sort-builder.service';

// A real drizzle instance over a stub pg client: nothing is executed against a server, but the
// predicates are compiled by the real dialect, so these assertions are on the SQL production would
// actually send. The mocked-drizzle suite in book-query-builder.service.test.ts can only assert
// clause shapes; this one pins the emitted SQL.
function makeDb() {
  const client = { query: () => Promise.resolve({ rows: [], fields: [] }) };
  return drizzle({ client: client as never, schema });
}

const USER_ID = 10;

type Compiled = { text: string; params: unknown[]; predicate: string };

function compileReadStatusWhere(operator: RuleOperator, value?: string[]): Compiled {
  const db = makeDb();
  const builder = new BookQueryBuilder(db as never, new BookSortBuilder());
  const filter = {
    type: 'group',
    join: 'AND',
    rules: [{ type: 'rule', field: 'readStatus', operator, ...(value ? { value } : {}) }],
  } as unknown as GroupRule;

  const where = builder.buildWhere(filter, { accessibleLibraryIds: [1], userId: USER_ID });
  const { sql, params } = db.select({ id: books.id }).from(books).where(where).toSQL();

  // Drop the library scope so assertions read against the read-status predicate alone.
  const marker = 'and ';
  const predicate = sql.slice(sql.indexOf(marker, sql.indexOf('library_id')) + marker.length, sql.length - 1);
  return { text: sql, params, predicate };
}

function countOccurrences(text: string, needle: RegExp): number {
  return text.match(needle)?.length ?? 0;
}

const STATUS_SUBQUERY = /from "user_book_status"/g;
const USER_SCOPE = /"user_book_status"\."user_id" = \$/g;
const BOOK_CORRELATION = /"user_book_status"\."book_id" = "books"\."id"/g;

/**
 * Issue #815: a book only gets a user_book_status row once a status is set explicitly or derived
 * from reading progress. A Hardcover import writes rows for every status except 'unread', so a
 * freshly imported library has no row at all for its genuinely unread books. The UI, sorting, jump
 * buckets and the OPDS unread shelf all read a missing row as 'unread', so the filter must too.
 */
describe('readStatus filter: books with no user_book_status row', () => {
  it('includesAny unread also matches books that have no status row', () => {
    const { predicate, params } = compileReadStatusWhere('includesAny', ['unread']);

    expect(predicate).toContain('not exists');
    expect(countOccurrences(predicate, STATUS_SUBQUERY)).toBe(2);
    expect(params).toEqual([1, USER_ID, 'unread', USER_ID]);
  });

  it('unions the two branches with OR, so neither branch narrows the other', () => {
    const { predicate } = compileReadStatusWhere('includesAny', ['unread']);

    expect(predicate).toContain(' or not exists');
    expect(predicate).not.toContain(' and not exists');
  });

  it('includesAny unread + want_to_read keeps the row-backed and the row-less branch', () => {
    const { predicate, params } = compileReadStatusWhere('includesAny', ['unread', 'want_to_read']);

    expect(predicate).toContain('"user_book_status"."status" in ($3, $4)');
    expect(predicate).toContain(' or not exists');
    expect(params).toEqual([1, USER_ID, 'unread', 'want_to_read', USER_ID]);
  });

  it('excludesAll unread rejects books that have no status row', () => {
    const { predicate, params } = compileReadStatusWhere('excludesAll', ['unread']);

    // The book must have a row, and that row must not be unread.
    expect(predicate).toMatch(/^\(not exists \([\s\S]*\) and exists \([\s\S]*\)\)$/);
    expect(countOccurrences(predicate, STATUS_SUBQUERY)).toBe(2);
    expect(params).toEqual([1, USER_ID, 'unread', USER_ID]);
  });

  it('scopes both branches to the requesting user', () => {
    const { predicate, params } = compileReadStatusWhere('includesAny', ['unread']);

    expect(countOccurrences(predicate, USER_SCOPE)).toBe(2);
    expect(params.filter((p) => p === USER_ID)).toHaveLength(2);
  });

  it('correlates both branches to the outer book row', () => {
    const { predicate } = compileReadStatusWhere('includesAny', ['unread']);

    expect(countOccurrences(predicate, BOOK_CORRELATION)).toBe(2);
  });

  it('rejects the filter when no user is in context, so the row-less branch can never leak', () => {
    const db = makeDb();
    const builder = new BookQueryBuilder(db as never, new BookSortBuilder());
    const filter = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'readStatus', operator: 'includesAny', value: ['unread'] }],
    } as unknown as GroupRule;

    expect(() => builder.buildWhere(filter, { accessibleLibraryIds: [1] })).toThrow(/authenticated user/);
  });
});

describe('readStatus filter: statuses that always have a row', () => {
  it('includesAny without unread stays a single exists, so row-less books are excluded', () => {
    const { predicate, params } = compileReadStatusWhere('includesAny', ['reading', 'read']);

    expect(predicate).not.toContain('not exists');
    expect(countOccurrences(predicate, STATUS_SUBQUERY)).toBe(1);
    expect(params).toEqual([1, USER_ID, 'reading', 'read']);
  });

  it('excludesAll without unread stays a single not exists, so row-less books still match', () => {
    const { predicate, params } = compileReadStatusWhere('excludesAll', ['abandoned']);

    expect(predicate).toMatch(/^not exists \(/);
    expect(countOccurrences(predicate, STATUS_SUBQUERY)).toBe(1);
    expect(params).toEqual([1, USER_ID, 'abandoned']);
  });

  it('isEmpty still means "no explicit status record", not "unread"', () => {
    const { predicate, params } = compileReadStatusWhere('isEmpty');

    expect(predicate).toMatch(/^not exists \(/);
    expect(countOccurrences(predicate, STATUS_SUBQUERY)).toBe(1);
    expect(params).not.toContain('unread');
  });

  it('isNotEmpty still means "has an explicit status record"', () => {
    const { predicate, params } = compileReadStatusWhere('isNotEmpty');

    expect(predicate).not.toContain('not exists');
    expect(countOccurrences(predicate, STATUS_SUBQUERY)).toBe(1);
    expect(params).not.toContain('unread');
  });

  it('includesAny with no values stays always-false', () => {
    const { predicate } = compileReadStatusWhere('includesAny', []);

    expect(predicate).toContain('1 = 0');
    expect(predicate).not.toContain('user_book_status');
  });

  it('excludesAll with no values stays always-true', () => {
    const { predicate } = compileReadStatusWhere('excludesAll', []);

    expect(predicate).toContain('1 = 1');
    expect(predicate).not.toContain('user_book_status');
  });
});
