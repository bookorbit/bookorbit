import { readFileSync } from 'fs';
import { join } from 'path';

const SEARCH_ENTRY_POINTS = [
  'modules/annotation/annotation.repository.ts',
  'modules/authors/authors.repository.ts',
  'modules/book-dock/book-dock.repository.ts',
  'modules/book/book-query-builder.service.ts',
  'modules/book/book.repository.ts',
  'modules/catalog/catalog.service.ts',
  'modules/custom-icon/custom-icon.repository.ts',
  'modules/entity-manager/strategies/author.strategy.ts',
  'modules/entity-manager/strategies/inline-entity.strategy.ts',
  'modules/entity-manager/strategies/junction-entity.strategy.ts',
  'modules/entity-manager/strategies/series.strategy.ts',
  'modules/migration/planner/matching.service.ts',
  'modules/opds/opds-book.service.ts',
  'modules/series/series.repository.ts',
] as const;

// Entry points that turn a free-text term typed by a user into a LIKE pattern. Stored entity
// names are whitespace-normalized, and unaccent() does not touch whitespace, so these have to
// collapse the term the same way or a pasted non-breaking space matches nothing.
const FREE_TEXT_SEARCH_ENTRY_POINTS = [
  'modules/authors/authors.repository.ts',
  'modules/book/book-query-builder.service.ts',
  'modules/catalog/catalog.service.ts',
  'modules/opds/opds-book.service.ts',
  'modules/series/series.repository.ts',
] as const;

describe('accent-insensitive search entry points', () => {
  it.each(SEARCH_ENTRY_POINTS)('%s uses the shared accent-insensitive predicate', (relativePath) => {
    const source = readFileSync(join(__dirname, '..', '..', relativePath), 'utf8');

    expect(source).toContain('accentInsensitiveIlike');
    expect(source).not.toMatch(/\bilike\s*\(/i);
    expect(source).not.toMatch(/\bILIKE\b/);
  });

  it.each(FREE_TEXT_SEARCH_ENTRY_POINTS)('%s builds its search pattern through the shared helper', (relativePath) => {
    const source = readFileSync(join(__dirname, '..', '..', relativePath), 'utf8');

    expect(source).toContain('buildSearchPattern');
    expect(source).not.toMatch(/replace\(\s*\/\[[%_\\\\]/);
    expect(source).not.toMatch(/function escapeLikePattern/);
  });
});
