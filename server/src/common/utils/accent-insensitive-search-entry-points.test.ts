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

describe('accent-insensitive search entry points', () => {
  it.each(SEARCH_ENTRY_POINTS)('%s uses the shared accent-insensitive predicate', (relativePath) => {
    const source = readFileSync(join(__dirname, '..', '..', relativePath), 'utf8');

    expect(source).toContain('accentInsensitiveIlike');
    expect(source).not.toMatch(/\bilike\s*\(/i);
    expect(source).not.toMatch(/\bILIKE\b/);
  });
});
