import type { ReleaseQuery } from './indexer-adapter';
import { buildSearchText } from './search-text';

function query(overrides: Partial<ReleaseQuery> = {}): ReleaseQuery {
  return { title: 'Dune', author: 'Frank Herbert', isbn13: null, isbn13s: [], mediaKind: 'ebook', language: null, limit: 25, ...overrides };
}

describe('buildSearchText', () => {
  it('joins the title and the author', () => {
    expect(buildSearchText(query())).toBe('Dune Frank Herbert');
  });

  it('searches without an author when the request names none', () => {
    expect(buildSearchText(query({ author: null }))).toBe('Dune');
  });

  /**
   * Measured against MyAnonaMouse: dropping "(Unabridged)" is the difference between six releases
   * and none, and a metadata provider puts it on nearly every audiobook.
   */
  it('drops the edition qualifier a metadata provider appends', () => {
    expect(buildSearchText(query({ title: 'Project Hail Mary (Unabridged)', author: 'Andy Weir' }))).toBe('Project Hail Mary Andy Weir');
    expect(buildSearchText(query({ title: 'Dune [Deluxe Edition]', author: null }))).toBe('Dune');
    expect(buildSearchText(query({ title: 'Dune (2005) (Retail)', author: null }))).toBe('Dune');
  });

  it('keeps the original title when it is nothing but a qualifier', () => {
    expect(buildSearchText(query({ title: '(Unabridged)', author: null }))).toBe('(Unabridged)');
  });
});
