import { assembleBookCards, assembleCollapsedBookCards, collapseBookCards } from './assemble-book-cards';

function makeBookRow(id: number, overrides?: Partial<Parameters<typeof assembleBookCards>[0][number]>) {
  return {
    id,
    status: 'ready',
    folderPath: `/books/folder-${id}`,
    addedAt: new Date('2024-01-01T00:00:00.000Z'),
    title: `Book ${id}`,
    seriesName: null,
    seriesIndex: null,
    publishedYear: null,
    language: null,
    rating: null,
    coverSource: null,
    lockedFields: null,
    subtitle: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
    ...overrides,
  };
}

describe('assembleBookCards', () => {
  it('assembles a simple book card with authors and files', () => {
    const rows = [makeBookRow(1)];
    const authorRows = [{ bookId: 1, name: 'Author A' }];
    const fileRows = [{ bookId: 1, id: 10, format: 'epub', role: 'primary', sizeBytes: null }];

    const [card] = assembleBookCards(rows, authorRows, fileRows, [], []);

    expect(card.id).toBe(1);
    expect(card.title).toBe('Book 1');
    expect(card.authors).toEqual(['Author A']);
    expect(card.files).toEqual([{ id: 10, format: 'epub', role: 'primary', sizeBytes: null }]);
  });

  it('includes updatedAt, metadataScore, and file size when present', () => {
    const rows = [makeBookRow(1, { updatedAt: new Date('2024-02-01T00:00:00.000Z'), metadataScore: 88 })];
    const fileRows = [{ bookId: 1, id: 10, format: 'epub', role: 'primary', sizeBytes: 4096 }];

    const [card] = assembleBookCards(rows, [], fileRows, [], []);

    expect(card.updatedAt).toBe('2024-02-01T00:00:00.000Z');
    expect(card.metadataScore).toBe(88);
    expect(card.files).toEqual([{ id: 10, format: 'epub', role: 'primary', sizeBytes: 4096 }]);
  });

  it('falls back to basename of folderPath when title is null', () => {
    const rows = [makeBookRow(2, { title: null, folderPath: '/books/my-book-folder' })];

    const [card] = assembleBookCards(rows, [], [], [], []);

    expect(card.title).toBe('my-book-folder');
  });

  it('returns reading progress from primary file', () => {
    const rows = [makeBookRow(1)];
    const fileRows = [
      { bookId: 1, id: 10, format: 'epub', role: 'primary', sizeBytes: null },
      { bookId: 1, id: 11, format: 'pdf', role: 'supplemental', sizeBytes: null },
    ];
    const progressRows = [
      { bookFileId: 10, percentage: 45 },
      { bookFileId: 11, percentage: 80 },
    ];

    const [card] = assembleBookCards(rows, [], fileRows, [], progressRows);

    expect(card.readingProgress).toBe(45);
  });

  it('falls back to first file for progress when no primary file exists', () => {
    const rows = [makeBookRow(1)];
    const fileRows = [{ bookId: 1, id: 11, format: 'pdf', role: 'supplemental', sizeBytes: null }];
    const progressRows = [{ bookFileId: 11, percentage: 30 }];

    const [card] = assembleBookCards(rows, [], fileRows, [], progressRows);

    expect(card.readingProgress).toBe(30);
  });

  it('returns null readingProgress when there are no files', () => {
    const rows = [makeBookRow(1)];
    const [card] = assembleBookCards(rows, [], [], [], []);
    expect(card.readingProgress).toBeNull();
  });

  it('returns null readingProgress when progress is not recorded for the file', () => {
    const rows = [makeBookRow(1)];
    const fileRows = [{ bookId: 1, id: 10, format: 'epub', role: 'primary', sizeBytes: null }];

    const [card] = assembleBookCards(rows, [], fileRows, [], []);

    expect(card.readingProgress).toBeNull();
  });

  it('assembles genres per book', () => {
    const rows = [makeBookRow(1)];
    const genreRows = [
      { bookId: 1, name: 'Fiction' },
      { bookId: 1, name: 'Sci-Fi' },
    ];

    const [card] = assembleBookCards(rows, [], [], genreRows, []);

    expect(card.genres).toEqual(['Fiction', 'Sci-Fi']);
  });

  it('processes multiple books independently', () => {
    const rows = [makeBookRow(1), makeBookRow(2)];
    const authorRows = [
      { bookId: 1, name: 'Author A' },
      { bookId: 2, name: 'Author B' },
    ];

    const cards = assembleBookCards(rows, authorRows, [], [], []);

    expect(cards[0].authors).toEqual(['Author A']);
    expect(cards[1].authors).toEqual(['Author B']);
  });

  it('returns empty arrays for books with no related data', () => {
    const rows = [makeBookRow(1)];
    const [card] = assembleBookCards(rows, [], [], [], []);

    expect(card.authors).toEqual([]);
    expect(card.files).toEqual([]);
    expect(card.genres).toEqual([]);
  });

  it('formats addedAt as ISO string', () => {
    const addedAt = new Date('2024-06-15T10:30:00.000Z');
    const rows = [makeBookRow(1, { addedAt })];

    const [card] = assembleBookCards(rows, [], [], [], []);

    expect(card.addedAt).toBe('2024-06-15T10:30:00.000Z');
  });

  it('returns an empty array when given no book rows', () => {
    const cards = assembleBookCards([], [], [], [], []);
    expect(cards).toEqual([]);
  });

  it('sets hasCover to false when coverSource is null', () => {
    const rows = [makeBookRow(1, { coverSource: null })];
    const [card] = assembleBookCards(rows, [], [], [], []);
    expect(card.hasCover).toBe(false);
  });

  it('sets hasCover to true when coverSource is non-null', () => {
    const rows = [makeBookRow(1, { coverSource: 'extracted' })];
    const [card] = assembleBookCards(rows, [], [], [], []);
    expect(card.hasCover).toBe(true);
  });

  it('marks cards with metadata locks', () => {
    const rows = [makeBookRow(1, { lockedFields: ['title'] })];

    const [card] = assembleBookCards(rows, [], [], [], []);

    expect(card.hasMetadataLocks).toBe(true);
    expect(card.lockedFields).toEqual(['title']);
  });

  it('marks cards without metadata locks as unlocked', () => {
    const rows = [makeBookRow(1, { lockedFields: [] })];

    const [card] = assembleBookCards(rows, [], [], [], []);

    expect(card.hasMetadataLocks).toBe(false);
    expect(card.lockedFields).toEqual([]);
  });

  it('returns empty lockedFields when lockedFields row is null', () => {
    const rows = [makeBookRow(1, { lockedFields: null })];

    const [card] = assembleBookCards(rows, [], [], [], []);

    expect(card.hasMetadataLocks).toBe(false);
    expect(card.lockedFields).toEqual([]);
  });

  it('normalizes lockedFields by filtering out unknown field names', () => {
    const rows = [makeBookRow(1, { lockedFields: ['title', 'unknownField', 'authors'] })];

    const [card] = assembleBookCards(rows, [], [], [], []);

    expect(card.lockedFields).toEqual(['title', 'authors']);
    expect(card.hasMetadataLocks).toBe(true);
  });

  it('returns lockedFields with multiple known fields', () => {
    const rows = [makeBookRow(1, { lockedFields: ['title', 'authors', 'seriesName', 'cover'] })];

    const [card] = assembleBookCards(rows, [], [], [], []);

    expect(card.lockedFields).toEqual(['title', 'authors', 'seriesName', 'cover']);
    expect(card.hasMetadataLocks).toBe(true);
  });

  it('includes all optional metadata fields', () => {
    const rows = [makeBookRow(1, { seriesName: 'Dune', seriesIndex: 1, publishedYear: 1965, language: 'en', rating: 5 })];

    const [card] = assembleBookCards(rows, [], [], [], []);

    expect(card.seriesName).toBe('Dune');
    expect(card.seriesIndex).toBe(1);
    expect(card.publishedYear).toBe(1965);
    expect(card.language).toBe('en');
    expect(card.rating).toBe(5);
  });

  it('returns null for all optional fields when absent', () => {
    const rows = [makeBookRow(1)];
    const [card] = assembleBookCards(rows, [], [], [], []);

    expect(card.seriesName).toBeNull();
    expect(card.seriesIndex).toBeNull();
    expect(card.publishedYear).toBeNull();
    expect(card.language).toBeNull();
    expect(card.rating).toBeNull();
  });

  it('handles a book with progress percentage of 0', () => {
    const rows = [makeBookRow(1)];
    const fileRows = [{ bookId: 1, id: 10, format: 'epub', role: 'primary', sizeBytes: null }];
    const progressRows = [{ bookFileId: 10, percentage: 0 }];

    const [card] = assembleBookCards(rows, [], fileRows, [], progressRows);

    // 0 is a valid progress value, not null
    expect(card.readingProgress).toBe(0);
  });

  it('populates narrators from narratorRows', () => {
    const rows = [makeBookRow(1)];
    const narratorRows = [
      { bookId: 1, name: 'Narrator A' },
      { bookId: 1, name: 'Narrator B' },
    ];
    const [card] = assembleBookCards(rows, [], [], [], [], [], narratorRows);
    expect(card.narrators).toEqual(['Narrator A', 'Narrator B']);
  });

  it('returns empty narrators array when no narratorRows for book', () => {
    const rows = [makeBookRow(1)];
    const [card] = assembleBookCards(rows, [], [], [], []);
    expect(card.narrators).toEqual([]);
  });

  it('maps subtitle, publisher, pageCount, isbn13 from row', () => {
    const rows = [makeBookRow(1, { subtitle: 'A Subtitle', publisher: 'Pub', pageCount: 300, isbn13: '9780000000000' })];
    const [card] = assembleBookCards(rows, [], [], [], []);
    expect(card.subtitle).toBe('A Subtitle');
    expect(card.publisher).toBe('Pub');
    expect(card.pageCount).toBe(300);
    expect(card.isbn13).toBe('9780000000000');
  });

  it('returns null for subtitle, publisher, pageCount, isbn13 when absent', () => {
    const rows = [makeBookRow(1)];
    const [card] = assembleBookCards(rows, [], [], [], []);
    expect(card.subtitle).toBeNull();
    expect(card.publisher).toBeNull();
    expect(card.pageCount).toBeNull();
    expect(card.isbn13).toBeNull();
  });

  it('populates tags from tagRows', () => {
    const rows = [makeBookRow(1)];
    const tagRows = [
      { bookId: 1, name: 'sci-fi' },
      { bookId: 1, name: 'classic' },
    ];
    const [card] = assembleBookCards(rows, [], [], [], [], [], [], tagRows);
    expect(card.tags).toEqual(['sci-fi', 'classic']);
  });

  it('returns empty tags array when no tagRows for book', () => {
    const rows = [makeBookRow(1)];
    const [card] = assembleBookCards(rows, [], [], [], []);
    expect(card.tags).toEqual([]);
  });

  it('assigns tags to correct books in multi-book assembly', () => {
    const rows = [makeBookRow(1), makeBookRow(2)];
    const tagRows = [
      { bookId: 1, name: 'fiction' },
      { bookId: 2, name: 'non-fiction' },
      { bookId: 2, name: 'history' },
    ];
    const cards = assembleBookCards(rows, [], [], [], [], [], [], tagRows);
    expect(cards[0].tags).toEqual(['fiction']);
    expect(cards[1].tags).toEqual(['non-fiction', 'history']);
  });
});

function makeCollapsedRow(id: number, overrides?: Record<string, unknown>) {
  return {
    id,
    status: 'ready',
    primaryFileId: null,
    folderPath: `/books/folder-${id}`,
    addedAt: new Date('2024-01-01T00:00:00.000Z'),
    title: `Book ${id}`,
    seriesName: 'Test Series',
    seriesIndex: id,
    publishedYear: null,
    language: null,
    rating: null,
    coverSource: null,
    lockedFields: null,
    subtitle: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
    bookCount: 3,
    readCount: 1,
    coverBookIds: [id],
    seriesLatestAddedAt: new Date('2024-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeBookCard(id: number, overrides?: Record<string, unknown>) {
  return {
    id,
    status: 'ready',
    title: `Book ${id}`,
    authors: [] as string[],
    seriesName: null as string | null,
    seriesIndex: null as number | null,
    files: [] as { id: number; format: string | null; role: string }[],
    publishedYear: null,
    language: null,
    genres: [] as string[],
    rating: null,
    readingProgress: null,
    readStatus: null as { status: string } | null,
    addedAt: '2024-01-01T00:00:00.000Z',
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [] as string[],
    subtitle: null as string | null,
    publisher: null as string | null,
    pageCount: null as number | null,
    isbn13: null as string | null,
    narrators: [] as string[],
    ...overrides,
  };
}

describe('assembleCollapsedBookCards', () => {
  it('sets collapsedSeries on rows with non-null bookCount', () => {
    const rows = [makeCollapsedRow(1)];
    const [card] = assembleCollapsedBookCards(rows, [], [], [], []);

    expect(card!.collapsedSeries).toBeDefined();
    expect(card!.collapsedSeries!.bookCount).toBe(3);
    expect(card!.collapsedSeries!.readCount).toBe(1);
    expect(card!.collapsedSeries!.coverBookIds).toEqual([1]);
  });

  it('does not set collapsedSeries on rows with null bookCount (standalones)', () => {
    const rows = [makeCollapsedRow(1, { bookCount: null })];
    const [card] = assembleCollapsedBookCards(rows, [], [], [], []);

    expect(card!.collapsedSeries).toBeUndefined();
  });

  it('converts seriesLatestAddedAt Date to ISO string', () => {
    const date = new Date('2024-06-15T12:00:00.000Z');
    const rows = [makeCollapsedRow(1, { seriesLatestAddedAt: date })];
    const [card] = assembleCollapsedBookCards(rows, [], [], [], []);

    expect(card!.collapsedSeries!.seriesLatestAddedAt).toBe('2024-06-15T12:00:00.000Z');
  });

  it('sets seriesLatestAddedAt to null when date is null', () => {
    const rows = [makeCollapsedRow(1, { seriesLatestAddedAt: null })];
    const [card] = assembleCollapsedBookCards(rows, [], [], [], []);

    expect(card!.collapsedSeries!.seriesLatestAddedAt).toBeNull();
  });

  it('sets coverBookIds to empty array when null', () => {
    const rows = [makeCollapsedRow(1, { coverBookIds: null })];
    const [card] = assembleCollapsedBookCards(rows, [], [], [], []);

    expect(card!.collapsedSeries!.coverBookIds).toEqual([]);
  });

  it('preserves base card fields alongside collapsedSeries', () => {
    const rows = [makeCollapsedRow(10, { title: 'Book Ten' })];
    const authorRows = [{ bookId: 10, name: 'Author X' }];
    const [card] = assembleCollapsedBookCards(rows, authorRows, [], [], []);

    expect(card!.title).toBe('Book Ten');
    expect(card!.authors).toEqual(['Author X']);
    expect(card!.collapsedSeries).toBeDefined();
  });
});

describe('collapseBookCards', () => {
  it('returns empty array for empty input', () => {
    expect(collapseBookCards([])).toEqual([]);
  });

  it('returns standalone books unchanged (no collapsedSeries)', () => {
    const cards = [makeBookCard(1, { title: 'Alpha' }), makeBookCard(2, { title: 'Beta' })];
    const result = collapseBookCards(cards);

    expect(result).toHaveLength(2);
    expect(result.every((c) => c.collapsedSeries === undefined)).toBe(true);
  });

  it('collapses multiple books in the same series into one card', () => {
    const cards = [
      makeBookCard(1, { seriesName: 'Dune', seriesIndex: 1 }),
      makeBookCard(2, { seriesName: 'Dune', seriesIndex: 2 }),
      makeBookCard(3, { seriesName: 'Dune', seriesIndex: 3 }),
    ];
    const result = collapseBookCards(cards);

    expect(result).toHaveLength(1);
    expect(result[0]!.collapsedSeries!.bookCount).toBe(3);
  });

  it('collapses series case-insensitively', () => {
    const cards = [makeBookCard(1, { seriesName: 'DUNE', seriesIndex: 1 }), makeBookCard(2, { seriesName: 'dune', seriesIndex: 2 })];
    const result = collapseBookCards(cards);

    expect(result).toHaveLength(1);
    expect(result[0]!.collapsedSeries!.bookCount).toBe(2);
  });

  it('treats books with null seriesName as standalones', () => {
    const cards = [makeBookCard(1, { seriesName: null }), makeBookCard(2, { seriesName: '  ' })];
    const result = collapseBookCards(cards);

    expect(result).toHaveLength(2);
    expect(result.every((c) => c.collapsedSeries === undefined)).toBe(true);
  });

  it('picks representative with lowest seriesIndex', () => {
    const cards = [
      makeBookCard(3, { seriesName: 'Mistborn', seriesIndex: 3 }),
      makeBookCard(1, { seriesName: 'Mistborn', seriesIndex: 1 }),
      makeBookCard(2, { seriesName: 'Mistborn', seriesIndex: 2 }),
    ];
    const result = collapseBookCards(cards);

    expect(result[0]!.id).toBe(1);
  });

  it('falls back to addedAt order when seriesIndex is null', () => {
    const cards = [
      makeBookCard(2, { seriesName: 'Arc', seriesIndex: null, addedAt: '2024-03-01T00:00:00.000Z' }),
      makeBookCard(1, { seriesName: 'Arc', seriesIndex: null, addedAt: '2024-01-01T00:00:00.000Z' }),
    ];
    const result = collapseBookCards(cards);

    expect(result[0]!.id).toBe(1);
  });

  it('prefers books with indexes over books without when sorting', () => {
    const cards = [makeBookCard(2, { seriesName: 'Arc', seriesIndex: null }), makeBookCard(1, { seriesName: 'Arc', seriesIndex: 1 })];
    const result = collapseBookCards(cards);

    expect(result[0]!.id).toBe(1);
  });

  it('counts readCount correctly', () => {
    const cards = [
      makeBookCard(1, { seriesName: 'Series', readStatus: { status: 'read' } }),
      makeBookCard(2, { seriesName: 'Series', readStatus: { status: 'reading' } }),
      makeBookCard(3, { seriesName: 'Series', readStatus: { status: 'read' } }),
    ];
    const result = collapseBookCards(cards);

    expect(result[0]!.collapsedSeries!.readCount).toBe(2);
  });

  it('includes bookCount equal to group size', () => {
    const cards = [makeBookCard(1, { seriesName: 'S' }), makeBookCard(2, { seriesName: 'S' }), makeBookCard(3, { seriesName: 'S' })];
    const result = collapseBookCards(cards);

    expect(result[0]!.collapsedSeries!.bookCount).toBe(3);
  });

  it('prefers books with covers for coverBookIds', () => {
    const cards = [
      makeBookCard(1, { seriesName: 'S', seriesIndex: 1, hasCover: false }),
      makeBookCard(2, { seriesName: 'S', seriesIndex: 2, hasCover: true }),
      makeBookCard(3, { seriesName: 'S', seriesIndex: 3, hasCover: true }),
    ];
    const result = collapseBookCards(cards);

    expect(result[0]!.collapsedSeries!.coverBookIds).toEqual([2, 3]);
  });

  it('falls back to all sorted books when none have covers', () => {
    const cards = [
      makeBookCard(1, { seriesName: 'S', seriesIndex: 1, hasCover: false }),
      makeBookCard(2, { seriesName: 'S', seriesIndex: 2, hasCover: false }),
    ];
    const result = collapseBookCards(cards);

    expect(result[0]!.collapsedSeries!.coverBookIds).toEqual([1, 2]);
  });

  it('caps coverBookIds at 4', () => {
    const cards = Array.from({ length: 6 }, (_, i) => makeBookCard(i + 1, { seriesName: 'BigSeries', seriesIndex: i + 1, hasCover: true }));
    const result = collapseBookCards(cards);

    expect(result[0]!.collapsedSeries!.coverBookIds).toHaveLength(4);
  });

  it('returns results in first-occurrence order, preserving input sequence', () => {
    const cards = [
      makeBookCard(1, { title: 'Zephyr', seriesName: null }),
      makeBookCard(2, { seriesName: 'Amber', seriesIndex: 1, title: null }),
      makeBookCard(3, { title: 'Mango', seriesName: null }),
      makeBookCard(4, { seriesName: 'Cobalt', seriesIndex: 1, title: null }),
    ];
    const result = collapseBookCards(cards);

    const keys = result.map((c) => (c.seriesName?.trim() ?? c.title ?? '').toLowerCase());
    expect(keys).toEqual(['zephyr', 'amber', 'mango', 'cobalt']);
  });

  it('keeps multiple distinct series separate', () => {
    const cards = [
      makeBookCard(1, { seriesName: 'Alpha' }),
      makeBookCard(2, { seriesName: 'Alpha' }),
      makeBookCard(3, { seriesName: 'Beta' }),
      makeBookCard(4, { seriesName: 'Beta' }),
      makeBookCard(5, { seriesName: 'Beta' }),
    ];
    const result = collapseBookCards(cards);

    expect(result).toHaveLength(2);
    const alpha = result.find((c) => c.seriesName === 'Alpha');
    const beta = result.find((c) => c.seriesName === 'Beta');
    expect(alpha!.collapsedSeries!.bookCount).toBe(2);
    expect(beta!.collapsedSeries!.bookCount).toBe(3);
  });
});
