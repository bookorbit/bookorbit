vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  getTableColumns: vi.fn(() => ({})),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({ op: 'inArray', left, right })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

import { LibraryRepository } from './library.repository';

describe('LibraryRepository', () => {
  const txUpdateWhere = vi.fn();
  const txUpdateSet = vi.fn();
  const txUpdate = vi.fn(() => ({ set: txUpdateSet }));
  const tx = {
    update: txUpdate,
  };

  const db = {
    update: vi.fn(),
    select: vi.fn(),
    transaction: vi.fn(),
    query: {
      userLibraryAccess: {
        findFirst: vi.fn(),
      },
    },
  };

  let repo: LibraryRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    repo = new LibraryRepository(db as any);

    db.transaction.mockImplementation(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx));
    txUpdate.mockImplementation(() => ({ set: txUpdateSet }));
    txUpdateSet.mockReturnValue({ where: txUpdateWhere });
    txUpdateWhere.mockResolvedValue(undefined);
  });

  it('updateDisplayOrders updates each library order entry in one transaction', async () => {
    await repo.updateDisplayOrders([
      { id: 1, displayOrder: 5 },
      { id: 2, displayOrder: 6 },
    ]);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledTimes(2);
    expect(txUpdateSet).toHaveBeenNthCalledWith(1, { displayOrder: 5 });
    expect(txUpdateSet).toHaveBeenNthCalledWith(2, { displayOrder: 6 });
  });

  it('getStats aggregates counts, sizes, and format map', async () => {
    const countChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 3 }]),
      }),
    };

    const formatChain = {
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([
              { format: 'epub', count: 2, totalSize: '3000' },
              { format: 'pdf', count: 1, totalSize: '700' },
            ]),
          }),
        }),
      }),
    };

    db.select.mockReturnValueOnce(countChain as any).mockReturnValueOnce(formatChain as any);

    const stats = await repo.getStats(9);

    expect(stats).toEqual({
      totalBooks: 3,
      totalSizeBytes: 3700,
      formatCounts: { epub: 2, pdf: 1 },
    });
  });

  it('hasUserAccess returns false when no access row exists', async () => {
    (db.query.userLibraryAccess.findFirst as vi.Mock).mockResolvedValue(undefined);

    await expect(repo.hasUserAccess(1, 2)).resolves.toBe(false);
  });

  it('getStats throws when totalSizeBytes exceeds safe integer range', async () => {
    const countChain = {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 1 }]),
      }),
    };

    const formatChain = {
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([{ format: 'epub', count: 1, totalSize: '9007199254740992' }]),
          }),
        }),
      }),
    };

    db.select.mockReturnValueOnce(countChain as any).mockReturnValueOnce(formatChain as any);

    await expect(repo.getStats(9)).rejects.toThrow('totalSizeBytes exceeds Number.MAX_SAFE_INTEGER');
  });
});
