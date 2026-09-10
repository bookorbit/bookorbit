vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ type: 'and', clauses })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: 'eq', left, right })),
  inArray: vi.fn((column: unknown, values: unknown[]) => ({ type: 'inArray', column, values })),
  isNotNull: vi.fn((value: unknown) => ({ type: 'isNotNull', value })),
  sql: vi.fn((parts: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', parts, values })),
}));

vi.mock('../../common/utils/accent-insensitive-search.utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../common/utils/accent-insensitive-search.utils')>()),
  accentInsensitiveExactMatchRank: vi.fn((left: unknown, term: string) => ({ type: 'rank', left, term })),
  accentInsensitiveIlike: vi.fn((left: unknown, pattern: string) => ({ type: 'ilike', left, pattern })),
}));

vi.mock('../../common/utils/content-filter-sql.utils', () => ({
  buildContentFilterClauses: vi.fn(() => [{ type: 'contentFilter' }]),
}));

import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import { accentInsensitiveExactMatchRank, accentInsensitiveIlike } from '../../common/utils/accent-insensitive-search.utils';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import {
  authors,
  bookAuthors,
  bookGenres,
  bookMetadata,
  bookNarrators,
  bookSeries,
  bookSeriesMemberships,
  bookTags,
  books,
  collections,
  genres,
  narrators,
  tags,
} from '../../db/schema';
import { CatalogRepository, type CatalogSearchScope } from './catalog.repository';

interface QueryChain {
  from: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
}

function createQueryChain(rows: unknown[]): QueryChain {
  const chain: QueryChain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn().mockResolvedValue(rows),
  };

  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.groupBy.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return chain;
}

function makeRepository(rows: unknown[] = []) {
  const selectChain = createQueryChain(rows);
  const selectDistinctChain = createQueryChain(rows);
  const db = {
    select: vi.fn(() => selectChain),
    selectDistinct: vi.fn(() => selectDistinctChain),
  };

  return {
    repository: new CatalogRepository(db as never),
    db,
    selectChain,
    selectDistinctChain,
  };
}

const filteredScope: CatalogSearchScope = {
  libraryIds: [4, 9],
  contentFilters: { ...EMPTY_CONTENT_FILTER_RULES, excludeTagIds: [3] },
};

describe('CatalogRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no author results without building a query for a blank term', async () => {
    const { repository, db } = makeRepository();

    await expect(repository.searchAuthors('   ', filteredScope)).resolves.toEqual([]);

    expect(db.selectDistinct).not.toHaveBeenCalled();
  });

  it.each([
    ['authors', authors, bookAuthors, (repository: CatalogRepository) => repository.searchAuthors('scope', filteredScope)],
    ['narrators', narrators, bookNarrators, (repository: CatalogRepository) => repository.searchNarrators('scope', filteredScope)],
    ['series', bookSeries, bookSeriesMemberships, (repository: CatalogRepository) => repository.searchSeries('scope', filteredScope)],
  ] as const)('joins %s through its book relation and applies the complete visibility scope', async (_label, table, junction, search) => {
    const { repository, selectDistinctChain } = makeRepository();

    await search(repository);

    expect(selectDistinctChain.from).toHaveBeenCalledWith(table);
    expect(selectDistinctChain.innerJoin).toHaveBeenCalledWith(junction, expect.anything());
    expect(selectDistinctChain.innerJoin).toHaveBeenCalledWith(books, expect.anything());
    expect(inArray).toHaveBeenCalledWith(books.libraryId, [4, 9]);
    expect(buildContentFilterClauses).toHaveBeenCalledWith(filteredScope.contentFilters, expect.anything());
  });

  it.each([
    ['genres', genres, bookGenres, (repository: CatalogRepository) => repository.searchGenres('  Young\u00a0 Adult  ', filteredScope)],
    ['tags', tags, bookTags, (repository: CatalogRepository) => repository.searchTags('  Young\u00a0 Adult  ', filteredScope)],
  ] as const)('deduplicates %s with grouping while retaining normalized exact-match ranking', async (_label, table, junction, search) => {
    const { repository, selectChain } = makeRepository();

    await search(repository);

    expect(selectChain.from).toHaveBeenCalledWith(table);
    expect(selectChain.innerJoin).toHaveBeenCalledWith(junction, expect.anything());
    expect(selectChain.innerJoin).toHaveBeenCalledWith(books, expect.anything());
    expect(accentInsensitiveIlike).toHaveBeenCalledWith(table.name, '%Young Adult%');
    expect(selectChain.groupBy).toHaveBeenCalledWith(table.id, table.name);
    expect(accentInsensitiveExactMatchRank).toHaveBeenCalledWith(table.name, 'Young Adult');
    expect(selectChain.orderBy).toHaveBeenCalledWith(expect.objectContaining({ type: 'rank' }), table.name);
  });

  it.each([
    ['publishers', bookMetadata.publisher, (repository: CatalogRepository) => repository.searchPublishers('scope', filteredScope)],
    ['languages', bookMetadata.language, (repository: CatalogRepository) => repository.searchLanguages('scope', filteredScope)],
  ] as const)('joins %s metadata to books before applying visibility', async (_label, column, search) => {
    const { repository, selectDistinctChain } = makeRepository([{ name: 'scope value' }, { name: null }]);

    await expect(search(repository)).resolves.toEqual([{ name: 'scope value' }]);

    expect(selectDistinctChain.from).toHaveBeenCalledWith(bookMetadata);
    expect(selectDistinctChain.innerJoin).toHaveBeenCalledWith(books, expect.anything());
    expect(isNotNull).toHaveBeenCalledWith(column);
    expect(inArray).toHaveBeenCalledWith(books.libraryId, [4, 9]);
  });

  it('does not build content-filter SQL for a superuser scope', async () => {
    const { repository } = makeRepository();

    await repository.searchTags('history', { libraryIds: [1, 2] });

    expect(buildContentFilterClauses).not.toHaveBeenCalled();
  });

  it('keeps collection lookup user-scoped and wildcard-safe', async () => {
    const { repository, selectChain } = makeRepository([{ name: 'Favorites' }]);

    await expect(repository.searchCollections(42, ' sci_fi% ')).resolves.toEqual([{ name: 'Favorites' }]);

    expect(eq).toHaveBeenCalledWith(collections.userId, 42);
    expect(accentInsensitiveIlike).toHaveBeenCalledWith(collections.name, '%sci\\_fi\\%%');
    expect(and).toHaveBeenCalled();
    expect(selectChain.from).toHaveBeenCalledWith(collections);
    expect(selectChain.limit).toHaveBeenCalledWith(20);
  });
});
