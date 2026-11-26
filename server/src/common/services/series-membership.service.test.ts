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

function makeMutationDb(currentUnits: { seriesId: number; unit: string | null; volumeIndex: string | null }[] = []) {
  const selectWhere = vi.fn().mockResolvedValue(currentUnits);
  const select = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: selectWhere }) });
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFrom = vi.fn().mockReturnValue({ where: deleteWhere });
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insertInto = vi.fn().mockReturnValue({ values: insertValues });
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  return {
    db: { delete: deleteFrom, insert: insertInto, update, select } as never,
    select,
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
      { seriesId: 101, seriesName: 'Dune', seriesIndex: 1, unit: null, volumeIndex: null, displayOrder: 0, expectedBookCount: null },
      { seriesId: 202, seriesName: 'The Expanse', seriesIndex: 5, unit: null, volumeIndex: null, displayOrder: 1, expectedBookCount: null },
    ]);
    expect(deleteFrom).toHaveBeenCalledTimes(1);
    expect(identity.resolveSeriesId).toHaveBeenCalledTimes(2);
    expect(insertValues).toHaveBeenCalledWith([
      { bookId: 10, seriesId: 101, seriesIndex: 1, seriesUnit: null, seriesVolumeIndex: null, displayOrder: 0 },
      { bookId: 10, seriesId: 202, seriesIndex: 5, seriesUnit: null, seriesVolumeIndex: null, displayOrder: 1 },
    ]);
    expect(updateSet).toHaveBeenNthCalledWith(1, {
      seriesId: 101,
      seriesName: 'Dune',
      seriesIndex: 1,
      seriesUnit: null,
      seriesVolumeIndex: null,
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
      seriesUnit: null,
      seriesVolumeIndex: null,
      updatedAt: expect.any(Date),
    });
  });

  it('keeps the stored unit when a save omits it, as released iOS builds do', async () => {
    const identity = makeSeriesIdentity({ berserk: 5 });
    const { db, insertValues } = makeMutationDb([{ seriesId: 5, unit: 'chapter', volumeIndex: '3' }]);
    const service = new SeriesMembershipService(db, identity as never);

    const result = await service.replaceForBook(10, [{ seriesName: 'Berserk', seriesIndex: '12' }], db);

    expect(result[0]).toMatchObject({ unit: 'chapter', volumeIndex: '3' });
    expect(insertValues).toHaveBeenCalledWith([
      { bookId: 10, seriesId: 5, seriesIndex: '12', seriesUnit: 'chapter', seriesVolumeIndex: '3', displayOrder: 0 },
    ]);
  });

  it('clears the unit on null and drops the volume number from anything but a chapter or issue', async () => {
    const identity = makeSeriesIdentity({ berserk: 5, saga: 6 });
    const { db, select, insertValues } = makeMutationDb([{ seriesId: 5, unit: 'chapter', volumeIndex: '3' }]);
    const service = new SeriesMembershipService(db, identity as never);

    await service.replaceForBook(
      10,
      [
        { seriesName: 'Berserk', seriesIndex: '12', unit: null, volumeIndex: '3' },
        { seriesName: 'Saga', seriesIndex: '2', unit: 'volume', volumeIndex: '9' },
      ],
      db,
    );

    expect(select).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith([
      { bookId: 10, seriesId: 5, seriesIndex: '12', seriesUnit: null, seriesVolumeIndex: null, displayOrder: 0 },
      { bookId: 10, seriesId: 6, seriesIndex: '2', seriesUnit: 'volume', seriesVolumeIndex: null, displayOrder: 1 },
    ]);
  });

  it('promotes remaining memberships when legacy scalar metadata is cleared', async () => {
    const identity = makeSeriesIdentity({});
    const metadataChain = makeSelectChain([{ seriesName: null, seriesIndex: null, seriesId: null, seriesUnit: null, seriesVolumeIndex: null }]);
    const membershipChain = makeSelectChain([
      { bookId: 7, seriesId: 1, seriesName: 'Primary', seriesIndex: 1, unit: null, volumeIndex: null, displayOrder: 0 },
      { bookId: 7, seriesId: 2, seriesName: 'Rest', seriesIndex: 2, unit: 'chapter', volumeIndex: null, displayOrder: 1 },
    ]);
    const db = {
      select: vi.fn().mockReturnValueOnce(metadataChain).mockReturnValueOnce(membershipChain),
    };
    const service = new SeriesMembershipService(db as never, identity as never);
    const replaceForBook = vi.spyOn(service, 'replaceForBook').mockResolvedValue([]);

    await service.syncPrimaryFromMetadata(7, db as never);

    expect(replaceForBook).toHaveBeenCalledWith(7, [{ seriesName: 'Rest', seriesIndex: 2, unit: 'chapter', volumeIndex: null }], db);
  });
});
