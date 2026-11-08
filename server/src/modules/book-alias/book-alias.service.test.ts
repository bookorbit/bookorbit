import { BookAliasRepository } from './book-alias.repository';
import { BookAliasService } from './book-alias.service';

describe('BookAliasService', () => {
  const build = (aliases: Map<number, number>) => {
    const repository = {
      resolve: vi.fn((ids: number[]) => Promise.resolve(new Map(ids.filter((id) => aliases.has(id)).map((id) => [id, aliases.get(id)!])))),
    };
    return { service: new BookAliasService(repository as unknown as BookAliasRepository), repository };
  };

  it('maps merged-away ids to the book they were merged into and leaves the rest out', async () => {
    const { service } = build(new Map([[4, 10]]));

    await expect(service.resolve([4, 5])).resolves.toEqual(new Map([[4, 10]]));
  });

  it('never queries for ids that cannot be a book id', async () => {
    const { service, repository } = build(new Map());

    await expect(service.resolve([0, -3, 1.5, Number.NaN, 2_147_483_648])).resolves.toEqual(new Map());
    expect(repository.resolve).not.toHaveBeenCalled();
  });

  it('passes only the valid ids on', async () => {
    const { service, repository } = build(new Map([[2_147_483_647, 1]]));

    await expect(service.resolve([0, 2_147_483_647, 9_999_999_999])).resolves.toEqual(new Map([[2_147_483_647, 1]]));
    expect(repository.resolve).toHaveBeenCalledWith([2_147_483_647]);
  });

  it('resolves one id to its target, or null when it was never merged', async () => {
    const { service } = build(new Map([[4, 10]]));

    await expect(service.resolveOne(4)).resolves.toBe(10);
    await expect(service.resolveOne(5)).resolves.toBeNull();
    await expect(service.resolveOne(-1)).resolves.toBeNull();
  });
});

describe('BookAliasRepository', () => {
  const build = (rowsPerCall: Array<Array<{ sourceBookId: number; targetBookId: number }>>) => {
    let call = 0;
    const where = vi.fn(() => Promise.resolve(rowsPerCall[call++] ?? []));
    const db = { select: () => ({ from: () => ({ where }) }) };
    return { repository: new BookAliasRepository(db as never), where };
  };

  it('reads each distinct id once and returns the targets it found', async () => {
    const { repository, where } = build([[{ sourceBookId: 3, targetBookId: 8 }]]);

    await expect(repository.resolve([3, 3, 4])).resolves.toEqual(new Map([[3, 8]]));
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('splits a large lookup into bounded batches', async () => {
    const ids = Array.from({ length: 1_001 }, (_, index) => index + 1);
    const { repository, where } = build([[{ sourceBookId: 1, targetBookId: 2_000 }], [], [{ sourceBookId: 1_001, targetBookId: 2_001 }]]);

    await expect(repository.resolve(ids)).resolves.toEqual(
      new Map([
        [1, 2_000],
        [1_001, 2_001],
      ]),
    );
    expect(where).toHaveBeenCalledTimes(3);
  });

  it('does not query for an empty list', async () => {
    const { repository, where } = build([]);

    await expect(repository.resolve([])).resolves.toEqual(new Map());
    expect(where).not.toHaveBeenCalled();
  });
});
