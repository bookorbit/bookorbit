import { BookRepository } from './book.repository';

function makeSelectChain<T>(terminalMethod: string, terminalResult: T) {
  const chain: Record<string, jest.Mock> = {
    from: jest.fn(),
    leftJoin: jest.fn(),
    innerJoin: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    offset: jest.fn(),
  };

  chain.from.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.offset.mockReturnValue(chain);

  if (terminalMethod === 'where') {
    chain.where.mockResolvedValue(terminalResult);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
  } else if (terminalMethod === 'orderBy') {
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockResolvedValue(terminalResult);
    chain.limit.mockReturnValue(chain);
  } else {
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockResolvedValue(terminalResult);
  }

  return chain;
}

describe('BookRepository', () => {
  it('returns empty pattern metadata without hitting DB when no book ids are provided', async () => {
    const db = { select: jest.fn() };
    const repo = new BookRepository(db as never);

    const result = await repo.findPatternMetadataByBookIds([]);

    expect(result).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('merges metadata rows with ordered author names per book', async () => {
    const metaRows = [
      {
        bookId: 10,
        title: 'Dune',
        subtitle: null,
        publisher: 'Ace',
        publishedYear: 1965,
        language: 'en',
        seriesName: 'Dune',
        seriesIndex: 1,
        isbn13: '9780000000001',
      },
      {
        bookId: 11,
        title: 'Hyperion',
        subtitle: null,
        publisher: null,
        publishedYear: null,
        language: null,
        seriesName: null,
        seriesIndex: null,
        isbn13: null,
      },
    ];
    const authorRows = [
      { bookId: 10, name: 'Frank Herbert' },
      { bookId: 10, name: 'Coauthor' },
      { bookId: 11, name: 'Dan Simmons' },
    ];

    const metaChain = makeSelectChain('where', metaRows);
    const authorChain = makeSelectChain('orderBy', authorRows);
    const db = {
      select: jest.fn().mockReturnValueOnce(metaChain).mockReturnValueOnce(authorChain),
    };

    const repo = new BookRepository(db as never);

    const result = await repo.findPatternMetadataByBookIds([10, 11]);

    expect(result).toEqual([
      {
        ...metaRows[0],
        authors: ['Frank Herbert', 'Coauthor'],
      },
      {
        ...metaRows[1],
        authors: ['Dan Simmons'],
      },
    ]);
  });

  it('returns empty search results quickly when no library ids are given', async () => {
    const db = {
      select: jest.fn(),
      selectDistinct: jest.fn(),
    };
    const repo = new BookRepository(db as never);

    const result = await repo.searchAcrossLibraries([], 'dune', 10);

    expect(result).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('combines title results with author names and unique formats', async () => {
    const rows = [
      { id: 10, title: 'Dune', seriesName: 'Dune', libraryId: 7, libraryName: 'Main' },
      { id: 11, title: 'Hyperion', seriesName: null, libraryId: 7, libraryName: 'Main' },
    ];
    const authorRows = [
      { bookId: 10, name: 'Frank Herbert' },
      { bookId: 10, name: 'F. Herbert' },
      { bookId: 11, name: 'Dan Simmons' },
    ];
    const formatRows = [
      { bookId: 10, format: 'epub' },
      { bookId: 10, format: 'epub' },
      { bookId: 10, format: 'pdf' },
      { bookId: 11, format: null },
    ];

    const distinctChain = {
      from: jest.fn(),
      innerJoin: jest.fn(),
      where: jest.fn(),
      as: jest.fn().mockReturnValue({}),
    };
    distinctChain.from.mockReturnValue(distinctChain);
    distinctChain.innerJoin.mockReturnValue(distinctChain);
    distinctChain.where.mockReturnValue(distinctChain);

    const mainChain = makeSelectChain('limit', rows);
    const authorChain = makeSelectChain('orderBy', authorRows);
    const formatChain = makeSelectChain('where', formatRows);

    const db = {
      selectDistinct: jest.fn().mockReturnValue(distinctChain),
      select: jest.fn().mockReturnValueOnce(mainChain).mockReturnValueOnce(authorChain).mockReturnValueOnce(formatChain),
    };

    const repo = new BookRepository(db as never);

    const result = await repo.searchAcrossLibraries([7], 'du', 20);

    expect(result).toEqual([
      {
        id: 10,
        title: 'Dune',
        seriesName: 'Dune',
        authors: ['Frank Herbert', 'F. Herbert'],
        libraryId: 7,
        libraryName: 'Main',
        formats: ['epub', 'pdf'],
      },
      {
        id: 11,
        title: 'Hyperion',
        seriesName: null,
        authors: ['Dan Simmons'],
        libraryId: 7,
        libraryName: 'Main',
        formats: [],
      },
    ]);
  });

  it('converts count totals to a number', async () => {
    const countChain = makeSelectChain('where', [{ total: '42' }]);
    const db = {
      select: jest.fn().mockReturnValue(countChain),
    };
    const repo = new BookRepository(db as never);

    const total = await repo.countWhere(undefined as never);

    expect(total).toBe(42);
  });

  it('returns empty file lists without querying when bookIds are empty', async () => {
    const db = {
      select: jest.fn(),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.findPrimaryFilesByBookIds([])).resolves.toEqual([]);
    await expect(repo.findAllFilesByBookIds([])).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('upserts reading progress with expected conflict target', async () => {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = jest.fn().mockReturnValue({ values });
    const db = { insert };
    const repo = new BookRepository(db as never);

    await repo.upsertProgress(5, 9, 'epubcfi(/6/2)', 7, 80);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({
      userId: 5,
      bookFileId: 9,
      cfi: 'epubcfi(/6/2)',
      pageNumber: 7,
      percentage: 80,
    });
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.any(Array),
        set: expect.objectContaining({
          cfi: 'epubcfi(/6/2)',
          pageNumber: 7,
          percentage: 80,
        }),
      }),
    );
  });
});
