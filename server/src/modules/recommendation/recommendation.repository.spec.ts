import { RecommendationRepository } from './recommendation.repository';

type SelectStep = {
  terminal: 'where' | 'limit';
  result: unknown;
};

function makeDb(steps: SelectStep[]) {
  const chains: Array<Record<string, jest.Mock>> = [];

  const select = jest.fn().mockImplementation(() => {
    const step = steps.shift();
    if (!step) throw new Error('No mocked select step available');

    const chain = {
      from: jest.fn(),
      where: jest.fn(),
      limit: jest.fn(),
      innerJoin: jest.fn(),
      leftJoin: jest.fn(),
      orderBy: jest.fn(),
    };

    chain.from.mockReturnValue(chain);
    chain.innerJoin.mockReturnValue(chain);
    chain.leftJoin.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
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
      { terminal: 'limit', result: [{ embedding: [0.1, 0.2], seriesName: 'Saga', rating: 4.5 }] },
      { terminal: 'where', result: [{ name: 'Author A' }, { name: 'Author B' }] },
      { terminal: 'where', result: [{ name: 'Fantasy' }] },
      { terminal: 'where', result: [{ name: 'Epic' }, { name: 'Classic' }] },
    ]);
    const repo = new RecommendationRepository(db);

    const result = await repo.getTargetBookData(7);

    expect(select).toHaveBeenCalledTimes(4);
    expect(result).toEqual({
      embedding: [0.1, 0.2],
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
    const rows = [{ bookId: 11, cosineSim: 0.77, seriesName: null, rating: 3.8 }];
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
});
