import { PgDialect, pgTable, text } from 'drizzle-orm/pg-core';

import { accentInsensitiveIlike, buildSearchPattern, escapeLikePattern } from './accent-insensitive-search.utils';

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

describe('escapeLikePattern', () => {
  it('escapes every LIKE metacharacter', () => {
    expect(escapeLikePattern('100%_off\\now')).toBe('100\\%\\_off\\\\now');
  });
});

describe('buildSearchPattern', () => {
  it('wraps the term in wildcards', () => {
    expect(buildSearchPattern('Dan Brown')).toBe('%Dan Brown%');
  });

  // unaccent() leaves whitespace alone, so a term that is not collapsed to the stored
  // normalized form matches nothing. See the 0068 migration.
  it.each([
    ['non-breaking space', 'Dan\u00A0Brown'],
    ['doubled space', 'Dan  Brown'],
    ['tab', 'Dan\tBrown'],
    ['newline', 'Dan\nBrown'],
    ['ideographic space', 'Dan\u3000Brown'],
    ['surrounding whitespace', '  Dan Brown  '],
  ])('collapses %s to a single space', (_label, term) => {
    expect(buildSearchPattern(term)).toBe('%Dan Brown%');
  });

  it('escapes LIKE metacharacters in the term', () => {
    expect(buildSearchPattern('50%_x')).toBe('%50\\%\\_x%');
  });

  it('escapes a backslash before it can consume the next character', () => {
    expect(buildSearchPattern('a\\b')).toBe('%a\\\\b%');
  });

  it('returns a bare wildcard for a whitespace-only term', () => {
    expect(buildSearchPattern('   ')).toBe('%%');
  });
});
