import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Permission } from '@bookorbit/types';

import { StorygraphRepository } from './storygraph.repository';

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
  const settingsRow = { id: 1, userId: 7, sessionCookie: 'sess', rememberToken: 'remember', enabled: true };
  const bookStateRow = { id: 2, userId: 7, bookId: 42, storygraphBookId: 'abc-123' };

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
  const permissionLimit = vi.fn().mockResolvedValue([{ isSuperuser: false, permissionName: Permission.StorygraphSync }]);
  const permissionWhere = vi.fn().mockReturnValue({ limit: permissionLimit });
  const permissionLeftJoin = vi.fn().mockReturnValue({ where: permissionWhere });
  const permissionFrom = vi.fn().mockReturnValue({ leftJoin: permissionLeftJoin });

  const db = {
    query: {
      storygraphUserSettings: settingsQuery,
      storygraphBookState: bookStateQuery,
    },
    insert: vi.fn().mockReturnValueOnce(settingsInsert).mockReturnValueOnce(bookStateInsert),
    delete: vi.fn().mockReturnValue(deleteChain),
    update: vi.fn().mockReturnValue(updateChain),
    select: vi.fn().mockReturnValue({ from: bookIdFrom }),
  };

  return {
    repo: new StorygraphRepository(db as never),
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

describe('StorygraphRepository', () => {
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

    await expect(repo.upsertSettings(7, { sessionCookie: 'sess' })).resolves.toEqual(settingsRow);
    expect(settingsInsert.values).toHaveBeenCalledWith({ userId: 7, sessionCookie: 'sess' });
    expect(settingsInsert.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: expect.objectContaining({ sessionCookie: 'sess' }) }),
    );
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

    await expect(repo.upsertBookState({ userId: 7, bookId: 42, storygraphBookId: 'abc-123' })).resolves.toEqual(bookStateRow);
    expect(bookStateInsert.values).toHaveBeenCalledWith({ userId: 7, bookId: 42, storygraphBookId: 'abc-123' });
    expect(bookStateInsert.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: expect.objectContaining({ storygraphBookId: 'abc-123' }) }),
    );
  });

  it('clearBookMatch resets the cached match and last-synced snapshot', async () => {
    const { repo, db, bookStateInsert } = makeRepository();
    db.insert.mockReset();
    db.insert.mockReturnValue(bookStateInsert);

    await expect(repo.clearBookMatch(7, 42)).resolves.toBeUndefined();
    expect(bookStateInsert.values).toHaveBeenCalledWith({
      userId: 7,
      bookId: 42,
      storygraphBookId: null,
      matchMethod: null,
      matchError: null,
      lastSyncedAt: null,
    });
  });

  it('resetSyncProgress nulls the synced markers while keeping the match', async () => {
    const { repo, db, updateChain } = makeRepository();

    await expect(repo.resetSyncProgress(7, 42)).resolves.toBeUndefined();
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastSyncedAt: null, lastSyncedStatus: null, lastSyncedProgress: null, syncError: null }),
    );
    // The match itself is preserved so the book stays "Linked".
    const setArg = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg).not.toHaveProperty('storygraphBookId');
    expect(setArg).not.toHaveProperty('matchMethod');
  });

  it('updateLastSyncedAt updates the settings timestamp', async () => {
    const { repo, updateChain } = makeRepository();
    const syncedAt = new Date('2026-01-01T00:00:00Z');

    await repo.updateLastSyncedAt(7, syncedAt);

    expect(updateChain.set).toHaveBeenCalledWith({ lastSyncedAt: syncedAt });
  });

  it('updateSessionCookie updates the stored session cookie', async () => {
    const { repo, updateChain } = makeRepository();

    await repo.updateSessionCookie(7, 'new-session-value');

    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ sessionCookie: 'new-session-value' }));
  });

  it('findSyncableBooks selects the local title, author, and file format', async () => {
    const { repo, db } = makeRepository();
    const selectArgs: Array<Record<string, unknown>> = [];
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'groupBy', 'orderBy', 'as']) {
      chain[method] = vi.fn().mockReturnValue(chain);
    }
    chain.limit = vi.fn().mockResolvedValue([]);
    chain.then = (resolve: (rows: unknown[]) => void) => resolve([]);
    db.select.mockImplementation((cols: Record<string, unknown>) => {
      selectArgs.push(cols);
      return chain;
    });

    await repo.findSyncableBooks(7);

    const mainSelect = selectArgs.find((cols) => cols && 'bookId' in cols && 'status' in cols);
    expect(mainSelect).toBeDefined();
    expect(mainSelect).toHaveProperty('title');
    expect(mainSelect).toHaveProperty('authorName');
    expect(mainSelect).toHaveProperty('format');
  });

  it('findBooksWithSyncErrors selects failure fields filtered to errored states', async () => {
    const { repo, db } = makeRepository();
    const selectArgs: Array<Record<string, unknown>> = [];
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'groupBy', 'orderBy', 'as']) {
      chain[method] = vi.fn().mockReturnValue(chain);
    }
    chain.limit = vi.fn().mockResolvedValue([]);
    chain.then = (resolve: (rows: unknown[]) => void) => resolve([]);
    db.select.mockImplementation((cols: Record<string, unknown>) => {
      selectArgs.push(cols);
      return chain;
    });

    await repo.findBooksWithSyncErrors(7);

    const mainSelect = selectArgs.find((cols) => cols && 'syncError' in cols);
    expect(mainSelect).toBeDefined();
    expect(mainSelect).toHaveProperty('bookId');
    expect(mainSelect).toHaveProperty('title');
    expect(mainSelect).toHaveProperty('authorName');
    expect(mainSelect).toHaveProperty('lastAttemptAt');
  });

  it('findSyncableBook returns a book from findSyncableBooks', async () => {
    const { repo } = makeRepository();
    const findBookSyncDataForUser = vi.spyOn(repo as any, 'findBookSyncDataForUser');
    findBookSyncDataForUser.mockResolvedValueOnce([{ bookId: 42 }]).mockResolvedValueOnce([]);

    await expect(repo.findSyncableBook(7, 42)).resolves.toEqual({ bookId: 42 });
    await expect(repo.findSyncableBook(7, 99)).resolves.toBeNull();
    expect(findBookSyncDataForUser).toHaveBeenNthCalledWith(1, 7, { bookId: 42, includeUnread: false, accessScope: undefined });
    expect(findBookSyncDataForUser).toHaveBeenNthCalledWith(2, 7, { bookId: 99, includeUnread: false, accessScope: undefined });
  });

  it('findBookIdByFileId returns the first matching book id', async () => {
    const { repo, bookIdLimit, bookIdWhere } = makeRepository();

    await expect(repo.findBookIdByFileId(5)).resolves.toBe(42);
    expect(bookIdLimit).toHaveBeenCalledWith(1);
    expect(bookIdWhere).toHaveBeenCalledTimes(1);
  });

  it('userHasStorygraphSyncPermission returns true for a user with the permission', async () => {
    const { repo, db, permissionFrom } = makeRepository();
    db.select.mockReturnValueOnce({ from: permissionFrom });

    await expect(repo.userHasStorygraphSyncPermission(7)).resolves.toBe(true);
  });

  it('userHasStorygraphSyncPermission returns true for a superuser', async () => {
    const { repo, db, permissionFrom, permissionLimit } = makeRepository();
    permissionLimit.mockResolvedValueOnce([{ isSuperuser: true, permissionName: null }]);
    db.select.mockReturnValueOnce({ from: permissionFrom });

    await expect(repo.userHasStorygraphSyncPermission(7)).resolves.toBe(true);
  });

  it('userHasStorygraphSyncPermission returns false without an active matching user permission row', async () => {
    const { repo, db, permissionFrom, permissionLimit } = makeRepository();
    permissionLimit.mockResolvedValueOnce([{ isSuperuser: false, permissionName: null }]);
    db.select.mockReturnValueOnce({ from: permissionFrom });

    await expect(repo.userHasStorygraphSyncPermission(7)).resolves.toBe(false);
  });
});
