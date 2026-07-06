import { SeriesMembershipService } from './series-membership.service';
import { normalizeMetadataText, normalizeMetadataTextKey } from '../utils/metadata-text-normalize.utils';

function makeSeriesIdentity(ids: Record<string, number>) {
  return {
    normalizeDisplayName: vi.fn((name: string | null | undefined) => normalizeMetadataText(name)),
    normalizeName: vi.fn((name: string | null | undefined) => normalizeMetadataTextKey(name)),
    resolveSeriesId: vi.fn((name: string | null | undefined) => {
      const key = normalizeMetadataTextKey(name) ?? '';
      return Promise.resolve(ids[key] ?? null);
    }),
  };
}

function makeMutationDb() {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFrom = vi.fn().mockReturnValue({ where: deleteWhere });
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insertInto = vi.fn().mockReturnValue({ values: insertValues });
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  return {
    db: { delete: deleteFrom, insert: insertInto, update } as never,
    deleteFrom,
    deleteWhere,
    insertInto,
    insertValues,
    update,
    updateSet,
    updateWhere,
  };
}

function makeSelectChain<T>(rows: T[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ innerJoin, where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, innerJoin, where, orderBy, limit };
}

describe('SeriesMembershipService', () => {
  it('replaces memberships with normalized unique series and syncs primary scalar metadata', async () => {
    const identity = makeSeriesIdentity({ dune: 101, 'the expanse': 202 });
    const { db, deleteFrom, insertValues, updateSet } = makeMutationDb();
    const service = new SeriesMembershipService(db, identity as never);

    const result = await service.replaceForBook(
      10,
      [
        { seriesName: '  Dune  ', seriesIndex: 1 },
        { seriesName: 'dune', seriesIndex: 2 },
        { seriesName: 'The   Expanse', seriesIndex: 5 },
        { seriesName: 'The Expanse', seriesIndex: null },
        { seriesName: '   ', seriesIndex: 3 },
      ],
      db,
    );

    expect(result).toEqual([
      { seriesId: 101, seriesName: 'Dune', seriesIndex: 1, displayOrder: 0 },
      { seriesId: 202, seriesName: 'The Expanse', seriesIndex: 5, displayOrder: 1 },
    ]);
    expect(deleteFrom).toHaveBeenCalledTimes(1);
    expect(identity.resolveSeriesId).toHaveBeenCalledTimes(2);
    expect(insertValues).toHaveBeenCalledWith([
      { bookId: 10, seriesId: 101, seriesIndex: 1, displayOrder: 0 },
      { bookId: 10, seriesId: 202, seriesIndex: 5, displayOrder: 1 },
    ]);
    expect(updateSet).toHaveBeenNthCalledWith(1, {
      seriesId: 101,
      seriesName: 'Dune',
      seriesIndex: 1,
      updatedAt: expect.any(Date),
    });
    expect(updateSet).toHaveBeenNthCalledWith(2, { updatedAt: expect.any(Date) });
  });

  it('does not insert membership rows when replacement normalizes to empty', async () => {
    const identity = makeSeriesIdentity({});
    const { db, insertInto, updateSet } = makeMutationDb();
    const service = new SeriesMembershipService(db, identity as never);

    await expect(service.replaceForBook(10, [{ seriesName: 'unknown' }], db)).resolves.toEqual([]);

    expect(insertInto).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenNthCalledWith(1, {
      seriesId: null,
      seriesName: null,
      seriesIndex: null,
      updatedAt: expect.any(Date),
    });
  });

  it('promotes remaining memberships when legacy scalar metadata is cleared', async () => {
    const identity = makeSeriesIdentity({});
    const metadataChain = makeSelectChain([{ seriesName: null, seriesIndex: null, seriesId: null }]);
    const membershipChain = makeSelectChain([
      { bookId: 7, seriesId: 1, seriesName: 'Primary', seriesIndex: 1, displayOrder: 0 },
      { bookId: 7, seriesId: 2, seriesName: 'Rest', seriesIndex: 2, displayOrder: 1 },
    ]);
    const db = {
      select: vi.fn().mockReturnValueOnce(metadataChain).mockReturnValueOnce(membershipChain),
    };
    const service = new SeriesMembershipService(db as never, identity as never);
    const replaceForBook = vi.spyOn(service, 'replaceForBook').mockResolvedValue([]);

    await service.syncPrimaryFromMetadata(7, db as never);

    expect(replaceForBook).toHaveBeenCalledWith(7, [{ seriesName: 'Rest', seriesIndex: 2 }], db);
  });
});
