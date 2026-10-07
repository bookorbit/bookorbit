import { NOTEBOOK_ENTRY_KINDS } from '@bookorbit/types';

import { NOTEBOOK_KIND_RANK, hasHighlightOnlyFilter, notebookKindForRank, resolveNotebookKinds, toNotebookFilters } from './notebook-filters';

describe('toNotebookFilters', () => {
  it('treats false booleans as no filter', () => {
    expect(toNotebookFilters({ starred: false, hasNote: false, approximate: false })).toEqual({});
  });

  it('keeps true booleans', () => {
    expect(toNotebookFilters({ starred: true, hasNote: true, approximate: true })).toEqual({ starred: true, hasNote: true, approximate: true });
  });

  it('splits, trims and de-duplicates the colour list', () => {
    expect(toNotebookFilters({ colors: ' #FACC15, yellow,,#FACC15 ' }).colors).toEqual(['#FACC15', 'yellow']);
    expect(toNotebookFilters({ colors: ' , ' }).colors).toBeUndefined();
  });

  it('keeps origins and the book id', () => {
    expect(toNotebookFilters({ origins: ['kobo', 'kobo', 'web'], bookId: 12 })).toEqual({ origins: ['kobo', 'web'], bookId: 12 });
    expect(toNotebookFilters({ origins: [] }).origins).toBeUndefined();
  });

  it('turns q into an escaped LIKE pattern', () => {
    expect(toNotebookFilters({ q: '  50%_off\\now  ' }).searchPattern).toBe('%50\\%\\_off\\\\now%');
  });

  it('ignores a blank q', () => {
    expect(toNotebookFilters({ q: '   ' }).searchPattern).toBeUndefined();
  });
});

describe('resolveNotebookKinds', () => {
  it('returns every kind by default, in rank order', () => {
    expect(resolveNotebookKinds(undefined, {})).toEqual([...NOTEBOOK_ENTRY_KINDS]);
    expect(resolveNotebookKinds([], {})).toEqual([...NOTEBOOK_ENTRY_KINDS]);
  });

  it('honours the requested kinds', () => {
    expect(resolveNotebookKinds(['review', 'journal'], {})).toEqual(['journal', 'review']);
  });

  it.each([[{ starred: true as const }], [{ colors: ['yellow'] }], [{ approximate: true as const }]])(
    'leaves only highlights while a highlight-only filter is set: %j',
    (filters) => {
      expect(hasHighlightOnlyFilter(filters)).toBe(true);
      expect(resolveNotebookKinds(undefined, filters)).toEqual(['highlight']);
      expect(resolveNotebookKinds(['journal', 'bookmark'], filters)).toEqual([]);
    },
  );

  it('keeps every kind for hasNote, which journal entries and reviews always meet', () => {
    expect(resolveNotebookKinds(undefined, { hasNote: true })).toEqual([...NOTEBOOK_ENTRY_KINDS]);
  });

  it('drops journal entries and reviews for an origin filter without web', () => {
    expect(resolveNotebookKinds(undefined, { origins: ['koreader', 'kobo'] })).toEqual(['highlight', 'bookmark']);
  });

  it('keeps journal entries and reviews when web is among the origins', () => {
    expect(resolveNotebookKinds(undefined, { origins: ['web', 'kobo'] })).toEqual([...NOTEBOOK_ENTRY_KINDS]);
  });
});

describe('kind ranks', () => {
  it('maps every rank back to its kind', () => {
    for (const kind of NOTEBOOK_ENTRY_KINDS) expect(notebookKindForRank(NOTEBOOK_KIND_RANK[kind])).toBe(kind);
    expect(NOTEBOOK_KIND_RANK).toEqual({ highlight: 0, journal: 1, bookmark: 2, review: 3 });
  });

  it('throws on an unknown rank', () => {
    expect(() => notebookKindForRank(9)).toThrow(RangeError);
  });
});
