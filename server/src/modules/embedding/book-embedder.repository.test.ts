import { BookEmbedderRepository } from './book-embedder.repository';

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
    };

    chain.from.mockReturnValue(chain);
    chain.innerJoin.mockReturnValue(chain);
    chain.where.mockImplementation(() => {
      if (step.terminal === 'where') return Promise.resolve(step.result);
      return chain;
    });
    chain.limit.mockImplementation(() => Promise.resolve(step.result));

    chains.push(chain);
    return chain;
  });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  return {
    db: { select, update } as never,
    select,
    chains,
    update,
    updateSet,
    updateWhere,
  };
}

describe('BookEmbedderRepository', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when metadata row does not exist', async () => {
    const { db, select } = makeDb([{ terminal: 'limit', result: [] }]);
    const repository = new BookEmbedderRepository(db);

    const result = await repository.findSourceData(42);

    expect(result).toBeNull();
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('combines metadata with normalized author, genre, and tag names', async () => {
    const { db, select } = makeDb([
      {
        terminal: 'limit',
        result: [
          {
            title: 'The Last Wish',
            seriesName: 'The Witcher',
            publisher: 'Orbit',
            description: 'A monster hunter travels the world',
          },
        ],
      },
      {
        terminal: 'where',
        result: [{ name: ' Andrzej Sapkowski ' }, { name: ' ' }, { name: null }],
      },
      {
        terminal: 'where',
        result: [{ name: 'Fantasy' }, { name: 'Epic Fantasy' }],
      },
      {
        terminal: 'where',
        result: [{ name: 'Sword & Sorcery' }, { name: '' }],
      },
    ]);
    const repository = new BookEmbedderRepository(db);

    const result = await repository.findSourceData(7);

    expect(select).toHaveBeenCalledTimes(4);
    expect(result).toEqual({
      title: 'The Last Wish',
      seriesName: 'The Witcher',
      publisher: 'Orbit',
      description: 'A monster hunter travels the world',
      authors: ['Andrzej Sapkowski'],
      genres: ['Fantasy', 'Epic Fantasy'],
      tags: ['Sword & Sorcery'],
    });
  });

  it('persists embedding vectors to book metadata', async () => {
    const { db, update, updateSet, updateWhere } = makeDb([]);
    const repository = new BookEmbedderRepository(db);
    const embedding = [0.1, 0.2, 0.3];

    await repository.saveEmbedding(11, embedding);

    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith({ embedding });
    expect(updateWhere).toHaveBeenCalledTimes(1);
  });
});
