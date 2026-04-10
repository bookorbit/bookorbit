import { SharedOverlaysImporter } from './shared-overlays.importer';

function makeRepoMocks() {
  const repo = {
    setRunMetric: vi.fn().mockResolvedValue(undefined),
  };
  const importRepo = {
    withTransaction: vi.fn().mockImplementation(async (handler: (repo: typeof importRepo) => Promise<unknown>) => handler(importRepo)),
    batchUpsertBookMetadata: vi.fn().mockResolvedValue(undefined),
    batchDeleteBookAuthors: vi.fn().mockResolvedValue(undefined),
    batchUpsertAuthors: vi.fn().mockResolvedValue(new Map()),
    batchInsertBookAuthors: vi.fn().mockResolvedValue(undefined),
    batchDeleteBookNarrators: vi.fn().mockResolvedValue(undefined),
    batchUpsertNarrators: vi.fn().mockResolvedValue(new Map()),
    batchInsertBookNarrators: vi.fn().mockResolvedValue(undefined),
    batchDeleteBookGenres: vi.fn().mockResolvedValue(undefined),
    batchUpsertGenres: vi.fn().mockResolvedValue(new Map()),
    batchInsertBookGenres: vi.fn().mockResolvedValue(undefined),
    batchDeleteBookTags: vi.fn().mockResolvedValue(undefined),
    batchUpsertTags: vi.fn().mockResolvedValue(new Map()),
    batchInsertBookTags: vi.fn().mockResolvedValue(undefined),
  };

  return { repo, importRepo };
}

describe('SharedOverlaysImporter', () => {
  it('imports metadata/contributors/genres/tags and tracks unresolved source books', async () => {
    const { repo, importRepo } = makeRepoMocks();
    importRepo.batchUpsertAuthors.mockResolvedValue(
      new Map([
        ['Frank Herbert', 1],
        ['Brian Herbert', 2],
      ]),
    );
    importRepo.batchUpsertNarrators.mockResolvedValue(new Map([['Narrator A', 7]]));
    importRepo.batchUpsertGenres.mockResolvedValue(new Map([['Science Fiction', 11]]));
    importRepo.batchUpsertTags.mockResolvedValue(new Map([['Space Opera', 12]]));

    const importer = new SharedOverlaysImporter(repo as never, importRepo as never);

    const planned = {
      execution: {
        matchedBooks: [
          { sourceBookId: 'source-1', targetBookId: 901 },
          { sourceBookId: 'missing', targetBookId: 902 },
        ],
        sourceData: {
          availableDomains: {
            metadata: true,
            authors: true,
            narrators: true,
            genres: true,
            tags: true,
          },
          books: [
            {
              sourceBookId: 'source-1',
              title: 'Dune',
              subtitle: null,
              isbn10: null,
              isbn13: null,
              description: 'Classic',
              publisher: 'Ace',
              publishedYear: 1965,
              language: 'en',
              author: 'unused',
              authors: [
                { name: 'Frank Herbert', sortName: 'Herbert, Frank', displayOrder: 0, description: null },
                { name: 'Brian Herbert', sortName: 'Herbert, Brian', displayOrder: 1, description: null },
              ],
              narrators: [{ name: 'Narrator A', sortName: null, displayOrder: 0, description: null }],
              genres: ['Science Fiction'],
              tags: ['Space Opera'],
            },
          ],
        },
      },
    };

    await importer.import(201, planned as never, async () => {});

    expect(importRepo.batchUpsertBookMetadata).toHaveBeenCalledWith([
      expect.objectContaining({
        bookId: 901,
        title: 'Dune',
        description: 'Classic',
        publisher: 'Ace',
        publishedYear: 1965,
        language: 'en',
      }),
    ]);
    expect(importRepo.batchDeleteBookAuthors).toHaveBeenCalledWith([901]);
    expect(importRepo.batchInsertBookAuthors).toHaveBeenCalledWith([
      { bookId: 901, authorId: 1, displayOrder: 0 },
      { bookId: 901, authorId: 2, displayOrder: 1 },
    ]);
    expect(importRepo.batchInsertBookNarrators).toHaveBeenCalledWith([{ bookId: 901, narratorId: 7, displayOrder: 0 }]);
    expect(importRepo.batchInsertBookGenres).toHaveBeenCalledWith([{ bookId: 901, genreId: 11 }]);
    expect(importRepo.batchInsertBookTags).toHaveBeenCalledWith([{ bookId: 901, tagId: 12 }]);

    expect(repo.setRunMetric).toHaveBeenCalledWith(
      201,
      'shared_overlays',
      'book_metadata',
      expect.objectContaining({
        processed: 2,
        imported: 1,
        unresolved: 1,
      }),
    );
  });
});
