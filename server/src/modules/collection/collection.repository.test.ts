vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  count: vi.fn(() => ({ op: 'count' })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ op: 'inArray', left, right })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

import { CollectionRepository } from './collection.repository';

describe('CollectionRepository', () => {
  const txWhere = vi.fn();
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
    txWhere.mockResolvedValue(undefined);
  });

  it('updateDisplayOrders performs all updates in a single transaction and updates timestamps', async () => {
    await repo.updateDisplayOrders(12, [
      { id: 1, displayOrder: 3 },
      { id: 2, displayOrder: 4 },
    ]);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledTimes(2);
    expect(txSet).toHaveBeenNthCalledWith(1, expect.objectContaining({ displayOrder: 3, updatedAt: expect.anything() }));
    expect(txSet).toHaveBeenNthCalledWith(2, expect.objectContaining({ displayOrder: 4, updatedAt: expect.anything() }));
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
    const firstInnerJoin = vi.fn().mockReturnValue({ where: firstWhere });
    const firstFrom = vi.fn().mockReturnValue({ innerJoin: firstInnerJoin });
    const firstSelect = { from: firstFrom };

    const secondWhere = vi.fn().mockResolvedValue([{ total: '2' }]);
    const secondInnerJoin = vi.fn().mockReturnValue({ where: secondWhere });
    const secondFrom = vi.fn().mockReturnValue({ innerJoin: secondInnerJoin });
    const secondSelect = { from: secondFrom };

    db.select.mockReturnValueOnce(firstSelect as never).mockReturnValueOnce(secondSelect as never);

    const result = await repo.findBookIdsPage(20, [100, 101], 1, 2);

    expect(firstLimit).toHaveBeenCalledWith(2);
    expect(firstOffset).toHaveBeenCalledWith(2);
    expect(result).toEqual({ bookIds: [7, 9], total: 2, page: 1, size: 2 });
  });
});
