import { classifyEditionPair, differsAsEdition, toEditionFacts, type EditionFactsRow } from './book-duplicate-editions';

function row(id: number, overrides: Partial<EditionFactsRow> = {}): EditionFactsRow {
  return {
    id,
    isbn10: null,
    isbn13: null,
    hardcover_id: null,
    hardcover_edition_id: null,
    open_library_id: null,
    publisher: null,
    published_year: null,
    formats: ['epub'],
    narrators: [],
    ...overrides,
  };
}

const facts = (id: number, overrides: Partial<EditionFactsRow> = {}) => toEditionFacts(row(id, overrides));
const audio = (id: number, overrides: Partial<EditionFactsRow> = {}) => facts(id, { formats: ['m4b'], ...overrides });

describe('differsAsEdition', () => {
  it('tells two audiobook recordings apart by their narrators', () => {
    expect(differsAsEdition(audio(1, { narrators: ['Rob Inglis'] }), audio(2, { narrators: ['Andy Serkis'] }))).toBe(true);
    expect(
      differsAsEdition(audio(1, { narrators: ['Kate Reading', 'Michael Kramer'] }), audio(2, { narrators: ['michael kramer', 'Kate Reading'] })),
    ).toBe(false);
  });

  it('ignores narrators on ebooks, where they are stray metadata', () => {
    expect(differsAsEdition(facts(1, { narrators: ['Rob Inglis'] }), facts(2, { narrators: ['Andy Serkis'] }))).toBe(false);
  });

  it('treats a different ISBN, Hardcover edition or year as another edition', () => {
    expect(differsAsEdition(facts(1, { isbn13: '9780306406157' }), facts(2, { isbn10: '0441013597' }))).toBe(true);
    expect(differsAsEdition(facts(1, { hardcover_edition_id: '11' }), facts(2, { hardcover_edition_id: '12' }))).toBe(true);
    expect(differsAsEdition(facts(1, { published_year: 1965 }), facts(2, { published_year: 2005 }))).toBe(true);
  });

  it('treats one ISBN in two spellings as one edition', () => {
    expect(differsAsEdition(facts(1, { isbn13: '978-0-306-40615-7' }), facts(2, { isbn10: '0306406152' }))).toBe(false);
  });

  it('reads a publisher named inside a longer name as the same publisher', () => {
    expect(differsAsEdition(facts(1, { publisher: 'Tor' }), facts(2, { publisher: 'Tor Books' }))).toBe(false);
    expect(differsAsEdition(facts(1, { publisher: 'Gollancz' }), facts(2, { publisher: 'Ace Books' }))).toBe(true);
  });

  it('never calls a re-download with thinner metadata another edition', () => {
    expect(differsAsEdition(facts(1, { isbn13: '9780306406157', publisher: 'Ace', published_year: 1990 }), facts(2))).toBe(false);
    expect(differsAsEdition(audio(1, { narrators: ['Rob Inglis'] }), audio(2))).toBe(false);
  });
});

describe('classifyEditionPair', () => {
  const recordings = [audio(1, { narrators: ['Rob Inglis'] }), audio(2, { narrators: ['Andy Serkis'] })] as const;

  it('moves a title match that differs as an edition to other editions', () => {
    expect(classifyEditionPair({ kind: 'duplicate', reasons: ['exact_metadata'] }, ...recordings)).toEqual({
      action: 'reclassify',
      reasons: ['title_author'],
    });
  });

  it('adds the shared work when both carry the same work id', () => {
    const [a, b] = [
      audio(1, { narrators: ['Rob Inglis'], open_library_id: 'OL1W' }),
      audio(2, { narrators: ['Andy Serkis'], open_library_id: 'ol1w' }),
    ];
    expect(classifyEditionPair({ kind: 'duplicate', reasons: ['fuzzy_metadata'] }, a, b)).toEqual({
      action: 'reclassify',
      reasons: ['same_work', 'title_author'],
    });
  });

  it('keeps identical files and a shared ISBN as duplicates, whatever else differs', () => {
    expect(classifyEditionPair({ kind: 'duplicate', reasons: ['exact_metadata', 'file_hash'] }, ...recordings)).toEqual({ action: 'keep' });
    expect(classifyEditionPair({ kind: 'duplicate', reasons: ['isbn'] }, ...recordings)).toEqual({ action: 'keep' });
  });

  it('keeps a duplicate that does not differ as an edition', () => {
    expect(classifyEditionPair({ kind: 'duplicate', reasons: ['exact_metadata'] }, facts(1), facts(2))).toEqual({ action: 'keep' });
  });

  it('keeps a work-id candidate only when it differs as an edition', () => {
    expect(classifyEditionPair({ kind: 'other_edition', reasons: ['same_work'] }, ...recordings)).toEqual({ action: 'keep' });
    expect(classifyEditionPair({ kind: 'other_edition', reasons: ['same_work'] }, facts(1), facts(2))).toEqual({ action: 'drop' });
    expect(classifyEditionPair({ kind: 'other_edition', reasons: ['same_work'] }, recordings[0], undefined)).toEqual({ action: 'drop' });
  });

  it('never calls an ebook and an audiobook editions of one medium', () => {
    const ebook = facts(1, { published_year: 1965 });
    const recording = audio(2, { published_year: 2005 });
    expect(classifyEditionPair({ kind: 'duplicate', reasons: ['exact_metadata'] }, ebook, recording)).toEqual({ action: 'keep' });
    expect(classifyEditionPair({ kind: 'other_edition', reasons: ['same_work'] }, ebook, recording)).toEqual({ action: 'drop' });
  });
});
