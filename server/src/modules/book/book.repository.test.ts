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

function makeInsertChain() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  return { values, onConflictDoUpdate };
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
    const seriesMembershipRows = [{ bookId: 10, seriesId: 20, seriesName: 'Dune', seriesIndex: 1, displayOrder: 0 }];
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
        .mockReturnValueOnce(makeSelectChain('orderBy', seriesMembershipRows))
        .mockReturnValueOnce(makeSelectChain('where', statusRows))
        .mockReturnValueOnce(makeSelectChain('where', fileProgressRows))
        .mockReturnValueOnce(makeSelectChain('where', [])),
    };
    const repo = new BookRepository(db as never);

    const result = await repo.findCards({ where: undefined as never, orderBy: [] as never, limit: 25, offset: 0, userId: 7 });

    expect(db.select).toHaveBeenNthCalledWith(1, expect.objectContaining({ hardcoverId: expect.anything(), hardcoverEditionId: expect.anything() }));
    expect(result).toEqual({
      rows,
      authorRows,
      fileRows,
      genreRows,
      tagRows,
      progressRows,
      statusRows,
      narratorRows,
      seriesMembershipRows,
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
      seriesMembershipRows: [],
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
    const seriesMembershipRows = [{ seriesId: 20, seriesName: 'Dune', seriesIndex: 1, displayOrder: 0 }];
    const communityRatingRows = [{ provider: 'amazon', rating: 4.8, ratingCount: 104451, updatedAt: new Date() }];
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain('limit', joinedBook))
        .mockReturnValueOnce(makeSelectChain('orderBy', authorRows))
        .mockReturnValueOnce(makeSelectChain('where', genreRows))
        .mockReturnValueOnce(makeSelectChain('where', tagRows))
        .mockReturnValueOnce(makeSelectChain('orderBy', fileRows))
        .mockReturnValueOnce(makeSelectChain('orderBy', narratorRows))
        .mockReturnValueOnce(makeSelectChain('orderBy', seriesMembershipRows))
        .mockReturnValueOnce(makeSelectChain('orderBy', communityRatingRows)),
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
      seriesMembershipRows,
      communityRatingRows,
    });
  });

  it('fetches per-book and per-file progress helpers with null-safe fallbacks', async () => {
    const findCollectionsChain = makeSelectChain('orderBy', [{ id: 1, name: 'Favorites' }]);
    const libraryIdChain = makeSelectChain('limit', [{ libraryId: 5 }]);
    const missingLibraryChain = makeSelectChain('limit', []);
    const fileByIdChain = makeSelectChain('limit', [
      { id: 9, absolutePath: '/books/a.epub', format: 'epub', bookId: 1, libraryId: 2, fileHash: null, sizeBytes: null },
    ]);
    const missingFileChain = makeSelectChain('limit', []);
    const progressChain = makeSelectChain('limit', [{ percentage: 12 }]);
    const missingProgressChain = makeSelectChain('limit', []);
    const progressByBookChain = makeSelectChain('orderBy', [
      {
        fileId: 1,
        cfi: null,
        pageNumber: null,
        percentage: 0,
        koboLocationSource: null,
        koboLocationType: null,
        koboLocationValue: null,
        koboContentSourceProgressPercent: null,
        koreaderProgress: null,
        updatedAt: null,
      },
    ]);
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
    await expect(repo.findFileById(9)).resolves.toEqual({
      id: 9,
      absolutePath: '/books/a.epub',
      format: 'epub',
      bookId: 1,
      libraryId: 2,
      fileHash: null,
      sizeBytes: null,
    });
    await expect(repo.findFileById(10)).resolves.toBeNull();
    await expect(repo.findProgress(1, 9)).resolves.toEqual({ percentage: 12 });
    await expect(repo.findProgress(1, 10)).resolves.toBeNull();
    await expect(repo.findProgressByBook(1, 10)).resolves.toEqual([
      {
        fileId: 1,
        cfi: null,
        pageNumber: null,
        percentage: 0,
        koboLocationSource: null,
        koboLocationType: null,
        koboLocationValue: null,
        koboContentSourceProgressPercent: null,
        koreaderProgress: null,
        updatedAt: null,
      },
    ]);
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
      { id: 10, title: 'Dune', coverSource: 'extracted', primaryFormat: 'm4b' },
      { id: 11, title: 'Foundation', coverSource: null, primaryFormat: 'epub' },
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
      { id: 10, title: 'Dune', updatedAt: null, hasCover: true, authors: ['Frank Herbert'], isAudiobook: true, isComic: false },
      {
        id: 11,
        title: 'Foundation',
        updatedAt: null,
        hasCover: false,
        authors: ['Isaac Asimov', 'Robert Heinlein'],
        isAudiobook: false,
        isComic: false,
      },
    ]);
  });

  it('returns hasCover false when coverSource is null in recommendation rows', async () => {
    const bookRows = [{ id: 5, title: 'No Cover', coverSource: null, primaryFormat: null }];
    const db = {
      select: vi.fn().mockReturnValueOnce(makeSelectChain('where', bookRows)).mockReturnValueOnce(makeSelectChain('where', [])),
    };
    const repo = new BookRepository(db as never);

    const result = await repo.findRecommendationTitlesByBookIds([5]);

    expect(result).toEqual([{ id: 5, title: 'No Cover', updatedAt: null, hasCover: false, authors: [], isAudiobook: false, isComic: false }]);
  });

  it('treats primary format checks as case-insensitive in recommendation rows', async () => {
    const bookRows = [{ id: 6, title: 'Audio Case', coverSource: 'custom', primaryFormat: 'MP3' }];
    const db = {
      select: vi.fn().mockReturnValueOnce(makeSelectChain('where', bookRows)).mockReturnValueOnce(makeSelectChain('where', [])),
    };
    const repo = new BookRepository(db as never);

    const result = await repo.findRecommendationTitlesByBookIds([6]);

    expect(result).toEqual([{ id: 6, title: 'Audio Case', updatedAt: null, hasCover: true, authors: [], isAudiobook: true, isComic: false }]);
  });

  it('flags comic primary formats as isComic in recommendation rows', async () => {
    const bookRows = [{ id: 8, title: 'Comic Case', coverSource: 'custom', primaryFormat: 'CBR' }];
    const db = {
      select: vi.fn().mockReturnValueOnce(makeSelectChain('where', bookRows)).mockReturnValueOnce(makeSelectChain('where', [])),
    };
    const repo = new BookRepository(db as never);

    const result = await repo.findRecommendationTitlesByBookIds([8]);

    expect(result).toEqual([{ id: 8, title: 'Comic Case', updatedAt: null, hasCover: true, authors: [], isAudiobook: false, isComic: true }]);
  });

  it('maps id-list helper rows and primary-file lookups', async () => {
    const libraryRows = [{ id: 1, libraryId: 7 }];
    const recommendationBookRows = [{ id: 1, title: 'Dune', coverSource: 'extracted', primaryFormat: 'm4b' }];
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
      { id: 1, title: 'Dune', updatedAt: null, hasCover: true, authors: ['Frank Herbert'], isAudiobook: true, isComic: false },
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
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(updateBuilder.set).toHaveBeenNthCalledWith(1, { title: 'Updated' });
    expect(updateBuilder.set).toHaveBeenNthCalledWith(2, expect.objectContaining({ updatedAt: expect.any(Date) }));
    expect(updateWhere).toHaveBeenCalledTimes(2);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('replaces all community rating rows: deletes old then inserts new', async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteBuilder = { where: vi.fn().mockReturnValue(deleteWhere) };
    const values = vi.fn().mockResolvedValue(undefined);
    const insertBuilder = { values };
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateBuilder = { set: vi.fn().mockReturnValue({ where: updateWhere }) };
    const db = {
      delete: vi.fn().mockReturnValue(deleteBuilder),
      insert: vi.fn().mockReturnValue(insertBuilder),
      update: vi.fn().mockReturnValue(updateBuilder),
    };
    const repo = new BookRepository(db as never);

    await repo.replaceCommunityRatings(10, [
      { provider: 'amazon', rating: 4.8, ratingCount: 104451 },
      { provider: 'hardcover', rating: 4.25, ratingCount: 12345 },
    ]);

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(deleteBuilder.where).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({ bookId: 10, provider: 'amazon', rating: 4.8, ratingCount: 104451, updatedAt: expect.any(Date) }),
      expect.objectContaining({ bookId: 10, provider: 'hardcover', rating: 4.25, ratingCount: 12345, updatedAt: expect.any(Date) }),
    ]);
    expect(updateBuilder.set).toHaveBeenCalledWith({ updatedAt: expect.any(Date) });
  });

  it('replaceCommunityRatings with empty array deletes all rows without inserting', async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteBuilder = { where: vi.fn().mockReturnValue(deleteWhere) };
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateBuilder = { set: vi.fn().mockReturnValue({ where: updateWhere }) };
    const db = {
      delete: vi.fn().mockReturnValue(deleteBuilder),
      insert: vi.fn(),
      update: vi.fn().mockReturnValue(updateBuilder),
    };
    const repo = new BookRepository(db as never);

    await repo.replaceCommunityRatings(10, []);

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
    expect(updateBuilder.set).toHaveBeenCalledWith({ updatedAt: expect.any(Date) });
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
        updatedAt: null,
        formats: ['epub', 'pdf'],
      },
      {
        id: 11,
        title: 'Hyperion',
        seriesName: null,
        authors: ['Dan Simmons'],
        libraryId: 7,
        libraryName: 'Main',
        updatedAt: null,
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

    await repo.upsertProgress(
      5,
      9,
      'epubcfi(/6/2)',
      7,
      80,
      null,
      'OEBPS/ch1.xhtml',
      'KoboSpan',
      'kobo.25.1',
      25,
      '/body/DocFragment[2]/body/p[1]/text()[1].0',
    );

    expect(insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 5,
        bookFileId: 9,
        cfi: 'epubcfi(/6/2)',
        pageNumber: 7,
        percentage: 80,
        koboLocationSource: 'OEBPS/ch1.xhtml',
        koboLocationType: 'KoboSpan',
        koboLocationValue: 'kobo.25.1',
        koboContentSourceProgressPercent: 25,
        koreaderProgress: '/body/DocFragment[2]/body/p[1]/text()[1].0',
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.any(Array),
        set: expect.objectContaining({
          cfi: 'epubcfi(/6/2)',
          pageNumber: 7,
          percentage: 80,
          koboLocationSource: 'OEBPS/ch1.xhtml',
          koboLocationType: 'KoboSpan',
          koboLocationValue: 'kobo.25.1',
          koboContentSourceProgressPercent: 25,
          koreaderProgress: '/body/DocFragment[2]/body/p[1]/text()[1].0',
        }),
      }),
    );
  });

  it('syncs primary EPUB progress into Kobo reading state and marks snapshot row pending', async () => {
    const insertChain = makeInsertChain();
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain('limit', [{ bookId: 10, primaryFileId: 9, format: 'epub' }]))
        .mockReturnValueOnce(
          makeSelectChain('limit', [
            {
              entitlementId: '10',
              createdAtKobo: '2026-01-01T00:00:00.000Z',
              currentBookmark: {
                LastModified: '2026-01-01T00:00:00.000Z',
                Location: { Source: 'old.xhtml', Type: 'KoboSpan', Value: 'kobo.1.1' },
                ProgressPercent: 20,
                ContentSourceProgressPercent: 2,
                ChapterProgress: 2,
              },
              statistics: { LastModified: '2026-01-01T00:00:00.000Z' },
              statusInfo: { LastModified: '2026-01-01T00:00:00.000Z', TimesStartedReading: 1 },
            },
          ]),
        ),
      insert: vi.fn().mockReturnValue(insertChain),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.syncKoboReadingStateFromProgress(5, 9, 80, 'OEBPS/ch14.xhtml', 'KoboSpan', 'kobo.25.1', 33.5)).resolves.toBe(true);

    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 5,
        bookId: 10,
        entitlementId: '10',
        createdAtKobo: '2026-01-01T00:00:00.000Z',
        currentBookmark: expect.objectContaining({
          LastModified: expect.any(String),
          ProgressPercent: 80,
          ContentSourceProgressPercent: 33.5,
          ChapterProgress: 2,
          Location: { Source: 'OEBPS/ch14.xhtml', Type: 'KoboSpan', Value: 'kobo.25.1' },
        }),
        statusInfo: expect.objectContaining({
          TimesStartedReading: 1,
          Status: 'Reading',
        }),
      }),
    );
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.any(Array),
        set: expect.objectContaining({
          currentBookmark: expect.objectContaining({
            LastModified: expect.any(String),
            ProgressPercent: 80,
            ContentSourceProgressPercent: 33.5,
            ChapterProgress: 2,
            Location: { Source: 'OEBPS/ch14.xhtml', Type: 'KoboSpan', Value: 'kobo.25.1' },
          }),
          statusInfo: expect.objectContaining({ Status: 'Reading' }),
        }),
      }),
    );
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('clears stale Kobo source-level percent while preserving device bookmark fields', async () => {
    const insertChain = makeInsertChain();
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain('limit', [{ bookId: 10, primaryFileId: 9, format: 'epub' }]))
        .mockReturnValueOnce(
          makeSelectChain('limit', [
            {
              entitlementId: '10',
              createdAtKobo: '2026-01-01T00:00:00.000Z',
              currentBookmark: {
                LastModified: '2026-01-01T00:00:00.000Z',
                Location: { Source: 'old.xhtml', Type: 'KoboSpan', Value: 'kobo.1.1' },
                ProgressPercent: 20,
                ContentSourceProgressPercent: 2,
                ChapterProgress: 2,
              },
              statistics: { LastModified: '2026-01-01T00:00:00.000Z' },
              statusInfo: { LastModified: '2026-01-01T00:00:00.000Z' },
            },
          ]),
        ),
      insert: vi.fn().mockReturnValue(insertChain),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.syncKoboReadingStateFromProgress(5, 9, 80, 'OEBPS/ch14.xhtml', 'KoboSpan', 'kobo.25.1', null)).resolves.toBe(true);

    const insertedBookmark = insertChain.values.mock.calls[0][0].currentBookmark;
    expect(insertedBookmark).toEqual(
      expect.objectContaining({
        LastModified: expect.any(String),
        ProgressPercent: 80,
        ChapterProgress: 2,
        Location: { Source: 'OEBPS/ch14.xhtml', Type: 'KoboSpan', Value: 'kobo.25.1' },
      }),
    );
    expect(insertedBookmark).not.toHaveProperty('ContentSourceProgressPercent');
  });

  it('advances Kobo reading state percent-only without a KoboSpan location, preserving the existing Location', async () => {
    const insertChain = makeInsertChain();
    const existingState = {
      entitlementId: 'ent-1',
      createdAtKobo: '2026-06-01T00:00:00.000Z',
      currentBookmark: { ProgressPercent: 40, Location: { Source: 'OEBPS/old.xhtml', Type: 'KoboSpan', Value: 'kobo.5.1' } },
      statistics: null,
      statusInfo: null,
    };
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain('limit', [{ bookId: 10, primaryFileId: 9, format: 'epub' }]))
        .mockReturnValueOnce(makeSelectChain('limit', [existingState])),
      insert: vi.fn().mockReturnValue(insertChain),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.syncKoboReadingStateFromProgress(5, 9, 80, 'OEBPS/ch14.xhtml', null, null, 33.5)).resolves.toBe(true);

    expect(db.insert).toHaveBeenCalledTimes(1);
    const inserted = insertChain.values.mock.calls[0][0] as { currentBookmark: Record<string, unknown> };
    expect(inserted.currentBookmark.ProgressPercent).toBe(80);
    expect(inserted.currentBookmark.Location).toEqual({ Source: 'OEBPS/old.xhtml', Type: 'KoboSpan', Value: 'kobo.5.1' });
    expect(db.execute).toHaveBeenCalled();
  });

  it('skips the percent-only Kobo reading state write when the bookmark percent is current', async () => {
    const existingState = {
      entitlementId: 'ent-1',
      createdAtKobo: '2026-06-01T00:00:00.000Z',
      currentBookmark: { ProgressPercent: 80 },
      statistics: null,
      statusInfo: null,
    };
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain('limit', [{ bookId: 10, primaryFileId: 9, format: 'epub' }]))
        .mockReturnValueOnce(makeSelectChain('limit', [existingState])),
      insert: vi.fn(),
      execute: vi.fn(),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.syncKoboReadingStateFromProgress(5, 9, 80, null, null, null, null)).resolves.toBe(true);

    expect(db.insert).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('does not sync Kobo reading state for non-primary EPUB files', async () => {
    const db = {
      select: vi.fn().mockReturnValueOnce(makeSelectChain('limit', [{ bookId: 10, primaryFileId: 99, format: 'epub' }])),
      insert: vi.fn(),
      execute: vi.fn(),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.syncKoboReadingStateFromProgress(5, 9, 80)).resolves.toBe(false);

    expect(db.insert).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('reads whether Kobo two-way progress sync is enabled', async () => {
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain('limit', [{ twoWayProgressSync: true }]))
        .mockReturnValueOnce(makeSelectChain('limit', [])),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.isKoboTwoWayProgressSyncEnabled(5)).resolves.toBe(true);
    await expect(repo.isKoboTwoWayProgressSyncEnabled(6)).resolves.toBe(false);
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
