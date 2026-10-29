import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { finishedReadScope } from './finished-read-scope';

const dialect = new PgDialect();
const render = (fragment: ReturnType<typeof finishedReadScope>) => dialect.sqlToQuery(fragment);

describe('finishedReadScope', () => {
  it('counts reads of present and deleted books alike when every library is in scope', () => {
    const { sql: text } = render(finishedReadScope(null));
    expect(text).toContain('"reading_attempts"."book_id" is not null');
    expect(text).toContain('"reading_attempts"."book_id" is null');
    expect(text).not.toContain('"books"."library_id" in');
  });

  it('scopes present books by their library and deleted ones by the library they were in', () => {
    const { sql: text, params } = render(finishedReadScope([3, 7]));
    expect(text).toContain('"books"."library_id" in ($1, $2)');
    expect(text).toContain('"reading_attempts"."book_library_id_snapshot" in ($3, $4)');
    expect(params).toEqual([3, 7, 3, 7]);
  });

  it('matches nothing when no library is in scope', () => {
    expect(render(finishedReadScope([])).sql).toBe('false');
  });

  it('applies content filters to present books only', () => {
    const { sql: text } = render(finishedReadScope(null, [sql`book_is_allowed`]));
    const [present, removed] = text.split(' or ');
    expect(present).toContain('book_is_allowed');
    expect(removed).not.toContain('book_is_allowed');
  });
});
