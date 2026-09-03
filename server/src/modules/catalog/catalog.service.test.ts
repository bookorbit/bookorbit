vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ type: 'and', clauses })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: 'eq', left, right })),
  ilike: vi.fn((left: unknown, pattern: string) => ({ type: 'ilike', left, pattern })),
  inArray: vi.fn((column: unknown, values: unknown[]) => ({ type: 'inArray', column, values })),
  isNotNull: vi.fn((value: unknown) => ({ type: 'isNotNull', value })),
  sql: vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', parts, values })),
}));

vi.mock('../../common/utils/accent-insensitive-search.utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../common/utils/accent-insensitive-search.utils')>()),
  accentInsensitiveIlike: vi.fn((left: unknown, pattern: string) => ({ type: 'accentInsensitiveIlike', left, pattern })),
}));

vi.mock('../../common/utils/content-filter-sql.utils', () => ({
  buildContentFilterClauses: vi.fn(() => [{ type: 'contentFilter' }]),
}));

import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { accentInsensitiveIlike } from '../../common/utils/accent-insensitive-search.utils';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import type { RequestUser } from '../../common/types/request-user';
import { authors, bookMetadata, bookSeries, bookTags, books, collections, narrators, tags } from '../../db/schema';
import { CatalogService } from './catalog.service';

interface QueryChain<T> {
  from: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  rows: T[];
}

function createQueryChain<T>(rows: T[]): QueryChain<T> {
  const chain: QueryChain<T> = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn().mockResolvedValue(rows),
    rows,
  };

  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);

  return chain;
}

function user(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 7,
    isSuperuser: false,
    contentFilters: { includeTagIds: [], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [] },
    ...overrides,
  } as RequestUser;
}

function makeService(libraryIds: number[] = [1, 2]) {
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

  const libraryService = { findAccessibleLibraryIds: vi.fn().mockResolvedValue(libraryIds) };
  const service = new CatalogService(db as never, libraryService as never);

  return {
    service,
    db,
    libraryService,
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

    await expect(service.searchAuthors(user(), '   ')).resolves.toEqual([]);
    expect(db.selectDistinct).not.toHaveBeenCalled();
  });

  it('trims and escapes wildcard characters for name searches', async () => {
    const { service, setSelectDistinctRows, selectDistinctChains } = makeService();
    setSelectDistinctRows([{ name: 'A%_\\B' }]);

    const result = await service.searchAuthors(user(), '  A%_\\B  ');

    expect(result).toEqual([{ name: 'A%_\\B' }]);
    expect(accentInsensitiveIlike).toHaveBeenCalledWith(authors.name, '%A\\%\\_\\\\B%');
    expect(selectDistinctChains[0]?.from).toHaveBeenCalledWith(authors);
    expect(selectDistinctChains[0]?.orderBy).toHaveBeenCalledWith(authors.name);
    expect(selectDistinctChains[0]?.limit).toHaveBeenCalledWith(15);
  });

  it('uses the shared name-search helper for narrators', async () => {
    const { service, setSelectDistinctRows, selectDistinctChains } = makeService();
    setSelectDistinctRows([{ name: 'Ray Porter' }]);

    const result = await service.searchNarrators(user(), 'Ray');

    expect(result).toEqual([{ name: 'Ray Porter' }]);
    expect(selectDistinctChains[0]?.from).toHaveBeenCalledWith(narrators);
    expect(selectDistinctChains[0]?.orderBy).toHaveBeenCalledWith(narrators.name);
  });

  it('uses distinct metadata lookup for publishers and filters null rows defensively', async () => {
    const { service, setSelectDistinctRows, selectDistinctChains } = makeService();
    setSelectDistinctRows([{ name: 'Orbit' }, { name: null }, { name: 'Tor' }]);

    const result = await service.searchPublishers(user(), '  or  ');

    expect(result).toEqual([{ name: 'Orbit' }, { name: 'Tor' }]);
    expect(isNotNull).toHaveBeenCalledWith(bookMetadata.publisher);
    expect(accentInsensitiveIlike).toHaveBeenCalledWith(bookMetadata.publisher, '%or%');
    expect(selectDistinctChains[0]?.from).toHaveBeenCalledWith(bookMetadata);
    expect(selectDistinctChains[0]?.limit).toHaveBeenCalledWith(15);
  });

  it('queries the expected metadata column for series search', async () => {
    const { service, setSelectDistinctRows, selectDistinctChains } = makeService();
    setSelectDistinctRows([{ name: 'The Expanse' }]);

    await service.searchSeries(user(), 'Expanse');

    expect(accentInsensitiveIlike).toHaveBeenCalledWith(bookSeries.name, '%Expanse%');
    expect(selectDistinctChains[0]?.from).toHaveBeenCalledWith(bookSeries);
  });

  it('queries the expected metadata column for language search', async () => {
    const { service, setSelectDistinctRows } = makeService();
    setSelectDistinctRows([{ name: 'English' }]);

    await service.searchLanguages(user(), 'English');

    expect(isNotNull).toHaveBeenCalledWith(bookMetadata.language);
    expect(accentInsensitiveIlike).toHaveBeenCalledWith(bookMetadata.language, '%English%');
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
    expect(accentInsensitiveIlike).toHaveBeenCalledWith(collections.name, '%sci\\_fi\\%%');
    expect(selectChains[0]?.from).toHaveBeenCalledWith(collections);
    expect(selectChains[0]?.orderBy).toHaveBeenCalledWith(collections.name);
    expect(selectChains[0]?.limit).toHaveBeenCalledWith(20);
  });

  // --- the reason this file changed: a suggestion must follow book visibility ---

  it('joins tag suggestions through to books so only reachable vocabulary is offered', async () => {
    const { service, setSelectDistinctRows, selectDistinctChains } = makeService([4, 9]);
    setSelectDistinctRows([{ name: 'erotica' }]);

    await service.searchTags(user(), 'erot');

    expect(selectDistinctChains[0]?.from).toHaveBeenCalledWith(tags);
    expect(selectDistinctChains[0]?.innerJoin).toHaveBeenCalledWith(bookTags, expect.anything());
    expect(selectDistinctChains[0]?.innerJoin).toHaveBeenCalledWith(books, expect.anything());
    expect(inArray).toHaveBeenCalledWith(books.libraryId, [4, 9]);
  });

  it('applies content filters to suggestions for a non-superuser', async () => {
    const { service, setSelectDistinctRows } = makeService();
    setSelectDistinctRows([]);

    await service.searchTags(user({ contentFilters: { includeTagIds: [3], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [] } }), 'k');

    expect(buildContentFilterClauses).toHaveBeenCalled();
  });

  it('does not apply content filters for a superuser, matching AuthorsService', async () => {
    const { service, setSelectDistinctRows } = makeService();
    setSelectDistinctRows([]);

    await service.searchTags(user({ isSuperuser: true }), 'k');

    expect(buildContentFilterClauses).not.toHaveBeenCalled();
  });

  it('suggests nothing when the user can open no library, rather than the whole vocabulary', async () => {
    const { service, db, libraryService } = makeService([]);

    await expect(service.searchTags(user(), 'erot')).resolves.toEqual([]);
    expect(libraryService.findAccessibleLibraryIds).toHaveBeenCalled();
    expect(db.selectDistinct).not.toHaveBeenCalled();
  });

  it('scopes genre suggestions the same way as tags', async () => {
    const { service, setSelectDistinctRows } = makeService([4]);
    setSelectDistinctRows([{ name: 'Erotica' }]);

    await service.searchGenres(user(), 'erot');

    expect(inArray).toHaveBeenCalledWith(books.libraryId, [4]);
    expect(and).toHaveBeenCalled();
  });
});
