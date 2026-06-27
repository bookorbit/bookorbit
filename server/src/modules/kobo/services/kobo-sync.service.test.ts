import { KoboSyncService } from './kobo-sync.service';

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

  return {
    query: {
      koboLibrarySnapshots: { findFirst: vi.fn() },
      koboSnapshotBooks: { findFirst: vi.fn() },
      koboSyncSettings: { findFirst: vi.fn() },
      collections: { findMany: vi.fn() },
    },
    select: vi.fn(() => makeChain(queue.select.shift() ?? [])),
    insert: vi.fn(() => makeChain(queue.insert.shift() ?? [])),
    update: vi.fn(() => makeChain(queue.update.shift() ?? [])),
    delete: vi.fn(() => makeChain(queue.delete.shift() ?? [])),
    execute: vi.fn(() => Promise.resolve({ rows: queue.execute.shift() ?? [] })),
    transaction: vi.fn(async (cb: (tx: { execute: (statement: unknown) => Promise<unknown> }) => Promise<void>) => {
      await cb({
        execute: vi.fn().mockResolvedValue(undefined),
      });
    }),
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
    publishedYear: 2022,
    language: 'en',
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
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    bookAccessService.getAccessibleLibraryIds.mockResolvedValue(null);
    readingStateService.getRawState.mockResolvedValue(null);
    contentFilterRepository.findByUserId.mockResolvedValue([]);
    bookIdentityService.ensureForBooks.mockImplementation((_userId: number, bookIds: number[], needsLegacyNumericRemoval: boolean) =>
      makeIdentityMap(bookIds, needsLegacyNumericRemoval),
    );
    bookIdentityService.findByBookIds.mockImplementation((_userId: number, bookIds: number[]) => makeIdentityMap(bookIds));
    bookIdentityService.markLegacyNumericRemovalComplete.mockResolvedValue(undefined);
    bookIdentityService.buildVersionedCoverImageId.mockImplementation((coverImageId: string, version: Date | null) =>
      version ? `${coverImageId}_${version.getTime()}` : coverImageId,
    );
  });

  it('getDelta creates new snapshot when missing and reconciles existing snapshot otherwise', async () => {
    const db = makeDb();
    const service = makeService(db);
    const eligible = [{ bookId: 1, fileHash: 'h1', deliveryHash: 'd1', metadataHash: 'm1' }];
    vi.spyOn(service as any, 'fetchEligibleSnapshotRows').mockResolvedValue(eligible);
    const createSpy = vi.spyOn(service as any, 'createSnapshot').mockResolvedValue(undefined);
    const reconcileSpy = vi.spyOn(service as any, 'reconcileSnapshot').mockResolvedValue(undefined);
    const pageSpy = vi.spyOn(service as any, 'getPageFromSnapshot').mockResolvedValue({
      entitlements: [{ ChangedTag: {} }],
      hasMore: false,
      syncToken: 'PX.token',
    });

    db.query.koboLibrarySnapshots.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 9, userId: 5 });

    await expect(service.getDelta(5, 'device-token', 'https://reader.example.com')).resolves.toEqual({
      entitlements: [{ ChangedTag: {} }],
      hasMore: false,
      syncToken: 'PX.token',
    });
    expect(createSpy).toHaveBeenCalledWith(5, eligible);

    await service.getDelta(5, 'device-token', 'https://reader.example.com');
    expect(reconcileSpy).toHaveBeenCalledWith(9, eligible);
    expect(pageSpy).toHaveBeenCalledTimes(2);
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

    expect(fetchSpy).toHaveBeenCalledWith(3, [12], true);
    expect(metadata.Title).toBe('Book 12');
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

  it('removeBookFromSync handles missing snapshot/row and delete-vs-mark paths', async () => {
    const db = makeDb();
    const service = makeService(db);

    db.query.koboLibrarySnapshots.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 4, userId: 1 })
      .mockResolvedValueOnce({ id: 4, userId: 1 })
      .mockResolvedValueOnce({ id: 4, userId: 1 });
    db.query.koboSnapshotBooks.findFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ bookId: 2, pendingDelete: true })
      .mockResolvedValueOnce({ bookId: 3, pendingDelete: false });

    await expect(service.removeBookFromSync(1, 10)).resolves.toBeUndefined();
    await expect(service.removeBookFromSync(1, 2)).resolves.toBeUndefined();
    await expect(service.removeBookFromSync(1, 3)).resolves.toBeUndefined();
    await expect(service.removeBookFromSync(1, 4)).resolves.toBeUndefined();

    expect(db.delete).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
  });

  it('invalidateSnapshot marks snapshot rows unsynced only when snapshot exists', async () => {
    const db = makeDb();
    db.query.koboLibrarySnapshots.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 21, userId: 9 });
    const service = makeService(db);

    await service.invalidateSnapshot(9);
    await service.invalidateSnapshot(9);

    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('createSnapshot inserts snapshot row and snapshot-books seed rows', async () => {
    const db = makeDb({ insert: [[{ id: 55 }], []] });
    const service = makeService(db);

    await (service as any).createSnapshot(7, [
      { bookId: 1, fileHash: 'h1', deliveryHash: 'd1', metadataHash: 'm1' },
      { bookId: 2, fileHash: null, deliveryHash: 'd2', metadataHash: 'm2' },
    ]);

    expect(db.insert).toHaveBeenCalledTimes(2);
  });

  it('getPageFromSnapshot returns empty result when no snapshot exists', async () => {
    const db = makeDb();
    db.query.koboLibrarySnapshots.findFirst.mockResolvedValue(null);
    const service = makeService(db);

    await expect((service as any).getPageFromSnapshot(7, 'tok', 'https://base', new Set())).resolves.toEqual({
      entitlements: [],
      hasMore: false,
      syncToken: expect.stringMatching(/^PX\./),
    });
  });

  it('getPageFromSnapshot returns tags on final page when no pending rows', async () => {
    const db = makeDb({ select: [[]] });
    db.query.koboLibrarySnapshots.findFirst.mockResolvedValue({ id: 1, userId: 7 });
    const service = makeService(db);
    vi.spyOn(service as any, 'buildTagItems').mockResolvedValue([{ ChangedTag: {} }]);

    const result = await (service as any).getPageFromSnapshot(7, 'tok', 'https://base', new Set([1]));

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
    db.query.koboLibrarySnapshots.findFirst.mockResolvedValue({ id: 22, userId: 7 });
    const service = makeService(db);
    vi.spyOn(service as any, 'fetchEligibleBooksByIds').mockResolvedValue(
      new Map([
        [2, makeBook(2)],
        [3, makeBook(3)],
      ]),
    );
    readingStateService.getRawState.mockResolvedValue(null);

    const result = await (service as any).getPageFromSnapshot(7, 'tok', 'https://base', new Set([1, 2, 3]));

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
    db.query.koboLibrarySnapshots.findFirst.mockResolvedValue({ id: 22, userId: 7 });
    const service = makeService(db);
    vi.spyOn(service as any, 'fetchEligibleBooksByIds').mockResolvedValue(new Map([[3, makeBook(3)]]));
    readingStateService.getRawState.mockResolvedValue({ EntitlementId: 'entitlement-3', CurrentBookmark: { ProgressPercent: 61 } });

    const result = await (service as any).getPageFromSnapshot(7, 'tok', 'https://base', new Set([3]));

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
      select: [[{ bookId: 3, pendingDelete: false, isNew: false }]],
    });
    db.query.koboLibrarySnapshots.findFirst.mockResolvedValue({ id: 22, userId: 7 });
    const service = makeService(db);
    vi.spyOn(service as any, 'fetchEligibleBooksByIds').mockResolvedValue(new Map([[3, { ...makeBook(3), needsLegacyNumericRemoval: true }]]));
    bookIdentityService.findByBookIds.mockResolvedValue(new Map([[3, makeIdentity(3, true)]]));
    readingStateService.getRawState.mockResolvedValue({ EntitlementId: 'entitlement-3', CurrentBookmark: { ProgressPercent: 61 } });

    const result = await (service as any).getPageFromSnapshot(7, 'tok', 'https://base', new Set([3]));

    expect(result.entitlements).toHaveLength(2);
    expect(result.entitlements[0]).toHaveProperty('ChangedEntitlement');
    expect(result.entitlements[1]).toEqual({
      NewEntitlement: expect.objectContaining({
        ReadingState: { EntitlementId: 'entitlement-3', CurrentBookmark: { ProgressPercent: 61 } },
      }),
    });
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

    const tags = await (service as any).buildTagItems(3, new Set([10, 22]));

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

  it('buildMetadataHash is deterministic and changes when metadata inputs change', () => {
    const service = makeService(makeDb());

    const hashA = (service as any).buildMetadataHash({
      title: 'Dune',
      authors: ['Frank Herbert'],
      seriesName: 'Dune',
      seriesIndex: 1,
      metadataUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      entitlementId: 'entitlement-1',
      coverImageId: 'cover-1',
    });
    const hashB = (service as any).buildMetadataHash({
      title: 'Dune',
      authors: ['Frank Herbert'],
      seriesName: 'Dune',
      seriesIndex: 1,
      metadataUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      entitlementId: 'entitlement-1',
      coverImageId: 'cover-1',
    });
    const hashC = (service as any).buildMetadataHash({
      title: 'Dune Messiah',
      authors: ['Frank Herbert'],
      seriesName: 'Dune',
      seriesIndex: 2,
      metadataUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      entitlementId: 'entitlement-1',
      coverImageId: 'cover-1',
    });
    const hashE = (service as any).buildMetadataHash({
      title: 'Dune',
      authors: ['Frank Herbert'],
      seriesName: 'Dune',
      seriesIndex: 1,
      metadataUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      entitlementId: 'entitlement-2',
      coverImageId: 'cover-1',
    });
    const hashF = (service as any).buildMetadataHash({
      title: 'Dune',
      authors: ['Frank Herbert'],
      seriesName: 'Dune',
      seriesIndex: 1,
      metadataUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      entitlementId: 'entitlement-1',
      coverImageId: 'cover-2',
    });

    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(hashC);
    expect(hashA).not.toBe(hashE);
    expect(hashA).not.toBe(hashF);
    expect(hashA).toHaveLength(16);
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

  it('fetchEligibleSnapshotRows and fetchEligibleBooksByIds map DB rows into sync payload objects', async () => {
    const db = makeDb({
      select: [
        [
          {
            bookId: 5,
            title: 'Dune',
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
            language: 'en',
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
        [{ bookId: 5, name: 'Author A' }],
        [{ bookId: 5, name: 'Collection A' }],
      ],
    });
    const service = makeService(db);
    vi.spyOn(service as any, 'buildEligibleBooksWhereClause').mockResolvedValue({ where: true });

    const snapshotRows = await (service as any).fetchEligibleSnapshotRows(8, true);
    expect(snapshotRows).toEqual([
      {
        bookId: 5,
        fileHash: 'file-hash',
        deliveryHash: expect.any(String),
        metadataHash: expect.any(String),
      },
    ]);

    const books = await (service as any).fetchEligibleBooksByIds(8, [5, 5], true);
    expect(books.get(5)).toEqual(
      expect.objectContaining({
        title: 'Dune',
        authors: ['Author A'],
        collectionNames: ['Collection A'],
        metadataHash: expect.any(String),
      }),
    );
  });
});
