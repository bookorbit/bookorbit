import { lenses } from '../../db/schema';
import { LensRepository } from './lens.repository';

describe('LensRepository', () => {
  it('builds find/update/delete queries and counts display-order updates inside a transaction', async () => {
    const findAllOrderBy = vi.fn().mockReturnValue('find-all-query');
    const findByIdLimit = vi.fn().mockResolvedValue([{ id: 1 }]);
    const where = vi.fn().mockReturnValue({ orderBy: findAllOrderBy, limit: findByIdLimit });
    const from = vi.fn().mockReturnValue({ where });

    const insertReturning = vi.fn().mockResolvedValue([{ id: 2 }]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    const insert = vi.fn().mockReturnValue({ values: insertValues });

    const updateReturning = vi.fn().mockResolvedValue([{ id: 3 }]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set: updateSet });

    const deleteReturning = vi.fn().mockResolvedValue([{ id: 4 }]);
    const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

    const txReturning = vi
      .fn()
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([]);
    const txWhere = vi.fn().mockReturnValue({ returning: txReturning });
    const txSet = vi.fn().mockReturnValue({ where: txWhere });
    const txUpdate = vi.fn().mockReturnValue({ set: txSet });
    const transaction = vi
      .fn()
      .mockImplementation(async (callback: (tx: { update: typeof txUpdate }) => Promise<number>) => callback({ update: txUpdate }));

    const db = {
      select: vi.fn().mockReturnValue({ from }),
      insert,
      update,
      delete: deleteFn,
      transaction,
    };

    const repo = new LensRepository(db as never);

    expect(repo.findAllForUser(9)).toBe('find-all-query');
    expect(findAllOrderBy).toHaveBeenCalledWith(lenses.displayOrder, lenses.name);

    await expect(repo.findById(1)).resolves.toEqual([{ id: 1 }]);
    await expect(repo.insert({ userId: 9, name: 'Favorites' } as never)).resolves.toEqual([{ id: 2 }]);
    await expect(repo.update(3, 9, { name: 'Renamed' })).resolves.toEqual([{ id: 3 }]);
    await expect(repo.delete(4, 9)).resolves.toEqual([{ id: 4 }]);

    const updatedCount = await repo.updateDisplayOrders(9, [
      { id: 100, displayOrder: 0 },
      { id: 101, displayOrder: 1 },
    ]);
    expect(updatedCount).toBe(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledTimes(2);
  });
});
