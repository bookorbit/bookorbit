import { BookRepository } from './book.repository';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { audiobookProgress, bookMetadata, books, koreaderDeviceProgress, koreaderProgressResets, readingProgress } from '../../db/schema';

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

  it('updates a book added date and modification timestamp together', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const db = { update: vi.fn().mockReturnValue({ set }) };
    const repo = new BookRepository(db as never);
    const addedAt = new Date('2020-06-15T00:00:00.000Z');

    await repo.updateAddedAt(9, addedAt);

    expect(db.update).toHaveBeenCalledWith(books);
    expect(set).toHaveBeenCalledWith({ addedAt, updatedAt: expect.any(Date) });
    expect(where).toHaveBeenCalledOnce();
  });

  it('setHardcoverEditionIdIfEmpty only fills a missing shared edition id', async () => {
    const returning = vi.fn().mockResolvedValue([{ bookId: 5 }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const db = { update: vi.fn().mockReturnValue({ set }) };
    const repo = new BookRepository(db as never);

    await expect(repo.setHardcoverEditionIdIfEmpty(5, '200')).resolves.toBe(true);

    expect(db.update).toHaveBeenCalledWith(bookMetadata);
    expect(set).toHaveBeenCalledWith({ hardcoverEditionId: '200', updatedAt: expect.any(Date) });
  });

  it('setHardcoverEditionIdIfEmpty returns false when the shared edition id is already set', async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const db = { update: vi.fn().mockReturnValue({ set }) };
    const repo = new BookRepository(db as never);

    await expect(repo.setHardcoverEditionIdIfEmpty(5, '200')).resolves.toBe(false);
  });

  it('loads book titles for deletion audit details', async () => {
    const rows = [
      { id: 3, title: 'Dune' },
      { id: 4, title: null },
    ];
    const selectChain = makeSelectChain('where', rows);
    const db = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.findDeletionAuditBooksByIds([3, 4])).resolves.toEqual(rows);
    await expect(repo.findDeletionAuditBooksByIds([])).resolves.toEqual([]);

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(selectChain.leftJoin).toHaveBeenCalledTimes(1);
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

  it('orders collapsed collection groups by their earliest membership position', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new BookRepository({ execute } as never);

    await repo.findCardsCollapsed({
      where: undefined,
      sort: [{ field: 'collectionOrder', dir: 'asc' }],
      limit: 50,
      offset: 0,
      userId: 7,
      defaultCollectionId: 42,
    });

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    expect(query.sql).toContain('MIN(base.collection_position) AS first_collection_position');
    expect(query.sql).toContain('COALESCE(sa.first_collection_position, base.collection_position) AS sort_collection_position');
    expect(query.sql).toContain('ORDER BY sort_collection_position ASC NULLS LAST, r.id ASC');
    expect(query.params).toContain(42);
  });

  // The order by names sort_collection_position unconditionally, so the column has to be selected
  // even when no collection is in scope or the query fails to parse.
  it('selects a null membership position when no collection is in scope', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new BookRepository({ execute } as never);

    await repo.findCardsCollapsed({
      where: undefined,
      sort: [{ field: 'title', dir: 'asc' }],
      limit: 50,
      offset: 0,
      userId: 7,
    });

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    expect(query.sql).toContain('NULL::bigint AS collection_position');
    expect(query.sql).not.toContain('FROM "collection_books"');
  });

  it('rejects an unusable collection id on the collapsed path', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new BookRepository({ execute } as never);

    await expect(
      repo.findCardsCollapsed({
        where: undefined,
        sort: [{ field: 'collectionOrder', dir: 'asc' }],
        limit: 50,
        offset: 0,
        userId: 7,
        defaultCollectionId: 0,
      }),
    ).rejects.toThrow('Invalid default collection id');
    expect(execute).not.toHaveBeenCalled();
  });

  it('findCardIds applies card query pagination without running enrichment queries', async () => {
    const chain = makeSelectChain('offset', [{ id: 9 }, { id: 3 }]);
    const db = { select: vi.fn().mockReturnValue(chain) };
    const repo = new BookRepository(db as never);

    await expect(repo.findCardIds({ where: undefined, orderBy: [], limit: 20, offset: 40, userId: 7 })).resolves.toEqual([9, 3]);

    expect(db.select).toHaveBeenCalledOnce();
    expect(chain.limit).toHaveBeenCalledWith(20);
    expect(chain.offset).toHaveBeenCalledWith(40);
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

  it('findIdsByWhere joins metadata before applying selection predicates', async () => {
    const rows = [{ id: 10 }, { id: 11 }];
    const chain = makeSelectChain('where', rows);
    const db = { select: vi.fn().mockReturnValue(chain) };
    const repo = new BookRepository(db as never);

    const result = await repo.findIdsByWhere(sql`${bookMetadata.title} is not null`);

    expect(chain.from).toHaveBeenCalledWith(books);
    expect(chain.leftJoin).toHaveBeenCalledWith(bookMetadata, expect.anything());

    const dialect = new PgDialect();
    const joinSql = dialect.sqlToQuery(chain.leftJoin.mock.calls[0]![1]).sql;
    const whereSql = dialect.sqlToQuery(chain.where.mock.calls[0]![0]).sql;
    expect(joinSql).toBe('"book_metadata"."book_id" = "books"."id"');
    expect(whereSql).toContain('"book_metadata"."title" is not null');
    expect(whereSql).toContain('"books"."status" <>');
    expect(result).toEqual([10, 11]);
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
    const koboSnapshotChain = makeSelectChain('orderBy', [{ deviceId: 3, deviceName: 'Libra', snapshotId: 8 }]);
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
    await expect(repo.findKoboSnapshotStates(1, 10)).resolves.toEqual([{ deviceId: 3, deviceName: 'Libra', snapshotId: 8 }]);
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
      { id: 10, title: 'Dune', coverAspectRatio: '2/3', coverSource: 'extracted', primaryFormat: 'm4b' },
      { id: 11, title: 'Foundation', coverAspectRatio: '1/1', coverSource: null, primaryFormat: 'epub' },
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
      {
        id: 10,
        title: 'Dune',
        coverAspectRatio: '2/3',
        updatedAt: null,
        hasCover: true,
        authors: ['Frank Herbert'],
        isAudiobook: true,
        isComic: false,
      },
      {
        id: 11,
        title: 'Foundation',
        coverAspectRatio: '1/1',
        updatedAt: null,
        hasCover: false,
        authors: ['Isaac Asimov', 'Robert Heinlein'],
        isAudiobook: false,
        isComic: false,
      },
    ]);
  });

  it('returns hasCover false when coverSource is null in recommendation rows', async () => {
    const bookRows = [{ id: 5, title: 'No Cover', coverAspectRatio: '2/3', coverSource: null, primaryFormat: null }];
    const db = {
      select: vi.fn().mockReturnValueOnce(makeSelectChain('where', bookRows)).mockReturnValueOnce(makeSelectChain('where', [])),
    };
    const repo = new BookRepository(db as never);

    const result = await repo.findRecommendationTitlesByBookIds([5]);

    expect(result).toEqual([
      { id: 5, title: 'No Cover', coverAspectRatio: '2/3', updatedAt: null, hasCover: false, authors: [], isAudiobook: false, isComic: false },
    ]);
  });

  it('treats primary format checks as case-insensitive in recommendation rows', async () => {
    const bookRows = [{ id: 6, title: 'Audio Case', coverAspectRatio: '2/3', coverSource: 'custom', primaryFormat: 'MP3' }];
    const db = {
      select: vi.fn().mockReturnValueOnce(makeSelectChain('where', bookRows)).mockReturnValueOnce(makeSelectChain('where', [])),
    };
    const repo = new BookRepository(db as never);

    const result = await repo.findRecommendationTitlesByBookIds([6]);

    expect(result).toEqual([
      { id: 6, title: 'Audio Case', coverAspectRatio: '2/3', updatedAt: null, hasCover: true, authors: [], isAudiobook: true, isComic: false },
    ]);
  });

  it('flags comic primary formats as isComic in recommendation rows', async () => {
    const bookRows = [{ id: 8, title: 'Comic Case', coverAspectRatio: '1/1', coverSource: 'custom', primaryFormat: 'CBR' }];
    const db = {
      select: vi.fn().mockReturnValueOnce(makeSelectChain('where', bookRows)).mockReturnValueOnce(makeSelectChain('where', [])),
    };
    const repo = new BookRepository(db as never);

    const result = await repo.findRecommendationTitlesByBookIds([8]);

    expect(result).toEqual([
      { id: 8, title: 'Comic Case', coverAspectRatio: '1/1', updatedAt: null, hasCover: true, authors: [], isAudiobook: false, isComic: true },
    ]);
  });

  it('maps id-list helper rows and primary-file lookups', async () => {
    const libraryRows = [{ id: 1, libraryId: 7 }];
    const recommendationBookRows = [{ id: 1, title: 'Dune', coverAspectRatio: '2/3', coverSource: 'extracted', primaryFormat: 'm4b' }];
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
      {
        id: 1,
        title: 'Dune',
        coverAspectRatio: '2/3',
        updatedAt: null,
        hasCover: true,
        authors: ['Frank Herbert'],
        isAudiobook: true,
        isComic: false,
      },
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

  it('merges metadata rows with ordered author and narrator names per book', async () => {
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
    const narratorRows = [
      { bookId: 10, name: 'Simon Vance' },
      { bookId: 10, name: 'Scott Brick' },
    ];

    const metaChain = makeSelectChain('where', metaRows);
    const authorChain = makeSelectChain('orderBy', authorRows);
    const narratorChain = makeSelectChain('orderBy', narratorRows);
    const db = {
      select: vi.fn().mockReturnValueOnce(metaChain).mockReturnValueOnce(authorChain).mockReturnValueOnce(narratorChain),
    };

    const repo = new BookRepository(db as never);

    const result = await repo.findPatternMetadataByBookIds([10, 11]);

    expect(result).toEqual([
      {
        ...metaRows[0],
        authors: ['Frank Herbert', 'Coauthor'],
        narrators: ['Simon Vance', 'Scott Brick'],
      },
      {
        ...metaRows[1],
        authors: ['Dan Simmons'],
        narrators: [],
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
    const resetWhere = vi.fn().mockResolvedValue(undefined);
    const del = vi.fn().mockReturnValue({ where: resetWhere });
    const db = { insert, delete: del };
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
        .mockReturnValueOnce(makeSelectChain('limit', [{ bookId: 10, primaryFileId: 9, format: 'epub', markAsFinishedPercentComplete: 98 }]))
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
        .mockReturnValueOnce(makeSelectChain('limit', [{ bookId: 10, primaryFileId: 9, format: 'epub', markAsFinishedPercentComplete: 98 }]))
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

  // Keeping the device Location while the percent moves ships a bookmark that contradicts
  // itself, and the device resumes from Location: it opens at the stale spot and pushes that
  // percent back. The reading-state pull path re-adds a Location whenever it can convert the cfi.
  it('drops the stale device Location when percent-only progress advances past it', async () => {
    const insertChain = makeInsertChain();
    const existingState = {
      entitlementId: 'ent-1',
      createdAtKobo: '2026-06-01T00:00:00.000Z',
      currentBookmark: {
        ProgressPercent: 40,
        ContentSourceProgressPercent: 61,
        ChapterProgress: 3,
        Location: { Source: 'OEBPS/old.xhtml', Type: 'KoboSpan', Value: 'kobo.5.1' },
      },
      statistics: null,
      statusInfo: null,
    };
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain('limit', [{ bookId: 10, primaryFileId: 9, format: 'epub', markAsFinishedPercentComplete: 98 }]))
        .mockReturnValueOnce(makeSelectChain('limit', [existingState])),
      insert: vi.fn().mockReturnValue(insertChain),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.syncKoboReadingStateFromProgress(5, 9, 80, 'OEBPS/ch14.xhtml', null, null, 33.5)).resolves.toBe(true);

    expect(db.insert).toHaveBeenCalledTimes(1);
    const inserted = insertChain.values.mock.calls[0][0] as { currentBookmark: Record<string, unknown> };
    expect(inserted.currentBookmark.ProgressPercent).toBe(80);
    expect(inserted.currentBookmark).not.toHaveProperty('Location');
    expect(inserted.currentBookmark).not.toHaveProperty('ContentSourceProgressPercent');
    expect(inserted.currentBookmark.ChapterProgress).toBe(3);
    const updated = insertChain.onConflictDoUpdate.mock.calls[0][0] as { set: { currentBookmark: Record<string, unknown> } };
    expect(updated.set.currentBookmark).not.toHaveProperty('Location');
    expect(db.execute).toHaveBeenCalled();
  });

  // A Kobo clock running ahead is stored verbatim from the device push. A hub write stamped at
  // wall-clock time lands behind it, loses the device conflict check, and never reaches the reader.
  it('stamps the reading state past device timestamps sitting in the future', async () => {
    const insertChain = makeInsertChain();
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const existingState = {
      entitlementId: 'ent-1',
      createdAtKobo: '2026-06-01T00:00:00.000Z',
      lastModifiedKobo: future,
      priorityTimestamp: future,
      currentBookmark: { ProgressPercent: 40, LastModified: future },
      statistics: null,
      statusInfo: { LastModified: future, Status: 'Reading' },
    };
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain('limit', [{ bookId: 10, primaryFileId: 9, format: 'epub', markAsFinishedPercentComplete: 98 }]))
        .mockReturnValueOnce(makeSelectChain('limit', [existingState])),
      insert: vi.fn().mockReturnValue(insertChain),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.syncKoboReadingStateFromProgress(5, 9, 80, null, null, null, null)).resolves.toBe(true);

    const inserted = insertChain.values.mock.calls[0][0] as {
      lastModifiedKobo: string;
      priorityTimestamp: string;
      currentBookmark: { LastModified: string };
      statusInfo: { LastModified: string };
    };
    const futureMs = new Date(future).getTime();
    expect(new Date(inserted.lastModifiedKobo).getTime()).toBeGreaterThan(futureMs);
    expect(new Date(inserted.priorityTimestamp).getTime()).toBeGreaterThan(futureMs);
    expect(new Date(inserted.currentBookmark.LastModified).getTime()).toBeGreaterThan(futureMs);
    expect(new Date(inserted.statusInfo.LastModified).getTime()).toBeGreaterThan(futureMs);
  });

  it('stamps the reading state at wall-clock time when no stored timestamp is ahead of it', async () => {
    const insertChain = makeInsertChain();
    const before = Date.now();
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain('limit', [{ bookId: 10, primaryFileId: 9, format: 'epub', markAsFinishedPercentComplete: 98 }]))
        .mockReturnValueOnce(
          makeSelectChain('limit', [
            {
              entitlementId: 'ent-1',
              createdAtKobo: '2026-06-01T00:00:00.000Z',
              lastModifiedKobo: '2026-06-01T00:00:00.000Z',
              priorityTimestamp: '2026-06-01T00:00:00.000Z',
              currentBookmark: { ProgressPercent: 40, LastModified: '2026-06-01T00:00:00.000Z' },
              statistics: null,
              statusInfo: null,
            },
          ]),
        ),
      insert: vi.fn().mockReturnValue(insertChain),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const repo = new BookRepository(db as never);

    await repo.syncKoboReadingStateFromProgress(5, 9, 80, null, null, null, null);

    const inserted = insertChain.values.mock.calls[0][0] as { lastModifiedKobo: string };
    const stampedMs = new Date(inserted.lastModifiedKobo).getTime();
    expect(stampedMs).toBeGreaterThanOrEqual(before);
    expect(stampedMs).toBeLessThanOrEqual(Date.now());
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
        .mockReturnValueOnce(makeSelectChain('limit', [{ bookId: 10, primaryFileId: 9, format: 'epub', markAsFinishedPercentComplete: 98 }]))
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
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain('limit', [{ bookId: 10, primaryFileId: 99, format: 'epub', markAsFinishedPercentComplete: 98 }])),
      insert: vi.fn(),
      execute: vi.fn(),
    };
    const repo = new BookRepository(db as never);

    await expect(repo.syncKoboReadingStateFromProgress(5, 9, 80)).resolves.toBe(false);

    expect(db.insert).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  describe('Kobo status derived from the library finished threshold', () => {
    async function syncStatusFor(percentage: number, markAsFinishedPercentComplete: unknown): Promise<string> {
      const insertChain = makeInsertChain();
      const db = {
        select: vi
          .fn()
          .mockReturnValueOnce(makeSelectChain('limit', [{ bookId: 10, primaryFileId: 9, format: 'epub', markAsFinishedPercentComplete }]))
          .mockReturnValueOnce(makeSelectChain('limit', [])),
        insert: vi.fn().mockReturnValue(insertChain),
        execute: vi.fn().mockResolvedValue(undefined),
      };

      await new BookRepository(db as never).syncKoboReadingStateFromProgress(5, 9, percentage);

      return (insertChain.values.mock.calls[0][0] as { statusInfo: { Status: string } }).statusInfo.Status;
    }

    it.each([
      { percentage: 0, threshold: 98, expected: 'ReadyToRead' },
      { percentage: 40, threshold: 98, expected: 'Reading' },
      { percentage: 97.5, threshold: 98, expected: 'Reading' },
      { percentage: 98, threshold: 98, expected: 'Finished' },
      { percentage: 100, threshold: 98, expected: 'Finished' },
      { percentage: 95, threshold: 95, expected: 'Finished' },
      { percentage: 99, threshold: 100, expected: 'Reading' },
    ])('reports $expected at $percentage% with a $threshold% threshold', async ({ percentage, threshold, expected }) => {
      await expect(syncStatusFor(percentage, threshold)).resolves.toBe(expected);
    });

    it('never reports an unread book as finished when the threshold is zero', async () => {
      await expect(syncStatusFor(0, 0)).resolves.toBe('ReadyToRead');
    });

    it('requires full completion when the threshold is unusable', async () => {
      await expect(syncStatusFor(98, null)).resolves.toBe('Reading');
      await expect(syncStatusFor(100, null)).resolves.toBe('Finished');
    });
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

  function makeClearProgressDb(file: { bookId: number; primaryFileId: number } | undefined, koboState: Record<string, unknown> | undefined) {
    const deleted: unknown[] = [];
    const inserted: unknown[] = [];
    const updated: unknown[] = [];
    const executed: unknown[] = [];

    const del = vi.fn().mockImplementation((table: unknown) => ({
      where: vi.fn().mockImplementation(() => {
        deleted.push(table);
        return Promise.resolve(undefined);
      }),
    }));
    // Recorded at values() so it captures both a plain insert and a chained upsert.
    const insert = vi.fn().mockImplementation((table: unknown) => ({
      values: vi.fn().mockImplementation((rows: unknown) => {
        inserted.push({ table, rows });
        return Object.assign(Promise.resolve(undefined), {
          onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        });
      }),
    }));
    const update = vi.fn().mockImplementation((table: unknown) => ({
      set: vi.fn().mockImplementation((patch: unknown) => ({
        where: vi.fn().mockImplementation(() => {
          updated.push({ table, patch });
          return Promise.resolve(undefined);
        }),
      })),
    }));
    const execute = vi.fn().mockImplementation((statement: unknown) => {
      executed.push(statement);
      return Promise.resolve(undefined);
    });

    // clearFileProgress looks the file up outside the transaction; inside it, the Kobo reset
    // reads the existing reading state and clearBookProgress lists the book's files.
    const select = vi
      .fn()
      .mockImplementation(() => makeSelectChain('limit', koboState ? [koboState] : []))
      .mockImplementationOnce(() => makeSelectChain('limit', file ? [file] : []));

    const tx = {
      delete: del,
      insert,
      update,
      execute,
      select: vi.fn().mockImplementation(() => makeSelectChain('limit', koboState ? [koboState] : [])),
    };
    const db = {
      select,
      delete: del,
      insert,
      update,
      execute,
      transaction: vi.fn().mockImplementation(async (cb: (t: unknown) => Promise<void>) => cb(tx)),
    };
    return { db, tx, deleted, inserted, updated, executed };
  }

  it('clears reading, audio and KOReader device rows for a file id and records the reset', async () => {
    const { db, deleted, inserted } = makeClearProgressDb({ bookId: 3, primaryFileId: 99 }, undefined);
    const repo = new BookRepository(db as never);

    await repo.clearFileProgress(7, 99);

    expect(deleted).toEqual([readingProgress, audiobookProgress, koreaderDeviceProgress, koreaderProgressResets]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual({ table: koreaderProgressResets, rows: [{ userId: 7, bookFileId: 99 }] });
  });

  it('leaves the Kobo bookmark alone when the cleared file is not the book primary', async () => {
    const { db, updated } = makeClearProgressDb({ bookId: 3, primaryFileId: 42 }, { lastModifiedKobo: '2026-01-01T00:00:00Z' });
    const repo = new BookRepository(db as never);

    await repo.clearFileProgress(7, 99);

    expect(updated).toEqual([]);
  });

  it('winds the Kobo bookmark back to the start when the primary file is cleared', async () => {
    const { db, updated, executed } = makeClearProgressDb({ bookId: 3, primaryFileId: 99 }, { lastModifiedKobo: '2026-01-01T00:00:00Z' });
    const repo = new BookRepository(db as never);

    await repo.clearFileProgress(7, 99);

    expect(updated).toHaveLength(1);
    const patch = (updated[0] as { patch: Record<string, unknown> }).patch;
    expect(patch.currentBookmark).toEqual(expect.objectContaining({ ProgressPercent: 0 }));
    expect(patch.statusInfo).toEqual(expect.objectContaining({ Status: 'ReadyToRead', TimesStartedReading: 0 }));
    // A Kobo bookmark only wins on a strictly newer timestamp, so the reset has to advance past
    // whatever the device last reported rather than stamping wall clock over it.
    expect(String(patch.lastModifiedKobo) > '2026-01-01T00:00:00Z').toBe(true);
    expect(executed).toHaveLength(1);
  });

  it('records a reset for every file of a book', async () => {
    const { db, inserted, deleted } = makeClearProgressDb(undefined, undefined);
    const repo = new BookRepository(db as never);
    db.transaction = vi.fn().mockImplementation(async (cb: (t: unknown) => Promise<void>) =>
      cb({
        ...db,
        select: vi
          .fn()
          .mockImplementation(() => makeSelectChain('limit', []))
          .mockImplementationOnce(() => makeSelectChain('where', [{ id: 11 }, { id: 12 }])),
      }),
    ) as never;

    await repo.clearBookProgress(7, 3);

    expect(deleted).toEqual([readingProgress, audiobookProgress, koreaderDeviceProgress, koreaderProgressResets]);
    expect(inserted).toEqual([
      {
        table: koreaderProgressResets,
        rows: [
          { userId: 7, bookFileId: 11 },
          { userId: 7, bookFileId: 12 },
        ],
      },
    ]);
  });

  it('retires a pending reset when the web reader writes progress back', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate }) });
    const resetWhere = vi.fn().mockResolvedValue(undefined);
    const del = vi.fn().mockReturnValue({ where: resetWhere });
    const repo = new BookRepository({ insert, delete: del } as never);

    await repo.upsertProgress(5, 9, 'epubcfi(/6/2)', null, 40);

    expect(del).toHaveBeenCalledWith(koreaderProgressResets);
    expect(resetWhere).toHaveBeenCalledTimes(1);
  });

  describe('temporal jump buckets', () => {
    const dialect = new PgDialect();

    it('maps bounded temporal groups and the unknown tail without a full row sort', async () => {
      const execute = vi.fn().mockResolvedValue({
        rows: [
          { bucket: '2026-07', item_index: 0, total: 100_000, is_unknown: false, unit: 'month', step: 1 },
          { bucket: '__unknown__', item_index: 99_900, total: 100_000, is_unknown: true, unit: 'month', step: 1 },
        ],
      });
      const repo = new BookRepository({ execute } as never);

      const result = await repo.findTemporalJumpBuckets({
        where: undefined,
        field: 'addedAt',
        direction: 'desc',
        precision: 'date',
        userId: 7,
        timeZone: 'America/Denver',
        maxBuckets: 24,
      });

      expect(result).toEqual({
        buckets: [
          { key: '2026-07', label: '2026-07', index: 0 },
          { key: '__unknown__', label: '__unknown__', index: 99_900, isUnknown: true },
        ],
        total: 100_000,
        kind: 'temporal',
        granularity: { unit: 'month', step: 1 },
      });
      const query = dialect.sqlToQuery(execute.mock.calls[0]![0]).sql;
      expect(query).toContain('temporal_rows AS MATERIALIZED');
      expect(query).toContain('known_capacity');
      expect(query).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING');
      expect(query).not.toContain('ROW_NUMBER()');
    });

    it('pre-aggregates per-user last-read values before collapsing series', async () => {
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      const repo = new BookRepository({ execute } as never);

      await repo.findTemporalJumpBucketsCollapsed({
        where: undefined,
        field: 'lastReadAt',
        direction: 'asc',
        precision: 'date',
        userId: 9,
        timeZone: 'UTC',
        maxBuckets: 32,
      });

      const query = dialect.sqlToQuery(execute.mock.calls[0]![0]).sql;
      expect(query).toContain('rail_last_read AS MATERIALIZED');
      expect(query).toContain('max(rail_rp.last_read_at)');
      expect(query).not.toContain('rail_rp.updated_at');
      expect(query).toContain('GROUP BY rail_bf.book_id');
      expect(query).toContain('base_rows AS MATERIALIZED');
      expect(query).toContain('representatives AS');
      expect(query).not.toContain('SELECT max(rp.updated_at)');
    });
  });

  describe('discrete jump buckets', () => {
    const dialect = new PgDialect();

    it('maps bounded categorical groups and unknown values', async () => {
      const execute = vi.fn().mockResolvedValue({
        rows: [
          { bucket: 'en', item_index: 0, total: 100_000, is_unknown: false },
          { bucket: '__unknown__', item_index: 90_000, total: 100_000, is_unknown: true },
        ],
      });
      const repo = new BookRepository({ execute } as never);

      const result = await repo.findJumpBuckets({
        where: undefined,
        field: 'language',
        kind: 'category',
        userId: 7,
        maxBuckets: 24,
        orderBy: [sql`book_metadata.language ASC NULLS LAST`],
      });

      expect(result).toEqual({
        buckets: [
          { key: 'en', label: 'en', index: 0 },
          { key: '__unknown__', label: '__unknown__', index: 90_000, isUnknown: true },
        ],
        total: 100_000,
        kind: 'category',
        granularity: null,
      });
      const query = dialect.sqlToQuery(execute.mock.calls[0]![0]).sql;
      expect(query).toContain('ordered AS MATERIALIZED');
      expect(query).toContain('bucket_count');
      expect(query).toContain('LIMIT');
    });

    it('joins primary formats and per-user statuses once instead of correlating each row', async () => {
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      const repo = new BookRepository({ execute } as never);

      await repo.findJumpBuckets({
        where: undefined,
        field: 'format',
        kind: 'category',
        userId: 9,
        maxBuckets: 32,
        orderBy: [sql`books.id ASC`],
      });
      const formatQuery = dialect.sqlToQuery(execute.mock.calls[0]![0]).sql;
      expect(formatQuery).toContain('LEFT JOIN "book_files" rail_primary_file');
      expect(formatQuery).not.toContain('SELECT bf.format');

      await repo.findJumpBuckets({
        where: undefined,
        field: 'readStatus',
        kind: 'category',
        userId: 9,
        maxBuckets: 32,
        orderBy: [sql`books.id ASC`],
      });
      const statusQuery = dialect.sqlToQuery(execute.mock.calls[1]![0]).sql;
      expect(statusQuery).toContain('LEFT JOIN "user_book_status" rail_ubs');
      expect(statusQuery).toContain('rail_ubs.user_id =');
      expect(statusQuery).not.toContain('SELECT ubs.status');
    });

    it('carries categorical values through the collapsed representative query', async () => {
      const execute = vi.fn().mockResolvedValue({ rows: [] });
      const repo = new BookRepository({ execute } as never);

      await repo.findJumpBucketsCollapsed({
        where: undefined,
        field: 'readStatus',
        kind: 'category',
        sort: [{ field: 'readStatus', dir: 'asc' }],
        userId: 9,
        maxBuckets: 32,
      });

      const query = dialect.sqlToQuery(execute.mock.calls[0]![0]).sql;
      expect(query).toContain('base_rows AS MATERIALIZED');
      expect(query).toContain("coalesce(rail_ubs.status::text, 'unread') AS rail_discrete_value");
      expect(query).toContain('base.rail_discrete_value');
      expect(query).toContain('r.rail_discrete_value');
    });
  });

  describe('bulkSetRating', () => {
    it('does nothing for an empty book id list', async () => {
      const db = { insert: vi.fn() };
      const repo = new BookRepository(db as never);

      await repo.bulkSetRating([], 4, 7);

      expect(db.insert).not.toHaveBeenCalled();
    });

    it('upserts a rating row per book id', async () => {
      const insertChain = makeInsertChain();
      const db = { insert: vi.fn().mockReturnValue(insertChain) };
      const repo = new BookRepository(db as never);

      await repo.bulkSetRating([10, 20], 4, 7);

      expect(insertChain.values).toHaveBeenCalledWith([
        { userId: 7, bookId: 10, rating: 4 },
        { userId: 7, bookId: 20, rating: 4 },
      ]);
      expect(insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          set: expect.objectContaining({ rating: 4 }),
        }),
      );
    });

    it('upserts a null rating tombstone instead of deleting the row', async () => {
      const insertChain = makeInsertChain();
      const db = { insert: vi.fn().mockReturnValue(insertChain) };
      const repo = new BookRepository(db as never);

      await repo.bulkSetRating([10], null, 7);

      expect(insertChain.values).toHaveBeenCalledWith([{ userId: 7, bookId: 10, rating: null }]);
      expect(insertChain.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          set: expect.objectContaining({ rating: null }),
        }),
      );
    });
  });
});
