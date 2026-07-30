import { BookmarkSyncService } from './bookmark-sync.service';

function makeRow(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    userId: 10,
    bookId: 5,
    cfi: 'epubcfi(/6/2)',
    title: 'Chapter 1',
    positionSeconds: null,
    origin: 'koreader',
    devicePos: '/body/DocFragment[2]',
    pageno: 12,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeService() {
  const repo = {
    listForSync: vi.fn(),
    createFromDevice: vi.fn().mockResolvedValue(null),
    restoreAtLocation: vi.fn().mockResolvedValue(null),
    findLiveByLocation: vi.fn().mockResolvedValue(null),
    updateFromDevice: vi.fn(),
    tombstone: vi.fn(),
    listPurgeableTombstones: vi.fn(),
    purge: vi.fn(),
  };
  return { service: new BookmarkSyncService(repo as never), repo };
}

const fields = { cfi: 'epubcfi(/6/2)', title: 'Chapter 1', devicePos: '/body/DocFragment[2]', pageno: 12 };

describe('BookmarkSyncService', () => {
  describe('upsertFromDevice', () => {
    it('reports a fresh insert as created', async () => {
      const { service, repo } = makeService();
      const row = makeRow();
      repo.createFromDevice.mockResolvedValue(row);

      const result = await service.upsertFromDevice(10, 5, fields);

      expect(result).toEqual({ row, outcome: 'created' });
      expect(repo.restoreAtLocation).not.toHaveBeenCalled();
    });

    it('restores the tombstone that still owns the location', async () => {
      const { service, repo } = makeService();
      const row = makeRow({ id: 2 });
      repo.restoreAtLocation.mockResolvedValue(row);

      const result = await service.upsertFromDevice(10, 5, fields);

      expect(result).toEqual({ row, outcome: 'restored' });
      expect(repo.restoreAtLocation).toHaveBeenCalledWith(
        10,
        5,
        { cfi: 'epubcfi(/6/2)', positionSeconds: null },
        { title: 'Chapter 1', origin: 'koreader', devicePos: '/body/DocFragment[2]', pageno: 12 },
      );
      expect(repo.findLiveByLocation).not.toHaveBeenCalled();
    });

    it('matches the live bookmark another device already created there', async () => {
      const { service, repo } = makeService();
      const row = makeRow({ id: 3, origin: 'web', devicePos: null });
      repo.findLiveByLocation.mockResolvedValue(row);

      const result = await service.upsertFromDevice(10, 5, fields);

      expect(result).toEqual({ row, outcome: 'matched' });
    });

    it('returns null when nothing could be landed', async () => {
      const { service } = makeService();

      expect(await service.upsertFromDevice(10, 5, fields)).toBeNull();
    });
  });

  it('delegates the remaining operations to the repository', async () => {
    const { service, repo } = makeService();
    const deletedBefore = new Date('2026-01-01T00:00:00Z');
    repo.tombstone.mockResolvedValue(2);
    repo.listPurgeableTombstones.mockResolvedValue([7]);
    repo.purge.mockResolvedValue(1);
    repo.listForSync.mockResolvedValue([]);

    await service.listForSync(10, 5, 500);
    await service.applyDeviceEdit(10, 3, { title: 'Renamed' });

    expect(repo.listForSync).toHaveBeenCalledWith(10, 5, 500);
    expect(repo.updateFromDevice).toHaveBeenCalledWith(10, 3, { title: 'Renamed' });
    expect(await service.tombstone(10, [1, 2])).toBe(2);
    expect(await service.listPurgeableTombstones(10, deletedBefore, 50)).toEqual([7]);
    expect(await service.purge(10, [7])).toBe(1);
  });
});
