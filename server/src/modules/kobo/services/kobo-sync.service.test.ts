import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';
import * as schema from '../../../db/schema';
import { KoboSyncService } from './kobo-sync.service';

// Recursively counts bound query params (drizzle-orm's `Param` chunks) in a built SQL tree,
// so tests can assert a clause isn't binding one parameter per matched book id.
function countSqlParams(node: unknown, seen = new Set<unknown>()): number {
  if (!node || typeof node !== 'object' || seen.has(node)) return 0;
  seen.add(node);
  if ((node as { constructor?: { name?: string } }).constructor?.name === 'Param') return 1;
  const children = Array.isArray(node) ? node : ((node as { queryChunks?: unknown[] }).queryChunks ?? []);
  return children.reduce((sum: number, child) => sum + countSqlParams(child, seen), 0);
}

type QueueState = {
  select: unknown[];
  insert: unknown[];
  update: unknown[];
  delete: unknown[];
  execute: unknown[];
};

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    groupBy: vi.fn(),
    offset: vi.fn(),
    values: vi.fn(),
    returning: vi.fn(),
    onConflictDoNothing: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    set: vi.fn(),
    as: vi.fn(),
    then: (onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
    catch: (onRejected: (error: unknown) => unknown) => Promise.resolve(result).catch(onRejected),
  };

  for (const key of [
    'from',
    'where',
    'orderBy',
    'limit',
    'innerJoin',
    'leftJoin',
    'groupBy',
    'offset',
    'values',
    'returning',
    'onConflictDoNothing',
    'onConflictDoUpdate',
    'set',
    'as',
  ]) {
    (chain[key] as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  }

  return chain;
}

function makeDb(state?: Partial<QueueState>) {
  const queue: QueueState = {
    select: [...(state?.select ?? [])],
    insert: [...(state?.insert ?? [])],
    update: [...(state?.update ?? [])],
    delete: [...(state?.delete ?? [])],
    execute: [...(state?.execute ?? [])],
  };
  const chains: ReturnType<typeof makeChain>[] = [];
  const updateChains: ReturnType<typeof makeChain>[] = [];
  const transactionChains: ReturnType<typeof makeChain>[] = [];
  const transactionExecutes: ReturnType<typeof vi.fn>[] = [];

  return {
    __chains: chains,
    __updateChains: updateChains,
    __transactionChains: transactionChains,
    __transactionExecutes: transactionExecutes,
    query: {
      users: { findFirst: vi.fn().mockResolvedValue({ settings: {} }) },
      koboLibrarySnapshots: { findFirst: vi.fn() },
      koboLegacyLibrarySnapshots: { findFirst: vi.fn().mockResolvedValue(undefined) },
      koboSnapshotBooks: { findFirst: vi.fn() },
      koboSyncSettings: { findFirst: vi.fn() },
      collections: { findMany: vi.fn() },
    },
    select: vi.fn(() => {
      const chain = makeChain(queue.select.shift() ?? []);
      chains.push(chain);
      return chain;
    }),
    insert: vi.fn(() => makeChain(queue.insert.shift() ?? [])),
    update: vi.fn(() => {
      const chain = makeChain(queue.update.shift() ?? []);
      updateChains.push(chain);
      return chain;
    }),
    delete: vi.fn(() => makeChain(queue.delete.shift() ?? [])),
    execute: vi.fn(() => Promise.resolve({ rows: queue.execute.shift() ?? [] })),
    transaction: vi.fn(
      async (cb: (tx: { execute: (statement: unknown) => Promise<unknown>; insert: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
        const execute = vi.fn().mockResolvedValue(undefined);
        transactionExecutes.push(execute);
        return cb({
          execute,
          insert: vi.fn(() => {
            const chain = makeChain(queue.insert.shift() ?? []);
            transactionChains.push(chain);
            return chain;
          }),
        });
      },
    ),
  };
}

function makeBook(id: number, format = 'epub') {
  return {
    bookId: id,
    koboEntitlementId: `entitlement-${id}`,
    koboCoverImageId: `cover-${id}_1767225600000`,
    needsLegacyNumericRemoval: false,
    title: `Book ${id}`,
    authors: ['Author One'],
    description: 'Description',
    publisher: 'Publisher',
    publishedDate: null,
    publishedYear: 2022,
    language: 'en',
    isbn: '9780306406157',
    seriesName: 'Series',
    seriesIndex: 2,
    fileFormat: format,
    fileSizeBytes: 1234,
    fileHash: `hash-${id}`,
    metadataHash: `meta-${id}`,
    deliveryFormat: format === 'pdf' ? 'PDF' : 'EPUB3',
    metadataUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
    collectionNames: ['Sci-Fi'],
    addedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };
}

describe('KoboSyncService', () => {
  const bookAccessService = {
    getAccessibleLibraryIds: vi.fn(),
  };
  const readingStateService = {
    getRawState: vi.fn(),
  };
  const contentFilterRepository = {
    findByUserId: vi.fn(),
  };
  const bookIdentityService = {
    ensureForBooks: vi.fn(),
    findByBookIds: vi.fn(),
    markLegacyNumericRemovalComplete: vi.fn(),
    buildVersionedCoverImageId: vi.fn(),
  };
  const queryBuilder = {
    buildWhere: vi.fn(),
  };
  const smartScopeService = {
    findKoboSyncScopes: vi.fn(),
  };
  const metadataExtractionService = {
    detectFixedLayout: vi.fn(),
  };

  function makeIdentity(bookId: number, needsLegacyNumericRemoval = false) {
    return {
      bookId,
      entitlementId: `entitlement-${bookId}`,
      coverImageId: `cover-${bookId}`,
      needsLegacyNumericRemoval,
    };
  }

  function makeIdentityMap(bookIds: number[], needsLegacyNumericRemoval = false) {
    return new Map([...new Set(bookIds)].map((bookId) => [bookId, makeIdentity(bookId, needsLegacyNumericRemoval)]));
  }

  function makeService(db: unknown) {
    return new KoboSyncService(
      db as never,
      bookAccessService as never,
      readingStateService as never,
      contentFilterRepository as never,
      bookIdentityService as never,
      queryBuilder as never,
      smartScopeService as never,
      metadataExtractionService as never,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    bookAccessService.getAccessibleLibraryIds.mockResolvedValue(null);
    smartScopeService.findKoboSyncScopes.mockResolvedValue([]);
    readingStateService.getRawState.mockResolvedValue(null);
    contentFilterRepository.findByUserId.mockResolvedValue([]);
    metadataExtractionService.detectFixedLayout.mockResolvedValue(null);
    bookIdentityService.ensureForBooks.mockImplementation((_userId: number, bookIds: number[], needsLegacyNumericRemoval: boolean) =>
      makeIdentityMap(bookIds, needsLegacyNumericRemoval),
    );
    bookIdentityService.findByBookIds.mockImplementation((_userId: number, bookIds: number[]) => makeIdentityMap(bookIds));
    bookIdentityService.markLegacyNumericRemovalComplete.mockResolvedValue(undefined);
    bookIdentityService.buildVersionedCoverImageId.mockImplementation((coverImageId: string, version: Date | null) =>
      version ? `${coverImageId}_${version.getTime()}` : coverImageId,
    );
  });

  it('creates and pages independent snapshots for devices sharing a user', async () => {
    const db = makeDb();
    const service = makeService(db);
    const eligible = [{ bookId: 1, fileHash: 'h1', deliveryHash: 'd1', metadataHash: 'm1', needsLegacyNumericRemoval: false }];
    vi.spyOn(service as any, 'fetchEligibleSnapshotRows').mockResolvedValue(eligible);
    vi.spyOn(service as any, 'findDeviceSnapshot').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'hasDeviceSnapshot')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    vi.spyOn(service as any, 'getLegacyNumericRemovalBookIds').mockResolvedValue(new Set());
    vi.spyOn(service as any, 'retireLegacySnapshotIfComplete').mockResolvedValue(undefined);
    const createSpy = vi.spyOn(service as any, 'createSnapshot').mockImplementation((_userId: number, deviceId: number) => ({
      snapshot: { id: deviceId === 101 ? 11 : 22, userId: 5, deviceId },
      created: true,
    }));
    const pageSpy = vi.spyOn(service as any, 'getPageFromSnapshot').mockResolvedValue({
      entitlements: [{ ChangedTag: {} }],
      hasMore: false,
      syncToken: 'PX.token',
    });

    await expect(service.getDelta(5, 101, 'device-a-token', 'https://reader.example.com')).resolves.toEqual({
      entitlements: [{ ChangedTag: {} }],
      hasMore: false,
      syncToken: 'PX.token',
    });
    await service.getDelta(5, 202, 'device-b-token', 'https://reader.example.com');

    expect(createSpy).toHaveBeenNthCalledWith(1, 5, 101, eligible, new Set());
    expect(createSpy).toHaveBeenNthCalledWith(2, 5, 202, eligible, new Set());
    expect((service as any).fetchEligibleSnapshotRows).toHaveBeenNthCalledWith(1, 5, false, expect.any(Map), true);
    expect((service as any).fetchEligibleSnapshotRows).toHaveBeenNthCalledWith(2, 5, true, expect.any(Map), true);
    expect(pageSpy).toHaveBeenNthCalledWith(1, 5, 11, 101, 'device-a-token', 'https://reader.example.com', expect.any(Map), expect.any(Function));
    expect(pageSpy).toHaveBeenNthCalledWith(2, 5, 22, 202, 'device-b-token', 'https://reader.example.com', expect.any(Map), expect.any(Function));
  });

  it('reconciles only the caller device snapshot when it already exists', async () => {
    const db = makeDb();
    const service = makeService(db);
    const eligible = [{ bookId: 1, fileHash: 'h1', deliveryHash: 'd1', metadataHash: 'm1', needsLegacyNumericRemoval: false }];
    vi.spyOn(service as any, 'findDeviceSnapshot').mockResolvedValue({ id: 9, userId: 5, deviceId: 101 });
    vi.spyOn(service as any, 'fetchEligibleSnapshotRows').mockResolvedValue(eligible);
    const reconcileSpy = vi.spyOn(service as any, 'reconcileSnapshot').mockResolvedValue(undefined);
    const pageSpy = vi.spyOn(service as any, 'getPageFromSnapshot').mockResolvedValue({ entitlements: [], hasMore: false, syncToken: 'PX.token' });

    await service.getDelta(5, 101, 'device-a-token', 'https://reader.example.com');

    expect(reconcileSpy).toHaveBeenCalledWith(9, eligible);
    expect(pageSpy).toHaveBeenCalledWith(5, 9, 101, 'device-a-token', 'https://reader.example.com', expect.any(Map), expect.any(Function));
    await expect(pageSpy.mock.calls[0]![6]()).resolves.toEqual(new Set([1]));
  });

  it('serves the next page without reconciling while the device still has pending rows', async () => {
    const db = makeDb({ select: [[{ bookId: 4 }]] });
    const service = makeService(db);
    vi.spyOn(service as any, 'findDeviceSnapshot').mockResolvedValue({ id: 9, userId: 5, deviceId: 101 });
    const eligibleSpy = vi.spyOn(service as any, 'fetchEligibleSnapshotRows').mockResolvedValue([]);
    const reconcileSpy = vi.spyOn(service as any, 'reconcileSnapshot').mockResolvedValue(undefined);
    const pageSpy = vi.spyOn(service as any, 'getPageFromSnapshot').mockResolvedValue({ entitlements: [], hasMore: true, syncToken: 'PX.token' });

    await service.getDelta(5, 101, 'device-a-token', 'https://reader.example.com');

    expect(reconcileSpy).not.toHaveBeenCalled();
    expect(eligibleSpy).not.toHaveBeenCalled();
    expect(pageSpy).toHaveBeenCalledWith(5, 9, 101, 'device-a-token', 'https://reader.example.com', expect.any(Map), expect.any(Function));
  });

  it('still resolves eligible ids for tag delivery when a pending page drains before it is served', async () => {
    const db = makeDb({ select: [[{ bookId: 4 }]] });
    const service = makeService(db);
    vi.spyOn(service as any, 'findDeviceSnapshot').mockResolvedValue({ id: 9, userId: 5, deviceId: 101 });
    const eligibleSpy = vi
      .spyOn(service as any, 'fetchEligibleSnapshotRows')
      .mockResolvedValue([{ bookId: 7, fileHash: 'h', deliveryHash: 'd', metadataHash: 'm', needsLegacyNumericRemoval: false }]);
    const pageSpy = vi.spyOn(service as any, 'getPageFromSnapshot').mockResolvedValue({ entitlements: [], hasMore: false, syncToken: 'PX.token' });

    await service.getDelta(5, 101, 'device-a-token', 'https://reader.example.com');

    await expect(pageSpy.mock.calls[0]![6]()).resolves.toEqual(new Set([7]));
    expect(eligibleSpy).toHaveBeenCalledWith(5, true, expect.any(Map));
  });

  it('getBookMetadata returns empty array when book is not eligible', async () => {
    const service = makeService(makeDb());
    vi.spyOn(service as any, 'fetchEligibleBooksByIds').mockResolvedValue(new Map());

    await expect(service.getBookMetadata(3, 99, 'tok', 'https://base')).resolves.toEqual([]);
  });

  it('getBookMetadata returns mapped metadata payload for eligible book', async () => {
    const db = makeDb();
    db.query.koboLibrarySnapshots.findFirst.mockResolvedValue({ id: 1 });
    const service = makeService(db);
    const fetchSpy = vi.spyOn(service as any, 'fetchEligibleBooksByIds').mockResolvedValue(new Map([[12, makeBook(12, 'pdf')]]));

    const [metadata] = (await service.getBookMetadata(3, 12, 'tok', 'https://base')) as Array<Record<string, unknown>>;

    expect(fetchSpy).toHaveBeenCalledWith(3, [12], true, expect.any(Map));
    expect(metadata.Title).toBe('Book 12');
    expect(metadata.Language).toBe('en');
    expect(metadata.ISBN).toBe('9780306406157');
    expect(metadata.DownloadUrls).toEqual([
      {
        Format: 'PDF',
        Size: 1234,
        Url: 'https://base/api/v1/kobo/tok/v1/books/entitlement-12/download',
        Platform: 'Generic',
        DrmType: 'None',
      },
    ]);
  });

  it('omits ISBN from Kobo metadata when the book has no valid ISBN', () => {
    const service = makeService(makeDb());

    const metadata = (service as any).buildBookMetadata({ ...makeBook(12), isbn: null }, 'tok', 'https://base');

    expect(metadata).not.toHaveProperty('ISBN');
  });

  it('removeBookFromSync handles missing snapshot/row and delete-vs-mark paths', async () => {
    const db = makeDb();
    const service = makeService(db);

    vi.spyOn(service as any, 'findDeviceSnapshot')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 4, userId: 1, deviceId: 91 })
      .mockResolvedValueOnce({ id: 4, userId: 1, deviceId: 91 })
      .mockResolvedValueOnce({ id: 4, userId: 1, deviceId: 91 });
    db.query.koboSnapshotBooks.findFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ bookId: 2, pendingDelete: true })
      .mockResolvedValueOnce({ bookId: 3, pendingDelete: false });

    await expect(service.removeBookFromSync(1, 91, 10)).resolves.toBeUndefined();
    await expect(service.removeBookFromSync(1, 91, 2)).resolves.toBeUndefined();
    await expect(service.removeBookFromSync(1, 91, 3)).resolves.toBeUndefined();
    await expect(service.removeBookFromSync(1, 91, 4)).resolves.toBeUndefined();

    expect(db.delete).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
  });

  it('createSnapshot seeds a device snapshot and uses a set-based query for removal tombstones', async () => {
    const db = makeDb({ insert: [[{ id: 55 }], []] });
    const service = makeService(db);

    const result = await (service as any).createSnapshot(
      7,
      99,
      [
        { bookId: 1, fileHash: 'h1', deliveryHash: 'd1', metadataHash: 'm1', needsLegacyNumericRemoval: true },
        { bookId: 2, fileHash: null, deliveryHash: 'd2', metadataHash: 'm2', needsLegacyNumericRemoval: false },
      ],
      new Set([2]),
    );

    expect(result).toEqual({ snapshot: { id: 55 }, created: true });
    expect(db.__transactionChains).toHaveLength(3);
    expect(db.__transactionChains[0].values).toHaveBeenCalledWith({ userId: 7, deviceId: 99 });
    expect(db.__transactionChains[1].values).toHaveBeenCalledWith([
      expect.objectContaining({ snapshotId: 55, bookId: 1, pendingDelete: false, isNew: true, needsLegacyNumericRemoval: true }),
      expect.objectContaining({ snapshotId: 55, bookId: 2, pendingDelete: false, isNew: true, needsLegacyNumericRemoval: true }),
    ]);
    expect(db.__transactionChains[2].values).toHaveBeenCalledWith([
      expect.objectContaining({ snapshotId: 55, bookId: 2, pendingDelete: true, isNew: false, needsLegacyNumericRemoval: true }),
    ]);
    expect(db.__transactionChains[2].onConflictDoUpdate).toHaveBeenCalledWith({
      target: [schema.koboSnapshotBooks.snapshotId, schema.koboSnapshotBooks.bookId],
      set: { needsLegacyNumericRemoval: true },
    });
    expect(db.__transactionExecutes[0]).toHaveBeenCalledTimes(1);
  });

  it('creates a legacy numeric tombstone for an ineligible book even when its identity was already completed', async () => {
    const db = makeDb({ insert: [[{ id: 55 }], []] });
    const service = makeService(db);

    await (service as any).createSnapshot(7, 99, [], new Set([42]));

    expect(db.__transactionChains).toHaveLength(2);
    expect(db.__transactionChains[1].values).toHaveBeenCalledWith([
      expect.objectContaining({
        snapshotId: 55,
        bookId: 42,
        synced: false,
        pendingDelete: true,
        isNew: false,
        needsLegacyNumericRemoval: true,
      }),
    ]);
    expect(db.__transactionChains[1].onConflictDoUpdate).toHaveBeenCalledWith({
      target: [schema.koboSnapshotBooks.snapshotId, schema.koboSnapshotBooks.bookId],
      set: { needsLegacyNumericRemoval: true },
    });
  });

  it('batches initial snapshot seed rows for large libraries', async () => {
    const db = makeDb({ insert: [[{ id: 55 }], [], []] });
    const service = makeService(db);
    const eligible = Array.from({ length: 5001 }, (_, index) => ({
      bookId: index + 1,
      fileHash: `file-${index}`,
      deliveryHash: `delivery-${index}`,
      metadataHash: `metadata-${index}`,
      needsLegacyNumericRemoval: false,
    }));

    await (service as any).createSnapshot(7, 99, eligible, new Set());

    expect(db.__transactionChains).toHaveLength(3);
    expect(db.__transactionChains[1].values).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ snapshotId: 55, bookId: 1 })]));
    expect(db.__transactionChains[2].values).toHaveBeenCalledWith([expect.objectContaining({ snapshotId: 55, bookId: 5001 })]);
  });

  it('reuses a concurrently-created device snapshot after a unique conflict', async () => {
    const db = makeDb({ insert: [[]] });
    const service = makeService(db);
    vi.spyOn(service as any, 'findDeviceSnapshot').mockResolvedValue({ id: 55, userId: 7, deviceId: 99 });

    await expect((service as any).createSnapshot(7, 99, [], new Set())).resolves.toEqual({
      snapshot: { id: 55, userId: 7, deviceId: 99 },
      created: false,
    });
  });

  it('uses the preserved legacy snapshot to mark every old numeric id for each legacy device', async () => {
    const db = makeDb({
      select: [[{ id: 88, legacyDeviceCutoffAt: new Date('2026-01-01T00:00:00.000Z') }], [{ bookId: 1 }, { bookId: 2 }]],
    });
    const service = makeService(db);
    bookIdentityService.ensureForBooks.mockResolvedValue(
      new Map([
        [1, makeIdentity(1, true)],
        [2, makeIdentity(2, false)],
      ]),
    );

    await expect((service as any).getLegacyNumericRemovalBookIds(7, 99)).resolves.toEqual(new Set([1, 2]));
    expect(bookIdentityService.ensureForBooks).toHaveBeenCalledWith(7, [1, 2], true);
  });

  it('batches legacy identity initialization for large pre-upgrade snapshots', async () => {
    const legacyBooks = Array.from({ length: 5001 }, (_, index) => ({ bookId: index + 1 }));
    const db = makeDb({
      select: [[{ id: 88, legacyDeviceCutoffAt: new Date('2026-01-01T00:00:00.000Z') }], legacyBooks],
    });
    const service = makeService(db);

    const ids = await (service as any).getLegacyNumericRemovalBookIds(7, 99);

    expect(ids).toHaveLength(5001);
    expect(bookIdentityService.ensureForBooks).toHaveBeenCalledTimes(2);
    expect(bookIdentityService.ensureForBooks).toHaveBeenNthCalledWith(
      1,
      7,
      Array.from({ length: 5000 }, (_, index) => index + 1),
      true,
    );
    expect(bookIdentityService.ensureForBooks).toHaveBeenNthCalledWith(2, 7, [5001], true);
  });

  it('waits for every device queue before clearing a legacy numeric-removal identity', async () => {
    const db = makeDb({ select: [[{ bookId: 3 }], []] });
    const service = makeService(db);
    vi.spyOn(service as any, 'hasUninitializedLegacyDevices').mockResolvedValue(false);

    await (service as any).completeLegacyNumericRemovals(7, 22, [3]);
    expect(bookIdentityService.markLegacyNumericRemovalComplete).not.toHaveBeenCalled();

    await (service as any).completeLegacyNumericRemovals(7, 23, [3]);
    expect(bookIdentityService.markLegacyNumericRemovalComplete).toHaveBeenCalledWith(7, [3]);
  });

  it('retains identity-level legacy removal state while a pre-upgrade device has not initialized', async () => {
    const db = makeDb({ select: [[]] });
    const service = makeService(db);
    vi.spyOn(service as any, 'hasUninitializedLegacyDevices').mockResolvedValue(true);

    await (service as any).completeLegacyNumericRemovals(7, 22, [3]);

    expect(bookIdentityService.markLegacyNumericRemovalComplete).not.toHaveBeenCalled();
  });

  it('getPageFromSnapshot returns tags on final page when no pending rows', async () => {
    const db = makeDb({ select: [[]] });
    const service = makeService(db);
    vi.spyOn(service as any, 'buildTagItems').mockResolvedValue([{ ChangedTag: {} }]);

    const result = await (service as any).getPageFromSnapshot(7, 1, 101, 'tok', 'https://base', new Map(), () => Promise.resolve(new Set([1])));

    expect(result).toEqual({
      entitlements: [{ ChangedTag: {} }],
      hasMore: false,
      syncToken: expect.stringMatching(/^PX\./),
    });
  });
  it('getPageFromSnapshot returns page entitlements for removed/new/changed books', async () => {
    const db = makeDb({
      select: [
        [
          { bookId: 1, pendingDelete: true, isNew: false },
          { bookId: 2, pendingDelete: false, isNew: true },
          { bookId: 3, pendingDelete: false, isNew: false },
        ],
      ],
    });
    const service = makeService(db);
    vi.spyOn(service as any, 'fetchEligibleBooksByIds').mockResolvedValue(
      new Map([
        [2, makeBook(2)],
        [3, makeBook(3)],
      ]),
    );
    readingStateService.getRawState.mockResolvedValue(null);

    const result = await (service as any).getPageFromSnapshot(7, 22, 101, 'tok', 'https://base', new Map(), () =>
      Promise.resolve(new Set([1, 2, 3])),
    );

    expect(result.hasMore).toBe(false);
    expect(result.entitlements).toHaveLength(3);
    expect(result.entitlements[0]).toHaveProperty('ChangedEntitlement');
    expect(result.entitlements[1]).toHaveProperty('NewEntitlement');
    expect(result.entitlements[2]).toHaveProperty('ChangedProductMetadata');
    expect(db.delete).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
  });

  it('getPageFromSnapshot includes changed reading state for changed books with stored Kobo state', async () => {
    const db = makeDb({
      select: [[{ bookId: 3, pendingDelete: false, isNew: false }]],
    });
    const service = makeService(db);
    vi.spyOn(service as any, 'fetchEligibleBooksByIds').mockResolvedValue(new Map([[3, makeBook(3)]]));
    readingStateService.getRawState.mockResolvedValue({ EntitlementId: 'entitlement-3', CurrentBookmark: { ProgressPercent: 61 } });

    const result = await (service as any).getPageFromSnapshot(7, 22, 101, 'tok', 'https://base', new Map(), () => Promise.resolve(new Set([3])));

    expect(result.entitlements).toHaveLength(2);
    expect(result.entitlements[0]).toHaveProperty('ChangedProductMetadata');
    expect(result.entitlements[1]).toEqual({
      ChangedReadingState: {
        ReadingState: { EntitlementId: 'entitlement-3', CurrentBookmark: { ProgressPercent: 61 } },
      },
    });
  });

  it('getPageFromSnapshot sends a replacement entitlement for changed books still using legacy numeric ids', async () => {
    const db = makeDb({
      select: [[{ bookId: 3, pendingDelete: false, isNew: false, needsLegacyNumericRemoval: true }]],
    });
    const service = makeService(db);
    vi.spyOn(service as any, 'fetchEligibleBooksByIds').mockResolvedValue(new Map([[3, makeBook(3)]]));
    bookIdentityService.findByBookIds.mockResolvedValue(new Map([[3, makeIdentity(3, false)]]));
    readingStateService.getRawState.mockResolvedValue({ EntitlementId: 'entitlement-3', CurrentBookmark: { ProgressPercent: 61 } });

    const result = await (service as any).getPageFromSnapshot(7, 22, 101, 'tok', 'https://base', new Map(), () => Promise.resolve(new Set([3])));

    expect(result.entitlements).toHaveLength(2);
    expect(result.entitlements[0]).toHaveProperty('ChangedEntitlement');
    expect(result.entitlements[1]).toEqual({
      NewEntitlement: expect.objectContaining({
        ReadingState: { EntitlementId: 'entitlement-3', CurrentBookmark: { ProgressPercent: 61 } },
      }),
    });
    expect(bookIdentityService.markLegacyNumericRemovalComplete).toHaveBeenCalledWith(7, [3]);
  });

  it('sends both numeric and UUID removals when an undelivered legacy book becomes ineligible', async () => {
    const db = makeDb({
      select: [[{ bookId: 3, pendingDelete: true, isNew: false, needsLegacyNumericRemoval: true }]],
    });
    const service = makeService(db);
    vi.spyOn(service as any, 'fetchEligibleBooksByIds').mockResolvedValue(new Map());
    bookIdentityService.findByBookIds.mockResolvedValue(new Map([[3, makeIdentity(3, true)]]));

    const result = await (service as any).getPageFromSnapshot(7, 22, 101, 'tok', 'https://base', new Map(), () => Promise.resolve(new Set()));
    const removedIds = result.entitlements.map(
      (entry: Record<string, { BookEntitlement: { Id: string } }>) => entry.ChangedEntitlement.BookEntitlement.Id,
    );

    expect(removedIds).toEqual(['3', 'entitlement-3']);
    expect(bookIdentityService.markLegacyNumericRemovalComplete).toHaveBeenCalledWith(7, [3]);
  });

  it('buildTagItems includes only currently-eligible books per collection', async () => {
    const db = makeDb({
      select: [
        [
          { collectionId: 1, bookId: 10 },
          { collectionId: 1, bookId: 11 },
          { collectionId: 2, bookId: 22 },
        ],
      ],
    });
    db.query.collections.findMany.mockResolvedValue([
      { id: 1, name: 'Favorites' },
      { id: 2, name: 'Comics' },
    ]);
    const service = makeService(db);

    const tags = await (service as any).buildTagItems(3, new Set([10, 22]), new Map());

    expect(tags).toHaveLength(2);
    expect(tags[0]).toEqual(
      expect.objectContaining({
        ChangedTag: expect.objectContaining({
          Tag: expect.objectContaining({
            Id: 'col-1',
            Items: [{ RevisionId: 'entitlement-10', Type: 'ProductRevisionTagItem' }],
          }),
        }),
      }),
    );
  });

  it('buildTagItems includes a tag per synced smart scope with matching, eligible books', async () => {
    const db = makeDb({
      select: [[{ id: 10 }, { id: 30 }]],
    });
    db.query.collections.findMany.mockResolvedValue([]);
    const filter = { type: 'group', join: 'AND', rules: [] };
    smartScopeService.findKoboSyncScopes.mockResolvedValue([{ id: 5, name: 'To Read', filter, syncToKobo: true }]);
    bookAccessService.getAccessibleLibraryIds.mockResolvedValue([1, 2]);
    queryBuilder.buildWhere.mockReturnValue('WHERE_CLAUSE');
    const service = makeService(db);

    const tags = await (service as any).buildTagItems(9, new Set([10, 22]), new Map());

    expect(queryBuilder.buildWhere).toHaveBeenCalledWith(filter, { accessibleLibraryIds: [1, 2], userId: 9, timeZone: 'UTC' });
    expect(tags).toHaveLength(1);
    expect(tags[0]).toEqual(
      expect.objectContaining({
        ChangedTag: expect.objectContaining({
          Tag: expect.objectContaining({
            Id: 'ss-5',
            Name: 'To Read',
            // book 30 matched the scope but isn't in the eligible set, and 22 is eligible but didn't match the scope
            Items: [{ RevisionId: 'entitlement-10', Type: 'ProductRevisionTagItem' }],
          }),
        }),
      }),
    );
  });

  it('buildTagItems excludes synced smart scopes without a filter instead of matching everything', async () => {
    const db = makeDb();
    db.query.collections.findMany.mockResolvedValue([]);
    smartScopeService.findKoboSyncScopes.mockResolvedValue([{ id: 6, name: 'Empty Scope', filter: null, syncToKobo: true }]);
    bookAccessService.getAccessibleLibraryIds.mockResolvedValue([1]);
    const service = makeService(db);

    const tags = await (service as any).buildTagItems(9, new Set([10]), new Map());

    expect(queryBuilder.buildWhere).not.toHaveBeenCalled();
    expect(tags).toEqual([
      expect.objectContaining({
        ChangedTag: expect.objectContaining({
          Tag: expect.objectContaining({ Id: 'ss-6', Items: [] }),
        }),
      }),
    ]);
  });

  it('getSyncedSmartScopeMatches resolves multiple scopes independently, keyed by scope id', async () => {
    const db = makeDb({ select: [[{ id: 10 }], [{ id: 20 }, { id: 21 }]] });
    const filterA = { type: 'group', join: 'AND', rules: [] };
    const filterB = { type: 'group', join: 'OR', rules: [] };
    smartScopeService.findKoboSyncScopes.mockResolvedValue([
      { id: 1, name: 'Scope A', filter: filterA, syncToKobo: true },
      { id: 2, name: 'Scope B', filter: filterB, syncToKobo: true },
    ]);
    queryBuilder.buildWhere.mockReturnValue('WHERE_CLAUSE');
    const service = makeService(db);

    const matches = await (service as any).getSyncedSmartScopeMatches(9, [1], 'America/New_York');

    expect(queryBuilder.buildWhere).toHaveBeenCalledWith(filterA, { accessibleLibraryIds: [1], userId: 9, timeZone: 'America/New_York' });
    expect(queryBuilder.buildWhere).toHaveBeenCalledWith(filterB, { accessibleLibraryIds: [1], userId: 9, timeZone: 'America/New_York' });
    expect(matches.get(1)).toEqual({ name: 'Scope A', bookIds: [10], where: 'WHERE_CLAUSE' });
    expect(matches.get(2)).toEqual({ name: 'Scope B', bookIds: [20, 21], where: 'WHERE_CLAUSE' });
  });

  it('syncs a scope owned by another user when the smart scope service resolves it for this user', async () => {
    const db = makeDb({ select: [[{ id: 30 }]] });
    db.query.collections.findMany.mockResolvedValue([]);
    const filter = { type: 'group', join: 'AND', rules: [] };
    // A shared scope: owned by user 1, opted into by user 9. Ownership and opt-in are the
    // smart scope module's rules, so sync must not re-filter by owner (issue #795).
    smartScopeService.findKoboSyncScopes.mockResolvedValue([{ id: 7, userId: 1, name: 'Book Club', filter, isPublic: true, syncToKobo: false }]);
    bookAccessService.getAccessibleLibraryIds.mockResolvedValue([1]);
    queryBuilder.buildWhere.mockReturnValue('WHERE_CLAUSE');
    const service = makeService(db);

    const tags = await (service as any).buildTagItems(9, new Set([30]), new Map());

    expect(smartScopeService.findKoboSyncScopes).toHaveBeenCalledWith(9);
    expect(tags).toEqual([
      expect.objectContaining({
        ChangedTag: expect.objectContaining({
          Tag: expect.objectContaining({
            Id: 'ss-7',
            Name: 'Book Club',
            Items: [{ RevisionId: 'entitlement-30', Type: 'ProductRevisionTagItem' }],
          }),
        }),
      }),
    ]);
  });

  it('fetches synced smart scope book ids with the metadata join required by metadata-backed filters', async () => {
    const db = makeDb({ select: [[{ id: 10 }]] });
    const filter = { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Dune' }] };
    smartScopeService.findKoboSyncScopes.mockResolvedValue([{ id: 1, name: 'Dune Scope', filter, syncToKobo: true }]);
    queryBuilder.buildWhere.mockReturnValue(sql`${schema.bookMetadata.title} ilike ${'%Dune%'}`);
    const service = makeService(db);

    const matches = await (service as any).getSyncedSmartScopeMatches(9, [1], 'UTC');

    expect(matches.get(1)?.bookIds).toEqual([10]);
    expect(db.__chains[0].leftJoin).toHaveBeenCalledWith(schema.bookMetadata, expect.anything());
  });

  it('reuses a shared smartScopeMatchCache instead of re-querying smart scopes for each caller', async () => {
    const db = makeDb({
      select: [[{ id: 10 }]], // getSyncedSmartScopeMatches' single per-scope book lookup
    });
    db.query.collections.findMany.mockResolvedValue([]);
    smartScopeService.findKoboSyncScopes.mockResolvedValue([
      { id: 5, name: 'To Read', filter: { type: 'group', join: 'AND', rules: [] }, syncToKobo: true },
    ]);
    bookAccessService.getAccessibleLibraryIds.mockResolvedValue([1]);
    contentFilterRepository.findByUserId.mockResolvedValue({ includeTagIds: [], includeGenreIds: [], excludeTagIds: [], excludeGenreIds: [] });
    queryBuilder.buildWhere.mockReturnValue('WHERE_CLAUSE');
    const service = makeService(db);
    const cache = new Map();

    await (service as any).buildEligibleBooksWhereClause(9, cache);
    await (service as any).buildTagItems(9, new Set([10]), cache);

    expect(smartScopeService.findKoboSyncScopes).toHaveBeenCalledTimes(1);
  });

  it("buildEligibleBooksWhereClause ORs in each scope's own SQL predicate instead of an inArray of matched book ids", async () => {
    const manyBookIds = Array.from({ length: 500 }, (_, i) => i + 1);
    const db = makeDb({ select: [manyBookIds.map((id) => ({ id }))] });
    db.query.collections.findMany.mockResolvedValue([]);
    smartScopeService.findKoboSyncScopes.mockResolvedValue([
      { id: 5, name: 'To Read', filter: { type: 'group', join: 'AND', rules: [] }, syncToKobo: true },
    ]);
    bookAccessService.getAccessibleLibraryIds.mockResolvedValue([1]);
    contentFilterRepository.findByUserId.mockResolvedValue({ includeTagIds: [], includeGenreIds: [], excludeTagIds: [], excludeGenreIds: [] });
    // A real (param-free) SQL fragment standing in for the scope's compiled filter, so we can
    // inspect the final where clause's structure instead of a mocked opaque string.
    queryBuilder.buildWhere.mockReturnValue(sql`EXISTS (FAKE_SCOPE_CONDITION)`);
    const service = makeService(db);

    const where = await (service as any).buildEligibleBooksWhereClause(9, new Map());

    // Regardless of how many books the scope matched, the clause should only bind params for
    // the fixed set of eligibility conditions (status/format/library/userId), not one per book.
    expect(countSqlParams(where)).toBeLessThan(10);
  });

  describe('reconcileSnapshot', () => {
    function makeTxExecute() {
      const captured: unknown[] = [];
      const fn = vi.fn((stmt: unknown) => {
        captured.push(stmt);
        return Promise.resolve();
      });
      return { fn, captured };
    }

    function makeReconcileDb(txExecute: ReturnType<typeof vi.fn>) {
      return {
        transaction: vi.fn(async (cb: (tx: { execute: ReturnType<typeof vi.fn> }) => Promise<void>) => {
          await cb({ execute: txExecute });
        }),
      };
    }

    // In Drizzle ORM's SQL objects, the queryChunks array contains:
    //   - StringChunk objects: { value: string[] }  -- SQL text fragments
    //   - nested SQL objects:  { queryChunks: ... }  -- nested SQL expressions
    //   - raw primitives (number | string | null)    -- bound parameter values
    function extractSqlStrings(obj: unknown): string[] {
      if (!obj || typeof obj !== 'object') return [];
      const r = obj as Record<string, unknown>;
      if (Array.isArray(r.queryChunks)) {
        return (r.queryChunks as unknown[]).flatMap(extractSqlStrings);
      }
      if (Array.isArray(r.value)) {
        return (r.value as unknown[]).filter((v): v is string => typeof v === 'string');
      }
      return [];
    }

    function extractSqlParams(obj: unknown): unknown[] {
      // Raw primitives stored directly in queryChunks ARE the bound params
      if (typeof obj === 'number' || typeof obj === 'string' || obj === null || typeof obj === 'boolean') {
        return [obj];
      }
      if (!obj || typeof obj !== 'object') return [];
      const r = obj as Record<string, unknown>;
      // SQL object - recurse into its chunks
      if (Array.isArray(r.queryChunks)) {
        return (r.queryChunks as unknown[]).flatMap(extractSqlParams);
      }
      // StringChunk { value: string[] } - SQL text, not a param
      return [];
    }

    it('issues only CREATE TEMP and 8 maintenance queries when eligibleBooks is empty', async () => {
      const { fn: txExecute } = makeTxExecute();
      const db = makeReconcileDb(txExecute);
      const service = makeService(db);

      await (service as any).reconcileSnapshot(42, []);

      // CREATE TEMP + 8 maintenance queries (no batch insert when list is empty)
      expect(txExecute).toHaveBeenCalledTimes(9);
    });

    it('issues one batch INSERT when eligibleBooks fits in a single batch', async () => {
      const { fn: txExecute, captured } = makeTxExecute();
      const db = makeReconcileDb(txExecute);
      const service = makeService(db);

      await (service as any).reconcileSnapshot(10, [
        { bookId: 1, fileHash: 'h1', deliveryHash: 'd1', metadataHash: 'm1' },
        { bookId: 2, fileHash: null, deliveryHash: 'd2', metadataHash: 'm2' },
      ]);

      // CREATE TEMP + 1 batch INSERT + 8 maintenance queries
      expect(txExecute).toHaveBeenCalledTimes(10);

      const batchInsert = captured[1];
      const sqlStrings = extractSqlStrings(batchInsert);
      expect(sqlStrings.some((s) => s.includes('VALUES'))).toBe(true);
      expect(sqlStrings.some((s) => s.includes('unnest'))).toBe(false);
    });

    it('passes correct bookId, fileHash, deliveryHash, and metadataHash as individual params in VALUES rows', async () => {
      const { fn: txExecute, captured } = makeTxExecute();
      const db = makeReconcileDb(txExecute);
      const service = makeService(db);

      await (service as any).reconcileSnapshot(5, [{ bookId: 7, fileHash: 'abc', deliveryHash: 'delivery', metadataHash: 'xyz' }]);

      const batchInsert = captured[1];
      const params = extractSqlParams(batchInsert);
      expect(params).toContain(7);
      expect(params).toContain('abc');
      expect(params).toContain('delivery');
      expect(params).toContain('xyz');
    });

    it('passes null fileHash correctly in VALUES rows', async () => {
      const { fn: txExecute, captured } = makeTxExecute();
      const db = makeReconcileDb(txExecute);
      const service = makeService(db);

      await (service as any).reconcileSnapshot(5, [{ bookId: 3, fileHash: null, deliveryHash: 'delivery', metadataHash: 'mhash' }]);

      const batchInsert = captured[1];
      const params = extractSqlParams(batchInsert);
      expect(params).toContain(null);
      expect(params).toContain('delivery');
      expect(params).toContain('mhash');
    });

    it('issues two batch INSERTs when eligibleBooks exceeds the 5000-item batch size', async () => {
      const { fn: txExecute } = makeTxExecute();
      const db = makeReconcileDb(txExecute);
      const service = makeService(db);

      const eligible = Array.from({ length: 5001 }, (_, i) => ({
        bookId: i + 1,
        fileHash: `h${i}`,
        deliveryHash: `d${i}`,
        metadataHash: `m${i}`,
      }));
      await (service as any).reconcileSnapshot(99, eligible);

      // CREATE TEMP + 2 batch INSERTs + 8 maintenance queries
      expect(txExecute).toHaveBeenCalledTimes(11);
    });

    it('includes snapshotId as a param in all maintenance queries', async () => {
      const { fn: txExecute, captured } = makeTxExecute();
      const db = makeReconcileDb(txExecute);
      const service = makeService(db);

      const snapshotId = 77;
      await (service as any).reconcileSnapshot(snapshotId, [{ bookId: 1, fileHash: 'f', deliveryHash: 'd', metadataHash: 'm' }]);

      // Statements at index 2-9 are the 8 maintenance queries
      const maintenanceStmts = captured.slice(2, 10);
      for (const stmt of maintenanceStmts) {
        const params = extractSqlParams(stmt);
        expect(params).toContain(snapshotId);
      }
    });

    it('each batch only contains its own chunk of books', async () => {
      const { fn: txExecute, captured } = makeTxExecute();
      const db = makeReconcileDb(txExecute);
      const service = makeService(db);

      const eligible = Array.from({ length: 5002 }, (_, i) => ({
        bookId: i + 1,
        fileHash: `h${i}`,
        deliveryHash: `d${i}`,
        metadataHash: `m${i}`,
      }));
      await (service as any).reconcileSnapshot(1, eligible);

      // batch 1: indices 1-5000 => bookIds 1-5000
      const batch1Params = extractSqlParams(captured[1]);
      expect(batch1Params).toContain(1);
      expect(batch1Params).toContain(5000);
      expect(batch1Params).not.toContain(5001);

      // batch 2: indices 5000-5001 => bookIds 5001-5002
      const batch2Params = extractSqlParams(captured[2]);
      expect(batch2Params).toContain(5001);
      expect(batch2Params).toContain(5002);
      expect(batch2Params).not.toContain(1);
    });

    it('resets device-removed rows that remain eligible for re-delivery', async () => {
      const { fn: txExecute, captured } = makeTxExecute();
      const db = makeReconcileDb(txExecute);
      const service = makeService(db);

      await (service as any).reconcileSnapshot(5, [{ bookId: 7, fileHash: 'abc', deliveryHash: 'delivery', metadataHash: 'xyz' }]);

      const resetStmt = captured.find((stmt) => {
        const sql = extractSqlStrings(stmt).join(' ');
        return sql.includes('removed_by_device = false') && sql.includes('removed_by_device = true');
      });

      expect(resetStmt).toBeDefined();
      const sql = extractSqlStrings(resetStmt).join(' ');
      expect(sql).toContain('synced = false');
      expect(sql).toContain('is_new = true');
    });

    it('keeps an undelivered legacy numeric removal as a pending delete when eligibility changes', async () => {
      const { fn: txExecute, captured } = makeTxExecute();
      const db = makeReconcileDb(txExecute);
      const service = makeService(db);

      await (service as any).reconcileSnapshot(5, []);

      const markPendingStmt = captured.find((stmt) => {
        const sql = extractSqlStrings(stmt).join(' ');
        return sql.includes('SET pending_delete = true') && sql.includes('sb.needs_legacy_numeric_removal = true');
      });
      const deleteStmt = captured.find((stmt) => {
        const sql = extractSqlStrings(stmt).join(' ');
        return sql.includes('DELETE FROM') && sql.includes('sb.needs_legacy_numeric_removal = false');
      });

      expect(markPendingStmt).toBeDefined();
      expect(deleteStmt).toBeDefined();
    });

    it('marks delivery changes as new entitlements and metadata-only changes as metadata updates', async () => {
      const { fn: txExecute, captured } = makeTxExecute();
      const db = makeReconcileDb(txExecute);
      const service = makeService(db);

      await (service as any).reconcileSnapshot(5, [{ bookId: 7, fileHash: 'abc', deliveryHash: 'delivery', metadataHash: 'xyz' }]);

      const deliveryStmt = captured.find((stmt) => {
        const sql = extractSqlStrings(stmt).join(' ');
        return sql.includes('sb.delivery_hash IS DISTINCT FROM e.delivery_hash');
      });
      const metadataStmt = captured.find((stmt) => {
        const sql = extractSqlStrings(stmt).join(' ');
        return sql.includes('sb.metadata_hash IS DISTINCT FROM e.metadata_hash');
      });

      expect(deliveryStmt).toBeDefined();
      expect(extractSqlStrings(deliveryStmt).join(' ')).toContain('is_new = true');
      expect(metadataStmt).toBeDefined();
      const metadataSql = extractSqlStrings(metadataStmt).join(' ');
      expect(metadataSql).toContain('is_new = false');
      expect(metadataSql).toContain('sb.delivery_hash IS NOT DISTINCT FROM e.delivery_hash');
    });
  });

  it('buildMetadataHash covers normalized language, ISBN, identity, cover, and serializer changes', () => {
    const service = makeService(makeDb());
    const params = {
      title: 'Dune',
      authors: ['Frank Herbert'],
      seriesName: 'Dune',
      seriesIndex: 1,
      metadataUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      entitlementId: 'entitlement-1',
      coverImageId: 'cover-1',
      language: 'en',
      isbn: '9780306406157',
    };

    const hash = (service as any).buildMetadataHash(params);
    const legacyHash = createHash('sha256')
      .update(
        [
          params.title,
          params.authors.join(','),
          params.seriesName,
          String(params.seriesIndex),
          String(params.metadataUpdatedAt),
          params.entitlementId,
          params.coverImageId,
        ].join('|'),
      )
      .digest('hex')
      .slice(0, 16);

    expect((service as any).buildMetadataHash({ ...params })).toBe(hash);
    expect((service as any).buildMetadataHash({ ...params, title: 'Dune Messiah' })).not.toBe(hash);
    expect((service as any).buildMetadataHash({ ...params, entitlementId: 'entitlement-2' })).not.toBe(hash);
    expect((service as any).buildMetadataHash({ ...params, coverImageId: 'cover-2' })).not.toBe(hash);
    expect((service as any).buildMetadataHash({ ...params, language: 'de' })).not.toBe(hash);
    expect((service as any).buildMetadataHash({ ...params, isbn: '9780441172719' })).not.toBe(hash);
    expect(hash).not.toBe(legacyHash);
    expect(hash).toHaveLength(16);
  });

  it('maps settings and file metadata into the actual Kobo delivery format', () => {
    const service = makeService(makeDb());

    const kepub = (service as any).getDeliveryInfo('epub', 1024, {
      convertToKepub: true,
      forceEnableHyphenation: false,
      kepubConversionLimitMb: 1,
    });
    const hyphenatedKepub = (service as any).getDeliveryInfo('epub', 1024, {
      convertToKepub: true,
      forceEnableHyphenation: true,
      kepubConversionLimitMb: 1,
    });
    const oversizedEpub = (service as any).getDeliveryInfo('epub', 2 * 1024 * 1024, {
      convertToKepub: true,
      forceEnableHyphenation: false,
      kepubConversionLimitMb: 1,
    });
    const disabledEpub = (service as any).getDeliveryInfo('epub', 1024, {
      convertToKepub: false,
      forceEnableHyphenation: true,
      kepubConversionLimitMb: 1,
    });

    expect(kepub.format).toBe('KEPUB');
    expect(hyphenatedKepub.format).toBe('KEPUB');
    expect(hyphenatedKepub.hash).not.toBe(kepub.hash);
    expect(oversizedEpub.format).toBe('EPUB3');
    expect(disabledEpub.format).toBe('EPUB3');
    expect(
      (service as any).getDeliveryInfo('pdf', 1024, {
        convertToKepub: false,
        forceEnableHyphenation: true,
        kepubConversionLimitMb: 1,
      }).format,
    ).toBe('PDF');

    const nativeKepub = (service as any).getDeliveryInfo('kepub', 1024, {
      convertToKepub: false,
      forceEnableHyphenation: false,
      kepubConversionLimitMb: 1,
    });
    expect(nativeKepub.format).toBe('KEPUB');
    expect(nativeKepub.hash).toBe(kepub.hash);
  });

  describe('fixed-layout (comic) delivery', () => {
    const settings = { convertToKepub: true, forceEnableHyphenation: false, kepubConversionLimitMb: 1 };

    it('announces a fixed-layout epub as EPUB3FL so the device renders it full screen', () => {
      const service = makeService(makeDb());

      expect((service as any).getDeliveryInfo('epub', 1024, settings, true).format).toBe('EPUB3FL');
    });

    it('announces a natively fixed-layout kepub as EPUB3FL', () => {
      const service = makeService(makeDb());

      expect((service as any).getDeliveryInfo('kepub', 1024, settings, true).format).toBe('EPUB3FL');
    });

    it('still announces EPUB3FL when kepub conversion is disabled or the file is over the limit', () => {
      const service = makeService(makeDb());

      expect((service as any).getDeliveryInfo('epub', 1024, { ...settings, convertToKepub: false }, true).format).toBe('EPUB3FL');
      expect((service as any).getDeliveryInfo('epub', 2 * 1024 * 1024, settings, true).format).toBe('EPUB3FL');
    });

    it('leaves a PDF alone, because the fixed-layout format only applies to EPUB', () => {
      const service = makeService(makeDb());

      expect((service as any).getDeliveryInfo('pdf', 1024, settings, true).format).toBe('PDF');
    });

    it('falls back to the reflowable formats when the flag is false or not yet known', () => {
      const service = makeService(makeDb());

      expect((service as any).getDeliveryInfo('epub', 1024, settings, false).format).toBe('KEPUB');
      expect((service as any).getDeliveryInfo('epub', 1024, settings, null).format).toBe('KEPUB');
      expect((service as any).getDeliveryInfo('epub', 1024, { ...settings, convertToKepub: false }, null).format).toBe('EPUB3');
    });

    it('separates hyphenated from plain kepub bytes even though both announce EPUB3FL', () => {
      const service = makeService(makeDb());

      const plain = (service as any).getDeliveryInfo('epub', 1024, settings, true);
      const hyphenated = (service as any).getDeliveryInfo('epub', 1024, { ...settings, forceEnableHyphenation: true }, true);

      expect(plain.format).toBe('EPUB3FL');
      expect(hyphenated.format).toBe('EPUB3FL');
      expect(hyphenated.hash).not.toBe(plain.hash);
    });

    it('ignores hyphenation in the hash when no conversion runs, because the bytes are identical', () => {
      const service = makeService(makeDb());

      const noConversion = { ...settings, convertToKepub: false };
      const plain = (service as any).getDeliveryInfo('epub', 1024, noConversion, true);
      const hyphenated = (service as any).getDeliveryInfo('epub', 1024, { ...noConversion, forceEnableHyphenation: true }, true);

      expect(hyphenated.hash).toBe(plain.hash);
    });

    it('changes the delivery hash so an already-synced comic is re-announced to the device', () => {
      const service = makeService(makeDb());

      const before = (service as any).getDeliveryInfo('epub', 1024, settings, null);
      const after = (service as any).getDeliveryInfo('epub', 1024, settings, true);

      expect(after.hash).not.toBe(before.hash);
    });
  });

  describe('fixed-layout backfill', () => {
    function candidate(fileId: number, overrides: Record<string, unknown> = {}) {
      return {
        fileId,
        fileAbsolutePath: `/books/${fileId}.epub`,
        fileFormat: 'epub',
        isFixedLayout: null,
        ...overrides,
      };
    }

    it('detects, returns, and persists the flag for files that have never been checked', async () => {
      const db = makeDb();
      const service = makeService(db);
      metadataExtractionService.detectFixedLayout.mockImplementation((path: string) => Promise.resolve(path === '/books/1.epub'));

      const resolved = await (service as any).backfillFixedLayout([candidate(1), candidate(2)]);

      expect(resolved).toEqual(
        new Map([
          [1, true],
          [2, false],
        ]),
      );
      expect(metadataExtractionService.detectFixedLayout).toHaveBeenCalledTimes(2);
      // One grouped write per distinct value, never one per file.
      expect(db.update).toHaveBeenCalledTimes(2);
      expect(db.__updateChains[0]!.set).toHaveBeenCalledWith({ isFixedLayout: true });
      expect(db.__updateChains[1]!.set).toHaveBeenCalledWith({ isFixedLayout: false });
    });

    it('never re-reads a file whose flag is already stored', async () => {
      const db = makeDb();
      const service = makeService(db);

      const resolved = await (service as any).backfillFixedLayout([candidate(1, { isFixedLayout: true }), candidate(2, { isFixedLayout: false })]);

      expect(resolved.size).toBe(0);
      expect(metadataExtractionService.detectFixedLayout).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });

    it('ignores formats that cannot declare a layout', async () => {
      const db = makeDb();
      const service = makeService(db);

      await (service as any).backfillFixedLayout([
        candidate(1, { fileFormat: 'pdf' }),
        candidate(2, { fileFormat: 'cbz' }),
        candidate(3, { fileFormat: null }),
      ]);

      expect(metadataExtractionService.detectFixedLayout).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });

    it('checks kepub files too, since a native kepub carries the same OPF', async () => {
      const service = makeService(makeDb());
      metadataExtractionService.detectFixedLayout.mockResolvedValue(true);

      const resolved = await (service as any).backfillFixedLayout([candidate(1, { fileFormat: 'kepub' })]);

      expect(resolved.get(1)).toBe(true);
    });

    it('caps how many files one sync opens, leaving the rest for the next sync', async () => {
      const db = makeDb();
      const service = makeService(db);
      metadataExtractionService.detectFixedLayout.mockResolvedValue(false);

      const resolved = await (service as any).backfillFixedLayout(Array.from({ length: 600 }, (_unused, index) => candidate(index + 1)));

      expect(metadataExtractionService.detectFixedLayout).toHaveBeenCalledTimes(500);
      expect(resolved.size).toBe(500);
    });

    it('leaves an unreadable file unresolved instead of recording it as reflowable', async () => {
      const db = makeDb();
      const service = makeService(db);
      metadataExtractionService.detectFixedLayout.mockResolvedValue(null);

      const resolved = await (service as any).backfillFixedLayout([candidate(1)]);

      expect(resolved.size).toBe(0);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('treats a thrown detection as unknown and keeps processing the rest', async () => {
      const db = makeDb();
      const service = makeService(db);
      metadataExtractionService.detectFixedLayout.mockImplementation((path: string) =>
        path === '/books/1.epub' ? Promise.reject(new Error('permission denied')) : Promise.resolve(true),
      );

      const resolved = await (service as any).backfillFixedLayout([candidate(1), candidate(2)]);

      expect(resolved).toEqual(new Map([[2, true]]));
      expect(db.__updateChains[0]!.set).toHaveBeenCalledWith({ isFixedLayout: true });
    });

    it('still announces the right format for this sync when the flag cannot be persisted', async () => {
      const db = makeDb();
      db.update.mockImplementationOnce(() => {
        throw new Error('database is read only');
      });
      const service = makeService(db);
      metadataExtractionService.detectFixedLayout.mockResolvedValue(true);

      const resolved = await (service as any).backfillFixedLayout([candidate(1)]);

      expect(resolved.get(1)).toBe(true);
    });

    it('does nothing at all once every eligible file has been checked', async () => {
      const db = makeDb();
      const service = makeService(db);

      await (service as any).backfillFixedLayout([]);

      expect(metadataExtractionService.detectFixedLayout).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  // Delivery hashes are stored per device: any drift re-marks every book as changed and makes
  // every device re-download its whole library. These are the values the pre-EPUB3FL
  // implementation produced and they must not move.
  it('keeps delivery hashes for non-comic books byte-identical to the previous implementation', () => {
    const service = makeService(makeDb());
    const base = { convertToKepub: true, forceEnableHyphenation: false, kepubConversionLimitMb: 1 };

    expect((service as any).getDeliveryInfo('pdf', 1024, base, null).hash).toBe('6c4931d80e7cbf0d');
    expect((service as any).getDeliveryInfo('kepub', 1024, base, null).hash).toBe('2f55f4d028ef859c');
    expect((service as any).getDeliveryInfo('epub', 1024, base, null).hash).toBe('2f55f4d028ef859c');
    expect((service as any).getDeliveryInfo('epub', 1024, { ...base, forceEnableHyphenation: true }, null).hash).toBe('990477a32a0f0d75');
    expect((service as any).getDeliveryInfo('epub', 1024, { ...base, convertToKepub: false }, null).hash).toBe('90fb0bb55cca2fd2');
    expect((service as any).getDeliveryInfo('epub', 2 * 1024 * 1024, base, null).hash).toBe('90fb0bb55cca2fd2');
    // Hyphenation must not leak into the hash of a book that is never converted.
    expect((service as any).getDeliveryInfo('epub', 2 * 1024 * 1024, { ...base, forceEnableHyphenation: true }, null).hash).toBe('90fb0bb55cca2fd2');
  });

  it('fetchEligibleSnapshotRows and fetchEligibleBooksByIds map DB rows into sync payload objects', async () => {
    const db = makeDb({
      select: [
        [
          {
            bookId: 5,
            title: 'Dune',
            isbn10: '0306406152',
            isbn13: '9780306406157',
            language: 'English',
            seriesName: 'Saga',
            seriesIndex: 2,
            metadataUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
            fileFormat: 'epub',
            fileSizeBytes: 1234,
            fileHash: 'file-hash',
            authorNamesCsv: 'Author A,Author B',
          },
        ],
        [
          {
            bookId: 5,
            title: 'Dune',
            description: 'Desc',
            publisher: 'Pub',
            publishedYear: 1965,
            language: 'English',
            isbn10: '0306406152',
            isbn13: '9780306406157',
            seriesName: 'Saga',
            seriesIndex: 2,
            fileFormat: 'epub',
            fileSizeBytes: 1234,
            fileHash: 'file-hash',
            metadataUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
            addedAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        ],
        [
          { bookId: 5, name: 'Author A' },
          { bookId: 5, name: 'Author B' },
        ],
        [{ bookId: 5, name: 'Collection A' }],
      ],
    });
    const service = makeService(db);
    vi.spyOn(service as any, 'buildEligibleBooksWhereClause').mockResolvedValue({ where: true });

    const snapshotRows = await (service as any).fetchEligibleSnapshotRows(8, true, new Map());
    expect(snapshotRows).toEqual([
      {
        bookId: 5,
        fileHash: 'file-hash',
        deliveryHash: expect.any(String),
        metadataHash: expect.any(String),
        needsLegacyNumericRemoval: true,
      },
    ]);

    const books = await (service as any).fetchEligibleBooksByIds(8, [5, 5], true, new Map());
    expect(books.get(5)).toEqual(
      expect.objectContaining({
        title: 'Dune',
        authors: ['Author A', 'Author B'],
        collectionNames: ['Collection A'],
        language: 'en',
        isbn: '9780306406157',
        metadataHash: expect.any(String),
      }),
    );
    expect(books.get(5)?.metadataHash).toBe(snapshotRows[0].metadataHash);
  });

  describe('fixed-layout books end to end', () => {
    function comicRows(isFixedLayout: boolean | null) {
      const shared = {
        bookId: 5,
        title: 'Manga Vol. 1',
        language: 'English',
        isbn10: null,
        isbn13: null,
        seriesName: null,
        seriesIndex: null,
        metadataUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        fileFormat: 'epub',
        fileSizeBytes: 1234,
        fileHash: 'file-hash',
        isFixedLayout,
      };
      return {
        select: [
          [{ ...shared, fileId: 77, fileAbsolutePath: '/books/manga.epub', authorNamesCsv: 'Mangaka' }],
          [{ ...shared, description: null, publisher: null, publishedYear: null, addedAt: new Date(), updatedAt: new Date() }],
          [{ bookId: 5, name: 'Mangaka' }],
          [],
        ],
      };
    }

    it('announces a stored fixed-layout book as EPUB3FL in the payload the device receives', async () => {
      const db = makeDb(comicRows(true));
      const service = makeService(db);
      vi.spyOn(service as any, 'buildEligibleBooksWhereClause').mockResolvedValue({ where: true });

      await (service as any).fetchEligibleSnapshotRows(8, false, new Map());
      const books = await (service as any).fetchEligibleBooksByIds(8, [5], false, new Map());
      const metadata = (service as any).buildBookMetadata(books.get(5), 'tok', 'https://base') as Record<string, unknown>;

      expect((metadata.DownloadUrls as Array<Record<string, unknown>>)[0]!.Format).toBe('EPUB3FL');
    });

    it('backfills an unchecked comic during the reconcile pass and hashes it as EPUB3FL immediately', async () => {
      const db = makeDb(comicRows(null));
      const service = makeService(db);
      vi.spyOn(service as any, 'buildEligibleBooksWhereClause').mockResolvedValue({ where: true });
      metadataExtractionService.detectFixedLayout.mockResolvedValue(true);

      const rows = await (service as any).fetchEligibleSnapshotRows(8, false, new Map(), true);

      expect(metadataExtractionService.detectFixedLayout).toHaveBeenCalledWith('/books/manga.epub', 'epub');
      expect(db.__updateChains[0]!.set).toHaveBeenCalledWith({ isFixedLayout: true });
      // The same pass that learns the flag also stores the EPUB3FL hash, so the device is told
      // about the comic on this sync rather than the next one.
      expect(rows[0].deliveryHash).toBe('6a8354534ee2c5c8');
    });

    it('does no filesystem work on the mid-page pass that only needs eligible ids', async () => {
      const db = makeDb(comicRows(null));
      const service = makeService(db);
      vi.spyOn(service as any, 'buildEligibleBooksWhereClause').mockResolvedValue({ where: true });

      await (service as any).fetchEligibleSnapshotRows(8, false, new Map());

      expect(metadataExtractionService.detectFixedLayout).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });

    it('does not open files for a book whose flag is already stored', async () => {
      const db = makeDb(comicRows(false));
      const service = makeService(db);
      vi.spyOn(service as any, 'buildEligibleBooksWhereClause').mockResolvedValue({ where: true });

      const rows = await (service as any).fetchEligibleSnapshotRows(8, false, new Map(), true);

      expect(metadataExtractionService.detectFixedLayout).not.toHaveBeenCalled();
      expect(rows[0].deliveryHash).toBe('2f55f4d028ef859c');
    });
  });
});
