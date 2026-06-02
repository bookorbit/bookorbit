import { RecommendationRepository } from './recommendation.repository';

type SelectStep = {
  terminal: 'where' | 'limit';
  result: unknown;
};

function makeDb(steps: SelectStep[]) {
  const chains: Array<Record<string, vi.Mock>> = [];

  const select = vi.fn().mockImplementation(() => {
    const step = steps.shift();
    if (!step) throw new Error('No mocked select step available');

    const chain = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
      innerJoin: vi.fn(),
      leftJoin: vi.fn(),
      orderBy: vi.fn(),
      groupBy: vi.fn(),
    };

    chain.from.mockReturnValue(chain);
    chain.innerJoin.mockReturnValue(chain);
    chain.leftJoin.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.groupBy.mockReturnValue(chain);
    chain.where.mockImplementation(() => {
      if (step.terminal === 'where') return Promise.resolve(step.result);
      return chain;
    });
    chain.limit.mockImplementation(() => Promise.resolve(step.result));

    chains.push(chain);
    return chain;
  });

  return {
    db: { select } as never,
    select,
    chains,
  };
}

describe('RecommendationRepository', () => {
  it('returns null target data when metadata does not exist', async () => {
    const { db, select } = makeDb([{ terminal: 'limit', result: [] }]);
    const repo = new RecommendationRepository(db);

    const result = await repo.getTargetBookData(100);

    expect(result).toBeNull();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('combines metadata, authors, genres, and tags for target book data', async () => {
    const { db, select } = makeDb([
      { terminal: 'limit', result: [{ embedding: [0.1, 0.2], seriesId: 42, seriesName: 'Saga', rating: 4.5 }] },
      {
        terminal: 'where',
        result: [
          { bookId: 7, name: 'Author A' },
          { bookId: 7, name: 'Author B' },
        ],
      },
      { terminal: 'where', result: [{ bookId: 7, name: 'Fantasy' }] },
      {
        terminal: 'where',
        result: [
          { bookId: 7, name: 'Epic' },
          { bookId: 7, name: 'Classic' },
        ],
      },
    ]);
    const repo = new RecommendationRepository(db);

    const result = await repo.getTargetBookData(7);

    expect(select).toHaveBeenCalledTimes(4);
    expect(result).toEqual({
      embedding: [0.1, 0.2],
      seriesId: 42,
      seriesName: 'Saga',
      rating: 4.5,
      authorNames: ['Author A', 'Author B'],
      genreTagNames: ['Fantasy', 'Epic', 'Classic'],
    });
  });

  it('returns empty ANN candidates when libraryIds is empty', async () => {
    const { db, select } = makeDb([]);
    const repo = new RecommendationRepository(db);

    const result = await repo.findAnnCandidates([0.2, 0.3], 10, []);

    expect(result).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('returns empty ANN candidates for invalid embeddings', async () => {
    const { db, select } = makeDb([]);
    const repo = new RecommendationRepository(db);

    await expect(repo.findAnnCandidates([], 10, [1])).resolves.toEqual([]);
    await expect(repo.findAnnCandidates([1, Number.NaN], 10, [1])).resolves.toEqual([]);
    await expect(repo.findAnnCandidates([1, Number.POSITIVE_INFINITY], 10, [1])).resolves.toEqual([]);

    expect(select).not.toHaveBeenCalled();
  });

  it('queries ANN candidates with expected query shape when input is valid', async () => {
    const rows = [{ bookId: 11, cosineSim: 0.77, seriesId: null, seriesName: null, rating: 3.8 }];
    const { db, select, chains } = makeDb([{ terminal: 'limit', result: rows }]);
    const repo = new RecommendationRepository(db);

    const result = await repo.findAnnCandidates([0.15, 0.45], 1, [3, 4]);

    expect(result).toEqual(rows);
    expect(select).toHaveBeenCalledTimes(1);
    expect(chains[0].from).toHaveBeenCalledTimes(1);
    expect(chains[0].innerJoin).toHaveBeenCalledTimes(1);
    expect(chains[0].where).toHaveBeenCalledTimes(1);
    expect(chains[0].orderBy).toHaveBeenCalledTimes(1);
    expect(chains[0].limit).toHaveBeenCalledWith(100);
  });

  it('returns empty metadata quickly when no book ids are requested', async () => {
    const { db, select } = makeDb([]);
    const repo = new RecommendationRepository(db);

    const result = await repo.getCandidateMetadata([]);

    expect(result).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('groups candidate metadata by book and preserves requested order', async () => {
    const { db } = makeDb([
      {
        terminal: 'where',
        result: [
          { bookId: 10, name: 'Author A' },
          { bookId: 10, name: 'Author B' },
          { bookId: 11, name: 'Author C' },
        ],
      },
      {
        terminal: 'where',
        result: [
          { bookId: 10, name: 'Fantasy' },
          { bookId: 11, name: 'History' },
        ],
      },
      {
        terminal: 'where',
        result: [{ bookId: 11, name: 'Award Winner' }],
      },
    ]);

    const repo = new RecommendationRepository(db);

    const result = await repo.getCandidateMetadata([11, 10, 99]);

    expect(result).toEqual([
      {
        bookId: 11,
        authorNames: ['Author C'],
        genreTagNames: ['History', 'Award Winner'],
      },
      {
        bookId: 10,
        authorNames: ['Author A', 'Author B'],
        genreTagNames: ['Fantasy'],
      },
      {
        bookId: 99,
        authorNames: [],
        genreTagNames: [],
      },
    ]);
  });

  it('returns null for getSeriesIdentity when no metadata exists', async () => {
    const { db, select } = makeDb([{ terminal: 'limit', result: [] }]);
    const repo = new RecommendationRepository(db);

    const result = await repo.getSeriesIdentity(100);

    expect(result).toBeNull();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('returns id and trimmed name for getSeriesIdentity', async () => {
    const { db } = makeDb([{ terminal: 'limit', result: [{ seriesId: 88, seriesName: '  Dune Saga  ' }] }]);
    const repo = new RecommendationRepository(db);

    const result = await repo.getSeriesIdentity(7);

    expect(result).toEqual({ id: 88, name: 'Dune Saga' });
  });

  it('returns identity with null name when series name is empty or whitespace', async () => {
    const { db } = makeDb([{ terminal: 'limit', result: [{ seriesId: 88, seriesName: '   ' }] }]);
    const repo = new RecommendationRepository(db);

    expect(await repo.getSeriesIdentity(7)).toEqual({ id: 88, name: null });
  });

  it('returns empty series books when libraryIds is empty', async () => {
    const { db, select } = makeDb([]);
    const repo = new RecommendationRepository(db);

    const result = await repo.findSeriesBooks(88, []);

    expect(result).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('returns null series identity when the metadata row has no series id', async () => {
    const { db, select } = makeDb([{ terminal: 'limit', result: [{ seriesId: null, seriesName: 'Dune' }] }]);
    const repo = new RecommendationRepository(db);

    const result = await repo.getSeriesIdentity(7);

    expect(result).toBeNull();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('queries series books with expected shape when input is valid', async () => {
    const rows = [
      { bookId: 1, title: 'Book 1', seriesIndex: 1, coverSource: 'extracted', primaryFormat: 'm4b' },
      { bookId: 2, title: 'Book 2', seriesIndex: 2, coverSource: null, primaryFormat: 'epub' },
    ];
    const authorRows = [{ bookId: 1, name: 'Frank Herbert' }];
    const { db, select, chains } = makeDb([
      { terminal: 'limit', result: rows },
      { terminal: 'where', result: authorRows },
    ]);
    const repo = new RecommendationRepository(db);

    const result = await repo.findSeriesBooks(88, [3, 4]);

    expect(result).toEqual([
      { bookId: 1, title: 'Book 1', seriesIndex: 1, coverSource: 'extracted', authorNames: ['Frank Herbert'], isAudiobook: true },
      { bookId: 2, title: 'Book 2', seriesIndex: 2, coverSource: null, authorNames: [], isAudiobook: false },
    ]);
    expect(select).toHaveBeenCalledTimes(2);
    expect(chains[0].from).toHaveBeenCalledTimes(1);
    expect(chains[0].leftJoin).toHaveBeenCalledTimes(2);
    expect(chains[0].where).toHaveBeenCalledTimes(1);
    expect(chains[0].orderBy).toHaveBeenCalledTimes(1);
    expect(chains[0].limit).toHaveBeenCalledWith(50);
  });

  it('returns series books with empty authorNames when no authors exist', async () => {
    const rows = [{ bookId: 5, title: 'Solo Book', seriesIndex: null, coverSource: null, primaryFormat: null }];
    const { db } = makeDb([
      { terminal: 'limit', result: rows },
      { terminal: 'where', result: [] },
    ]);
    const repo = new RecommendationRepository(db);

    const result = await repo.findSeriesBooks(88, [1]);

    expect(result).toEqual([{ bookId: 5, title: 'Solo Book', seriesIndex: null, coverSource: null, authorNames: [], isAudiobook: false }]);
  });

  it('returns empty author books when libraryIds is empty', async () => {
    const { db, select } = makeDb([]);
    const repo = new RecommendationRepository(db);

    const result = await repo.findAuthorBooks(1, []);

    expect(result).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('queries author books with expected shape when input is valid', async () => {
    const rows = [{ bookId: 10, title: 'Other Book', sharedAuthors: 2, coverSource: 'extracted', primaryFormat: 'MP3' }];
    const authorRows = [{ bookId: 10, name: 'Terry Pratchett' }];
    const { db, select, chains } = makeDb([
      { terminal: 'where', result: undefined },
      { terminal: 'limit', result: rows },
      { terminal: 'where', result: authorRows },
    ]);
    const repo = new RecommendationRepository(db);

    const result = await repo.findAuthorBooks(1, [3]);

    expect(result).toEqual([{ bookId: 10, title: 'Other Book', coverSource: 'extracted', authorNames: ['Terry Pratchett'], isAudiobook: true }]);
    expect(select).toHaveBeenCalledTimes(3);
    expect(chains[1].innerJoin).toHaveBeenCalledTimes(1);
    expect(chains[1].leftJoin).toHaveBeenCalledTimes(2);
    expect(chains[1].limit).toHaveBeenCalledWith(25);
  });

  it('returns author books with empty authorNames when no authors exist', async () => {
    const rows = [{ bookId: 7, title: 'Anonymous Work', sharedAuthors: 1, coverSource: null, primaryFormat: null }];
    const { db } = makeDb([
      { terminal: 'where', result: undefined },
      { terminal: 'limit', result: rows },
      { terminal: 'where', result: [] },
    ]);
    const repo = new RecommendationRepository(db);

    const result = await repo.findAuthorBooks(1, [1]);

    expect(result).toEqual([{ bookId: 7, title: 'Anonymous Work', coverSource: null, authorNames: [], isAudiobook: false }]);
  });
});
