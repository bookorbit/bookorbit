import { BookEmbedderService } from './book-embedder.service';

function makeMetaChain(metaRow: unknown[] = []) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(metaRow),
  };
  return chain;
}

describe('BookEmbedderService', () => {
  const logger = { debug: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when book metadata is missing', async () => {
    const db = {
      select: vi.fn().mockReturnValue(makeMetaChain([])),
    };

    const service = new BookEmbedderService(db as never);

    await expect(service.embedBook(42)).resolves.toBeNull();
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('builds and persists deterministic embedding for metadata + relations', async () => {
    const metaChain = makeMetaChain([
      {
        title: 'The Last Wish',
        seriesName: 'The Witcher',
        publisher: 'Orbit',
        description: 'A monster hunter travels the world',
      },
    ]);

    const authorChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ name: 'Andrzej Sapkowski' }]),
    };
    const genreChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ name: 'Fantasy' }]),
    };
    const tagChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ name: 'Sword & Sorcery' }]),
    };

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set: updateSet });

    const db = {
      select: vi.fn().mockReturnValueOnce(metaChain).mockReturnValueOnce(authorChain).mockReturnValueOnce(genreChain).mockReturnValueOnce(tagChain),
      update,
    };

    const service = new BookEmbedderService(db as never);
    (service as unknown as { logger: typeof logger }).logger = logger as never;

    const embedding = await service.embedBook(7);

    expect(embedding).not.toBeNull();
    expect(embedding).toHaveLength(256);
    const norm = Math.sqrt((embedding ?? []).reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 10);

    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith({ embedding });
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith('Embedded book 7');

    const again = service.buildVector({
      title: 'The Last Wish',
      seriesName: 'The Witcher',
      publisher: 'Orbit',
      description: 'A monster hunter travels the world',
      authors: ['Andrzej Sapkowski'],
      genres: ['Fantasy'],
      tags: ['Sword & Sorcery'],
    });
    expect(again).toEqual(embedding);
  });

  it('filters stopwords/short tokens and keeps zero vector when no usable content', () => {
    const service = new BookEmbedderService({} as never);

    const vec = service.buildVector({
      title: 'a the of',
      description: 'it is as to',
      seriesName: null,
      publisher: null,
      authors: [],
      genres: [],
      tags: [],
    });

    expect(vec).toHaveLength(256);
    expect(vec.every((v) => v === 0)).toBe(true);
  });

  it('limits description contribution to first 100 words', () => {
    const service = new BookEmbedderService({} as never);

    const words = Array.from({ length: 130 }, (_, i) => `token${i}`);
    const longDescription = words.join(' ');

    const with130 = service.buildVector({
      title: null,
      seriesName: null,
      publisher: null,
      authors: [],
      genres: [],
      tags: [],
      description: longDescription,
    });

    const with100 = service.buildVector({
      title: null,
      seriesName: null,
      publisher: null,
      authors: [],
      genres: [],
      tags: [],
      description: words.slice(0, 100).join(' '),
    });

    expect(with130).toEqual(with100);
  });
});
