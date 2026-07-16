import { PgDialect, pgTable, text } from 'drizzle-orm/pg-core';

import { accentInsensitiveIlike } from './accent-insensitive-search.utils';

const records = pgTable('records', {
  name: text('name'),
});

describe('accentInsensitiveIlike', () => {
  it('applies unaccent to both the stored value and the search pattern', () => {
    const dialect = new PgDialect();

    const query = dialect.sqlToQuery(accentInsensitiveIlike(records.name, '%gracian%'));

    expect(query.sql).toBe('public.bookorbit_unaccent("records"."name") ILIKE public.bookorbit_unaccent($1)');
    expect(query.params).toEqual(['%gracian%']);
  });

  it('keeps wildcard escaping parameterized', () => {
    const dialect = new PgDialect();

    const query = dialect.sqlToQuery(accentInsensitiveIlike(records.name, '%100\\%\\_%'));

    expect(query.params).toEqual(['%100\\%\\_%']);
  });
});
