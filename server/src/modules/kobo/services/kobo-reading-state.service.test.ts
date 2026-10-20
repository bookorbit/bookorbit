import { Logger } from '@nestjs/common';

import * as schema from '../../../db/schema';
import { KoboReadingProgressRepository } from '../kobo-reading-progress.repository';
import { KoboReadingStateService } from './kobo-reading-state.service';
import { createCapturingDb } from '../../../common/test-utils/capture-sql-db';
import { ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED } from '../../achievement/achievement-events.service';

function makeInsertChain() {
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) });
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
  const readingStates = { findFirst: vi.fn() };
  const deviceStates = { findFirst: vi.fn((...args) => readingStates.findFirst(...args)) };
  return {
    query: {
      books: { findFirst: vi.fn() },
      koboLibrarySnapshots: { findFirst: vi.fn() },
      koboReadingStates: readingStates,
      koboDeviceReadingStates: deviceStates,
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
  const progressBridge = {
    koboBookmarkToCanonical: vi.fn(),
    cfiToKoboBookmark: vi.fn(),
    narrationToKoboBookmark: vi.fn(),
    comparePositions: vi.fn(),
  };
  const settingsService = { getSettings: vi.fn() };
  const achievementEvents = { emit: vi.fn() };
  const analyticsResolver = { resolveBookFileId: vi.fn() };
  const readingSessions = { recordCumulativeSyncedSession: vi.fn() };
  const bookService = { syncAudioProgressForExternalEbookProgress: vi.fn() };
  const knownPositions = {
    find: vi.fn<KoboReadingProgressRepository['findKnownPosition']>(),
    record: vi.fn<KoboReadingProgressRepository['recordKnownPosition']>(),
  };
  const finishThreshold = vi.fn<KoboReadingProgressRepository['findFinishThreshold']>();

  function makeService(db: ReturnType<typeof makeDb>, deliveries?: { current: ReturnType<typeof vi.fn> }) {
    const progressRepository = new KoboReadingProgressRepository(db as never);
    vi.spyOn(progressRepository, 'findKnownPosition').mockImplementation(knownPositions.find);
    vi.spyOn(progressRepository, 'recordKnownPosition').mockImplementation(knownPositions.record);
    vi.spyOn(progressRepository, 'findFinishThreshold').mockImplementation(finishThreshold);
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
      bookService as never,
      progressRepository,
      deliveries as never,
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
    bookService.syncAudioProgressForExternalEbookProgress.mockResolvedValue(undefined);
    knownPositions.find.mockResolvedValue(null);
    knownPositions.record.mockResolvedValue(undefined);
    finishThreshold.mockResolvedValue(null);
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

    expect(db.query.koboReadingStates.findFirst).toHaveBeenCalledTimes(2);
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
    db.insert.mockReturnValueOnce(progressInsert).mockReturnValueOnce(stateInsert).mockReturnValueOnce(stateInsert);
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
    // Issue #1458: the activity instant travels intact so the day is resolved on the reader's
    // calendar downstream, rather than being pre-truncated to a UTC date key here.
    const koboActivity = userBookStatusService.autoUpdate.mock.calls[0]![5] as { occurredAt: Date; timeZone: string };
    expect(koboActivity.occurredAt).toBeInstanceOf(Date);
    expect(Number.isNaN(koboActivity.occurredAt.getTime())).toBe(false);
    expect(typeof koboActivity.timeZone).toBe('string');
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
        // A page turn on the Kobo is a text move; clients compare it with the narration stamp.
        textUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(bookService.syncAudioProgressForExternalEbookProgress).toHaveBeenCalledWith(1, 5, 55, 42.5, {
      cfi: null,
      koreaderProgress: null,
      sourceUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
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
    db.insert.mockReturnValueOnce(progressInsert).mockReturnValueOnce(stateInsert).mockReturnValueOnce(stateInsert);
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

    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(bookService.syncAudioProgressForExternalEbookProgress).not.toHaveBeenCalled();
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

  // A Kobo pushes its bookmark back whenever the book is closed, restamped with the close whether
  // or not a page turned. The place it was sent at a reread came back stamped after the phone that
  // finished the book meanwhile, so the finish was undone and the echo opened another read.
  describe('a Kobo returning the place it already held', () => {
    const sent = { locationSource: 'OEBPS/ch1.xhtml', locationValue: 'kobo.1.1', positionSetAt: new Date('2026-10-17T19:49:45.000Z') };
    const finishedOnKobo = {
      entitlementId: '44',
      lastModifiedKobo: '2026-10-17T18:16:41Z',
      currentBookmark: {
        LastModified: '2026-10-17T18:16:41Z',
        ProgressPercent: 100,
        Location: { Source: 'OEBPS/titlepage.xhtml', Type: 'KoboSpan', Value: 'kobo.1.1' },
      },
      statusInfo: { Status: 'Finished', LastModified: '2026-10-17T18:16:41Z' },
    };
    const pushAt = (value: string) => ({
      CurrentBookmark: {
        LastModified: '2026-10-17T19:54:46Z',
        ProgressPercent: 2,
        Location: { Source: 'OEBPS/ch1.xhtml', Type: 'KoboSpan', Value: value },
      },
      StatusInfo: { Status: 'Reading', LastModified: '2026-10-17T19:54:46Z' },
    });
    const hubSetAt = (at: string) => ({
      cfi: 'epubcfi(/6/34!/4/52/2[s161]/1:0)',
      percentage: 99.87,
      textUpdatedAt: new Date(at),
      narrationUpdatedAt: new Date(at),
      updatedAt: new Date(at),
    });

    function makeDbWithHub(hub: Record<string, unknown>, lookups: number) {
      const db = makeDb();
      db.query.books.findFirst.mockResolvedValue({ id: 44 });
      db.query.koboDeviceReadingStates.findFirst.mockResolvedValue(finishedOnKobo);
      db.query.koboReadingStates.findFirst.mockResolvedValue(null);
      for (let i = 0; i < lookups; i++) {
        db.select.mockReturnValueOnce(makeSelectChain([{ fileId: 55 }])).mockReturnValueOnce(makeSelectChain([hub]));
      }
      db.insert.mockImplementation(() => makeInsertChain());
      return db;
    }

    it('keeps the place another device reached since, and opens no new read', async () => {
      knownPositions.find.mockResolvedValue(sent);
      const db = makeDbWithHub(hubSetAt('2026-10-17T19:53:34.000Z'), 1);

      await makeService(db).upsertState(1, 44, pushAt('kobo.1.1'), 1, 98, true, 77);

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(db.insert).toHaveBeenCalledWith(schema.koboDeviceReadingStates);
      expect(bookService.syncAudioProgressForExternalEbookProgress).not.toHaveBeenCalled();
      expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
      expect(knownPositions.record).not.toHaveBeenCalled();
      // So the Kobo is sent the newer place on its next sync.
      expect(db.execute).toHaveBeenCalled();
    });

    // A Kobo fetches the newer place before it delivers a close made earlier, so the place sent was
    // already the new one when the untouched page it had pushed before came back with the close.
    it('keeps the place reached elsewhere when the Kobo repeats its own last push after fetching it', async () => {
      knownPositions.find.mockResolvedValue({
        locationSource: 'OEBPS/ch17.xhtml',
        locationValue: 'kobo.26.1',
        positionSetAt: new Date('2026-10-17T20:55:09.000Z'),
      });
      const db = makeDbWithHub(hubSetAt('2026-10-17T20:55:09.000Z'), 1);
      db.query.koboDeviceReadingStates.findFirst.mockResolvedValue({
        ...finishedOnKobo,
        lastModifiedKobo: '2026-10-17T20:54:30Z',
        currentBookmark: {
          LastModified: '2026-10-17T20:54:30Z',
          ProgressPercent: 2,
          Location: { Source: 'OEBPS/ch1.xhtml', Type: 'KoboSpan', Value: 'kobo.1.1' },
        },
        statusInfo: { Status: 'Reading', LastModified: '2026-10-17T20:54:30Z' },
      });
      const closed = pushAt('kobo.1.1');
      closed.CurrentBookmark.LastModified = '2026-10-17T20:57:55Z';

      await makeService(db).upsertState(1, 44, closed, 1, 98, true, 77);

      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(db.insert).toHaveBeenCalledWith(schema.koboDeviceReadingStates);
      expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
    });

    it('takes the place when nothing moved the book since it was sent', async () => {
      knownPositions.find.mockResolvedValue(sent);
      const db = makeDbWithHub(hubSetAt('2026-10-17T19:40:00.000Z'), 2);

      await makeService(db).upsertState(1, 44, pushAt('kobo.1.1'), 1, 98, true, 77);

      expect(db.insert).toHaveBeenCalledWith(schema.readingProgress);
      expect(userBookStatusService.autoUpdate).toHaveBeenCalledWith(1, 44, 2, 1, 98, expect.anything());
      expect(knownPositions.record).toHaveBeenCalledWith(1, 77, 44, {
        locationSource: 'OEBPS/ch1.xhtml',
        locationValue: 'kobo.1.1',
        positionSetAt: new Date('2026-10-17T19:54:46Z'),
      });
    });

    it('takes a place the Kobo moved to, newest first as before', async () => {
      knownPositions.find.mockResolvedValue(sent);
      const db = makeDbWithHub(hubSetAt('2026-10-17T19:53:34.000Z'), 1);

      await makeService(db).upsertState(1, 44, pushAt('kobo.40.1'), 1, 98, true, 77);

      expect(db.insert).toHaveBeenCalledWith(schema.readingProgress);
      expect(knownPositions.record).toHaveBeenCalledWith(1, 77, 44, expect.objectContaining({ locationValue: 'kobo.40.1' }));
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

    it('includes native KEPUB in the scoped primary-file lookup for hub bookmark delivery', async () => {
      const { db } = makeRefreshableDb();
      const capture = createCapturingDb();
      db.select = capture.db.select.bind(capture.db) as never;
      await makeService(db).getRawState(1, 44);
      expect(capture.queries).toHaveLength(1);
      expect(capture.queries[0]!.params).toEqual([44, 'epub', 'kepub', 1]);
    });

    it('finishes the book on the Kobo when another reader carried it to the end', async () => {
      const db = makeDb();
      db.update = vi.fn(() => makeUpdateChain()) as never;
      db.query.books.findFirst.mockResolvedValue({ id: 44 });
      db.query.koboReadingStates.findFirst.mockResolvedValue(storedState);
      db.select
        .mockReturnValueOnce(makeSelectChain([{ fileId: 55 }]))
        .mockReturnValueOnce(makeSelectChain([{ cfi: 'epubcfi(/6/142!/4/2/2/2[next-reads_img])', percentage: 100, koboLocationValue: null }]));
      settingsService.getSettings.mockResolvedValue({ twoWayProgressSync: true });
      progressBridge.cfiToKoboBookmark.mockResolvedValue({ source: 'OEBPS/next-reads.xhtml', value: 'kobo.1.1', contentSourceProgressPercent: 0 });

      const state = (await makeService(db).getRawState(1, 44)) as Record<string, Record<string, unknown>>;

      expect(state.StatusInfo).toMatchObject({ Status: 'Finished' });
      expect(state.CurrentBookmark).toMatchObject({ ProgressPercent: 100, Location: { Source: 'OEBPS/next-reads.xhtml', Value: 'kobo.1.1' } });
    });

    it('leaves a book that is still being read as Reading', async () => {
      const { db } = makeRefreshableDb();

      const state = (await makeService(db).getRawState(1, 44)) as Record<string, Record<string, unknown>>;

      expect(state.StatusInfo).toEqual({ Status: 'Reading' });
    });

    // A Kobo with its own row was served the status it last reported, so a book marked read in
    // BookOrbit afterwards stayed Reading on it.
    it('serves a status BookOrbit set after the Kobo last reported one', async () => {
      const db = makeDb();
      db.query.books.findFirst.mockResolvedValue({ id: 44 });
      db.query.koboDeviceReadingStates.findFirst.mockResolvedValue({
        ...storedState,
        statusInfo: { Status: 'Reading', LastModified: '2026-10-17T20:12:35Z', TimesStartedReading: 1 },
      });
      db.query.koboReadingStates.findFirst.mockResolvedValue({ statusInfo: { Status: 'Finished', LastModified: '2026-10-17T20:26:17.150Z' } });

      const state = (await makeService(db).getRawState(1, 44, 77)) as Record<string, Record<string, unknown>>;

      expect(state.StatusInfo).toEqual({ Status: 'Finished', LastModified: '2026-10-17T20:26:17.150Z', TimesStartedReading: 1 });
    });

    it('keeps a status the Kobo reported after the one BookOrbit set', async () => {
      const db = makeDb();
      db.query.books.findFirst.mockResolvedValue({ id: 44 });
      db.query.koboDeviceReadingStates.findFirst.mockResolvedValue({
        ...storedState,
        statusInfo: { Status: 'Finished', LastModified: '2026-10-17T20:30:00Z' },
      });
      db.query.koboReadingStates.findFirst.mockResolvedValue({ statusInfo: { Status: 'Reading', LastModified: '2026-10-17T20:26:17.150Z' } });

      const state = (await makeService(db).getRawState(1, 44, 77)) as Record<string, Record<string, unknown>>;

      expect(state.StatusInfo).toEqual({ Status: 'Finished', LastModified: '2026-10-17T20:30:00Z' });
    });

    // A read-along ends on its last sentence, short of 100%. BookOrbit called the book read by the
    // library's finish mark, while the Kobo, finished only at 100%, kept it as Reading.
    it('finishes the book on the Kobo once another device carried it past the library finish mark', async () => {
      const db = makeDb();
      db.update = vi.fn(() => makeUpdateChain()) as never;
      db.query.books.findFirst.mockResolvedValue({ id: 44 });
      db.query.koboDeviceReadingStates.findFirst.mockResolvedValue(storedState);
      db.select
        .mockReturnValueOnce(makeSelectChain([{ fileId: 55 }]))
        .mockReturnValueOnce(makeSelectChain([{ cfi: 'epubcfi(/6/34!/4/52/2[s161]/1:0)', percentage: 99.89, koboLocationValue: null }]));
      settingsService.getSettings.mockResolvedValue({ twoWayProgressSync: true });
      progressBridge.cfiToKoboBookmark.mockResolvedValue({ source: 'OEBPS/ch17.xhtml', value: 'kobo.26.1', contentSourceProgressPercent: 99.8 });
      finishThreshold.mockResolvedValue(98);

      const state = (await makeService(db).getRawState(1, 44, 77)) as Record<string, Record<string, unknown>>;

      expect(state.StatusInfo).toMatchObject({ Status: 'Finished', LastModified: state.LastModified });
      expect(state.CurrentBookmark).toMatchObject({ ProgressPercent: 99.89, Location: { Value: 'kobo.26.1' } });
    });

    it('keeps a book short of the library finish mark as Reading', async () => {
      const { db } = makeRefreshableDb();
      finishThreshold.mockResolvedValue(98);

      const state = (await makeService(db).getRawState(1, 44)) as Record<string, Record<string, unknown>>;

      expect(state.StatusInfo).toEqual({ Status: 'Reading' });
      expect(finishThreshold).toHaveBeenCalledWith(44);
    });

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

    it('places a read-along narration marker on the device when the saved progress has no text position', async () => {
      const db = makeDb();
      db.update = vi.fn(() => makeUpdateChain()) as never;
      db.query.books.findFirst.mockResolvedValue({ id: 44 });
      db.query.koboReadingStates.findFirst.mockResolvedValue(storedState);
      db.select
        .mockReturnValueOnce(makeSelectChain([{ fileId: 55 }]))
        .mockReturnValueOnce(
          makeSelectChain([
            { cfi: null, percentage: 70, koboLocationValue: null, mediaOverlayFragment: 'OEBPS/ch6.xhtml#s161', mediaOverlaySectionIndex: 9 },
          ]),
        );
      settingsService.getSettings.mockResolvedValue({ twoWayProgressSync: true });
      progressBridge.narrationToKoboBookmark.mockResolvedValue({ source: 'OEBPS/ch6.xhtml', value: 'kobo.43.3', contentSourceProgressPercent: 61.9 });

      const state = (await makeService(db).getRawState(1, 44)) as Record<string, Record<string, unknown>>;

      expect(progressBridge.narrationToKoboBookmark).toHaveBeenCalledWith(
        1,
        44,
        55,
        { fragment: 'OEBPS/ch6.xhtml#s161', sectionIndex: 9 },
        undefined,
      );
      expect(progressBridge.cfiToKoboBookmark).not.toHaveBeenCalled();
      expect(state.CurrentBookmark).toMatchObject({
        ProgressPercent: 70,
        ContentSourceProgressPercent: 61.9,
        Location: { Source: 'OEBPS/ch6.xhtml', Type: 'KoboSpan', Value: 'kobo.43.3' },
      });
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

    // A Kobo told to follow the hub fetches the bookmark again before it pushes. A request-time
    // stamp was newer on every fetch, so it asked to follow again, without end.
    it('serves an unmoved hub position to a device with the same stamp on every fetch', async () => {
      const db = makeDb();
      db.query.books.findFirst.mockResolvedValue({ id: 44 });
      db.query.koboDeviceReadingStates.findFirst.mockResolvedValue(storedState);
      let call = 0;
      db.select.mockImplementation(() =>
        makeSelectChain(
          ++call % 2 === 1
            ? [{ fileId: 55 }]
            : [
                {
                  cfi: 'epubcfi(/6/8!/4/2/2/1:0)',
                  percentage: 79,
                  koboLocationValue: null,
                  textUpdatedAt: new Date('2026-08-17T09:30:00.000Z'),
                  updatedAt: new Date('2026-08-17T10:15:00.000Z'),
                },
              ],
        ),
      );
      settingsService.getSettings.mockResolvedValue({ twoWayProgressSync: true });
      progressBridge.cfiToKoboBookmark.mockResolvedValue({ source: 'OEBPS/ch7.xhtml', value: 'kobo.31.1', contentSourceProgressPercent: 12.5 });
      const service = makeService(db);

      const first = (await service.getRawState(1, 44, 77)) as Record<string, string | Record<string, unknown>>;
      const second = (await service.getRawState(1, 44, 77)) as Record<string, string | Record<string, unknown>>;

      expect(first.CurrentBookmark).toMatchObject({ LastModified: '2026-08-17T09:30:00.000Z', Location: { Value: 'kobo.31.1' } });
      expect(first.LastModified).toBe('2026-08-17T09:30:00.000Z');
      expect(second).toEqual(first);
      expect(knownPositions.record).toHaveBeenCalledWith(1, 77, 44, {
        locationSource: 'OEBPS/ch7.xhtml',
        locationValue: 'kobo.31.1',
        positionSetAt: new Date('2026-08-17T09:30:00.000Z'),
      });
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
    await new KoboReadingProgressRepository(db as never).stampLocation(7, 44, {
      source: 'OEBPS/ch1.xhtml',
      value: 'kobo.3.1',
      contentSourceProgressPercent: 12,
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain('"updated_at" = "reading_progress"."updated_at"');
    expect(queries[0]!.sql).toContain('"last_read_at" = "reading_progress"."last_read_at"');
  });
  describe('Storyteller delivery progress protection', () => {
    const savedCfi = 'epubcfi(/6/2!/4/2/1:3)';
    const previousAt = '2026-01-01T00:00:00Z';
    const incomingAt = '2026-01-02T00:00:00Z';
    function resetDb(percentage = 61) {
      const db = makeDb();
      const insert = makeInsertChain();
      db.insert.mockReturnValue(insert);
      db.query.books.findFirst.mockResolvedValue({ id: 5 });
      db.query.koboReadingStates.findFirst.mockResolvedValue({
        deliveryId: 'old',
        currentBookmark: { ProgressPercent: 61, LastModified: previousAt },
      });
      let call = 0;
      db.select.mockImplementation(() =>
        makeSelectChain(
          ++call % 2 === 1
            ? [{ fileId: 55 }]
            : [
                {
                  percentage,
                  cfi: savedCfi,
                  koreaderProgress: '/body/DocFragment[1]/body/p[1]/text().3',
                  updatedAt: new Date(previousAt),
                },
              ],
        ),
      );
      return { db, insert };
    }
    const resetPayload = { CurrentBookmark: { ProgressPercent: 0, LastModified: incomingAt } };
    it.each(['offered', 'transfer_observed', 'cancelled'])('retains canonical progress and raw events during %s replacement', async (state) => {
      const { db, insert } = resetDb();
      const deliveries = { current: vi.fn().mockResolvedValue({ id: 'new', previousId: 'old', state, options: { replacement: true } }) };
      await expect(makeService(db, deliveries).upsertState(1, 5, resetPayload, 1, 99, true, 77)).resolves.toEqual(ACK('entitlement-5', 'Success'));
      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(insert.values).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 77,
          deliveryId: 'old',
          currentBookmark: resetPayload.CurrentBookmark,
        }),
      );
      expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
      expect(bookService.syncAudioProgressForExternalEbookProgress).not.toHaveBeenCalled();
      expect(achievementEvents.emit).not.toHaveBeenCalled();
      expect(db.execute).toHaveBeenCalledTimes(1);
    });
    it('does not accept an initial zero echo for an unknown device copy', async () => {
      const { db } = resetDb();
      await makeService(db, { current: vi.fn().mockResolvedValue(null) }).upsertState(1, 5, resetPayload, 1, 99, true, 77);
      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
    });
    it('protects repeated initialization zero events even after the initial transfer is observed', async () => {
      const { db, insert } = resetDb();
      db.query.koboReadingStates.findFirst.mockResolvedValue({
        deliveryId: 'old',
        currentBookmark: { ProgressPercent: 0, LastModified: previousAt },
      });
      const service = makeService(db, { current: vi.fn().mockResolvedValue({ id: 'old', state: 'transfer_observed', options: {} }) });
      await service.upsertState(1, 5, resetPayload, 1, 99, true, 77);
      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 77, currentBookmark: resetPayload.CurrentBookmark }));
      settingsService.getSettings.mockResolvedValue({ twoWayProgressSync: true });
      await expect(service.getRawState(1, 5, 77)).resolves.toMatchObject({
        CurrentBookmark: { ProgressPercent: 61 },
        StatusInfo: { Status: 'Reading', TimesStartedReading: 1 },
      });
      expect(db.update).not.toHaveBeenCalled();
      await service.upsertState(1, 5, { CurrentBookmark: { ProgressPercent: 0, LastModified: '2026-01-03T00:00:00Z' } }, 1, 99, true, 77);
      expect(db.insert).toHaveBeenCalledTimes(2);
      expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
    });
    it.each([0, 20])('allows deliberate backwards reading to %s on a known unchanged copy', async (percentage) => {
      const { db, insert } = resetDb();
      await makeService(db, { current: vi.fn().mockResolvedValue({ id: 'old', state: 'transfer_observed', options: {} }) }).upsertState(
        1,
        5,
        { CurrentBookmark: { ProgressPercent: percentage, LastModified: incomingAt } },
        1,
        99,
        true,
        77,
      );
      expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 55, percentage, cfi: null }));
      expect(userBookStatusService.autoUpdate).toHaveBeenCalled();
    });
    it('keeps a device copy built from a file that stopped being primary on that file', async () => {
      const { db, insert } = resetDb();
      const queue = [[{ fileId: 55 }], [{ id: 66 }], [{ percentage: 61, cfi: savedCfi, updatedAt: new Date(previousAt) }]];
      db.select.mockImplementation(() => makeSelectChain(queue.shift() ?? []));
      await makeService(db, {
        current: vi.fn().mockResolvedValue({ id: 'old', state: 'transfer_observed', options: {}, sourceFileId: 66 }),
      }).upsertState(1, 5, { CurrentBookmark: { ProgressPercent: 70, LastModified: incomingAt } }, 1, 99, true, 77);
      expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 66, percentage: 70 }));
      expect(insert.values).not.toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 55 }));
      expect(bookService.syncAudioProgressForExternalEbookProgress).toHaveBeenCalledWith(1, 5, 66, 70, expect.anything());
    });
    it('keeps the previous copy attributable while replacement is only prepared', async () => {
      const { db, insert } = resetDb();
      await makeService(db, {
        current: vi.fn().mockResolvedValue({ id: 'new', previousId: 'old', state: 'prepared', options: { replacement: true } }),
      }).upsertState(1, 5, resetPayload, 1, 99, true, 77);
      expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 55, percentage: 0 }));
      expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 77, deliveryId: 'old' }));
    });
    it('permits a replacement to echo a deliberate reset already saved in BookOrbit', async () => {
      const { db, insert } = resetDb(0);
      await makeService(db, {
        current: vi.fn().mockResolvedValue({ id: 'new', previousId: 'old', state: 'user_confirmed', options: { replacement: true } }),
      }).upsertState(1, 5, resetPayload, 1, 99, true, 77);
      expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 55, percentage: 0, cfi: savedCfi }));
      expect(db.insert).toHaveBeenCalledTimes(3);
    });
    it('accepts forward percentage progress without decoding an ambiguous replacement location', async () => {
      const { db, insert } = resetDb();
      await makeService(db, {
        current: vi.fn().mockResolvedValue({ id: 'new', previousId: 'old', state: 'transfer_observed', options: { replacement: true } }),
      }).upsertState(
        1,
        5,
        {
          CurrentBookmark: {
            ProgressPercent: 65,
            LastModified: incomingAt,
            Location: { Type: 'KoboSpan', Source: 'chapter.xhtml', Value: 'kobo.1.1' },
          },
        },
        1,
        99,
        true,
        77,
      );
      expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 55, percentage: 65, koboLocationValue: null }));
      expect(progressBridge.koboBookmarkToCanonical).not.toHaveBeenCalled();
    });
    it('still holds saved progress against a backwards push from a confirmed replacement', async () => {
      const { db, insert } = resetDb();
      await makeService(db, {
        current: vi.fn().mockResolvedValue({ id: 'new', previousId: 'old', state: 'user_confirmed', options: { replacement: true } }),
      }).upsertState(1, 5, { CurrentBookmark: { ProgressPercent: 3, LastModified: incomingAt } }, 1, 99, true, 77);
      expect(insert.values).not.toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 55 }));
      expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 77, deliveryId: 'new' }));
      expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
    });
    it.each([
      ['accepts', 1, 58],
      ['holds back', -1, 61],
    ])('%s a confirmed replacement push whose position is later or earlier than its lower percentage suggests', async (_label, order, saved) => {
      const { db, insert } = resetDb();
      progressBridge.koboBookmarkToCanonical.mockResolvedValue({ cfi: 'epubcfi(/6/4!/4/2/1:0)', xpointer: '/body/p[2]' });
      progressBridge.comparePositions.mockReturnValue(order);
      await makeService(db, {
        current: vi.fn().mockResolvedValue({ id: 'new', previousId: 'old', state: 'user_confirmed', options: { replacement: true } }),
      }).upsertState(
        1,
        5,
        {
          CurrentBookmark: {
            ProgressPercent: 58,
            LastModified: incomingAt,
            Location: { Type: 'KoboSpan', Source: 'chapter.xhtml', Value: 'kobo.43.4' },
          },
        },
        1,
        99,
        true,
        77,
      );
      expect(progressBridge.comparePositions).toHaveBeenCalledWith('epubcfi(/6/4!/4/2/1:0)', savedCfi);
      if (saved === 58)
        expect(insert.values).toHaveBeenCalledWith(
          expect.objectContaining({ bookFileId: 55, percentage: 58, cfi: 'epubcfi(/6/4!/4/2/1:0)', koboLocationValue: 'kobo.43.4' }),
        );
      else expect(insert.values).not.toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 55 }));
    });
    it('trusts a confirmed replacement, even while the device bookmark still names the copy it replaced', async () => {
      const { db, insert } = resetDb();
      await makeService(db, {
        current: vi.fn().mockResolvedValue({ id: 'new', previousId: 'old', state: 'user_confirmed', options: { replacement: true } }),
      }).upsertState(
        1,
        5,
        {
          CurrentBookmark: {
            ProgressPercent: 65,
            LastModified: incomingAt,
            Location: { Type: 'KoboSpan', Source: 'chapter.xhtml', Value: 'kobo.1.1' },
          },
        },
        1,
        99,
        true,
        77,
      );
      expect(progressBridge.koboBookmarkToCanonical).toHaveBeenCalledWith(1, 5, 'chapter.xhtml', 'kobo.1.1', 77);
      expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 55, percentage: 65, koboLocationValue: 'kobo.1.1' }));
      expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 77, deliveryId: 'new' }));
    });
    it('acknowledges an equal-percent echo without reopening a synced device', async () => {
      const { db } = resetDb();
      await makeService(db, { current: vi.fn().mockResolvedValue({ id: 'new', state: 'offered', options: {} }) }).upsertState(
        1,
        5,
        { CurrentBookmark: { ProgressPercent: 61, LastModified: previousAt } },
        1,
        99,
        true,
        77,
      );
      expect(db.execute).not.toHaveBeenCalled();
      expect(bookService.syncAudioProgressForExternalEbookProgress).not.toHaveBeenCalled();
    });
    it('does not propagate a backwards event if a concurrent canonical update wins the atomic write', async () => {
      const { db, insert } = resetDb(20);
      const rejected = makeInsertChain();
      rejected.onConflictDoUpdate.mockReturnValue({ returning: vi.fn().mockResolvedValue([]) });
      db.insert.mockReturnValueOnce(rejected).mockReturnValue(insert);
      db.select
        .mockReturnValueOnce(makeSelectChain([{ fileId: 55 }]))
        .mockReturnValueOnce(makeSelectChain([{ percentage: 20 }]))
        .mockReturnValueOnce(makeSelectChain([{ fileId: 55 }]))
        .mockReturnValueOnce(makeSelectChain([{ percentage: 20, updatedAt: new Date(previousAt) }]))
        .mockReturnValueOnce(makeSelectChain([{ percentage: 61 }]));
      await makeService(db, {
        current: vi.fn().mockResolvedValue({ id: 'new', previousId: 'old', state: 'offered', options: { replacement: true } }),
      }).upsertState(1, 5, { CurrentBookmark: { ProgressPercent: 42, LastModified: incomingAt } }, 1, 99, true, 77);
      expect(insert.values).toHaveBeenCalledOnce();
      expect(insert.values).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 77, currentBookmark: { ProgressPercent: 42, LastModified: incomingAt } }),
      );
      expect(userBookStatusService.autoUpdate).not.toHaveBeenCalled();
      expect(bookService.syncAudioProgressForExternalEbookProgress).not.toHaveBeenCalled();
    });
    it.each([null, savedCfi])('serves canonical percentage when precise conversion is unavailable (cfi=%s)', async (cfi) => {
      const { db } = resetDb();
      db.query.koboReadingStates.findFirst.mockResolvedValue({
        currentBookmark: { ProgressPercent: 0, Location: { Value: 'stale' }, ContentSourceProgressPercent: 0 },
      });
      db.select
        .mockReset()
        .mockReturnValueOnce(makeSelectChain([{ fileId: 55 }]))
        .mockReturnValueOnce(makeSelectChain([{ percentage: 61, cfi, updatedAt: new Date(previousAt) }]));
      settingsService.getSettings.mockResolvedValue({ twoWayProgressSync: true });
      const result = (await makeService(db).getRawState(1, 5, 77)) as { CurrentBookmark: Record<string, unknown> };
      expect(result.CurrentBookmark.ProgressPercent).toBe(61);
      expect(result.CurrentBookmark.Location).toBeUndefined();
      expect(result.CurrentBookmark.ContentSourceProgressPercent).toBeUndefined();
    });
    it('uses canonical progress for a first Kobo sync without any stored Kobo state', async () => {
      const { db } = resetDb();
      db.query.koboReadingStates.findFirst.mockResolvedValue(null);
      settingsService.getSettings.mockResolvedValue({ twoWayProgressSync: true });
      await expect(makeService(db).getRawState(1, 5, 77)).resolves.toMatchObject({
        CurrentBookmark: { ProgressPercent: 61 },
        StatusInfo: { Status: 'Reading' },
      });
    });
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
