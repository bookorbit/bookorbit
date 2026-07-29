import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, type AchievementEventsService } from '../achievement/achievement-events.service';
import type { UserBookNoteService } from '../user-book-note/user-book-note.service';
import type { UserBookStatusService } from '../user-book-status/user-book-status.service';
import type { BookStatesUploadDto, BulkProgressDto, MatchCheckDto, SweepCompleteDto } from './dto';
import type { KoreaderPluginRepository } from './koreader-plugin.repository';
import { KoreaderPluginService } from './koreader-plugin.service';
import type { KoreaderRepository } from './koreader.repository';
import type { KoreaderService } from './koreader.service';

const DEVICE_ID = 'abcdef12-3456-7890-abcd-ef1234567890';
const HASH_A = 'a'.repeat(32);
const HASH_B = 'b'.repeat(32);

function makeUser(): RequestUser {
  return { id: 7, settings: {} } as unknown as RequestUser;
}

function deviceFields() {
  return { deviceId: DEVICE_ID, deviceModel: 'Kobo Libra 2', pluginVersion: '0.1.0' };
}

describe('KoreaderPluginService', () => {
  let koreaderRepo: {
    getAccessibleLibraryIds: ReturnType<typeof vi.fn>;
    resolveBookFilesByHashes: ReturnType<typeof vi.fn>;
    upsertUnmatchedBooks: ReturnType<typeof vi.fn>;
    clearUnmatchedBooks: ReturnType<typeof vi.fn>;
  };
  let pluginRepo: {
    getRatings: ReturnType<typeof vi.fn>;
    upsertRatings: ReturnType<typeof vi.fn>;
    upsertSweep: ReturnType<typeof vi.fn>;
    listSweeps: ReturnType<typeof vi.fn>;
    getPluginTotals: ReturnType<typeof vi.fn>;
    getLibraryMaxFileTimestamp: ReturnType<typeof vi.fn>;
    getHashLinkVersion: ReturnType<typeof vi.fn>;
  };
  let koreaderService: { applyBulkProgress: ReturnType<typeof vi.fn> };
  let userBookStatusService: {
    findOne: ReturnType<typeof vi.fn>;
    findByBookIds: ReturnType<typeof vi.fn>;
    setManual: ReturnType<typeof vi.fn>;
  };
  let userBookNoteService: {
    findByBookIds: ReturnType<typeof vi.fn>;
    setNotes: ReturnType<typeof vi.fn>;
    normalizeNote: (value: string | null | undefined) => string | null;
  };
  let achievementEvents: { emit: ReturnType<typeof vi.fn> };
  let service: KoreaderPluginService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    koreaderRepo = {
      getAccessibleLibraryIds: vi.fn().mockResolvedValue([1]),
      resolveBookFilesByHashes: vi.fn().mockResolvedValue(new Map([[HASH_A, { bookFileId: 10, bookId: 20, libraryId: 1 }]])),
      upsertUnmatchedBooks: vi.fn().mockResolvedValue(undefined),
      clearUnmatchedBooks: vi.fn().mockResolvedValue(undefined),
    };
    pluginRepo = {
      getRatings: vi.fn().mockResolvedValue(new Map()),
      upsertRatings: vi.fn().mockResolvedValue(undefined),
      upsertSweep: vi.fn().mockResolvedValue(new Date('2026-06-09T10:00:00.000Z')),
      listSweeps: vi.fn().mockResolvedValue([]),
      getPluginTotals: vi.fn().mockResolvedValue({ matchedBooks: 0, pageStatEvents: 0, annotations: 0, unmatchedBooks: 0 }),
      getLibraryMaxFileTimestamp: vi.fn().mockResolvedValue(new Date('2026-06-01T00:00:00.000Z')),
      getHashLinkVersion: vi.fn().mockResolvedValue({ count: 0, maxTs: null }),
    };
    koreaderService = { applyBulkProgress: vi.fn().mockResolvedValue({ shared: 0, stale: 0 }) };
    userBookStatusService = {
      findOne: vi.fn().mockResolvedValue(null),
      findByBookIds: vi.fn().mockResolvedValue(new Map()),
      setManual: vi.fn().mockResolvedValue(undefined),
    };
    userBookNoteService = {
      findByBookIds: vi.fn().mockResolvedValue(new Map()),
      setNotes: vi.fn().mockResolvedValue(undefined),
      normalizeNote: (value) => {
        const trimmed = value?.trim();
        return trimmed ? trimmed : null;
      },
    };
    achievementEvents = { emit: vi.fn() };

    service = new KoreaderPluginService(
      koreaderRepo as unknown as KoreaderRepository,
      pluginRepo as unknown as KoreaderPluginRepository,
      koreaderService as unknown as KoreaderService,
      userBookStatusService as unknown as UserBookStatusService,
      userBookNoteService as unknown as UserBookNoteService,
      achievementEvents as unknown as AchievementEventsService,
    );
  });

  describe('matchCheck', () => {
    it('returns matches and a stable 16-char library version token', async () => {
      const dto = { ...deviceFields(), hashes: [HASH_A.toUpperCase(), HASH_A, HASH_B] } as MatchCheckDto;

      const result = await service.matchCheck(makeUser(), dto);

      expect(koreaderRepo.resolveBookFilesByHashes).toHaveBeenCalledWith([HASH_A, HASH_B], [1], 7);
      expect(koreaderRepo.clearUnmatchedBooks).toHaveBeenCalledWith(7, [HASH_A]);
      expect(koreaderRepo.upsertUnmatchedBooks).toHaveBeenCalledWith(7, [{ hash: HASH_B, source: 'statistics' }], DEVICE_ID);
      expect(result.matches).toEqual([{ hash: HASH_A, bookId: 20, bookFileId: 10 }]);
      expect(result.libraryVersion).toMatch(/^[0-9a-f]{16}$/);
    });

    it('persists unmatched candidate metadata from the device statistics database', async () => {
      const dto = {
        ...deviceFields(),
        hashes: [HASH_A, HASH_B],
        books: [
          { hash: HASH_A, title: 'Matched title', authors: 'Matched author', lastOpen: 100 },
          { hash: HASH_B.toUpperCase(), title: 'Unmatched title', authors: 'Author One', lastOpen: 200 },
        ],
      } as MatchCheckDto;

      await service.matchCheck(makeUser(), dto);

      expect(koreaderRepo.upsertUnmatchedBooks).toHaveBeenCalledWith(
        7,
        [{ hash: HASH_B, title: 'Unmatched title', authors: 'Author One', lastOpen: 200, source: 'statistics', metadataAmbiguous: false }],
        DEVICE_ID,
      );
    });

    it('keeps the strongest unmatched source and ambiguity flag for duplicate candidate metadata', async () => {
      const dto = {
        ...deviceFields(),
        hashes: [HASH_B],
        books: [
          { hash: HASH_B, title: 'Stats title', lastOpen: 100, source: 'statistics' },
          { hash: HASH_B, title: 'File title', authors: 'File author', lastOpen: 200, source: 'file', metadataAmbiguous: true },
        ],
      } as MatchCheckDto;

      await service.matchCheck(makeUser(), dto);

      expect(koreaderRepo.upsertUnmatchedBooks).toHaveBeenCalledWith(
        7,
        [{ hash: HASH_B, title: 'File title', authors: 'File author', lastOpen: 200, source: 'file', metadataAmbiguous: true }],
        DEVICE_ID,
      );
    });

    it('does not overwrite stronger unmatched metadata with a weaker later candidate', async () => {
      const dto = {
        ...deviceFields(),
        hashes: [HASH_B],
        books: [
          { hash: HASH_B, title: 'Open file title', authors: 'Open file author', lastOpen: 200, source: 'current_file', metadataAmbiguous: false },
          { hash: HASH_B, title: 'Stats title', authors: 'Stats author', lastOpen: 300, source: 'statistics', metadataAmbiguous: true },
        ],
      } as MatchCheckDto;

      await service.matchCheck(makeUser(), dto);

      expect(koreaderRepo.upsertUnmatchedBooks).toHaveBeenCalledWith(
        7,
        [{ hash: HASH_B, title: 'Open file title', authors: 'Open file author', lastOpen: 300, source: 'current_file', metadataAmbiguous: false }],
        DEVICE_ID,
      );
    });

    // The plugin treats matchCheck's libraryVersion and the bulk manifest's
    // manifestVersion as the same token and feeds both into one invalidation
    // path. A divergence here would show up on device as permanent spurious
    // rematching, not as a failure, so it is pinned.
    it('returns the same token the bulk manifest exposes as manifestVersion', async () => {
      const dto = { ...deviceFields(), hashes: [HASH_A] } as MatchCheckDto;

      const result = await service.matchCheck(makeUser(), dto);

      await expect(service.getLibraryVersion(7)).resolves.toBe(result.libraryVersion);
    });

    it('changes the library version token when the accessible library set changes', async () => {
      const dto = { ...deviceFields(), hashes: [HASH_A] } as MatchCheckDto;

      const first = await service.matchCheck(makeUser(), dto);
      koreaderRepo.getAccessibleLibraryIds.mockResolvedValue([1, 2]);
      const second = await service.matchCheck(makeUser(), dto);

      expect(second.libraryVersion).not.toBe(first.libraryVersion);
    });

    it('changes the library version token when manual hash links change', async () => {
      const dto = { ...deviceFields(), hashes: [HASH_A] } as MatchCheckDto;

      const first = await service.matchCheck(makeUser(), dto);
      pluginRepo.getHashLinkVersion.mockResolvedValue({ count: 1, maxTs: new Date('2026-06-02T00:00:00.000Z') });
      const second = await service.matchCheck(makeUser(), dto);

      expect(second.libraryVersion).not.toBe(first.libraryVersion);
    });

    it('changes the library version token when a manual hash link count changes without a newer timestamp', async () => {
      const dto = { ...deviceFields(), hashes: [HASH_A] } as MatchCheckDto;
      const maxTs = new Date('2026-06-02T00:00:00.000Z');
      pluginRepo.getHashLinkVersion.mockResolvedValue({ count: 2, maxTs });

      const first = await service.matchCheck(makeUser(), dto);
      pluginRepo.getHashLinkVersion.mockResolvedValue({ count: 1, maxTs });
      const second = await service.matchCheck(makeUser(), dto);

      expect(second.libraryVersion).not.toBe(first.libraryVersion);
    });
  });

  describe('uploadBookStates', () => {
    function statesDto(books: BookStatesUploadDto['books']): BookStatesUploadDto {
      return { ...deviceFields(), books } as BookStatesUploadDto;
    }

    function serverStatus(status: string, updatedAt: string) {
      userBookStatusService.findByBookIds.mockResolvedValue(new Map([[20, { status, source: 'manual', updatedAt }]]));
    }

    function serverRating(rating: number | null, updatedAt: Date) {
      pluginRepo.getRatings.mockResolvedValue(new Map([[20, { rating, updatedAt }]]));
    }

    function serverNote(note: string | null, updatedAt: string) {
      userBookNoteService.findByBookIds.mockResolvedValue(new Map([[20, { note, updatedAt }]]));
    }

    it('reports unmatched hashes', async () => {
      const result = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_B, status: 'reading' }]));
      expect(result.unmatched).toEqual([HASH_B]);
      expect(result.results).toHaveLength(0);
    });

    it('applies a status when no server status exists', async () => {
      const result = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, status: 'complete', statusModified: '2026-06-01' }]));

      expect(userBookStatusService.setManual).toHaveBeenCalledWith(7, 20, 'read');
      expect(result.results[0]).toMatchObject({ hash: HASH_A, statusApplied: true, ratingApplied: false, reviewApplied: false });
    });

    it('treats an identical status as applied without writing', async () => {
      serverStatus('read', '2026-06-05T08:00:00.000Z');

      const result = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, status: 'complete', statusModified: '2026-01-01' }]));

      expect(userBookStatusService.setManual).not.toHaveBeenCalled();
      expect(result.results[0]!.statusApplied).toBe(true);
    });

    it('applies the device status when its date is strictly newer than the server update', async () => {
      serverStatus('reading', '2026-06-05T08:00:00.000Z');

      await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, status: 'abandoned', statusModified: '2026-06-06' }]));

      expect(userBookStatusService.setManual).toHaveBeenCalledWith(7, 20, 'abandoned');
    });

    it('keeps the server status on a same-day tie or older device date', async () => {
      serverStatus('reading', '2026-06-05T08:00:00.000Z');

      const tie = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, status: 'complete', statusModified: '2026-06-05' }]));
      const older = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, status: 'complete', statusModified: '2026-06-04' }]));

      expect(userBookStatusService.setManual).not.toHaveBeenCalled();
      expect(tie.results[0]!.statusApplied).toBe(false);
      expect(older.results[0]!.statusApplied).toBe(false);
    });

    it('applies a rating when none exists and emits the rating event', async () => {
      const result = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, rating: 4 }]));

      expect(pluginRepo.upsertRatings).toHaveBeenCalledWith(7, [{ bookId: 20, rating: 4 }], expect.any(Date));
      expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, { userId: 7, bookIds: [20], rating: 4 });
      expect(result.results[0]!.ratingApplied).toBe(true);
    });

    it('keeps the server rating on a same-day tie and never clears without a device rating', async () => {
      serverRating(5, new Date('2026-06-05T08:00:00.000Z'));

      const tie = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, rating: 3, statusModified: '2026-06-05' }]));
      const noRating = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, status: 'reading' }]));

      expect(pluginRepo.upsertRatings).not.toHaveBeenCalled();
      expect(tie.results[0]!.ratingApplied).toBe(false);
      expect(noRating.results[0]!.ratingApplied).toBe(false);
    });

    it('overwrites the server rating when the device change is newer', async () => {
      serverRating(2, new Date('2026-06-01T08:00:00.000Z'));

      await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, rating: 5, statusModified: '2026-06-02' }]));

      expect(pluginRepo.upsertRatings).toHaveBeenCalledWith(7, [{ bookId: 20, rating: 5 }], expect.any(Date));
    });

    it('clears a rating when the device clear is newer and reports the written timestamp', async () => {
      serverRating(2, new Date('2026-06-01T08:00:00.000Z'));

      const result = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, ratingCleared: true, statusModified: '2026-06-02' }]));

      expect(pluginRepo.upsertRatings).toHaveBeenCalledWith(7, [{ bookId: 20, rating: null }], expect.any(Date));
      const writtenAt = pluginRepo.upsertRatings.mock.calls[0]![2] as Date;
      expect(result.results[0]).toMatchObject({ rating: null, ratingSet: false, ratingUpdatedAt: writtenAt.toISOString() });
    });

    it('applies a review note when none exists and returns canonical personal state', async () => {
      const result = await service.uploadBookStates(
        makeUser(),
        statesDto([{ hash: HASH_A, reviewNote: ' Loved it. ', reviewModified: '2026-06-03' }]),
      );

      expect(userBookNoteService.setNotes).toHaveBeenCalledWith(7, [{ bookId: 20, note: 'Loved it.' }], expect.any(Date));
      const writtenAt = userBookNoteService.setNotes.mock.calls[0]![2] as Date;
      expect(result.results[0]).toMatchObject({
        reviewApplied: true,
        reviewNote: 'Loved it.',
        reviewNoteSet: true,
        reviewUpdatedAt: writtenAt.toISOString(),
      });
    });

    it('keeps the server review on a same-day tie', async () => {
      serverNote('Server note', '2026-06-05T08:00:00.000Z');

      const result = await service.uploadBookStates(
        makeUser(),
        statesDto([{ hash: HASH_A, reviewNote: 'Device note', reviewModified: '2026-06-05' }]),
      );

      expect(userBookNoteService.setNotes).not.toHaveBeenCalled();
      expect(result.results[0]).toMatchObject({ reviewApplied: false, reviewNote: 'Server note' });
    });

    it('clears a review when the device clear is newer', async () => {
      serverNote('Server note', '2026-06-01T08:00:00.000Z');

      const result = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, reviewCleared: true, reviewModified: '2026-06-02' }]));

      expect(userBookNoteService.setNotes).toHaveBeenCalledWith(7, [{ bookId: 20, note: null }], expect.any(Date));
      expect(result.results[0]).toMatchObject({ reviewApplied: true, reviewNote: null, reviewNoteSet: false });
    });

    it('reads server state once per request regardless of book count', async () => {
      koreaderRepo.resolveBookFilesByHashes.mockResolvedValue(
        new Map([
          [HASH_A, { bookFileId: 10, bookId: 20, libraryId: 1 }],
          [HASH_B, { bookFileId: 11, bookId: 21, libraryId: 1 }],
        ]),
      );

      await service.uploadBookStates(
        makeUser(),
        statesDto([
          { hash: HASH_A, status: 'reading', rating: 3, reviewNote: 'A' },
          { hash: HASH_B, status: 'reading', rating: 4, reviewNote: 'B' },
        ]),
      );

      expect(userBookStatusService.findByBookIds).toHaveBeenCalledTimes(1);
      expect(userBookStatusService.findByBookIds).toHaveBeenCalledWith(7, [20, 21]);
      expect(pluginRepo.getRatings).toHaveBeenCalledTimes(1);
      expect(userBookNoteService.findByBookIds).toHaveBeenCalledTimes(1);
      expect(userBookStatusService.findOne).not.toHaveBeenCalled();
    });

    it('writes ratings and reviews once for the whole batch and groups rating events by value', async () => {
      koreaderRepo.resolveBookFilesByHashes.mockResolvedValue(
        new Map([
          [HASH_A, { bookFileId: 10, bookId: 20, libraryId: 1 }],
          [HASH_B, { bookFileId: 11, bookId: 21, libraryId: 1 }],
        ]),
      );

      await service.uploadBookStates(
        makeUser(),
        statesDto([
          { hash: HASH_A, rating: 4, reviewNote: 'A' },
          { hash: HASH_B, rating: 4, reviewNote: 'B' },
        ]),
      );

      expect(pluginRepo.upsertRatings).toHaveBeenCalledTimes(1);
      expect(pluginRepo.upsertRatings).toHaveBeenCalledWith(
        7,
        [
          { bookId: 20, rating: 4 },
          { bookId: 21, rating: 4 },
        ],
        expect.any(Date),
      );
      expect(userBookNoteService.setNotes).toHaveBeenCalledTimes(1);
      expect(achievementEvents.emit).toHaveBeenCalledTimes(1);
      expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, { userId: 7, bookIds: [20, 21], rating: 4 });
    });

    it('lets a later entry for the same book observe the earlier rating and review writes', async () => {
      const result = await service.uploadBookStates(
        makeUser(),
        statesDto([
          { hash: HASH_A, rating: 4, reviewNote: 'First' },
          { hash: HASH_A.toUpperCase(), rating: 4, reviewNote: 'First' },
        ]),
      );

      expect(pluginRepo.upsertRatings).toHaveBeenCalledWith(7, [{ bookId: 20, rating: 4 }], expect.any(Date));
      expect(userBookNoteService.setNotes).toHaveBeenCalledWith(7, [{ bookId: 20, note: 'First' }], expect.any(Date));
      expect(result.results[1]).toMatchObject({ ratingApplied: true, reviewApplied: true, rating: 4, reviewNote: 'First' });
      expect(achievementEvents.emit).toHaveBeenCalledTimes(1);
    });

    it('re-reads a status only when a later entry resolves to a book written in this batch', async () => {
      userBookStatusService.findOne.mockResolvedValue({ status: 'read', source: 'manual', updatedAt: '2026-06-06T08:00:00.000Z' });

      const result = await service.uploadBookStates(
        makeUser(),
        statesDto([
          { hash: HASH_A, status: 'complete', statusModified: '2026-06-06' },
          { hash: HASH_A.toUpperCase(), status: 'complete', statusModified: '2026-06-06' },
        ]),
      );

      expect(userBookStatusService.setManual).toHaveBeenCalledTimes(1);
      expect(userBookStatusService.findOne).toHaveBeenCalledTimes(1);
      expect(result.results.map((entry) => entry.statusApplied)).toEqual([true, true]);
    });

    it('returns results in input order', async () => {
      koreaderRepo.resolveBookFilesByHashes.mockResolvedValue(
        new Map([
          [HASH_A, { bookFileId: 10, bookId: 20, libraryId: 1 }],
          [HASH_B, { bookFileId: 11, bookId: 21, libraryId: 1 }],
        ]),
      );

      const result = await service.uploadBookStates(
        makeUser(),
        statesDto([{ hash: HASH_B, rating: 1 }, { hash: HASH_A, rating: 2 }, { hash: HASH_B }]),
      );

      expect(result.results.map((entry) => entry.hash)).toEqual([HASH_B, HASH_A, HASH_B]);
    });
  });

  describe('bulkProgress', () => {
    function progressDto(items: BulkProgressDto['items']): BulkProgressDto {
      return { ...deviceFields(), items } as BulkProgressDto;
    }

    it('hands every matched item to one bulk apply carrying the shared device identity', async () => {
      koreaderRepo.resolveBookFilesByHashes.mockResolvedValue(
        new Map([
          [HASH_A, { bookFileId: 10, bookId: 20, libraryId: 1 }],
          [HASH_B, { bookFileId: 11, bookId: 21, libraryId: 1 }],
        ]),
      );

      const result = await service.bulkProgress(
        makeUser(),
        progressDto([
          { hash: HASH_A, percentage: 0.5, progress: '/body/DocFragment[3]/body', timestamp: 1700000000 },
          { hash: HASH_B, percentage: 0.1 },
        ]),
      );

      expect(koreaderService.applyBulkProgress).toHaveBeenCalledTimes(1);
      expect(koreaderService.applyBulkProgress).toHaveBeenCalledWith(
        7,
        [
          {
            bookFile: { id: 10, bookId: 20, libraryId: 1 },
            percentage: 0.5,
            progress: '/body/DocFragment[3]/body',
            timestamp: 1700000000,
          },
          { bookFile: { id: 11, bookId: 21, libraryId: 1 }, percentage: 0.1, progress: undefined, timestamp: undefined },
        ],
        { device: 'Kobo Libra 2', deviceId: DEVICE_ID },
      );
      expect(result.results).toEqual([
        { hash: HASH_A, accepted: true },
        { hash: HASH_B, accepted: true },
      ]);
    });

    it('reports unmatched hashes and passes only matched items to the bulk apply', async () => {
      const result = await service.bulkProgress(
        makeUser(),
        progressDto([
          { hash: HASH_B, percentage: 0.3 },
          { hash: HASH_A, percentage: 0.4 },
        ]),
      );

      expect(result.unmatched).toEqual([HASH_B]);
      expect(result.results).toEqual([{ hash: HASH_A, accepted: true }]);
      expect(koreaderService.applyBulkProgress).toHaveBeenCalledWith(
        7,
        [{ bookFile: { id: 10, bookId: 20, libraryId: 1 }, percentage: 0.4, progress: undefined, timestamp: undefined }],
        expect.any(Object),
      );
    });
  });

  describe('sweepComplete', () => {
    it('records the sweep and returns the library version', async () => {
      const dto = { ...deviceFields(), booksMatched: 3, pageStatsUploaded: 120, annotationsUpserted: 4 } as SweepCompleteDto;

      const result = await service.sweepComplete(makeUser(), dto);

      expect(pluginRepo.upsertSweep).toHaveBeenCalledWith({
        userId: 7,
        deviceId: DEVICE_ID,
        deviceModel: 'Kobo Libra 2',
        pluginVersion: '0.1.0',
        booksMatched: 3,
        pageStatsUploaded: 120,
        annotationsUpserted: 4,
      });
      expect(result).toEqual({ ok: true, lastSweepAt: '2026-06-09T10:00:00.000Z', libraryVersion: expect.stringMatching(/^[0-9a-f]{16}$/) });
    });
  });
});
