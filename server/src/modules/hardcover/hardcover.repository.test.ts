import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Permission } from '@bookorbit/types';

import * as schema from '../../db/schema';
import { HardcoverRepository } from './hardcover.repository';

function makeReturningChain(row: unknown) {
  const chain = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    returning: vi.fn(),
  };
  chain.values.mockReturnValue(chain);
  chain.onConflictDoUpdate.mockReturnValue(chain);
  chain.returning.mockResolvedValue([row]);
  return chain;
}

function makeWhereChain(result: unknown) {
  return {
    where: vi.fn().mockResolvedValue(result),
  };
}

function makeRepository() {
  const settingsRow = { id: 1, userId: 7, apiToken: 'tok', enabled: true, bookSyncMode: 'all_eligible' };
  const bookStateRow = { id: 2, userId: 7, bookId: 42, hardcoverBookId: 99, syncOverride: null, syncExcluded: false };

  const settingsQuery = { findFirst: vi.fn().mockResolvedValue(settingsRow) };
  const bookStateQuery = {
    findFirst: vi.fn().mockResolvedValue(bookStateRow),
    findMany: vi.fn().mockResolvedValue([bookStateRow]),
  };

  const settingsInsert = makeReturningChain(settingsRow);
  const bookStateInsert = makeReturningChain(bookStateRow);
  const deleteChain = makeWhereChain(undefined);
  const updateChain = { set: vi.fn().mockReturnValue(makeWhereChain(undefined)) };
  const bookIdLimit = vi.fn().mockResolvedValue([{ bookId: 42 }]);
  const bookIdWhere = vi.fn().mockReturnValue({ limit: bookIdLimit });
  const bookIdFrom = vi.fn().mockReturnValue({ where: bookIdWhere });
  const permissionLimit = vi.fn().mockResolvedValue([{ isSuperuser: false, permissionName: Permission.HardcoverSync }]);
  const permissionWhere = vi.fn().mockReturnValue({ limit: permissionLimit });
  const permissionLeftJoin = vi.fn().mockReturnValue({ where: permissionWhere });
  const permissionFrom = vi.fn().mockReturnValue({ leftJoin: permissionLeftJoin });

  const db = {
    query: {
      hardcoverUserSettings: settingsQuery,
      hardcoverBookState: bookStateQuery,
    },
    insert: vi.fn().mockReturnValueOnce(settingsInsert).mockReturnValueOnce(bookStateInsert),
    delete: vi.fn().mockReturnValue(deleteChain),
    update: vi.fn().mockReturnValue(updateChain),
    select: vi.fn().mockReturnValue({ from: bookIdFrom }),
  };

  return {
    repo: new HardcoverRepository(db as never),
    db,
    settingsQuery,
    bookStateQuery,
    settingsInsert,
    bookStateInsert,
    deleteChain,
    updateChain,
    bookIdLimit,
    bookIdWhere,
    permissionLimit,
    permissionFrom,
    settingsRow,
    bookStateRow,
  };
}

describe('HardcoverRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('findSettings returns the user settings row', async () => {
    const { repo, settingsQuery, settingsRow } = makeRepository();

    await expect(repo.findSettings(7)).resolves.toEqual(settingsRow);
    expect(settingsQuery.findFirst).toHaveBeenCalledTimes(1);
  });

  it('upsertSettings inserts or updates settings for a user', async () => {
    const { repo, db, settingsInsert, settingsRow } = makeRepository();
    db.insert.mockReset();
    db.insert.mockReturnValue(settingsInsert);

    await expect(repo.upsertSettings(7, { apiToken: 'tok' })).resolves.toEqual(settingsRow);
    expect(settingsInsert.values).toHaveBeenCalledWith({ userId: 7, apiToken: 'tok' });
    expect(settingsInsert.onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({ set: expect.objectContaining({ apiToken: 'tok' }) }));
  });

  it('deleteSettings deletes settings for a user', async () => {
    const { repo, deleteChain } = makeRepository();

    await repo.deleteSettings(7);

    expect(deleteChain.where).toHaveBeenCalledTimes(1);
  });

  it('findBookState returns one book state row', async () => {
    const { repo, bookStateQuery, bookStateRow } = makeRepository();

    await expect(repo.findBookState(7, 42)).resolves.toEqual(bookStateRow);
    expect(bookStateQuery.findFirst).toHaveBeenCalledTimes(1);
  });

  it('findBookStatesByBookIds short-circuits for an empty list', async () => {
    const { repo, bookStateQuery } = makeRepository();

    await expect(repo.findBookStatesByBookIds(7, [])).resolves.toEqual([]);
    expect(bookStateQuery.findMany).not.toHaveBeenCalled();
  });

  it('findBookStatesByBookIds returns matching state rows', async () => {
    const { repo, bookStateQuery, bookStateRow } = makeRepository();

    await expect(repo.findBookStatesByBookIds(7, [42])).resolves.toEqual([bookStateRow]);
    expect(bookStateQuery.findMany).toHaveBeenCalledTimes(1);
  });

  it('upsertBookState inserts or updates per-book state', async () => {
    const { repo, db, bookStateInsert, bookStateRow } = makeRepository();
    db.insert.mockReset();
    db.insert.mockReturnValue(bookStateInsert);

    await expect(repo.upsertBookState({ userId: 7, bookId: 42, hardcoverBookId: 99 })).resolves.toEqual(bookStateRow);
    expect(bookStateInsert.values).toHaveBeenCalledWith({ userId: 7, bookId: 42, hardcoverBookId: 99 });
    expect(bookStateInsert.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: expect.objectContaining({ hardcoverBookId: 99 }) }),
    );
  });

  it('setBookSyncOverride inserts or updates only the per-book override', async () => {
    const { repo, db, bookStateInsert, bookStateRow } = makeRepository();
    db.insert.mockReset();
    db.insert.mockReturnValue(bookStateInsert);

    await expect(repo.setBookSyncOverride(7, 42, 'included')).resolves.toEqual(bookStateRow);

    expect(bookStateInsert.values).toHaveBeenCalledWith({ userId: 7, bookId: 42, syncOverride: 'included', syncExcluded: false });
    expect(bookStateInsert.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [schema.hardcoverBookState.userId, schema.hardcoverBookState.bookId],
        set: expect.objectContaining({ syncOverride: 'included', syncExcluded: false }),
      }),
    );
  });

  it('updateLastSyncedAt updates the settings timestamp', async () => {
    const { repo, updateChain } = makeRepository();
    const syncedAt = new Date('2026-01-01T00:00:00Z');

    await repo.updateLastSyncedAt(7, syncedAt);

    expect(updateChain.set).toHaveBeenCalledWith({ lastSyncedAt: syncedAt });
  });

  it('findSyncableBooks selects the local pageCount and format', async () => {
    const { repo, db } = makeRepository();
    const selectArgs: Array<Record<string, unknown>> = [];
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'groupBy', 'as']) {
      chain[method] = vi.fn().mockReturnValue(chain);
    }
    chain.then = (resolve: (rows: unknown[]) => void) => resolve([]);
    db.select.mockImplementation((cols: Record<string, unknown>) => {
      selectArgs.push(cols);
      return chain;
    });

    await repo.findSyncableBooks(7);

    const mainSelect = selectArgs.find((cols) => cols && 'bookId' in cols && 'status' in cols);
    expect(mainSelect).toBeDefined();
    expect(mainSelect).toHaveProperty('pageCount');
    expect(mainSelect).toHaveProperty('format');
  });

  it('findSyncableBook returns a book from findSyncableBooks', async () => {
    const { repo } = makeRepository();
    const findSyncableBooksForUser = vi.spyOn(repo as any, 'findSyncableBooksForUser');
    findSyncableBooksForUser.mockResolvedValueOnce([{ bookId: 42 }]).mockResolvedValueOnce([]);

    await expect(repo.findSyncableBook(7, 42)).resolves.toEqual({ bookId: 42 });
    await expect(repo.findSyncableBook(7, 99)).resolves.toBeNull();
    expect(findSyncableBooksForUser).toHaveBeenNthCalledWith(1, 7, 42);
    expect(findSyncableBooksForUser).toHaveBeenNthCalledWith(2, 7, 99);
  });

  it('findSyncableBook applies the single-book filter in the query builder', async () => {
    const { repo, db } = makeRepository();
    const selectArgs: Array<Record<string, unknown>> = [];
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'groupBy', 'as']) {
      chain[method] = vi.fn().mockReturnValue(chain);
    }
    chain.then = (resolve: (rows: unknown[]) => void) => resolve([{ bookId: 42 }]);
    db.select.mockImplementation((cols: Record<string, unknown>) => {
      selectArgs.push(cols);
      return chain;
    });

    await expect(repo.findSyncableBook(7, 42)).resolves.toEqual({ bookId: 42 });

    expect(chain.where).toHaveBeenCalled();
    expect(selectArgs.some((cols) => cols && 'bookId' in cols && 'status' in cols)).toBe(true);
  });

  it('findCurrentReadingBooks filters to reading/rereading statuses', async () => {
    const { repo, db } = makeRepository();
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'groupBy', 'as']) {
      chain[method] = vi.fn().mockReturnValue(chain);
    }
    chain.then = (resolve: (rows: unknown[]) => void) => resolve([{ bookId: 42 }]);
    db.select.mockImplementation(() => chain);

    await expect(repo.findCurrentReadingBooks(7)).resolves.toEqual([{ bookId: 42 }]);
    expect(chain.where).toHaveBeenCalled();
  });

  it('updateEditionIfLinked updates an existing link and returns true', async () => {
    const { repo, db } = makeRepository();
    const returning = vi.fn().mockResolvedValue([{ id: 2 }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    db.update.mockReset();
    db.update.mockReturnValue({ set });

    await expect(repo.updateEditionIfLinked(7, 42, 555)).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ hardcoverEditionId: 555 }));
  });

  it('updateEditionIfLinked returns false when the user has no link for that book', async () => {
    const { repo, db } = makeRepository();
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    db.update.mockReset();
    db.update.mockReturnValue({ set });

    await expect(repo.updateEditionIfLinked(7, 42, 555)).resolves.toBe(false);
  });

  it('findBookIdByFileId returns null when no file row exists', async () => {
    const { repo, bookIdLimit } = makeRepository();
    bookIdLimit.mockResolvedValueOnce([]);

    await expect(repo.findBookIdByFileId(5)).resolves.toBeNull();
  });

  it('findBookIdByFileId returns the first matching book id', async () => {
    const { repo, bookIdLimit, bookIdWhere } = makeRepository();

    await expect(repo.findBookIdByFileId(5)).resolves.toBe(42);
    expect(bookIdLimit).toHaveBeenCalledWith(1);
    expect(bookIdWhere).toHaveBeenCalledTimes(1);
  });

  it('findImportCandidateBooks short-circuits when no libraries are accessible', async () => {
    const { repo, db } = makeRepository();
    db.select.mockClear();

    await expect(repo.findImportCandidateBooks(7, [])).resolves.toEqual([]);

    expect(db.select).not.toHaveBeenCalled();
  });

  it('findImportCandidateBooks maps local books with authors and progress', async () => {
    const { repo, db } = makeRepository();
    const progressSq = { bookId: 'progressBookId', maxProgress: 'maxProgress' };
    const progressChain: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'groupBy']) {
      progressChain[method] = vi.fn().mockReturnValue(progressChain);
    }
    progressChain.as = vi.fn().mockReturnValue(progressSq);

    const rows = [
      {
        bookId: 42,
        primaryFileId: 500,
        primaryFileFormat: 'epub',
        title: 'Dune',
        isbn13: '9780441172719',
        isbn10: null,
        hardcoverMetadataId: '10',
        authorsCsv: 'Frank Herbert||Brian Herbert',
        status: 'unread',
        startedAt: null,
        finishedAt: null,
        progress: 12,
      },
      {
        bookId: 43,
        primaryFileId: null,
        primaryFileFormat: null,
        title: null,
        isbn13: null,
        isbn10: null,
        hardcoverMetadataId: null,
        authorsCsv: '',
        status: null,
        startedAt: null,
        finishedAt: null,
        progress: null,
      },
    ];
    const mainChain: Record<string, unknown> = {};
    for (const method of ['from', 'leftJoin', 'where']) {
      mainChain[method] = vi.fn().mockReturnValue(mainChain);
    }
    mainChain.groupBy = vi.fn().mockResolvedValue(rows);

    db.select.mockReset();
    db.select.mockReturnValueOnce(progressChain).mockReturnValueOnce(mainChain);

    await expect(
      repo.findImportCandidateBooks(7, [1], { includeTagIds: [], excludeTagIds: [], includeGenreIds: [], excludeGenreIds: [] }),
    ).resolves.toEqual([
      {
        bookId: 42,
        primaryFileId: 500,
        primaryFileFormat: 'epub',
        title: 'Dune',
        isbn13: '9780441172719',
        isbn10: null,
        hardcoverMetadataId: '10',
        authors: ['Frank Herbert', 'Brian Herbert'],
        status: 'unread',
        startedAt: null,
        finishedAt: null,
        progress: 12,
      },
      {
        bookId: 43,
        primaryFileId: null,
        primaryFileFormat: null,
        title: null,
        isbn13: null,
        isbn10: null,
        hardcoverMetadataId: null,
        authors: [],
        status: null,
        startedAt: null,
        finishedAt: null,
        progress: null,
      },
    ]);
    expect(progressChain.as).toHaveBeenCalledWith('import_max_progress_sq');
    expect(mainChain.groupBy).toHaveBeenCalled();
  });

  it('userHasHardcoverSyncPermission returns true for a user with the permission', async () => {
    const { repo, db, permissionFrom } = makeRepository();
    db.select.mockReturnValueOnce({ from: permissionFrom });

    await expect(repo.userHasHardcoverSyncPermission(7)).resolves.toBe(true);
  });

  it('userHasHardcoverSyncPermission returns true for a superuser', async () => {
    const { repo, db, permissionFrom, permissionLimit } = makeRepository();
    permissionLimit.mockResolvedValueOnce([{ isSuperuser: true, permissionName: null }]);
    db.select.mockReturnValueOnce({ from: permissionFrom });

    await expect(repo.userHasHardcoverSyncPermission(7)).resolves.toBe(true);
  });

  it('userHasHardcoverSyncPermission returns false without an active matching user permission row', async () => {
    const { repo, db, permissionFrom, permissionLimit } = makeRepository();
    permissionLimit.mockResolvedValueOnce([{ isSuperuser: false, permissionName: null }]);
    db.select.mockReturnValueOnce({ from: permissionFrom });

    await expect(repo.userHasHardcoverSyncPermission(7)).resolves.toBe(false);
  });

  it('upsertImportProgress inserts or updates only blank existing progress', async () => {
    const { repo, db } = makeRepository();
    const progressInsert = makeReturningChain({ bookFileId: 500 });
    db.insert.mockReset();
    db.insert.mockReturnValue(progressInsert);

    await expect(repo.upsertImportProgress(7, 500, 140)).resolves.toBe(true);

    expect(progressInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        bookFileId: 500,
        percentage: 100,
      }),
    );
    expect(progressInsert.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [schema.readingProgress.bookFileId, schema.readingProgress.userId],
        setWhere: expect.anything(),
        set: expect.objectContaining({ percentage: 100 }),
      }),
    );
    expect(progressInsert.returning).toHaveBeenCalledWith({ bookFileId: schema.readingProgress.bookFileId });
  });

  it('upsertImportProgress returns false when an existing positive progress row wins the race', async () => {
    const { repo, db } = makeRepository();
    const progressInsert = makeReturningChain({ bookFileId: 500 });
    progressInsert.returning.mockResolvedValue([]);
    db.insert.mockReset();
    db.insert.mockReturnValue(progressInsert);

    await expect(repo.upsertImportProgress(7, 500, 50)).resolves.toBe(false);
  });

  it('upsertImportProgress normalizes invalid percentages to zero', async () => {
    const { repo, db } = makeRepository();
    const progressInsert = makeReturningChain({ bookFileId: 500 });
    db.insert.mockReset();
    db.insert.mockReturnValue(progressInsert);

    await expect(repo.upsertImportProgress(7, 500, Number.NaN)).resolves.toBe(true);

    expect(progressInsert.values).toHaveBeenCalledWith(expect.objectContaining({ percentage: 0 }));
    expect(progressInsert.onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({ set: expect.objectContaining({ percentage: 0 }) }));
  });
});
