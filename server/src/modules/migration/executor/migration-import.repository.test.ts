import * as schema from '../../../db/schema';
import { MigrationImportRepository } from './migration-import.repository';

describe('MigrationImportRepository', () => {
  it('uses transactional repository instance inside withTransaction', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 44 }]);
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });

    const tx = { insert };
    const db = {
      transaction: vi.fn().mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    const repo = new MigrationImportRepository(db as never);
    const row = await repo.withTransaction((transactionRepo) => transactionRepo.upsertTag('Fantasy'));

    expect(row).toEqual({ id: 44 });
    expect(insert).toHaveBeenCalledWith(schema.tags);
  });

  it('upserts book metadata in batches and updates provided scalar id fields on conflict', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const execute = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });

    const repo = new MigrationImportRepository({ insert, execute } as never);
    await repo.batchUpsertBookMetadata([
      {
        bookId: 1,
        title: 'Dune',
        openLibraryId: 'OL1W',
        itunesId: '123',
      },
      {
        bookId: 2,
        publisher: 'Ace',
      },
    ]);

    expect(insert).toHaveBeenCalledTimes(2);
    expect(onConflictDoUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        target: schema.bookMetadata.bookId,
        set: expect.objectContaining({
          title: expect.anything(),
          openLibraryId: expect.anything(),
          itunesId: expect.anything(),
          updatedAt: expect.anything(),
        }),
      }),
    );
  });

  it('resolves series identity for batch metadata imports', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert };
    const seriesIdentity = {
      resolveMetadataPatch: vi.fn().mockResolvedValue({ bookId: 1, seriesName: 'Dune', seriesId: 88 }),
    };

    const repo = new MigrationImportRepository(db as never, seriesIdentity as never);
    await repo.batchUpsertBookMetadata([{ bookId: 1, seriesName: '  Dune  ' }]);

    expect(seriesIdentity.resolveMetadataPatch).toHaveBeenCalledWith({ bookId: 1, seriesName: '  Dune  ' }, db);
    expect(values).toHaveBeenCalledWith({ bookId: 1, seriesName: 'Dune', seriesId: 88 });
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          seriesName: expect.anything(),
          seriesId: expect.anything(),
        }),
      }),
    );
  });

  it('clearUserBookStatuses no-ops for empty targets and deduplicates ids otherwise', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where });
    const repo = new MigrationImportRepository({ delete: deleteFn } as never);

    await repo.clearUserBookStatuses([], [1, 2]);
    await repo.clearUserBookStatuses([1], []);
    expect(deleteFn).not.toHaveBeenCalled();

    await repo.clearUserBookStatuses([1, 1, 2], [10, 10, 11]);
    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('batchUpsertAuthors returns name-to-id mapping from inserted rows', async () => {
    const returning = vi.fn().mockResolvedValue([
      { id: 10, name: 'Frank Herbert' },
      { id: 11, name: 'Brian Herbert' },
    ]);
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const execute = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });

    const repo = new MigrationImportRepository({ execute, insert } as never);
    const map = await repo.batchUpsertAuthors([
      { name: 'Frank Herbert', sortName: 'Herbert, Frank' },
      { name: 'Brian Herbert', sortName: 'Herbert, Brian' },
    ]);

    expect(map).toEqual(
      new Map([
        ['Frank Herbert', 10],
        ['Brian Herbert', 11],
      ]),
    );
  });

  it('fetches primary file maps and marks only audio formats as audiobook primary', async () => {
    const where = vi.fn().mockResolvedValue([
      { bookId: 1, primaryFileId: 101, primaryFileFormat: 'epub' },
      { bookId: 2, primaryFileId: 202, primaryFileFormat: 'mp3' },
      { bookId: 3, primaryFileId: null, primaryFileFormat: null },
    ]);
    const leftJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ leftJoin });
    const select = vi.fn().mockReturnValue({ from });

    const repo = new MigrationImportRepository({ select } as never);
    await expect(repo.fetchTargetBookPrimaryFiles([])).resolves.toEqual({
      primaryFilesByBookId: new Map(),
      audiobookPrimaryFilesByBookId: new Map(),
    });
    const result = await repo.fetchTargetBookPrimaryFiles([1, 2, 3]);

    expect(result.primaryFilesByBookId).toEqual(
      new Map([
        [1, 101],
        [2, 202],
      ]),
    );
    expect(result.audiobookPrimaryFilesByBookId).toEqual(new Map([[2, 202]]));
  });

  it('groups target files by book id and supports empty input short-circuit', async () => {
    const where = vi.fn().mockResolvedValue([
      { id: 11, bookId: 1, hash: 'h1', absolutePath: '/books/1.epub' },
      { id: 12, bookId: 1, hash: null, absolutePath: '/books/1.m4b' },
      { id: 21, bookId: 2, hash: 'h2', absolutePath: '/books/2.epub' },
    ]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const repo = new MigrationImportRepository({ select } as never);

    await expect(repo.fetchTargetBookFiles([])).resolves.toEqual(new Map());
    await expect(repo.fetchTargetBookFiles([1, 2])).resolves.toEqual(
      new Map([
        [
          1,
          [
            { id: 11, hash: 'h1', absolutePath: '/books/1.epub' },
            { id: 12, hash: null, absolutePath: '/books/1.m4b' },
          ],
        ],
        [[2, [{ id: 21, hash: 'h2', absolutePath: '/books/2.epub' }]]][0],
      ]),
    );
  });

  it('returns library-id map for book ids and skips query for empty input', async () => {
    const where = vi.fn().mockResolvedValue([
      { id: 1, libraryId: 10 },
      { id: 2, libraryId: 20 },
    ]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });

    const repo = new MigrationImportRepository({ select } as never);

    await expect(repo.fetchLibraryIdsByBookIds([])).resolves.toEqual(new Map());
    await expect(repo.fetchLibraryIdsByBookIds([1, 2])).resolves.toEqual(
      new Map([
        [1, 10],
        [2, 20],
      ]),
    );
  });

  it('upsertCollectionBook reflects whether insert produced a row', async () => {
    const returning = vi
      .fn()
      .mockResolvedValueOnce([{ collectionId: 1 }])
      .mockResolvedValueOnce([]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn().mockReturnValue({ values });

    const repo = new MigrationImportRepository({ insert } as never);

    await expect(repo.upsertCollectionBook(1, 10)).resolves.toBe(true);
    await expect(repo.upsertCollectionBook(1, 10)).resolves.toBe(false);
  });

  it('executes relation delete/insert wrapper methods against expected tables', async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn().mockReturnValue({ values });
    const execute = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });

    const repo = new MigrationImportRepository({ delete: deleteFn, execute, insert } as never);

    await repo.deleteBookAuthors(1);
    await repo.deleteBookNarrators(1);
    await repo.deleteBookGenres(1);
    await repo.deleteBookTags(1);
    await repo.clearCollectionBooks(10);
    await repo.insertBookAuthor(1, 2, 0);
    await repo.insertBookNarrator(1, 3, 1);
    await repo.insertBookGenre(1, 4);
    await repo.insertBookTag(1, 5);
    await repo.insertBookmark({ userId: 1, bookId: 1, cfi: '/6/2', title: 'x', createdAt: new Date() } as never);

    expect(deleteFn).toHaveBeenCalledWith(schema.bookAuthors);
    expect(deleteFn).toHaveBeenCalledWith(schema.bookNarrators);
    expect(deleteFn).toHaveBeenCalledWith(schema.bookGenres);
    expect(deleteFn).toHaveBeenCalledWith(schema.bookTags);
    expect(deleteFn).toHaveBeenCalledWith(schema.collectionBooks);
    expect(insert).toHaveBeenCalledWith(schema.bookAuthors);
    expect(insert).toHaveBeenCalledWith(schema.bookNarrators);
    expect(insert).toHaveBeenCalledWith(schema.bookGenres);
    expect(insert).toHaveBeenCalledWith(schema.bookTags);
    expect(insert).toHaveBeenCalledWith(schema.bookmarks);
  });

  it('marks cover as custom with aligned insert/update timestamps', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const repo = new MigrationImportRepository({ insert } as never);

    await repo.markCoverAsCustom(77);

    const insertedPayload = values.mock.calls[0][0] as { coverSource: string; updatedAt: Date };
    const conflictPayload = onConflictDoUpdate.mock.calls[0][0] as { set: { coverSource: string; updatedAt: Date } };

    expect(insertedPayload.coverSource).toBe('custom');
    expect(insertedPayload.updatedAt).toBeInstanceOf(Date);
    expect(conflictPayload.set.coverSource).toBe('custom');
    expect(conflictPayload.set.updatedAt).toEqual(insertedPayload.updatedAt);
  });

  it('upsert progress methods omit conflict target keys from update set', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const repo = new MigrationImportRepository({ insert } as never);

    await repo.upsertUserBookStatus({
      userId: 1,
      bookId: 2,
      status: 'read',
      source: 'manual',
      startedAt: null,
      finishedAt: null,
      updatedAt: new Date(),
    } as never);
    await repo.upsertReadingProgress({
      bookFileId: 10,
      userId: 1,
      percentage: 50,
      cfi: null,
      pageNumber: null,
      positionSeconds: null,
      updatedAt: new Date(),
    } as never);
    await repo.upsertAudiobookProgress({
      userId: 1,
      bookId: 2,
      percentage: 75,
      currentFileId: 10,
      positionSeconds: 120,
      updatedAt: new Date(),
    } as never);

    const setUserBookStatus = onConflictDoUpdate.mock.calls[0][0].set as Record<string, unknown>;
    expect(setUserBookStatus).not.toHaveProperty('userId');
    expect(setUserBookStatus).not.toHaveProperty('bookId');

    const setReadingProgress = onConflictDoUpdate.mock.calls[1][0].set as Record<string, unknown>;
    expect(setReadingProgress).not.toHaveProperty('bookFileId');
    expect(setReadingProgress).not.toHaveProperty('userId');

    const setAudiobookProgress = onConflictDoUpdate.mock.calls[2][0].set as Record<string, unknown>;
    expect(setAudiobookProgress).not.toHaveProperty('userId');
    expect(setAudiobookProgress).not.toHaveProperty('bookId');
  });

  it('clear reading/bookmark/annotation methods short-circuit empty targets', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where });
    const repo = new MigrationImportRepository({ delete: deleteFn } as never);

    await repo.clearReadingProgress([], [1]);
    await repo.clearReadingProgress([1], []);
    await repo.clearBookmarks([], [1]);
    await repo.clearBookmarks([1], []);
    await repo.clearAnnotations([], [1]);
    await repo.clearAnnotations([1], []);

    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('fetchExistingCollections short-circuits empty user lists', async () => {
    const select = vi.fn();
    const repo = new MigrationImportRepository({ select } as never);

    await expect(repo.fetchExistingCollections([])).resolves.toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('executes single-row upsert wrappers and collection helpers with non-empty inputs', async () => {
    const returning = vi
      .fn()
      .mockResolvedValueOnce([{ id: 101 }])
      .mockResolvedValueOnce([{ id: 102 }])
      .mockResolvedValueOnce([{ id: 103 }])
      .mockResolvedValueOnce([{ id: 104 }])
      .mockResolvedValueOnce([{ id: 500 }]);
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate, onConflictDoNothing, returning });
    const insert = vi.fn().mockReturnValue({ values });

    const where = vi.fn().mockResolvedValue([{ id: 7, userId: 10, name: 'Sci-fi' }]);
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const execute = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });

    const repo = new MigrationImportRepository({ execute, insert, select } as never);

    await repo.upsertBookMetadata(1, { title: 'Dune' });
    await expect(repo.upsertAuthor({ name: 'Frank Herbert', sortName: 'Herbert, Frank' } as never)).resolves.toEqual({ id: 101 });
    await expect(repo.upsertNarrator({ name: 'Narrator', sortName: 'Narrator' })).resolves.toEqual({ id: 102 });
    await expect(repo.upsertGenre('Science Fiction')).resolves.toEqual({ id: 103 });
    await expect(repo.upsertTag('Space Opera')).resolves.toEqual({ id: 104 });
    await repo.insertAnnotation({ userId: 1, bookId: 1, cfi: '/6/2', text: 'note', color: 'yellow', style: 'highlight' } as never);
    await expect(repo.fetchExistingCollections([10])).resolves.toEqual([{ id: 7, userId: 10, name: 'Sci-fi' }]);
    await expect(
      repo.insertCollection({ userId: 10, name: 'Imported', description: null, syncToKobo: false, displayOrder: 0 } as never),
    ).resolves.toEqual({ id: 500 });

    expect(insert).toHaveBeenCalledWith(schema.bookMetadata);
    expect(insert).toHaveBeenCalledWith(schema.authors);
    expect(insert).toHaveBeenCalledWith(schema.narrators);
    expect(insert).toHaveBeenCalledWith(schema.genres);
    expect(insert).toHaveBeenCalledWith(schema.tags);
    expect(insert).toHaveBeenCalledWith(schema.annotations);
    expect(insert).toHaveBeenCalledWith(schema.collections);
    expect(select).toHaveBeenCalled();
  });

  it('executes non-empty clear methods for progress, bookmarks, annotations, and audiobooks', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where });
    const repo = new MigrationImportRepository({ delete: deleteFn } as never);

    await repo.clearReadingProgress([1, 1], [10, 10]);
    await repo.clearAudiobookProgress([1, 1], [2, 2]);
    await repo.clearBookmarks([1, 1], [2, 2]);
    await repo.clearAnnotations([1, 1], [2, 2]);

    expect(deleteFn).toHaveBeenCalledWith(schema.readingProgress);
    expect(deleteFn).toHaveBeenCalledWith(schema.audiobookProgress);
    expect(deleteFn).toHaveBeenCalledWith(schema.bookmarks);
    expect(deleteFn).toHaveBeenCalledWith(schema.annotations);
    expect(where).toHaveBeenCalledTimes(4);
  });

  it('runs batch contributor and taxonomy helpers for non-empty and empty arrays', async () => {
    const returning = vi
      .fn()
      .mockResolvedValueOnce([{ id: 201, name: 'Narrator A' }])
      .mockResolvedValueOnce([{ id: 301, name: 'Fantasy' }])
      .mockResolvedValueOnce([{ id: 401, name: 'Epic' }]);
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate, onConflictDoNothing });
    const insert = vi.fn().mockReturnValue({ values });
    const where = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where });
    const execute = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });

    const repo = new MigrationImportRepository({ execute, insert, delete: deleteFn } as never);

    await repo.batchUpsertBookMetadata([]);
    await repo.batchDeleteBookAuthors([]);
    await repo.batchDeleteBookNarrators([]);
    await repo.batchDeleteBookGenres([]);
    await repo.batchDeleteBookTags([]);
    expect(insert).not.toHaveBeenCalled();
    expect(deleteFn).not.toHaveBeenCalled();

    await repo.batchDeleteBookAuthors([1]);
    await repo.batchInsertBookAuthors([{ bookId: 1, authorId: 2, displayOrder: 0 }]);
    await repo.batchDeleteBookNarrators([1]);
    await expect(repo.batchUpsertNarrators([{ name: 'Narrator A', sortName: 'Narrator A' }])).resolves.toEqual(new Map([['Narrator A', 201]]));
    await repo.batchInsertBookNarrators([{ bookId: 1, narratorId: 201, displayOrder: 0 }]);
    await repo.batchDeleteBookGenres([1]);
    await expect(repo.batchUpsertGenres(['Fantasy'])).resolves.toEqual(new Map([['Fantasy', 301]]));
    await repo.batchInsertBookGenres([{ bookId: 1, genreId: 301 }]);
    await repo.batchDeleteBookTags([1]);
    await expect(repo.batchUpsertTags(['Epic'])).resolves.toEqual(new Map([['Epic', 401]]));
    await repo.batchInsertBookTags([{ bookId: 1, tagId: 401 }]);

    expect(deleteFn).toHaveBeenCalledWith(schema.bookAuthors);
    expect(deleteFn).toHaveBeenCalledWith(schema.bookNarrators);
    expect(deleteFn).toHaveBeenCalledWith(schema.bookGenres);
    expect(deleteFn).toHaveBeenCalledWith(schema.bookTags);
    expect(insert).toHaveBeenCalledWith(schema.bookAuthors);
    expect(insert).toHaveBeenCalledWith(schema.bookNarrators);
    expect(insert).toHaveBeenCalledWith(schema.genres);
    expect(insert).toHaveBeenCalledWith(schema.tags);
  });

  it('runs batch user-state write methods for non-empty and empty batches', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate, onConflictDoNothing });
    const insert = vi.fn().mockReturnValue({ values });
    const repo = new MigrationImportRepository({ insert } as never);

    await repo.batchUpsertUserBookStatuses([]);
    await repo.batchUpsertReadingProgress([]);
    await repo.batchUpsertAudiobookProgress([]);
    await repo.batchInsertBookmarks([]);
    await repo.batchInsertAnnotations([]);
    await repo.batchInsertCollectionBooks([]);
    expect(insert).not.toHaveBeenCalled();

    await repo.batchUpsertUserBookStatuses([{ userId: 1, bookId: 2, status: 'read', source: 'manual', updatedAt: new Date() } as never]);
    await repo.batchUpsertReadingProgress([{ userId: 1, bookFileId: 10, percentage: 50, updatedAt: new Date() } as never]);
    await repo.batchUpsertAudiobookProgress([
      { userId: 1, bookId: 2, percentage: 25, currentFileId: 10, positionSeconds: 0, updatedAt: new Date() } as never,
    ]);
    await repo.batchInsertBookmarks([{ userId: 1, bookId: 2, title: 'mark', cfi: '/6/2', createdAt: new Date() } as never]);
    await repo.batchInsertAnnotations([{ userId: 1, bookId: 2, cfi: '/6/2', text: 'a', color: 'yellow', style: 'highlight' } as never]);
    await repo.batchInsertCollectionBooks([{ collectionId: 7, bookId: 2 }]);

    expect(insert).toHaveBeenCalledWith(schema.userBookStatus);
    expect(insert).toHaveBeenCalledWith(schema.readingProgress);
    expect(insert).toHaveBeenCalledWith(schema.audiobookProgress);
    expect(insert).toHaveBeenCalledWith(schema.bookmarks);
    expect(insert).toHaveBeenCalledWith(schema.annotations);
    expect(insert).toHaveBeenCalledWith(schema.collectionBooks);
  });
});
