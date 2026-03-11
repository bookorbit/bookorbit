vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ op: 'and', clauses })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right })),
  getTableColumns: vi.fn(() => ({})),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', text: strings.join(''), values })),
}));

import { LibraryRepository } from './library.repository';

describe('LibraryRepository', () => {
  const updateWhere = vi.fn();
  const updateSet = vi.fn();

  const db = {
    update: vi.fn(() => ({ set: updateSet })),
    select: vi.fn(),
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
});
