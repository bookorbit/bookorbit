jest.mock('drizzle-orm', () => ({
  and: jest.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  eq: jest.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  getTableColumns: jest.fn(() => ({})),
  sql: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

import { LibraryRepository } from './library.repository';

describe('LibraryRepository', () => {
  const updateWhere = jest.fn();
  const updateSet = jest.fn();

  const db = {
    update: jest.fn(() => ({ set: updateSet })),
    select: jest.fn(),
    query: {
      userLibraryAccess: {
        findFirst: jest.fn(),
      },
    },
  };

  let repo: LibraryRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    repo = new LibraryRepository(db as any);

    db.update.mockImplementation(() => ({ set: updateSet }));
    updateSet.mockReturnValue({ where: updateWhere });
    updateWhere.mockResolvedValue(undefined);
  });

  it('updateDisplayOrders updates each library order entry', async () => {
    await repo.updateDisplayOrders([
      { id: 1, displayOrder: 5 },
      { id: 2, displayOrder: 6 },
    ]);

    expect(db.update).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenNthCalledWith(1, { displayOrder: 5 });
    expect(updateSet).toHaveBeenNthCalledWith(2, { displayOrder: 6 });
  });

  it('getStats aggregates counts, sizes, and format map', async () => {
    const countChain = {
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([{ count: 3 }]),
      }),
    };

    const formatChain = {
      from: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            groupBy: jest.fn().mockResolvedValue([
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
    (db.query.userLibraryAccess.findFirst as jest.Mock).mockResolvedValue(undefined);

    await expect(repo.hasUserAccess(1, 2)).resolves.toBe(false);
  });
});
