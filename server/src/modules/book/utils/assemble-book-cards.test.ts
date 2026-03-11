import { assembleBookCards } from './assemble-book-cards';

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
    ...overrides,
  };
}

describe('assembleBookCards', () => {
  it('assembles a simple book card with authors and files', () => {
    const rows = [makeBookRow(1)];
    const authorRows = [{ bookId: 1, name: 'Author A' }];
    const fileRows = [{ bookId: 1, id: 10, format: 'epub', role: 'primary' }];

    const [card] = assembleBookCards(rows, authorRows, fileRows, [], [], []);

    expect(card.id).toBe(1);
    expect(card.title).toBe('Book 1');
    expect(card.authors).toEqual(['Author A']);
    expect(card.files).toEqual([{ id: 10, format: 'epub', role: 'primary' }]);
  });

  it('falls back to basename of folderPath when title is null', () => {
    const rows = [makeBookRow(2, { title: null, folderPath: '/books/my-book-folder' })];

    const [card] = assembleBookCards(rows, [], [], [], [], []);

    expect(card.title).toBe('my-book-folder');
  });

  it('returns reading progress from primary file', () => {
    const rows = [makeBookRow(1)];
    const fileRows = [
      { bookId: 1, id: 10, format: 'epub', role: 'primary' },
      { bookId: 1, id: 11, format: 'pdf', role: 'supplemental' },
    ];
    const progressRows = [
      { bookFileId: 10, percentage: 45 },
      { bookFileId: 11, percentage: 80 },
    ];

    const [card] = assembleBookCards(rows, [], fileRows, [], [], progressRows);

    expect(card.readingProgress).toBe(45);
  });

  it('falls back to first file for progress when no primary file exists', () => {
    const rows = [makeBookRow(1)];
    const fileRows = [{ bookId: 1, id: 11, format: 'pdf', role: 'supplemental' }];
    const progressRows = [{ bookFileId: 11, percentage: 30 }];

    const [card] = assembleBookCards(rows, [], fileRows, [], [], progressRows);

    expect(card.readingProgress).toBe(30);
  });

  it('returns null readingProgress when there are no files', () => {
    const rows = [makeBookRow(1)];
    const [card] = assembleBookCards(rows, [], [], [], [], []);
    expect(card.readingProgress).toBeNull();
  });

  it('returns null readingProgress when progress is not recorded for the file', () => {
    const rows = [makeBookRow(1)];
    const fileRows = [{ bookId: 1, id: 10, format: 'epub', role: 'primary' }];

    const [card] = assembleBookCards(rows, [], fileRows, [], [], []);

    expect(card.readingProgress).toBeNull();
  });

  it('assembles genres and tags per book', () => {
    const rows = [makeBookRow(1)];
    const genreRows = [
      { bookId: 1, name: 'Fiction' },
      { bookId: 1, name: 'Sci-Fi' },
    ];
    const tagRows = [{ bookId: 1, name: 'favorite' }];

    const [card] = assembleBookCards(rows, [], [], genreRows, tagRows, []);

    expect(card.genres).toEqual(['Fiction', 'Sci-Fi']);
    expect(card.tags).toEqual(['favorite']);
  });

  it('processes multiple books independently', () => {
    const rows = [makeBookRow(1), makeBookRow(2)];
    const authorRows = [
      { bookId: 1, name: 'Author A' },
      { bookId: 2, name: 'Author B' },
    ];

    const cards = assembleBookCards(rows, authorRows, [], [], [], []);

    expect(cards[0].authors).toEqual(['Author A']);
    expect(cards[1].authors).toEqual(['Author B']);
  });

  it('returns empty arrays for books with no related data', () => {
    const rows = [makeBookRow(1)];
    const [card] = assembleBookCards(rows, [], [], [], [], []);

    expect(card.authors).toEqual([]);
    expect(card.files).toEqual([]);
    expect(card.genres).toEqual([]);
    expect(card.tags).toEqual([]);
  });

  it('formats addedAt as ISO string', () => {
    const addedAt = new Date('2024-06-15T10:30:00.000Z');
    const rows = [makeBookRow(1, { addedAt })];

    const [card] = assembleBookCards(rows, [], [], [], [], []);

    expect(card.addedAt).toBe('2024-06-15T10:30:00.000Z');
  });

  it('returns an empty array when given no book rows', () => {
    const cards = assembleBookCards([], [], [], [], [], []);
    expect(cards).toEqual([]);
  });

  it('includes all optional metadata fields', () => {
    const rows = [makeBookRow(1, { seriesName: 'Dune', seriesIndex: 1, publishedYear: 1965, language: 'en', rating: 5 })];

    const [card] = assembleBookCards(rows, [], [], [], [], []);

    expect(card.seriesName).toBe('Dune');
    expect(card.seriesIndex).toBe(1);
    expect(card.publishedYear).toBe(1965);
    expect(card.language).toBe('en');
    expect(card.rating).toBe(5);
  });

  it('returns null for all optional fields when absent', () => {
    const rows = [makeBookRow(1)];
    const [card] = assembleBookCards(rows, [], [], [], [], []);

    expect(card.seriesName).toBeNull();
    expect(card.seriesIndex).toBeNull();
    expect(card.publishedYear).toBeNull();
    expect(card.language).toBeNull();
    expect(card.rating).toBeNull();
  });

  it('handles a book with progress percentage of 0', () => {
    const rows = [makeBookRow(1)];
    const fileRows = [{ bookId: 1, id: 10, format: 'epub', role: 'primary' }];
    const progressRows = [{ bookFileId: 10, percentage: 0 }];

    const [card] = assembleBookCards(rows, [], fileRows, [], [], progressRows);

    // 0 is a valid progress value, not null
    expect(card.readingProgress).toBe(0);
  });
});
