import { KoboReadingStateService } from './kobo-reading-state.service';

function makeSelectChain(limitResult: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue(limitResult);
  return chain;
}

function makeInsertChain() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  return {
    values,
    onConflictDoUpdate,
  };
}

function makeDb() {
  return {
    query: {
      books: { findFirst: vi.fn() },
      bookFiles: { findFirst: vi.fn() },
      koboReadingStates: { findFirst: vi.fn() },
    },
    select: vi.fn(),
    insert: vi.fn(),
  };
}

describe('KoboReadingStateService', () => {
  const bookAccessService = {
    assertBookAccessible: vi.fn(),
    getAccessibleLibraryIds: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    bookAccessService.getAccessibleLibraryIds.mockResolvedValue(null);
  });

  it('returns ignored update results when the target book is missing', async () => {
    const db = makeDb();
    db.query.books.findFirst.mockResolvedValue(null);
    const service = new KoboReadingStateService(db as never, bookAccessService as never);

    await expect(service.upsertState(7, 99, {}, 2, 90)).resolves.toEqual({
      RequestResult: 'Success',
      UpdateResults: [
        {
          EntitlementId: '99',
          CurrentBookmarkResult: { Result: 'Ignored' },
          StatisticsResult: { Result: 'Ignored' },
          StatusInfoResult: { Result: 'Ignored' },
        },
      ],
    });
  });

  it('merges reading state sub-objects by LastModified and syncs progress', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    const progressInsert = makeInsertChain();
    db.insert.mockReturnValueOnce(stateInsert).mockReturnValueOnce(progressInsert);
    db.query.books.findFirst.mockResolvedValueOnce({ id: 12 }).mockResolvedValueOnce({ primaryFileId: 88 });
    db.query.koboReadingStates.findFirst
      .mockResolvedValueOnce({
        currentBookmark: { LastModified: '2026-01-02T00:00:00.000Z', ProgressPercent: 34 },
        statistics: { LastModified: '2026-01-01T00:00:00.000Z', Value: 1 },
        statusInfo: { LastModified: '2026-01-01T00:00:00.000Z', Status: 'Reading' },
      })
      .mockResolvedValueOnce({
        entitlementId: '12',
        createdAtKobo: '2026-01-01T00:00:00.000Z',
        lastModifiedKobo: '2026-01-03T00:00:00.000Z',
        priorityTimestamp: '2026-01-03T00:00:00.000Z',
        currentBookmark: { ProgressPercent: 34 },
        statistics: { Value: 1 },
        statusInfo: { Status: 'Reading' },
      });
    db.query.bookFiles.findFirst.mockResolvedValue({ id: 88 });

    const service = new KoboReadingStateService(db as never, bookAccessService as never);
    const result = await service.upsertState(
      3,
      12,
      {
        LastModified: '2026-01-03T00:00:00.000Z',
        CurrentBookmark: { LastModified: '2026-01-01T00:00:00.000Z', ProgressPercent: 10 },
        Statistics: { LastModified: '2026-01-05T00:00:00.000Z', Value: 2 },
      },
      2,
      90,
    );

    expect(stateInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        bookId: 12,
        currentBookmark: { LastModified: '2026-01-02T00:00:00.000Z', ProgressPercent: 34 },
        statistics: { LastModified: '2026-01-05T00:00:00.000Z', Value: 2 },
      }),
    );
    expect(progressInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        bookFileId: 88,
        percentage: 34,
      }),
    );
    expect(result).toEqual({
      EntitlementId: '12',
      Created: '2026-01-01T00:00:00.000Z',
      LastModified: '2026-01-03T00:00:00.000Z',
      PriorityTimestamp: '2026-01-03T00:00:00.000Z',
      CurrentBookmark: { ProgressPercent: 34 },
      Statistics: { Value: 1 },
      StatusInfo: { Status: 'Reading' },
    });
  });

  it('syncToReadingProgress normalizes finished progress to 100 and skips below-threshold updates', async () => {
    const db = makeDb();
    const progressInsert = makeInsertChain();
    db.insert.mockReturnValue(progressInsert);
    db.query.books.findFirst.mockResolvedValue({ primaryFileId: 45 });
    db.query.bookFiles.findFirst.mockResolvedValue({ id: 45 });
    const service = new KoboReadingStateService(db as never, bookAccessService as never);

    await (service as any).syncToReadingProgress(6, 7, 99, 2, 90);
    expect(progressInsert.values).toHaveBeenCalledWith(expect.objectContaining({ percentage: 100 }));

    progressInsert.values.mockClear();
    await (service as any).syncToReadingProgress(6, 7, 1, 2, 90);
    expect(progressInsert.values).not.toHaveBeenCalled();
  });

  it('getRawState returns null when absent and maps persisted fields when present', async () => {
    const db = makeDb();
    db.query.koboReadingStates.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      entitlementId: '44',
      createdAtKobo: '2026-01-01T00:00:00.000Z',
      lastModifiedKobo: '2026-01-02T00:00:00.000Z',
      priorityTimestamp: '2026-01-03T00:00:00.000Z',
      currentBookmark: { ProgressPercent: 20 },
      statistics: { Value: 1 },
      statusInfo: { Status: 'ReadyToRead' },
    });
    const service = new KoboReadingStateService(db as never, bookAccessService as never);

    await expect(service.getRawState(1, 44)).resolves.toBeNull();
    await expect(service.getRawState(1, 44)).resolves.toEqual({
      EntitlementId: '44',
      Created: '2026-01-01T00:00:00.000Z',
      LastModified: '2026-01-02T00:00:00.000Z',
      PriorityTimestamp: '2026-01-03T00:00:00.000Z',
      CurrentBookmark: { ProgressPercent: 20 },
      Statistics: { Value: 1 },
      StatusInfo: { Status: 'ReadyToRead' },
    });
  });

  it('builds outgoing changed-reading-state payloads for progress push pages', async () => {
    const db = makeDb();
    const rows = Array.from({ length: 251 }, (_, i) => ({ bookId: i + 1, percentage: i % 3 === 0 ? 95 : 40 }));
    const selectChain = makeSelectChain(rows);
    db.select.mockReturnValue(selectChain);
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    const service = new KoboReadingStateService(db as never, bookAccessService as never);

    const result = await service.getAndMarkStatesNeedingPush(4, 30, 90);

    expect(result.hasMore).toBe(true);
    expect(result.items).toHaveLength(250);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        ChangedReadingState: expect.objectContaining({
          ReadingState: expect.objectContaining({
            EntitlementId: '1',
            CurrentBookmark: expect.objectContaining({ ProgressPercent: 95 }),
          }),
        }),
      }),
    );
    expect(stateInsert.values).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ userId: 4, bookId: 1 })]));
  });

  it('returns empty push payload when no updated reading progress rows exist', async () => {
    const db = makeDb();
    db.select.mockReturnValue(makeSelectChain([]));
    const service = new KoboReadingStateService(db as never, bookAccessService as never);

    await expect(service.getAndMarkStatesNeedingPush(4, 30, 90)).resolves.toEqual({ items: [], hasMore: false });
    expect(db.insert).not.toHaveBeenCalled();
  });
});
