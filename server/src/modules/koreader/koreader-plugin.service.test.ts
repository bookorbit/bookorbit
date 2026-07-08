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
    getAllDeviceProgress: ReturnType<typeof vi.fn>;
    getReadingProgress: ReturnType<typeof vi.fn>;
  };
  let pluginRepo: {
    getRating: ReturnType<typeof vi.fn>;
    upsertRating: ReturnType<typeof vi.fn>;
    upsertSweep: ReturnType<typeof vi.fn>;
    listSweeps: ReturnType<typeof vi.fn>;
    getPluginTotals: ReturnType<typeof vi.fn>;
    getLibraryMaxFileTimestamp: ReturnType<typeof vi.fn>;
    getHashLinkVersion: ReturnType<typeof vi.fn>;
  };
  let koreaderService: { applyProgressForResolvedFile: ReturnType<typeof vi.fn> };
  let userBookStatusService: { findOne: ReturnType<typeof vi.fn>; setManual: ReturnType<typeof vi.fn> };
  let userBookNoteService: {
    findOne: ReturnType<typeof vi.fn>;
    findRow: ReturnType<typeof vi.fn>;
    setNote: ReturnType<typeof vi.fn>;
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
      getAllDeviceProgress: vi.fn().mockResolvedValue([]),
      getReadingProgress: vi.fn().mockResolvedValue(null),
    };
    pluginRepo = {
      getRating: vi.fn().mockResolvedValue(null),
      upsertRating: vi.fn().mockResolvedValue({ rating: null, updatedAt: new Date('2026-01-01T00:00:00.000Z') }),
      upsertSweep: vi.fn().mockResolvedValue(new Date('2026-06-09T10:00:00.000Z')),
      listSweeps: vi.fn().mockResolvedValue([]),
      getPluginTotals: vi.fn().mockResolvedValue({ matchedBooks: 0, pageStatEvents: 0, annotations: 0, unmatchedBooks: 0 }),
      getLibraryMaxFileTimestamp: vi.fn().mockResolvedValue(new Date('2026-06-01T00:00:00.000Z')),
      getHashLinkVersion: vi.fn().mockResolvedValue({ count: 0, maxTs: null }),
    };
    koreaderService = { applyProgressForResolvedFile: vi.fn().mockResolvedValue(undefined) };
    userBookStatusService = { findOne: vi.fn().mockResolvedValue(null), setManual: vi.fn().mockResolvedValue(undefined) };
    userBookNoteService = {
      findOne: vi.fn().mockResolvedValue(null),
      findRow: vi.fn().mockResolvedValue(null),
      setNote: vi.fn().mockResolvedValue({ note: null, updatedAt: '2026-06-01T00:00:00.000Z' }),
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
      userBookStatusService.findOne.mockResolvedValue({ status: 'read', source: 'manual', updatedAt: '2026-06-05T08:00:00.000Z' });

      const result = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, status: 'complete', statusModified: '2026-01-01' }]));

      expect(userBookStatusService.setManual).not.toHaveBeenCalled();
      expect(result.results[0]!.statusApplied).toBe(true);
    });

    it('applies the device status when its date is strictly newer than the server update', async () => {
      userBookStatusService.findOne.mockResolvedValue({ status: 'reading', source: 'manual', updatedAt: '2026-06-05T08:00:00.000Z' });

      await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, status: 'abandoned', statusModified: '2026-06-06' }]));

      expect(userBookStatusService.setManual).toHaveBeenCalledWith(7, 20, 'abandoned');
    });

    it('keeps the server status on a same-day tie or older device date', async () => {
      userBookStatusService.findOne.mockResolvedValue({ status: 'reading', source: 'manual', updatedAt: '2026-06-05T08:00:00.000Z' });

      const tie = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, status: 'complete', statusModified: '2026-06-05' }]));
      const older = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, status: 'complete', statusModified: '2026-06-04' }]));

      expect(userBookStatusService.setManual).not.toHaveBeenCalled();
      expect(tie.results[0]!.statusApplied).toBe(false);
      expect(older.results[0]!.statusApplied).toBe(false);
    });

    it('applies a rating when none exists and emits the rating event', async () => {
      const result = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, rating: 4 }]));

      expect(pluginRepo.upsertRating).toHaveBeenCalledWith(7, 20, 4);
      expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, { userId: 7, bookIds: [20], rating: 4 });
      expect(result.results[0]!.ratingApplied).toBe(true);
    });

    it('keeps the server rating on a same-day tie and never clears without a device rating', async () => {
      pluginRepo.getRating.mockResolvedValue({ rating: 5, updatedAt: new Date('2026-06-05T08:00:00.000Z') });

      const tie = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, rating: 3, statusModified: '2026-06-05' }]));
      const noRating = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, status: 'reading' }]));

      expect(pluginRepo.upsertRating).not.toHaveBeenCalled();
      expect(tie.results[0]!.ratingApplied).toBe(false);
      expect(noRating.results[0]!.ratingApplied).toBe(false);
    });

    it('overwrites the server rating when the device change is newer', async () => {
      pluginRepo.getRating.mockResolvedValue({ rating: 2, updatedAt: new Date('2026-06-01T08:00:00.000Z') });

      await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, rating: 5, statusModified: '2026-06-02' }]));

      expect(pluginRepo.upsertRating).toHaveBeenCalledWith(7, 20, 5);
    });

    it('clears a rating when the device clear is newer', async () => {
      pluginRepo.getRating.mockResolvedValueOnce({ rating: 2, updatedAt: new Date('2026-06-01T08:00:00.000Z') });
      pluginRepo.upsertRating.mockResolvedValueOnce({ rating: null, updatedAt: new Date('2026-06-02T08:00:00.000Z') });

      const result = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, ratingCleared: true, statusModified: '2026-06-02' }]));

      expect(pluginRepo.upsertRating).toHaveBeenCalledWith(7, 20, null);
      expect(result.results[0]).toMatchObject({ rating: null, ratingSet: false, ratingUpdatedAt: '2026-06-02T08:00:00.000Z' });
    });

    it('applies a review note when none exists and returns canonical personal state', async () => {
      userBookNoteService.setNote.mockResolvedValue({ note: 'Loved it.', updatedAt: '2026-06-03T12:00:00.000Z' });

      const result = await service.uploadBookStates(
        makeUser(),
        statesDto([{ hash: HASH_A, reviewNote: ' Loved it. ', reviewModified: '2026-06-03' }]),
      );

      expect(userBookNoteService.setNote).toHaveBeenCalledWith(7, 20, 'Loved it.');
      expect(result.results[0]).toMatchObject({
        reviewApplied: true,
        reviewNote: 'Loved it.',
        reviewNoteSet: true,
        reviewUpdatedAt: '2026-06-03T12:00:00.000Z',
      });
    });

    it('keeps the server review on a same-day tie', async () => {
      userBookNoteService.findRow.mockResolvedValue({ note: 'Server note', updatedAt: new Date('2026-06-05T08:00:00.000Z') });

      const result = await service.uploadBookStates(
        makeUser(),
        statesDto([{ hash: HASH_A, reviewNote: 'Device note', reviewModified: '2026-06-05' }]),
      );

      expect(userBookNoteService.setNote).not.toHaveBeenCalled();
      expect(result.results[0]).toMatchObject({ reviewApplied: false, reviewNote: 'Server note' });
    });

    it('clears a review when the device clear is newer', async () => {
      userBookNoteService.findRow.mockResolvedValue({ note: 'Server note', updatedAt: new Date('2026-06-01T08:00:00.000Z') });
      userBookNoteService.setNote.mockResolvedValue({ note: null, updatedAt: '2026-06-02T08:00:00.000Z' });

      const result = await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, reviewCleared: true, reviewModified: '2026-06-02' }]));

      expect(userBookNoteService.setNote).toHaveBeenCalledWith(7, 20, null);
      expect(result.results[0]).toMatchObject({ reviewApplied: true, reviewNote: null, reviewNoteSet: false });
    });

    it('does not re-query canonical rating/review state when the device already supplied them', async () => {
      pluginRepo.getRating.mockResolvedValue({ rating: 2, updatedAt: new Date('2026-06-01T08:00:00.000Z') });
      userBookNoteService.findRow.mockResolvedValue({ note: 'Existing', updatedAt: new Date('2026-06-01T08:00:00.000Z') });

      await service.uploadBookStates(makeUser(), statesDto([{ hash: HASH_A, rating: 2, reviewNote: 'Existing', reviewModified: '2026-06-01' }]));

      expect(pluginRepo.getRating).toHaveBeenCalledTimes(1);
      expect(userBookNoteService.findRow).toHaveBeenCalledTimes(1);
      expect(userBookNoteService.findOne).not.toHaveBeenCalled();
    });
  });

  describe('bulkProgress', () => {
    function progressDto(items: BulkProgressDto['items']): BulkProgressDto {
      return { ...deviceFields(), items } as BulkProgressDto;
    }

    it('applies progress with the shared device identity', async () => {
      const result = await service.bulkProgress(
        makeUser(),
        progressDto([{ hash: HASH_A, percentage: 0.5, progress: '/body/DocFragment[3]/body', timestamp: 1700000000 }]),
      );

      expect(koreaderService.applyProgressForResolvedFile).toHaveBeenCalledWith(
        7,
        { id: 10, bookId: 20, libraryId: 1 },
        {
          percentage: 0.5,
          progress: '/body/DocFragment[3]/body',
          device: 'Kobo Libra 2',
          deviceId: DEVICE_ID,
          timestamp: 1700000000,
        },
        { skipSharedProgress: false },
      );
      expect(result.results[0]).toEqual({ hash: HASH_A, accepted: true });
    });

    it('skips shared progress updates when something newer is already known server-side', async () => {
      koreaderRepo.getAllDeviceProgress.mockResolvedValue([{ deviceId: 'other', syncTimestamp: 1800000000, updatedAt: new Date() }]);

      await service.bulkProgress(makeUser(), progressDto([{ hash: HASH_A, percentage: 0.2, timestamp: 1700000000 }]));

      expect(koreaderService.applyProgressForResolvedFile).toHaveBeenCalledWith(7, { id: 10, bookId: 20, libraryId: 1 }, expect.any(Object), {
        skipSharedProgress: true,
      });
    });

    it('never treats progress as stale without a device timestamp', async () => {
      koreaderRepo.getAllDeviceProgress.mockResolvedValue([{ deviceId: 'other', syncTimestamp: 1800000000, updatedAt: new Date() }]);

      await service.bulkProgress(makeUser(), progressDto([{ hash: HASH_A, percentage: 0.2 }]));

      expect(koreaderService.applyProgressForResolvedFile).toHaveBeenCalledWith(7, { id: 10, bookId: 20, libraryId: 1 }, expect.any(Object), {
        skipSharedProgress: false,
      });
    });

    it('reports unmatched hashes', async () => {
      const result = await service.bulkProgress(makeUser(), progressDto([{ hash: HASH_B, percentage: 0.3 }]));
      expect(result.unmatched).toEqual([HASH_B]);
      expect(koreaderService.applyProgressForResolvedFile).not.toHaveBeenCalled();
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
