import { KoboReadingStateService } from './kobo-reading-state.service';

function makeInsertChain() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  return { values, onConflictDoUpdate };
}

function makeDb() {
  return {
    query: {
      books: { findFirst: vi.fn() },
      koboReadingStates: { findFirst: vi.fn() },
    },
    insert: vi.fn(),
  };
}

describe('KoboReadingStateService', () => {
  const bookAccessService = { assertBookAccessible: vi.fn() };
  const userBookStatusService = { autoUpdate: vi.fn() };
  const achievementEvents = { emit: vi.fn() };

  function makeService(db: ReturnType<typeof makeDb>) {
    return new KoboReadingStateService(db as never, bookAccessService as never, userBookStatusService as never, achievementEvents as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    userBookStatusService.autoUpdate.mockResolvedValue(undefined);
  });

  it('returns ignored update results when the target book is missing', async () => {
    const db = makeDb();
    db.query.books.findFirst.mockResolvedValue(null);

    await expect(makeService(db).upsertState(7, 99, {}, 1, 99)).resolves.toEqual({
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
  });

  it('merges reading state sub-objects by LastModified before storing raw state', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 12, libraryId: 1 });
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
    );

    expect(stateInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        bookId: 12,
        currentBookmark: { LastModified: '2026-01-02T00:00:00.000Z', ProgressPercent: 34 },
        statistics: { LastModified: '2026-01-05T00:00:00.000Z', Value: 2 },
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

  it('calls autoUpdate with merged percent and thresholds when bookmark has ProgressPercent', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 5, libraryId: 1 });
    db.query.koboReadingStates.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ entitlementId: '5', currentBookmark: { ProgressPercent: 42.5 } });

    await makeService(db).upsertState(1, 5, { CurrentBookmark: { LastModified: '2026-01-01T00:00:00Z', ProgressPercent: 42.5 } }, 1, 99);

    expect(userBookStatusService.autoUpdate).toHaveBeenCalledWith(1, 5, 42.5, 1, 99);
  });

  it('does not call autoUpdate when bookmark has no percent', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 7, libraryId: 1 });
    db.query.koboReadingStates.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ entitlementId: '7' });

    await makeService(db).upsertState(2, 7, { Statistics: { LastModified: '2026-01-01T00:00:00Z' } }, 1, 99);

    expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
  });

  it('upserts daily reading stats when progress percent is greater than 0', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    const dailyInsert = makeInsertChain();
    db.insert.mockImplementation(() => {
      return stateInsert;
    });
    // We need to handle two insert calls - one for koboReadingStates and one for userReadingDailyStats
    let insertCallCount = 0;
    db.insert = vi.fn().mockImplementation(() => {
      insertCallCount++;
      if (insertCallCount === 1) return stateInsert;
      return dailyInsert;
    });

    db.query.books.findFirst.mockResolvedValue({ id: 5, libraryId: 10 });
    db.query.koboReadingStates.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ entitlementId: '5', currentBookmark: { ProgressPercent: 42.5 } });

    await makeService(db).upsertState(1, 5, { CurrentBookmark: { LastModified: '2026-01-01T00:00:00Z', ProgressPercent: 42.5 } }, 1, 99);

    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(dailyInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        libraryId: 10,
        readingSeconds: 0,
        progressDelta: 42.5,
        sessionsCount: 1,
      }),
    );
    expect(achievementEvents.emit).toHaveBeenCalledWith(
      'reading-session.saved',
      expect.objectContaining({
        userId: 1,
        progressDelta: 42.5,
        endProgress: 42.5,
      }),
    );
  });

  it('computes progressDelta from previous percent when updating existing state', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    const dailyInsert = makeInsertChain();
    let insertCallCount = 0;
    db.insert = vi.fn().mockImplementation(() => {
      insertCallCount++;
      if (insertCallCount === 1) return stateInsert;
      return dailyInsert;
    });

    db.query.books.findFirst.mockResolvedValue({ id: 5, libraryId: 10 });
    db.query.koboReadingStates.findFirst
      .mockResolvedValueOnce({
        currentBookmark: { ProgressPercent: 30 },
      })
      .mockResolvedValueOnce({ entitlementId: '5', currentBookmark: { ProgressPercent: 42.5 } });

    await makeService(db).upsertState(1, 5, { CurrentBookmark: { ProgressPercent: 42.5 } }, 1, 99);

    // progressDelta should be 42.5 - 30 = 12.5
    expect(dailyInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        progressDelta: 12.5,
      }),
    );
  });

  it('does not upsert daily stats when progress percent is 0', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 5, libraryId: 10 });
    db.query.koboReadingStates.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ entitlementId: '5', currentBookmark: { ProgressPercent: 0 } });

    await makeService(db).upsertState(1, 5, { CurrentBookmark: { ProgressPercent: 0 } }, 1, 99);

    // Only one insert call for koboReadingStates, none for userReadingDailyStats
    expect(db.insert).toHaveBeenCalledTimes(1);
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

    await expect(makeService(db).getRawState(1, 44)).resolves.toBeNull();
    await expect(makeService(db).getRawState(1, 44)).resolves.toEqual({
      EntitlementId: '44',
      Created: '2026-01-01T00:00:00.000Z',
      LastModified: '2026-01-02T00:00:00.000Z',
      PriorityTimestamp: '2026-01-03T00:00:00.000Z',
      CurrentBookmark: { ProgressPercent: 20 },
      Statistics: { Value: 1 },
      StatusInfo: { Status: 'ReadyToRead' },
    });
  });
});
