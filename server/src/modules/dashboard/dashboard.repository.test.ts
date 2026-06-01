import { DashboardRepository } from './dashboard.repository';

function makeLimitChain<T>(rows: T) {
  const chain: Record<string, vi.Mock> = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  return chain;
}

describe('DashboardRepository', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('returns empty results without querying when no libraries are accessible', async () => {
    const db = { select: vi.fn(), execute: vi.fn() };
    const repo = new DashboardRepository(db as never);

    await expect(repo.findRecentlyAddedBookIds([], 20)).resolves.toEqual([]);
    await expect(repo.findContinueReadingBookIds([], 1, 20)).resolves.toEqual([]);
    await expect(repo.findUpNextInSeriesBookIds([], 1, 20)).resolves.toEqual([]);
    await expect(repo.findRandomBookIds([], 1, 20)).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('maps recently added rows to id list', async () => {
    const listChain = makeLimitChain([{ id: 5 }, { id: 2 }]);
    const db = { select: vi.fn().mockReturnValue(listChain) };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findRecentlyAddedBookIds([10], 2);

    expect(result).toEqual([5, 2]);
    expect(listChain.limit).toHaveBeenCalledWith(2);
  });

  it('maps continue-reading rows to id list', async () => {
    const listChain = makeLimitChain([{ id: 40 }, { id: 9 }]);
    const db = { select: vi.fn().mockReturnValue(listChain) };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findContinueReadingBookIds([8], 55, 10);

    expect(result).toEqual([40, 9]);
    expect(listChain.leftJoin).toHaveBeenCalledTimes(3);
    expect(listChain.innerJoin).not.toHaveBeenCalled();
    expect(listChain.limit).toHaveBeenCalledWith(10);
  });

  it('returns empty random ids when there are no candidates', async () => {
    const listChain = makeLimitChain([]);
    const db = { select: vi.fn().mockReturnValue(listChain) };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findRandomBookIds([5], 7, 20);

    expect(result).toEqual([]);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(listChain.leftJoin).toHaveBeenCalledTimes(2);
    expect(listChain.orderBy).toHaveBeenCalledTimes(1);
    expect(listChain.limit).toHaveBeenCalledWith(20);
  });

  it('maps random rows to id list and respects limit', async () => {
    const listChain = makeLimitChain([{ id: 21 }, { id: 3 }, { id: 15 }]);
    const db = { select: vi.fn().mockReturnValue(listChain) };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findRandomBookIds([5], 7, 3);

    expect(result).toEqual([21, 3, 15]);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(listChain.leftJoin).toHaveBeenCalledTimes(2);
    expect(listChain.orderBy).toHaveBeenCalledTimes(1);
    expect(listChain.limit).toHaveBeenCalledWith(3);
  });

  it('returns empty random ids and does not query when limit is zero', async () => {
    const db = { select: vi.fn() };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findRandomBookIds([3, 4], 99, 0);

    expect(result).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('maps up-next-in-series rows to id list', async () => {
    const db = {
      select: vi.fn(),
      execute: vi.fn().mockResolvedValue({ rows: [{ id: 17 }, { id: 4 }] }),
    };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findUpNextInSeriesBookIds([9], 55, 10);

    expect(result).toEqual([17, 4]);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('returns empty up-next-in-series ids and does not query when limit is zero', async () => {
    const db = {
      select: vi.fn(),
      execute: vi.fn(),
    };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findUpNextInSeriesBookIds([9], 55, 0);

    expect(result).toEqual([]);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('returns empty up-next-in-series ids when query returns no rows', async () => {
    const db = {
      select: vi.fn(),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findUpNextInSeriesBookIds([2], 101, 20);

    expect(result).toEqual([]);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
