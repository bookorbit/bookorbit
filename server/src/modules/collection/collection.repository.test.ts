vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  count: vi.fn(() => ({ op: 'count' })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ op: 'inArray', left, right })),
  ne: vi.fn((left: unknown, right: unknown) => ({ op: 'ne', left, right })),
  or: vi.fn((...clauses: unknown[]) => ({ op: 'or', clauses })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
    {
      join: vi.fn((chunks: unknown[], separator: unknown) => ({ op: 'sql.join', chunks, separator })),
    },
  ),
}));

import { CollectionRepository } from './collection.repository';

describe('CollectionRepository', () => {
  const txWhere = vi.fn();
  const txReturning = vi.fn();
  const txSet = vi.fn();
  const txUpdate = vi.fn(() => ({ set: txSet }));
  const tx = {
    update: txUpdate,
  };

  const db = {
    select: vi.fn(),
    transaction: vi.fn(),
  };

  let repo: CollectionRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = new CollectionRepository(db as never);

    db.transaction.mockImplementation(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx));
    txUpdate.mockImplementation(() => ({ set: txSet }));
    txSet.mockReturnValue({ where: txWhere });
    txWhere.mockReturnValue({ returning: txReturning });
    txReturning.mockResolvedValue([{ id: 1 }]);
  });

  it('updateDisplayOrders performs all updates in a single transaction and updates timestamps', async () => {
    const updatedCount = await repo.updateDisplayOrders(12, [
      { id: 1, displayOrder: 3 },
      { id: 2, displayOrder: 4 },
    ]);

    expect(updatedCount).toBe(2);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledTimes(2);
    expect(txSet).toHaveBeenNthCalledWith(1, expect.objectContaining({ displayOrder: 3, updatedAt: expect.anything() }));
    expect(txSet).toHaveBeenNthCalledWith(2, expect.objectContaining({ displayOrder: 4, updatedAt: expect.anything() }));
  });

  it('aborts the transaction when any collection is not owned by the caller', async () => {
    txReturning.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);

    const updatedCount = await repo.updateDisplayOrders(12, [
      { id: 1, displayOrder: 3 },
      { id: 2, displayOrder: 4 },
    ]);

    expect(updatedCount).toBe(0);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledTimes(2);
  });

  it('findBookIdsPage short-circuits when no library ids are accessible', async () => {
    const result = await repo.findBookIdsPage(20, [], 1, 25);

    expect(result).toEqual({ bookIds: [], total: 0, page: 1, size: 25 });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('findBookIdsPage returns paged ids and total count', async () => {
    const firstOffset = vi.fn().mockResolvedValue([{ bookId: 7 }, { bookId: 9 }]);
    const firstLimit = vi.fn().mockReturnValue({ offset: firstOffset });
    const firstOrderBy = vi.fn().mockReturnValue({ limit: firstLimit });
    const firstWhere = vi.fn().mockReturnValue({ orderBy: firstOrderBy });
    const firstInnerJoin2 = vi.fn().mockReturnValue({ where: firstWhere });
    const firstInnerJoin = vi.fn().mockReturnValue({ innerJoin: firstInnerJoin2 });
    const firstFrom = vi.fn().mockReturnValue({ innerJoin: firstInnerJoin });
    const firstSelect = { from: firstFrom };

    const secondWhere = vi.fn().mockResolvedValue([{ total: '2' }]);
    const secondInnerJoin2 = vi.fn().mockReturnValue({ where: secondWhere });
    const secondInnerJoin = vi.fn().mockReturnValue({ innerJoin: secondInnerJoin2 });
    const secondFrom = vi.fn().mockReturnValue({ innerJoin: secondInnerJoin });
    const secondSelect = { from: secondFrom };

    db.select.mockReturnValueOnce(firstSelect as never).mockReturnValueOnce(secondSelect as never);

    const result = await repo.findBookIdsPage(20, [100, 101], 1, 2);

    expect(firstLimit).toHaveBeenCalledWith(2);
    expect(firstOffset).toHaveBeenCalledWith(2);
    expect(result).toEqual({ bookIds: [7, 9], total: 2, page: 1, size: 2 });
  });

  it('findAllOwnedForUserWithMembership builds a viewer-filtered membership projection for provided book ids', async () => {
    const orderBy = vi.fn().mockResolvedValue([{ id: 1, memberCount: 2 }]);
    const groupBy = vi.fn().mockReturnValue({ orderBy });
    const where = vi.fn().mockReturnValue({ groupBy });
    const secondLeftJoin = vi.fn().mockReturnValue({ where });
    const leftJoin = vi.fn().mockReturnValue({ leftJoin: secondLeftJoin });
    const from = vi.fn().mockReturnValue({ leftJoin });
    db.select.mockReturnValueOnce({ from } as never);

    const visibleBooksWhere = { type: 'visible-books' } as never;
    const rows = await repo.findAllOwnedForUserWithMembership(5, [100, 101], visibleBooksWhere);

    expect(rows).toEqual([{ id: 1, memberCount: 2 }]);
    expect(db.select).toHaveBeenCalledWith(expect.objectContaining({ memberCount: expect.anything() }));
    expect(secondLeftJoin).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ op: 'and' }));
  });

  it('findAllVisibleForUser keeps public metadata visible while counting only viewer-visible books', async () => {
    const orderBy = vi.fn().mockResolvedValue([{ id: 1, bookCount: 1 }]);
    const groupBy = vi.fn().mockReturnValue({ orderBy });
    const where = vi.fn().mockReturnValue({ groupBy });
    const secondLeftJoin = vi.fn().mockReturnValue({ where });
    const firstLeftJoin = vi.fn().mockReturnValue({ leftJoin: secondLeftJoin });
    const from = vi.fn().mockReturnValue({ leftJoin: firstLeftJoin });
    db.select.mockReturnValueOnce({ from } as never);

    const rows = await repo.findAllVisibleForUser(5, { type: 'visible-books' } as never);

    expect(rows).toEqual([{ id: 1, bookCount: 1 }]);
    expect(where).toHaveBeenCalledWith(expect.objectContaining({ op: 'or' }));
    expect(secondLeftJoin).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ op: 'and' }));
  });

  it('findByIdForViewer embeds owner-or-public authorization in the query', async () => {
    const limit = vi.fn().mockResolvedValue([{ id: 10, bookCount: 1 }]);
    const groupBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ groupBy });
    const secondLeftJoin = vi.fn().mockReturnValue({ where });
    const firstLeftJoin = vi.fn().mockReturnValue({ leftJoin: secondLeftJoin });
    const from = vi.fn().mockReturnValue({ leftJoin: firstLeftJoin });
    db.select.mockReturnValueOnce({ from } as never);

    await repo.findByIdForViewer(10, 5, false, { type: 'visible-books' } as never);

    expect(where).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'and',
        clauses: expect.arrayContaining([expect.objectContaining({ op: 'or' })]),
      }),
    );
  });

  it('buildReadableMembershipWhere carries the same owner-or-public authorization predicate', () => {
    const limit = vi.fn().mockReturnValue({});
    const where = vi.fn().mockReturnValue({ limit });
    const innerJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ innerJoin });
    db.select.mockReturnValueOnce({ from } as never);

    repo.buildReadableMembershipWhere(10, 5, false);

    expect(where).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'and',
        clauses: expect.arrayContaining([expect.objectContaining({ op: 'or' })]),
      }),
    );
  });

  it('addBooks and removeBooks issue membership writes with expected payloads', async () => {
    const insertChain = {
      values: vi.fn(),
      onConflictDoNothing: vi.fn(),
      returning: vi.fn(),
    };
    insertChain.values.mockReturnValue(insertChain);
    insertChain.onConflictDoNothing.mockReturnValue(insertChain);
    insertChain.returning.mockResolvedValue([{ collectionId: 10, bookId: 1 }]);

    const deleteChain = {
      where: vi.fn(),
      returning: vi.fn(),
    };
    deleteChain.where.mockReturnValue(deleteChain);
    deleteChain.returning.mockResolvedValue([{ collectionId: 10, bookId: 1 }]);

    const localDb = {
      insert: vi.fn().mockReturnValue(insertChain),
      delete: vi.fn().mockReturnValue(deleteChain),
    };
    const localRepo = new CollectionRepository(localDb as never);

    await localRepo.addBooks(10, [1, 2]);
    await localRepo.removeBooks(10, [1]);

    expect(insertChain.values).toHaveBeenCalledWith([
      { collectionId: 10, bookId: 1 },
      { collectionId: 10, bookId: 2 },
    ]);
    expect(insertChain.onConflictDoNothing).toHaveBeenCalled();
    expect(deleteChain.where).toHaveBeenCalled();
  });
});
