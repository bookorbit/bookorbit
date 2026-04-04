vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ type: 'and', clauses })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: 'eq', left, right })),
  ilike: vi.fn((left: unknown, pattern: string) => ({ type: 'ilike', left, pattern })),
  isNotNull: vi.fn((value: unknown) => ({ type: 'isNotNull', value })),
  sql: vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', parts, values })),
}));

import { and, eq, ilike, isNotNull } from 'drizzle-orm';

import { authors, bookMetadata, collections, narrators } from '../../db/schema';
import { CatalogService } from './catalog.service';

interface QueryChain<T> {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  rows: T[];
}

function createQueryChain<T>(rows: T[]): QueryChain<T> {
  const chain: QueryChain<T> = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn().mockResolvedValue(rows),
    rows,
  };

  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);

  return chain;
}

function makeService() {
  let selectRows: { name: string }[] = [];
  let selectDistinctRows: { name: string | null }[] = [];

  const selectChains: QueryChain<{ name: string }>[] = [];
  const selectDistinctChains: QueryChain<{ name: string | null }>[] = [];

  const db = {
    select: vi.fn(() => {
      const chain = createQueryChain(selectRows);
      selectChains.push(chain);
      return chain;
    }),
    selectDistinct: vi.fn(() => {
      const chain = createQueryChain(selectDistinctRows);
      selectDistinctChains.push(chain);
      return chain;
    }),
  } as const;

  const service = new CatalogService(db as never);

  return {
    service,
    db,
    selectChains,
    selectDistinctChains,
    setSelectRows: (rows: { name: string }[]) => {
      selectRows = rows;
    },
    setSelectDistinctRows: (rows: { name: string | null }[]) => {
      selectDistinctRows = rows;
    },
  };
}

describe('CatalogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty result without querying the database for blank author terms', async () => {
    const { service, db } = makeService();

    await expect(service.searchAuthors('   ')).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('trims and escapes wildcard characters for name searches', async () => {
    const { service, setSelectRows, selectChains } = makeService();
    setSelectRows([{ name: 'A%_\\B' }]);

    const result = await service.searchAuthors('  A%_\\B  ');

    expect(result).toEqual([{ name: 'A%_\\B' }]);
    expect(ilike).toHaveBeenCalledWith(authors.name, '%A\\%\\_\\\\B%');
    expect(selectChains[0]?.from).toHaveBeenCalledWith(authors);
    expect(selectChains[0]?.orderBy).toHaveBeenCalledWith(authors.name);
    expect(selectChains[0]?.limit).toHaveBeenCalledWith(15);
  });

  it('uses the shared name-search helper for narrators', async () => {
    const { service, setSelectRows, selectChains } = makeService();
    setSelectRows([{ name: 'Ray Porter' }]);

    const result = await service.searchNarrators('Ray');

    expect(result).toEqual([{ name: 'Ray Porter' }]);
    expect(selectChains[0]?.from).toHaveBeenCalledWith(narrators);
    expect(selectChains[0]?.orderBy).toHaveBeenCalledWith(narrators.name);
    expect(selectChains[0]?.limit).toHaveBeenCalledWith(15);
  });

  it('uses distinct metadata lookup for publishers and filters null rows defensively', async () => {
    const { service, setSelectDistinctRows, selectDistinctChains } = makeService();
    setSelectDistinctRows([{ name: 'Orbit' }, { name: null }, { name: 'Tor' }]);

    const result = await service.searchPublishers('  or  ');

    expect(result).toEqual([{ name: 'Orbit' }, { name: 'Tor' }]);
    expect(isNotNull).toHaveBeenCalledWith(bookMetadata.publisher);
    expect(ilike).toHaveBeenCalledWith(bookMetadata.publisher, '%or%');
    expect(selectDistinctChains[0]?.from).toHaveBeenCalledWith(bookMetadata);
    expect(selectDistinctChains[0]?.limit).toHaveBeenCalledWith(15);
  });

  it('queries the expected metadata column for series search', async () => {
    const { service, setSelectDistinctRows } = makeService();
    setSelectDistinctRows([{ name: 'The Expanse' }]);

    await service.searchSeries('Expanse');

    expect(isNotNull).toHaveBeenCalledWith(bookMetadata.seriesName);
    expect(ilike).toHaveBeenCalledWith(bookMetadata.seriesName, '%Expanse%');
  });

  it('queries the expected metadata column for language search', async () => {
    const { service, setSelectDistinctRows } = makeService();
    setSelectDistinctRows([{ name: 'English' }]);

    await service.searchLanguages('English');

    expect(isNotNull).toHaveBeenCalledWith(bookMetadata.language);
    expect(ilike).toHaveBeenCalledWith(bookMetadata.language, '%English%');
  });

  it('returns an empty result for blank collection terms to match other search endpoints', async () => {
    const { service, db } = makeService();

    await expect(service.searchCollections(7, '   ')).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('enforces user scoping and collection limit for collection searches', async () => {
    const { service, setSelectRows, selectChains } = makeService();
    setSelectRows([{ name: 'Sci-Fi Favorites' }]);

    const result = await service.searchCollections(42, ' sci_fi% ');

    expect(result).toEqual([{ name: 'Sci-Fi Favorites' }]);
    expect(eq).toHaveBeenCalledWith(collections.userId, 42);
    expect(ilike).toHaveBeenCalledWith(collections.name, '%sci\\_fi\\%%');
    expect(and).toHaveBeenCalledTimes(1);
    expect(selectChains[0]?.from).toHaveBeenCalledWith(collections);
    expect(selectChains[0]?.where).toHaveBeenCalledWith(expect.objectContaining({ type: 'and' }));
    expect(selectChains[0]?.orderBy).toHaveBeenCalledWith(collections.name);
    expect(selectChains[0]?.limit).toHaveBeenCalledWith(20);
  });
});
