import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';

import { bookDockUnitFiles } from '../../db/schema';
import { UNIT_FILE_ORDER } from './book-dock.repository';

/**
 * `book-dock.repository.test.ts` mocks `drizzle-orm` down to plain objects, so it cannot see the
 * SQL that comes out the other end. This builds the real clause and reads the string.
 *
 * It exists because of a bug that shipped: `asc(sql\`x nulls last\`)` renders as
 * `x nulls last asc`, which Postgres rejects outright, so every finalize of a multi-file unit died
 * with a syntax error that reached the requester as "Held for review: Failed query".
 */
const db = drizzle({} as never);

describe('book_dock_unit_files ordering', () => {
  it('puts the direction before the null placement, the only order Postgres accepts', () => {
    const rendered = db
      .select()
      .from(bookDockUnitFiles)
      .orderBy(...UNIT_FILE_ORDER)
      .toSQL().sql;

    expect(rendered).toContain('"sort_order" asc nulls last');
    expect(rendered).not.toContain('nulls last asc');
  });
});
