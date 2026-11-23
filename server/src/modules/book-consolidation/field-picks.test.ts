import { getTableColumns } from 'drizzle-orm';

import { bookMetadata } from '../../db/schema';
import { BOOK_MERGE_FIELD_SPECS, fieldValue, resolveFieldSources, type BookFacts } from './field-picks';

function facts(bookId: number, metadata: Record<string, unknown>, lockedFields: string[] = []): BookFacts {
  return { bookId, metadata, lockedFields: new Set(lockedFields), authors: [], narrators: [], series: [], hasAudio: false };
}

describe('merge field picks', () => {
  it('names only real book_metadata columns', () => {
    const columns = new Set(Object.keys(getTableColumns(bookMetadata)));
    const named = Object.values(BOOK_MERGE_FIELD_SPECS).flatMap((spec) => spec.columns);

    expect(named.filter((column) => !columns.has(column))).toEqual([]);
  });

  it('picks the edition name and first published year on their own, apart from the published year', () => {
    const target = facts(1, { publishedYear: 2020, editionName: null, originalPublishedYear: null });
    const source = facts(2, { publishedYear: 2001, editionName: 'Full Cast', originalPublishedYear: 1954 });

    const sources = resolveFieldSources([target, source]);

    expect(sources.get('editionName')).toBe(2);
    expect(sources.get('originalPublishedYear')).toBe(2);
    expect(sources.get('publishedYear')).toBe(1);
    expect(fieldValue('editionName', source)).toBe('Full Cast');
    expect(fieldValue('originalPublishedYear', source)).toBe(1954);
  });

  it('keeps a locked edition name on the kept book', () => {
    const target = facts(1, { editionName: null }, ['editionName']);
    const source = facts(2, { editionName: 'Full Cast' });

    expect(resolveFieldSources([target, source]).get('editionName')).toBe(1);
  });
});
