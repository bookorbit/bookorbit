import { KoboReadingStateService } from './kobo-reading-state.service';
import { ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED } from '../../achievement/achievement-events.service';

function makeInsertChain() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  return { values, onConflictDoUpdate };
}

function makeSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result);
  return chain;
}

function makeDb() {
  return {
    query: {
      books: { findFirst: vi.fn() },
      koboLibrarySnapshots: { findFirst: vi.fn() },
      koboReadingStates: { findFirst: vi.fn() },
    },
    select: vi.fn(() => makeSelectChain([])),
    insert: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

describe('KoboReadingStateService', () => {
  const bookAccessService = { assertBookAccessible: vi.fn() };
  const userBookStatusService = { autoUpdate: vi.fn() };
  const bookIdentityService = { ensureForBook: vi.fn() };
  const progressBridge = { koboBookmarkToCanonical: vi.fn(), cfiToKoboBookmark: vi.fn() };
  const settingsService = { getSettings: vi.fn() };
  const achievementEvents = { emit: vi.fn() };

  function makeService(db: ReturnType<typeof makeDb>) {
    return new KoboReadingStateService(
      db as never,
      bookAccessService as never,
      userBookStatusService as never,
      bookIdentityService as never,
      progressBridge as never,
      settingsService as never,
      achievementEvents as never,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    userBookStatusService.autoUpdate.mockResolvedValue(undefined);
    progressBridge.koboBookmarkToCanonical.mockResolvedValue(null);
    progressBridge.cfiToKoboBookmark.mockResolvedValue(null);
    settingsService.getSettings.mockResolvedValue({ twoWayProgressSync: false });
    bookIdentityService.ensureForBook.mockImplementation((_userId: number, bookId: number) => ({
      bookId,
      entitlementId: `entitlement-${bookId}`,
      coverImageId: `cover-${bookId}`,
      needsLegacyNumericRemoval: false,
    }));
  });

  it('returns ignored update results when the target book is missing', async () => {
    const db = makeDb();
    db.query.books.findFirst.mockResolvedValue(null);

    await expect(makeService(db).upsertState(7, 99, {}, 1, 99, false)).resolves.toEqual({
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
    expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
    expect(bookAccessService.assertBookAccessible).not.toHaveBeenCalled();
  });

  it('merges reading state sub-objects by LastModified before storing raw state', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 12 });
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

    const result = await makeService(db).upsertState(
      3,
      12,
      {
        LastModified: '2026-01-03T00:00:00.000Z',
        CurrentBookmark: { LastModified: '2026-01-01T00:00:00.000Z', ProgressPercent: 10 },
        Statistics: { LastModified: '2026-01-05T00:00:00.000Z', Value: 2 },
      },
      1,
      99,
      false,
    );

    expect(stateInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        bookId: 12,
        entitlementId: 'entitlement-12',
        currentBookmark: { LastModified: '2026-01-02T00:00:00.000Z', ProgressPercent: 34 },
        statistics: { LastModified: '2026-01-05T00:00:00.000Z', Value: 2 },
      }),
    );
    expect(result).toEqual({
      EntitlementId: 'entitlement-12',
      Created: '2026-01-01T00:00:00.000Z',
      LastModified: '2026-01-03T00:00:00.000Z',
      PriorityTimestamp: '2026-01-03T00:00:00.000Z',
      CurrentBookmark: { ProgressPercent: 34 },
      Statistics: { Value: 1 },
      StatusInfo: { Status: 'Reading' },
    });
  });

  it('does not regress envelope timestamps below a newer hub-refreshed bookmark on device re-push', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 12 });
    db.query.koboReadingStates.findFirst
      .mockResolvedValueOnce({
        lastModifiedKobo: '2026-06-11T15:49:30.355Z',
        priorityTimestamp: '2026-06-11T15:49:30.355Z',
        currentBookmark: {
          LastModified: '2026-06-11T15:49:30.355Z',
          ProgressPercent: 84.94,
          Location: { Source: 'index_split_012.html', Type: 'KoboSpan', Value: 'kobo.1.1' },
        },
      })
      .mockResolvedValueOnce({
        entitlementId: '12',
        createdAtKobo: '2026-06-11T15:42:12.729Z',
        lastModifiedKobo: '2026-06-11T15:49:30.355Z',
        priorityTimestamp: '2026-06-11T15:49:30.355Z',
        currentBookmark: { ProgressPercent: 84.94 },
      });

    await makeService(db).upsertState(
      3,
      12,
      {
        LastModified: '2026-06-11T15:49:20Z',
        PriorityTimestamp: '2026-06-11T15:49:20Z',
        CurrentBookmark: {
          LastModified: '2026-06-11T15:49:20Z',
          ProgressPercent: 21,
          Location: { Source: 'index_split_012.html', Type: 'KoboSpan', Value: 'kobo.1.1' },
        },
      },
      1,
      99,
      false,
    );

    expect(stateInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        lastModifiedKobo: '2026-06-11T15:49:30.355Z',
        priorityTimestamp: '2026-06-11T15:49:30.355Z',
        currentBookmark: expect.objectContaining({ ProgressPercent: 84.94, LastModified: '2026-06-11T15:49:30.355Z' }),
      }),
    );
    expect(stateInsert.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          lastModifiedKobo: '2026-06-11T15:49:30.355Z',
          priorityTimestamp: '2026-06-11T15:49:30.355Z',
        }),
      }),
    );
  });

  it('calls autoUpdate with merged percent and thresholds when bookmark has ProgressPercent', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    const progressInsert = makeInsertChain();
    db.insert.mockReturnValueOnce(stateInsert).mockReturnValueOnce(progressInsert);
    db.select
      .mockReturnValueOnce(makeSelectChain([{ fileId: 55 }]))
      .mockReturnValueOnce(makeSelectChain([{ percentage: 20, cfi: null, updatedAt: new Date('2025-12-31T00:00:00.000Z') }]));
    db.query.books.findFirst.mockResolvedValue({ id: 5 });
    db.query.koboReadingStates.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ entitlementId: '5', currentBookmark: { ProgressPercent: 42.5 } });

    await makeService(db).upsertState(
      1,
      5,
      {
        CurrentBookmark: {
          LastModified: '2026-01-01T00:00:00Z',
          ProgressPercent: 42.5,
          ContentSourceProgressPercent: 12.25,
          Location: { Source: 'OEBPS/html/ch5.xhtml', Type: 'KoboSpan', Value: 'kobo.25.1' },
        },
      },
      1,
      99,
      true,
    );

    expect(userBookStatusService.autoUpdate).toHaveBeenCalledWith(1, 5, 42.5, 1, 99);
    expect(progressInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        bookFileId: 55,
        percentage: 42.5,
        cfi: null,
        pageNumber: null,
        koboLocationSource: 'OEBPS/html/ch5.xhtml',
        koboLocationType: 'KoboSpan',
        koboLocationValue: 'kobo.25.1',
        koboContentSourceProgressPercent: 12.25,
      }),
    );
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('does not treat ContentSourceProgressPercent as whole-book progress', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 5 });
    db.query.koboReadingStates.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ entitlementId: '5', currentBookmark: { ContentSourceProgressPercent: 75 } });

    await makeService(db).upsertState(
      1,
      5,
      { CurrentBookmark: { LastModified: '2026-01-01T00:00:00Z', ContentSourceProgressPercent: 75 } },
      1,
      99,
      true,
    );

    expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('does not mirror Kobo percent to internal progress when two-way sync is disabled', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 5 });
    db.query.koboReadingStates.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ entitlementId: '5', currentBookmark: { ProgressPercent: 42.5 } });

    await makeService(db).upsertState(1, 5, { CurrentBookmark: { LastModified: '2026-01-01T00:00:00Z', ProgressPercent: 42.5 } }, 1, 99, false);

    expect(userBookStatusService.autoUpdate).toHaveBeenCalledWith(1, 5, 42.5, 1, 99);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
    expect(achievementEvents.emit).toHaveBeenCalledWith(
      ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED,
      expect.objectContaining({ userId: 1, bookId: 5, progress: 42.5, source: 'kobo' }),
    );
  });

  it('does not replace newer internal CFI progress with stale Kobo percent', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    db.select
      .mockReturnValueOnce(makeSelectChain([{ fileId: 60 }]))
      .mockReturnValueOnce(makeSelectChain([{ percentage: 70, cfi: 'epubcfi(/6/2)', updatedAt: new Date('2026-01-02T00:00:00.000Z') }]));
    db.query.books.findFirst.mockResolvedValue({ id: 6 });
    db.query.koboReadingStates.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ entitlementId: '6', currentBookmark: { ProgressPercent: 60 } });

    await makeService(db).upsertState(1, 6, { CurrentBookmark: { LastModified: '2026-01-01T00:00:00.000Z', ProgressPercent: 60 } }, 1, 99, true);

    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('does not call autoUpdate when bookmark has no percent', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 7 });
    db.query.koboReadingStates.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ entitlementId: '7' });

    await makeService(db).upsertState(2, 7, { Statistics: { LastModified: '2026-01-01T00:00:00Z' } }, 1, 99, false);

    expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
  });

  it('getRawState returns null when absent and maps persisted fields when present', async () => {
    const db = makeDb();
    db.query.books.findFirst.mockResolvedValue({ id: 44 });
    db.query.koboReadingStates.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      entitlementId: '44',
      createdAtKobo: '2026-01-01T00:00:00.000Z',
      lastModifiedKobo: '2026-01-02T00:00:00.000Z',
      priorityTimestamp: '2026-01-03T00:00:00.000Z',
      currentBookmark: { ProgressPercent: 20 },
      statistics: { Value: 1 },
      statusInfo: { Status: 'ReadyToRead' },
    });

    await expect(makeService(db).getRawState(1, 44)).resolves.toBeNull();
    await expect(makeService(db).getRawState(1, 44)).resolves.toEqual({
      EntitlementId: 'entitlement-44',
      Created: '2026-01-01T00:00:00.000Z',
      LastModified: '2026-01-02T00:00:00.000Z',
      PriorityTimestamp: '2026-01-03T00:00:00.000Z',
      CurrentBookmark: { ProgressPercent: 20 },
      Statistics: { Value: 1 },
      StatusInfo: { Status: 'ReadyToRead' },
    });
  });

  it('getRawState returns null for missing legacy book ids without checking access', async () => {
    const db = makeDb();
    db.query.books.findFirst.mockResolvedValue(null);

    await expect(makeService(db).getRawState(1, 1219)).resolves.toBeNull();

    expect(bookAccessService.assertBookAccessible).not.toHaveBeenCalled();
    expect(db.query.koboReadingStates.findFirst).not.toHaveBeenCalled();
  });
});
