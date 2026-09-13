import { Logger } from '@nestjs/common';

import { KoboReadingStateService } from './kobo-reading-state.service';
import { createCapturingDb } from '../../../common/test-utils/capture-sql-db';
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

function makeUpdateChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  return { set, where };
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
    update: vi.fn(() => makeUpdateChain()),
    execute: vi.fn().mockResolvedValue(undefined),
  };
}

const ACK = (entitlementId: string, result: 'Success' | 'Ignored') => ({
  RequestResult: 'Success',
  UpdateResults: [
    {
      EntitlementId: entitlementId,
      CurrentBookmarkResult: { Result: result },
      StatisticsResult: { Result: result },
      StatusInfoResult: { Result: result },
    },
  ],
});

describe('KoboReadingStateService', () => {
  const bookAccessService = { assertBookAccessible: vi.fn() };
  const userBookStatusService = { autoUpdate: vi.fn() };
  const bookIdentityService = { ensureForBook: vi.fn() };
  const progressBridge = { koboBookmarkToCanonical: vi.fn(), cfiToKoboBookmark: vi.fn() };
  const settingsService = { getSettings: vi.fn() };
  const achievementEvents = { emit: vi.fn() };
  const analyticsResolver = { resolveBookFileId: vi.fn() };
  const readingSessions = { recordCumulativeSyncedSession: vi.fn() };

  function makeService(db: ReturnType<typeof makeDb>) {
    return new KoboReadingStateService(
      db as never,
      bookAccessService as never,
      userBookStatusService as never,
      bookIdentityService as never,
      progressBridge as never,
      settingsService as never,
      achievementEvents as never,
      analyticsResolver as never,
      readingSessions as never,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    bookAccessService.assertBookAccessible.mockResolvedValue(undefined);
    userBookStatusService.autoUpdate.mockResolvedValue(undefined);
    progressBridge.koboBookmarkToCanonical.mockResolvedValue(null);
    progressBridge.cfiToKoboBookmark.mockResolvedValue(null);
    settingsService.getSettings.mockResolvedValue({ twoWayProgressSync: false });
    analyticsResolver.resolveBookFileId.mockResolvedValue({ kind: 'resolved', bookFileId: 53 });
    readingSessions.recordCumulativeSyncedSession.mockResolvedValue({ kind: 'baseline' });
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

    await expect(makeService(db).upsertState(7, 99, {}, 1, 99, false, 70)).resolves.toEqual(ACK('99', 'Ignored'));
    expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
    expect(bookAccessService.assertBookAccessible).not.toHaveBeenCalled();
  });

  // The device leaves a pushed state pending until every section is acknowledged, and treats its
  // own pending copy as authoritative meanwhile: it re-pushes each sync and opens the book at its
  // local bookmark whatever the pull path delivered. Returning the state object instead of the
  // acknowledgement envelope is what stranded hub progress on the device.
  it('acknowledges every section of an accepted device push', async () => {
    const db = makeDb();
    db.insert.mockReturnValue(makeInsertChain());
    db.query.books.findFirst.mockResolvedValue({ id: 12 });
    db.query.koboReadingStates.findFirst.mockResolvedValue(null);

    await expect(
      makeService(db).upsertState(3, 12, { CurrentBookmark: { LastModified: '2026-01-02T00:00:00.000Z', ProgressPercent: 42 } }, 1, 99, false, 30),
    ).resolves.toEqual(ACK('entitlement-12', 'Success'));
  });

  it('answers a device push without reading the stored state back', async () => {
    const db = makeDb();
    db.insert.mockReturnValue(makeInsertChain());
    db.query.books.findFirst.mockResolvedValue({ id: 12 });
    db.query.koboReadingStates.findFirst.mockResolvedValue(null);

    await makeService(db).upsertState(3, 12, { CurrentBookmark: { LastModified: '2026-01-02T00:00:00.000Z', ProgressPercent: 42 } }, 1, 99, true, 30);

    expect(db.query.koboReadingStates.findFirst).toHaveBeenCalledTimes(1);
    expect(settingsService.getSettings).not.toHaveBeenCalled();
    expect(progressBridge.cfiToKoboBookmark).not.toHaveBeenCalled();
  });

  it('merges reading state sub-objects by LastModified before storing', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 12 });
    db.query.koboReadingStates.findFirst.mockResolvedValue({
      currentBookmark: { LastModified: '2026-01-02T00:00:00.000Z', ProgressPercent: 34 },
      statistics: { LastModified: '2026-01-01T00:00:00.000Z', Value: 1 },
      statusInfo: { LastModified: '2026-01-01T00:00:00.000Z', Status: 'Reading' },
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
      30,
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
    expect(result).toEqual(ACK('entitlement-12', 'Success'));
  });

  it('does not regress envelope timestamps below a newer hub-refreshed bookmark on device re-push', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 12 });
    db.query.koboReadingStates.findFirst.mockResolvedValue({
      lastModifiedKobo: '2026-06-11T15:49:30.355Z',
      priorityTimestamp: '2026-06-11T15:49:30.355Z',
      currentBookmark: {
        LastModified: '2026-06-11T15:49:30.355Z',
        ProgressPercent: 84.94,
        Location: { Source: 'index_split_012.html', Type: 'KoboSpan', Value: 'kobo.1.1' },
      },
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
      30,
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
    expect(db.select).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
    expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
    expect(achievementEvents.emit).not.toHaveBeenCalled();
  });

  it('does not repeat bookmark or status side effects for an identical device echo', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    const bookmark = { LastModified: '2026-01-02T00:00:00.000Z', ProgressPercent: 42 };
    const statistics = { LastModified: '2026-01-02T00:00:00.000Z', SpentReadingMinutes: 5 };
    const statusInfo = { LastModified: '2026-01-02T00:00:00.000Z', Status: 'Reading' };
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 12 });
    db.query.koboReadingStates.findFirst.mockResolvedValue({
      entitlementId: 'entitlement-12',
      createdAtKobo: '2026-01-01T00:00:00.000Z',
      lastModifiedKobo: '2026-01-02T00:00:00.000Z',
      priorityTimestamp: '2026-01-02T00:00:00.000Z',
      currentBookmark: bookmark,
      statistics,
      statusInfo,
    });

    await makeService(db).upsertState(
      3,
      12,
      {
        LastModified: '2026-01-02T00:00:00.000Z',
        PriorityTimestamp: '2026-01-02T00:00:00.000Z',
        CurrentBookmark: { ...bookmark },
        Statistics: { ...statistics },
        StatusInfo: { ...statusInfo },
      },
      1,
      99,
      true,
      30,
    );

    expect(db.execute).not.toHaveBeenCalled();
    expect(readingSessions.recordCumulativeSyncedSession).toHaveBeenCalledWith(expect.objectContaining({ counter: 5, sourceDeviceKey: '30' }));
    expect(progressBridge.koboBookmarkToCanonical).not.toHaveBeenCalled();
    expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
    expect(achievementEvents.emit).not.toHaveBeenCalled();
  });

  it('does not propagate a stale lower-progress echo or treat it as reread evidence', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    const currentBookmark = { LastModified: '2026-01-02T00:00:00.000Z', ProgressPercent: 84.94 };
    const currentStatus = { LastModified: '2026-01-02T00:00:00.000Z', Status: 'Reading', TimesStartedReading: 2 };
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 12 });
    db.query.koboReadingStates.findFirst.mockResolvedValue({
      entitlementId: 'entitlement-12',
      lastModifiedKobo: '2026-01-02T00:00:00.000Z',
      priorityTimestamp: '2026-01-02T00:00:00.000Z',
      currentBookmark,
      statistics: null,
      statusInfo: currentStatus,
    });

    await makeService(db).upsertState(
      3,
      12,
      {
        LastModified: '2026-01-01T00:00:00.000Z',
        CurrentBookmark: { LastModified: '2026-01-01T00:00:00.000Z', ProgressPercent: 21 },
        StatusInfo: { LastModified: '2026-01-01T00:00:00.000Z', Status: 'Reading', TimesStartedReading: 1 },
      },
      1,
      99,
      true,
      30,
    );

    expect(stateInsert.values).toHaveBeenCalledWith(expect.objectContaining({ currentBookmark, statusInfo: currentStatus }));
    expect(db.execute).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
    expect(achievementEvents.emit).not.toHaveBeenCalled();
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
    db.query.koboReadingStates.findFirst.mockResolvedValue(null);

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
      77,
    );

    expect(userBookStatusService.autoUpdate).toHaveBeenCalledWith(
      1,
      5,
      42.5,
      1,
      99,
      expect.objectContaining({ origin: 'kobo', strongRereadEvidence: false }),
    );
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
    db.query.koboReadingStates.findFirst.mockResolvedValue(null);

    await makeService(db).upsertState(
      1,
      5,
      { CurrentBookmark: { LastModified: '2026-01-01T00:00:00Z', ContentSourceProgressPercent: 75 } },
      1,
      99,
      true,
      77,
    );

    expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('mirrors Kobo percent to internal progress when two-way sync is disabled', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    const progressInsert = makeInsertChain();
    db.insert.mockReturnValueOnce(stateInsert).mockReturnValueOnce(progressInsert);
    db.select
      .mockReturnValueOnce(makeSelectChain([{ fileId: 55 }]))
      .mockReturnValueOnce(makeSelectChain([{ percentage: 20, cfi: null, updatedAt: new Date('2025-12-31T00:00:00.000Z') }]));
    db.query.books.findFirst.mockResolvedValue({ id: 5 });
    db.query.koboReadingStates.findFirst.mockResolvedValue(null);

    await makeService(db).upsertState(
      1,
      5,
      {
        CurrentBookmark: {
          LastModified: '2026-01-01T00:00:00Z',
          ProgressPercent: 42.5,
          Location: { Source: 'OEBPS/html/ch5.xhtml', Type: 'KoboSpan', Value: 'kobo.25.1' },
        },
      },
      1,
      99,
      false,
      77,
    );

    expect(userBookStatusService.autoUpdate).toHaveBeenCalledWith(
      1,
      5,
      42.5,
      1,
      99,
      expect.objectContaining({ origin: 'kobo', strongRereadEvidence: false }),
    );
    expect(progressBridge.koboBookmarkToCanonical).not.toHaveBeenCalled();
    expect(progressInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        bookFileId: 55,
        percentage: 42.5,
        cfi: null,
        koboLocationSource: 'OEBPS/html/ch5.xhtml',
        koboLocationType: 'KoboSpan',
        koboLocationValue: 'kobo.25.1',
      }),
    );
    expect(db.execute).not.toHaveBeenCalled();
    expect(achievementEvents.emit).toHaveBeenCalledWith(
      ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED,
      expect.objectContaining({ userId: 1, bookId: 5, progress: 42.5, source: 'kobo' }),
    );
    expect(achievementEvents.emit.mock.invocationCallOrder[0]!).toBeGreaterThan(userBookStatusService.autoUpdate.mock.invocationCallOrder[0]!);
  });

  it('does not fail the Kobo progress update when auto status update fails', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 5 });
    db.query.koboReadingStates.findFirst.mockResolvedValue(null);
    userBookStatusService.autoUpdate.mockRejectedValueOnce(new Error('status update failed'));

    await expect(
      makeService(db).upsertState(1, 5, { CurrentBookmark: { LastModified: '2026-01-01T00:00:00Z', ProgressPercent: 42.5 } }, 1, 99, false, 77),
    ).resolves.toEqual(ACK('entitlement-5', 'Success'));

    expect(userBookStatusService.autoUpdate).toHaveBeenCalledWith(
      1,
      5,
      42.5,
      1,
      99,
      expect.objectContaining({ origin: 'kobo', strongRereadEvidence: false }),
    );
    expect(achievementEvents.emit).toHaveBeenCalledWith(
      ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED,
      expect.objectContaining({ userId: 1, bookId: 5, progress: 42.5, source: 'kobo' }),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[kobo.reading_state_status_update] [fail] userId=1 bookId=5'));
    warnSpy.mockRestore();
  });

  it('does not replace newer internal CFI progress with stale Kobo percent', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    db.select
      .mockReturnValueOnce(makeSelectChain([{ fileId: 60 }]))
      .mockReturnValueOnce(makeSelectChain([{ percentage: 70, cfi: 'epubcfi(/6/2)', updatedAt: new Date('2026-01-02T00:00:00.000Z') }]));
    db.query.books.findFirst.mockResolvedValue({ id: 6 });
    db.query.koboReadingStates.findFirst.mockResolvedValue(null);

    await makeService(db).upsertState(1, 6, { CurrentBookmark: { LastModified: '2026-01-01T00:00:00.000Z', ProgressPercent: 60 } }, 1, 99, true, 77);

    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('does not call autoUpdate when bookmark has no percent', async () => {
    const db = makeDb();
    const stateInsert = makeInsertChain();
    db.insert.mockReturnValue(stateInsert);
    db.query.books.findFirst.mockResolvedValue({ id: 7 });
    db.query.koboReadingStates.findFirst.mockResolvedValue(null);

    await makeService(db).upsertState(2, 7, { Statistics: { LastModified: '2026-01-01T00:00:00Z' } }, 1, 99, false, 77);

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

  describe('getRawState hub bookmark refresh', () => {
    const storedState = {
      entitlementId: '44',
      createdAtKobo: '2026-08-01T00:00:00.000Z',
      lastModifiedKobo: '2026-08-16T12:00:00.000Z',
      priorityTimestamp: '2026-08-16T12:00:00.000Z',
      currentBookmark: {
        LastModified: '2026-08-16T12:00:00.000Z',
        ProgressPercent: 43,
        Location: { Source: 'OEBPS/ch2.xhtml', Type: 'KoboSpan', Value: 'kobo.9.1' },
      },
      statistics: { Value: 1 },
      statusInfo: { Status: 'Reading' },
    };

    function makeRefreshableDb(state: Record<string, unknown> = storedState) {
      const db = makeDb();
      const updateChain = makeUpdateChain();
      db.update = vi.fn(() => updateChain) as never;
      db.query.books.findFirst.mockResolvedValue({ id: 44 });
      db.query.koboReadingStates.findFirst.mockResolvedValue(state);
      db.select
        .mockReturnValueOnce(makeSelectChain([{ fileId: 55 }]))
        .mockReturnValueOnce(makeSelectChain([{ cfi: 'epubcfi(/6/8!/4/2/2/1:0)', percentage: 79, koboLocationValue: null }]));
      settingsService.getSettings.mockResolvedValue({ twoWayProgressSync: true });
      progressBridge.cfiToKoboBookmark.mockResolvedValue({ source: 'OEBPS/ch7.xhtml', value: 'kobo.31.1', contentSourceProgressPercent: 12.5 });
      return { db, updateChain };
    }

    it('replaces the device Location with one computed from the hub position', async () => {
      const { db, updateChain } = makeRefreshableDb();

      const state = (await makeService(db).getRawState(1, 44)) as Record<string, Record<string, unknown>>;

      expect(state.CurrentBookmark).toMatchObject({
        ProgressPercent: 79,
        ContentSourceProgressPercent: 12.5,
        Location: { Source: 'OEBPS/ch7.xhtml', Type: 'KoboSpan', Value: 'kobo.31.1' },
      });
      expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ currentBookmark: state.CurrentBookmark }));
    });

    // A Kobo clock running ahead is stored verbatim on the device push. Stamping the refresh at
    // wall-clock time would land it behind that, and the device keeps its own bookmark on open.
    it('stamps the refreshed bookmark past a device timestamp in the future', async () => {
      const future = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
      const { db, updateChain } = makeRefreshableDb({
        ...storedState,
        lastModifiedKobo: future,
        priorityTimestamp: future,
        currentBookmark: { ...storedState.currentBookmark, LastModified: future },
      });

      const state = (await makeService(db).getRawState(1, 44)) as Record<string, string | Record<string, unknown>>;

      const futureMs = new Date(future).getTime();
      expect(new Date(state.LastModified as string).getTime()).toBeGreaterThan(futureMs);
      expect(new Date(state.PriorityTimestamp as string).getTime()).toBeGreaterThan(futureMs);
      expect(new Date((state.CurrentBookmark as Record<string, string>).LastModified).getTime()).toBeGreaterThan(futureMs);
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ lastModifiedKobo: state.LastModified, priorityTimestamp: state.LastModified }),
      );
    });

    it('serves the stored bookmark and warns when the refresh throws', async () => {
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { db } = makeRefreshableDb();
      settingsService.getSettings.mockRejectedValue(new Error('settings unavailable'));

      await expect(makeService(db).getRawState(1, 44)).resolves.toMatchObject({
        LastModified: '2026-08-16T12:00:00.000Z',
        CurrentBookmark: storedState.currentBookmark,
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[kobo.reading_state_refresh] [fail] userId=1 bookId=44'));
      warnSpy.mockRestore();
    });

    it('leaves the stored bookmark alone while a device-originated location owns the position', async () => {
      const db = makeDb();
      const updateChain = makeUpdateChain();
      db.update = vi.fn(() => updateChain) as never;
      db.query.books.findFirst.mockResolvedValue({ id: 44 });
      db.query.koboReadingStates.findFirst.mockResolvedValue(storedState);
      db.select
        .mockReturnValueOnce(makeSelectChain([{ fileId: 55 }]))
        .mockReturnValueOnce(makeSelectChain([{ cfi: 'epubcfi(/6/8!/4/2/2/1:0)', percentage: 43, koboLocationValue: 'kobo.9.1' }]));
      settingsService.getSettings.mockResolvedValue({ twoWayProgressSync: true });

      await expect(makeService(db).getRawState(1, 44)).resolves.toMatchObject({ CurrentBookmark: storedState.currentBookmark });
      expect(progressBridge.cfiToKoboBookmark).not.toHaveBeenCalled();
      expect(updateChain.set).not.toHaveBeenCalled();
    });
  });

  it('getRawState returns null for missing legacy book ids without checking access', async () => {
    const db = makeDb();
    db.query.books.findFirst.mockResolvedValue(null);

    await expect(makeService(db).getRawState(1, 1219)).resolves.toBeNull();

    expect(bookAccessService.assertBookAccessible).not.toHaveBeenCalled();
    expect(db.query.koboReadingStates.findFirst).not.toHaveBeenCalled();
  });

  // Recording which Location a bookmark maps to is bookkeeping, not reading, so it must not
  // count as a read event. lastReadAt advances by default, so this path has to opt out.
  it('leaves both timestamps untouched when stamping a bookmark location', async () => {
    const { db, queries } = createCapturingDb();
    const service = makeService(db as never);

    await (
      service as unknown as {
        stampProgressLocation: (
          userId: number,
          fileId: number,
          point: { source: string; value: string; contentSourceProgressPercent: number | null },
        ) => Promise<void>;
      }
    ).stampProgressLocation(7, 44, { source: 'OEBPS/ch1.xhtml', value: 'kobo.3.1', contentSourceProgressPercent: 12 });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain('"updated_at" = "reading_progress"."updated_at"');
    expect(queries[0]!.sql).toContain('"last_read_at" = "reading_progress"."last_read_at"');
  });
  describe('reading sessions derived from device reading time', () => {
    const STATS_AT = '2026-08-20T19:30:00.000Z';

    function makeStatsDb(previousStatistics: unknown, settings?: unknown) {
      const db = makeDb();
      db.insert.mockReturnValue(makeInsertChain());
      db.query.books.findFirst.mockResolvedValue({ id: 46 });
      db.query.koboReadingStates.findFirst.mockResolvedValue(previousStatistics === undefined ? null : { statistics: previousStatistics });
      db.select.mockImplementation((columns: Record<string, unknown>) => {
        const selection = Object.keys(columns ?? {}).join(',');
        if (selection === 'settings') return makeSelectChain(settings === undefined ? [] : [{ settings }]);
        return makeSelectChain([]);
      });
      return db;
    }

    function push(db: ReturnType<typeof makeDb>, statistics: Record<string, unknown>, extra: Record<string, unknown> = {}) {
      return makeService(db).upsertState(7, 46, { Statistics: statistics, ...extra }, 1, 99, false, 30);
    }

    it('passes the raw device counter to the per-device transactional recorder', async () => {
      const db = makeStatsDb({ SpentReadingMinutes: 800 });

      await push(db, { LastModified: STATS_AT, SpentReadingMinutes: 860 });

      expect(readingSessions.recordCumulativeSyncedSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 7,
          bookId: 46,
          bookFileId: 53,
          cursorSource: 'kobo-statistics',
          sourceDeviceKey: '30',
          sessionIdPrefix: 'kst:30:',
          counter: 860,
          endedAt: new Date(STATS_AT),
          source: 'kobo',
        }),
      );
    });

    it('processes an identical global state so a second device can establish its own cursor', async () => {
      const statistics = { LastModified: STATS_AT, SpentReadingMinutes: 860 };
      const db = makeStatsDb(statistics);

      await push(db, { ...statistics });

      expect(readingSessions.recordCumulativeSyncedSession).toHaveBeenCalledWith(expect.objectContaining({ sourceDeviceKey: '30', counter: 860 }));
    });

    it('keeps the cursor retryable when the file cannot currently be resolved', async () => {
      const db = makeStatsDb({ SpentReadingMinutes: 800 });
      analyticsResolver.resolveBookFileId.mockResolvedValue({ kind: 'skipped', reason: 'no_epub_file' });

      await push(db, { LastModified: STATS_AT, SpentReadingMinutes: 860 });

      expect(readingSessions.recordCumulativeSyncedSession).toHaveBeenCalledWith(expect.objectContaining({ bookFileId: null, counter: 860 }));
    });

    it('carries progress and the reporting user timezone', async () => {
      const db = makeStatsDb({ SpentReadingMinutes: 800 }, { timezone: 'Europe/Oslo' });
      db.query.koboReadingStates.findFirst.mockResolvedValue({
        statistics: { SpentReadingMinutes: 800 },
        currentBookmark: { LastModified: '2026-08-19T10:00:00.000Z', ProgressPercent: 22 },
      });

      await push(db, { LastModified: STATS_AT, SpentReadingMinutes: 860 }, { CurrentBookmark: { LastModified: STATS_AT, ProgressPercent: 29 } });

      expect(readingSessions.recordCumulativeSyncedSession).toHaveBeenCalledWith(
        expect.objectContaining({ progressDelta: 7, endProgress: 29, timeZone: 'Europe/Oslo' }),
      );
    });

    it('holds a device clock running ahead to the present', async () => {
      const db = makeStatsDb({ SpentReadingMinutes: 800 });
      const before = Date.now();

      await push(db, { LastModified: '2099-01-01T00:00:00.000Z', SpentReadingMinutes: 860 });

      const call = readingSessions.recordCumulativeSyncedSession.mock.calls[0]![0] as { endedAt: Date };
      expect(call.endedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(call.endedAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('rejects a counter too large for the reading-session duration column', async () => {
      const db = makeStatsDb({ SpentReadingMinutes: 1 });

      await push(db, { LastModified: STATS_AT, SpentReadingMinutes: 40_000_000 });

      expect(readingSessions.recordCumulativeSyncedSession).not.toHaveBeenCalled();
    });

    it('still acknowledges the push when transactional accounting fails', async () => {
      const db = makeStatsDb({ SpentReadingMinutes: 800 });
      readingSessions.recordCumulativeSyncedSession.mockRejectedValue(new Error('database is down'));
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(push(db, { LastModified: STATS_AT, SpentReadingMinutes: 860 })).resolves.toEqual(ACK('entitlement-46', 'Success'));

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[kobo.statistics_session] [fail]'));
      warn.mockRestore();
    });
  });
});
