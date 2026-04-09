import { DashboardRepository } from './dashboard.repository';

function makeBoundsChain<T>(rows: T) {
  const chain: Record<string, vi.Mock> = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockResolvedValue(rows);
  return chain;
}

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
    const db = { select: vi.fn() };
    const repo = new DashboardRepository(db as never);

    await expect(repo.findRecentlyAddedBookIds([], 20)).resolves.toEqual([]);
    await expect(repo.findContinueReadingBookIds([], 1, 20)).resolves.toEqual([]);
    await expect(repo.findRandomBookIds([], 1, 20)).resolves.toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
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
    expect(listChain.limit).toHaveBeenCalledWith(10);
  });

  it('returns empty random ids when there are no candidates', async () => {
    const boundsChain = makeBoundsChain([{ minId: null, maxId: null }]);
    const db = { select: vi.fn().mockReturnValue(boundsChain) };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findRandomBookIds([5], 7, 20);

    expect(result).toEqual([]);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('uses zero offset for random ids when total candidates are below requested limit', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const boundsChain = makeBoundsChain([{ minId: 1, maxId: 3 }]);
    const firstPassChain = makeLimitChain([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const secondPassChain = makeLimitChain([]);
    const db = {
      select: vi.fn().mockReturnValueOnce(boundsChain).mockReturnValueOnce(firstPassChain).mockReturnValueOnce(secondPassChain),
    };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findRandomBookIds([5], 7, 20);

    expect(result).toEqual([1, 2, 3]);
    expect(firstPassChain.limit).toHaveBeenCalledWith(20);
    expect(secondPassChain.limit).toHaveBeenCalledWith(17);
    randomSpy.mockRestore();
  });

  it('uses wrap-around sampling when anchored random pass does not fill the limit', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const boundsChain = makeBoundsChain([{ minId: 1, maxId: 12 }]);
    const firstPassChain = makeLimitChain([{ id: 21 }, { id: 22 }]);
    const secondPassChain = makeLimitChain([{ id: 1 }, { id: 2 }]);
    const db = {
      select: vi.fn().mockReturnValueOnce(boundsChain).mockReturnValueOnce(firstPassChain).mockReturnValueOnce(secondPassChain),
    };
    const repo = new DashboardRepository(db as never);

    const result = await repo.findRandomBookIds([3, 4], 99, 5);

    expect(result).toEqual([21, 22, 1, 2]);
    expect(firstPassChain.limit).toHaveBeenCalledWith(5);
    expect(secondPassChain.limit).toHaveBeenCalledWith(3);
    randomSpy.mockRestore();
  });
});
