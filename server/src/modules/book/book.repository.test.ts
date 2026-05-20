import { BookRepository } from './book.repository';

function makeSelectChain<T>(terminalMethod: string, terminalResult: T) {
  const chain: Record<string, vi.Mock> = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };

  chain.from.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.offset.mockReturnValue(chain);

  if (terminalMethod === 'where') {
    chain.where.mockResolvedValue(terminalResult);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
  } else if (terminalMethod === 'offset') {
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.offset.mockResolvedValue(terminalResult);
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
  it('runs callbacks inside db transactions', async () => {
    const db = {
      transaction: vi.fn((callback: (tx: { id: string }) => Promise<string>) => callback({ id: 'tx-1' })),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.withTransaction((tx: { id: string }) => Promise.resolve(`seen-${tx.id}`))).resolves.toBe('seen-tx-1');
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('findCards loads card rows and related collections for the current user', async () => {
    const rows = [{ id: 10, primaryFileId: 1001, _total: 1 }];
    const authorRows = [{ bookId: 10, name: 'Frank Herbert' }];
    const fileRows = [{ bookId: 10, id: 1001, format: 'epub', role: 'primary' }];
    const genreRows = [{ bookId: 10, name: 'Sci-Fi' }];
    const tagRows = [{ bookId: 10, name: 'dune' }];
    const fileProgressRows = [{ bookFileId: 1001, percentage: 45, updatedAt: new Date('2026-01-01T00:00:00.000Z') }];
    const statusRows = [{ bookId: 10, status: 'reading', source: 'manual', startedAt: null, finishedAt: null, updatedAt: null }];
    const narratorRows = [{ bookId: 10, name: 'Scott Brick' }];
    const progressRows = [{ bookFileId: 1001, percentage: 45 }];

    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain('offset', rows))
        .mockReturnValueOnce(makeSelectChain('orderBy', authorRows))
        .mockReturnValueOnce(makeSelectChain('where', fileRows))
        .mockReturnValueOnce(makeSelectChain('where', genreRows))
        .mockReturnValueOnce(makeSelectChain('where', tagRows))
        .mockReturnValueOnce(makeSelectChain('orderBy', narratorRows))
        .mockReturnValueOnce(makeSelectChain('where', statusRows))
        .mockReturnValueOnce(makeSelectChain('where', fileProgressRows))
        .mockReturnValueOnce(makeSelectChain('where', [])),
    };
    const repo = new BookRepository(db as never);

    const result = await repo.findCards({ where: undefined as never, orderBy: [] as never, limit: 25, offset: 0, userId: 7 });

    expect(result).toEqual({
      rows,
      authorRows,
      fileRows,
      genreRows,
      tagRows,
      progressRows,
      statusRows,
      narratorRows,
      total: 1,
    });
  });

  it('findCards maps newer audiobook progress onto the primary file for cards', async () => {
    const rows = [{ id: 10, primaryFileId: 1001, _total: 1 }];
    const readingProgressRows = [{ bookFileId: 1001, percentage: 22, updatedAt: new Date('2026-01-01T00:00:00.000Z') }];
    const audiobookProgressRows = [{ bookId: 10, percentage: 48, updatedAt: new Date('2026-01-02T00:00:00.000Z') }];

    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain('offset', rows))
        .mockReturnValueOnce(makeSelectChain('orderBy', []))
        .mockReturnValueOnce(makeSelectChain('where', []))
        .mockReturnValueOnce(makeSelectChain('where', []))
        .mockReturnValueOnce(makeSelectChain('where', []))
        .mockReturnValueOnce(makeSelectChain('orderBy', []))
        .mockReturnValueOnce(makeSelectChain('where', []))
        .mockReturnValueOnce(makeSelectChain('where', readingProgressRows))
        .mockReturnValueOnce(makeSelectChain('where', audiobookProgressRows)),
    };
    const repo = new BookRepository(db as never);

    const result = await repo.findCards({ where: undefined as never, orderBy: [] as never, limit: 25, offset: 0, userId: 7 });

    expect(result.progressRows).toEqual([{ bookFileId: 1001, percentage: 48 }]);
  });

  it('findCardsByBookIds returns empty payload when no ids are requested', async () => {
    const db = { select: vi.fn() };
    const repo = new BookRepository(db as never);

    await expect(repo.findCardsByBookIds([], 1)).resolves.toEqual({
      rows: [],
      authorRows: [],
      fileRows: [],
      genreRows: [],
      tagRows: [],
      progressRows: [],
      statusRows: [],
      narratorRows: [],
      total: 0,
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('findCardsByBookIds delegates to findCards with fixed pagination bounds', async () => {
    const repo = new BookRepository({} as never);
    const findCardsSpy = vi.spyOn(repo, 'findCards').mockResolvedValue({} as never);

    await repo.findCardsByBookIds([10, 20], 7);

    expect(findCardsSpy).toHaveBeenCalledWith({
      where: expect.anything(),
      orderBy: [],
      limit: 2,
      offset: 0,
      userId: 7,
    });
  });

  it('findById returns null when no matching book exists', async () => {
    const db = {
      select: vi.fn().mockReturnValue(makeSelectChain('limit', [])),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.findById(99)).resolves.toBeNull();
  });

  it('findById returns full joined payload when the book exists', async () => {
    const joinedBook = [{ books: { id: 10 }, book_metadata: { title: 'Dune' }, libraries: { name: 'Main' } }];
    const authorRows = [{ id: 1, name: 'Frank Herbert', sortName: 'Herbert, Frank' }];
    const genreRows = [{ name: 'Sci-Fi' }];
    const tagRows = [{ name: 'classic' }];
    const fileRows = [
      { id: 99, format: 'epub', role: 'primary', sizeBytes: 1, absolutePath: '/books/dune.epub', createdAt: new Date(), durationSeconds: null },
    ];
    const narratorRows = [{ id: 4, name: 'Narrator', sortName: null, displayOrder: 0 }];
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain('limit', joinedBook))
        .mockReturnValueOnce(makeSelectChain('orderBy', authorRows))
        .mockReturnValueOnce(makeSelectChain('where', genreRows))
        .mockReturnValueOnce(makeSelectChain('where', tagRows))
        .mockReturnValueOnce(makeSelectChain('orderBy', fileRows))
        .mockReturnValueOnce(makeSelectChain('orderBy', narratorRows)),
    };
    const repo = new BookRepository(db as never);

    const result = await repo.findById(10);

    expect(result).toEqual({
      book: joinedBook[0],
      authorRows,
      genreRows,
      tagRows,
      fileRows,
      narratorRows,
    });
  });

  it('fetches per-book and per-file progress helpers with null-safe fallbacks', async () => {
    const findCollectionsChain = makeSelectChain('orderBy', [{ id: 1, name: 'Favorites' }]);
    const libraryIdChain = makeSelectChain('limit', [{ libraryId: 5 }]);
    const missingLibraryChain = makeSelectChain('limit', []);
    const fileByIdChain = makeSelectChain('limit', [{ id: 9, absolutePath: '/books/a.epub', format: 'epub', bookId: 1, libraryId: 2 }]);
    const missingFileChain = makeSelectChain('limit', []);
    const progressChain = makeSelectChain('limit', [{ percentage: 12 }]);
    const missingProgressChain = makeSelectChain('limit', []);
    const progressByBookChain = makeSelectChain('orderBy', [{ fileId: 1, cfi: null, pageNumber: null, percentage: 0, updatedAt: null }]);
    const koboReadingChain = makeSelectChain('limit', [{ createdAtKobo: null }]);
    const koboSnapshotChain = makeSelectChain('limit', [{ snapshotId: 8 }]);
    const koboCollectionsChain = makeSelectChain('where', [{ name: 'Sync Me' }]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(findCollectionsChain)
        .mockReturnValueOnce(libraryIdChain)
        .mockReturnValueOnce(missingLibraryChain)
        .mockReturnValueOnce(fileByIdChain)
        .mockReturnValueOnce(missingFileChain)
        .mockReturnValueOnce(progressChain)
        .mockReturnValueOnce(missingProgressChain)
        .mockReturnValueOnce(progressByBookChain)
        .mockReturnValueOnce(koboReadingChain)
        .mockReturnValueOnce(koboSnapshotChain)
        .mockReturnValueOnce(koboCollectionsChain),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.findCollectionsByBookId(10, 1)).resolves.toEqual([{ id: 1, name: 'Favorites' }]);
    await expect(repo.findLibraryIdByBookId(10)).resolves.toBe(5);
    await expect(repo.findLibraryIdByBookId(11)).resolves.toBeNull();
    await expect(repo.findFileById(9)).resolves.toEqual({ id: 9, absolutePath: '/books/a.epub', format: 'epub', bookId: 1, libraryId: 2 });
    await expect(repo.findFileById(10)).resolves.toBeNull();
    await expect(repo.findProgress(1, 9)).resolves.toEqual({ percentage: 12 });
    await expect(repo.findProgress(1, 10)).resolves.toBeNull();
    await expect(repo.findProgressByBook(1, 10)).resolves.toEqual([{ fileId: 1, cfi: null, pageNumber: null, percentage: 0, updatedAt: null }]);
    await expect(repo.findKoboReadingState(1, 10)).resolves.toEqual({ createdAtKobo: null });
    await expect(repo.findKoboSnapshotState(1, 10)).resolves.toEqual({ snapshotId: 8 });
    await expect(repo.findKoboSyncCollectionNamesForBook(1, 10)).resolves.toEqual(['Sync Me']);
  });

  it('returns empty arrays for id-list helpers when input is empty', async () => {
    const db = { select: vi.fn() };
    const repo = new BookRepository(db as never);

    await expect(repo.findLibraryIdsByBookIds([])).resolves.toEqual([]);
    await expect(repo.findRecommendationTitlesByBookIds([])).resolves.toEqual([]);
    await expect(repo.findPrimaryFilesByBookIds([])).resolves.toEqual([]);
    await expect(repo.findAllFilesByBookIds([])).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('maps hasCover from coverSource and aggregates authors per book in recommendation rows', async () => {
    const bookRows = [
      { id: 10, title: 'Dune', coverSource: 'extracted' },
      { id: 11, title: 'Foundation', coverSource: null },
    ];
    const authorRows = [
      { bookId: 10, name: 'Frank Herbert' },
      { bookId: 11, name: 'Isaac Asimov' },
      { bookId: 11, name: 'Robert Heinlein' },
    ];
    const db = {
      select: vi.fn().mockReturnValueOnce(makeSelectChain('where', bookRows)).mockReturnValueOnce(makeSelectChain('where', authorRows)),
    };
    const repo = new BookRepository(db as never);

    const result = await repo.findRecommendationTitlesByBookIds([10, 11]);

    expect(result).toEqual([
      { id: 10, title: 'Dune', hasCover: true, authors: ['Frank Herbert'] },
      { id: 11, title: 'Foundation', hasCover: false, authors: ['Isaac Asimov', 'Robert Heinlein'] },
    ]);
  });

  it('returns hasCover false when coverSource is null in recommendation rows', async () => {
    const bookRows = [{ id: 5, title: 'No Cover', coverSource: null }];
    const db = {
      select: vi.fn().mockReturnValueOnce(makeSelectChain('where', bookRows)).mockReturnValueOnce(makeSelectChain('where', [])),
    };
    const repo = new BookRepository(db as never);

    const result = await repo.findRecommendationTitlesByBookIds([5]);

    expect(result).toEqual([{ id: 5, title: 'No Cover', hasCover: false, authors: [] }]);
  });

  it('maps id-list helper rows and primary-file lookups', async () => {
    const libraryRows = [{ id: 1, libraryId: 7 }];
    const recommendationBookRows = [{ id: 1, title: 'Dune', coverSource: 'extracted' }];
    const recommendationAuthorRows = [{ bookId: 1, name: 'Frank Herbert' }];
    const allIdsRows = [{ id: 3 }, { id: 4 }];
    const primaryFileRows = [{ absolutePath: '/books/a.epub', format: 'epub' }];
    const missingPrimaryRows: unknown[] = [];
    const primaryFilesByIds = [{ bookId: 1, absolutePath: '/books/a.epub', format: 'epub', sizeBytes: 10 }];
    const allFilesByIds = [{ bookId: 1, absolutePath: '/books/a.epub', format: 'epub', sizeBytes: 10, sortOrder: 0 }];
    const allIdsChain = {
      from: vi.fn().mockResolvedValue(allIdsRows),
    };
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain('where', libraryRows))
        .mockReturnValueOnce(makeSelectChain('where', recommendationBookRows))
        .mockReturnValueOnce(makeSelectChain('where', recommendationAuthorRows))
        .mockReturnValueOnce(makeSelectChain('orderBy', primaryFilesByIds))
        .mockReturnValueOnce(makeSelectChain('orderBy', allFilesByIds))
        .mockReturnValueOnce(allIdsChain)
        .mockReturnValueOnce(makeSelectChain('limit', primaryFileRows))
        .mockReturnValueOnce(makeSelectChain('limit', missingPrimaryRows)),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.findLibraryIdsByBookIds([1])).resolves.toEqual(libraryRows);
    await expect(repo.findRecommendationTitlesByBookIds([1])).resolves.toEqual([
      { id: 1, title: 'Dune', hasCover: true, authors: ['Frank Herbert'] },
    ]);
    await expect(repo.findPrimaryFilesByBookIds([1])).resolves.toEqual(primaryFilesByIds);
    await expect(repo.findAllFilesByBookIds([1])).resolves.toEqual(allFilesByIds);
    await expect(repo.findAllIds()).resolves.toEqual([3, 4]);
    await expect(repo.findPrimaryFile(1)).resolves.toEqual({ absolutePath: '/books/a.epub', format: 'epub' });
    await expect(repo.findPrimaryFile(2)).resolves.toBeNull();
  });

  it('writes deletion, metadata updates, and audio progress rows', async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteBuilder = { where: deleteWhere };
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateBuilder = { set: vi.fn().mockReturnValue({ where: updateWhere }) };
    const audioInsert = {
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ bookId: 10, percentage: 33 }]),
        }),
      }),
    };
    const audioProgressSelect = makeSelectChain('limit', [{ percentage: 22 }]);
    const missingAudioProgressSelect = makeSelectChain('limit', []);
    const db = {
      delete: vi.fn().mockReturnValue(deleteBuilder),
      update: vi.fn().mockReturnValue(updateBuilder),
      insert: vi.fn().mockReturnValue(audioInsert),
      select: vi.fn().mockReturnValueOnce(audioProgressSelect).mockReturnValueOnce(missingAudioProgressSelect),
    };
    const repo = new BookRepository(db as never);

    await repo.deleteByIds([10, 11]);
    await repo.updateMetadataFields(10, { title: 'Updated' });
    await expect(repo.findAudioProgress(1, 10)).resolves.toEqual({ percentage: 22 });
    await expect(repo.findAudioProgress(1, 11)).resolves.toBeNull();
    await expect(repo.upsertAudioProgress(1, 10, 4, 120, 33)).resolves.toEqual({ bookId: 10, percentage: 33 });

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('returns empty pattern metadata without hitting DB when no book ids are provided', async () => {
    const db = { select: vi.fn() };
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
      select: vi.fn().mockReturnValueOnce(metaChain).mockReturnValueOnce(authorChain),
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
      select: vi.fn(),
      selectDistinct: vi.fn(),
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
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      as: vi.fn().mockReturnValue({}),
    };
    distinctChain.from.mockReturnValue(distinctChain);
    distinctChain.innerJoin.mockReturnValue(distinctChain);
    distinctChain.where.mockReturnValue(distinctChain);

    const mainChain = makeSelectChain('limit', rows);
    const authorChain = makeSelectChain('orderBy', authorRows);
    const formatChain = makeSelectChain('where', formatRows);

    const db = {
      selectDistinct: vi.fn().mockReturnValue(distinctChain),
      select: vi.fn().mockReturnValueOnce(mainChain).mockReturnValueOnce(authorChain).mockReturnValueOnce(formatChain),
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
      select: vi.fn().mockReturnValue(countChain),
    };
    const repo = new BookRepository(db as never);

    const total = await repo.countWhere(undefined as never);

    expect(total).toBe(42);
  });

  it('returns empty file lists without querying when bookIds are empty', async () => {
    const db = {
      select: vi.fn(),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.findPrimaryFilesByBookIds([])).resolves.toEqual([]);
    await expect(repo.findAllFilesByBookIds([])).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('upserts reading progress with an idempotent conflict update', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert };
    const repo = new BookRepository(db as never);

    await repo.upsertProgress(5, 9, 'epubcfi(/6/2)', 7, 80);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 5,
        bookFileId: 9,
        cfi: 'epubcfi(/6/2)',
        pageNumber: 7,
        percentage: 80,
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.any(Array),
        set: expect.objectContaining({ cfi: 'epubcfi(/6/2)', pageNumber: 7, percentage: 80 }),
      }),
    );
  });

  it('clears both reading_progress and audiobook_progress rows for a file id', async () => {
    const readingWhere = vi.fn().mockResolvedValue(undefined);
    const audioWhere = vi.fn().mockResolvedValue(undefined);
    const del = vi.fn().mockReturnValueOnce({ where: readingWhere }).mockReturnValueOnce({ where: audioWhere });
    const db = {
      delete: del,
    };
    const repo = new BookRepository(db as never);

    await repo.clearFileProgress(7, 99);

    expect(del).toHaveBeenCalledTimes(2);
    expect(readingWhere).toHaveBeenCalledTimes(1);
    expect(audioWhere).toHaveBeenCalledTimes(1);
  });
});
