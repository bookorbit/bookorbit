import { BadRequestException, Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import {
  ACHIEVEMENT_EVENT_BACKFILL,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  type AchievementEventsService,
} from '../achievement/achievement-events.service';
import type { PageStatsUploadDto } from './dto';
import type { KoreaderPluginRepository } from './koreader-plugin.repository';
import type { KoreaderRepository } from './koreader.repository';
import { KoreaderStatsService } from './koreader-stats.service';
import type { DerivedKoreaderSession } from './koreader-stats.util';

const DEVICE_ID = 'abcdef12-3456-7890-abcd-ef1234567890';
const HASH_A = 'a'.repeat(32);
const HASH_B = 'b'.repeat(32);

function makeUser(): RequestUser {
  return { id: 7, settings: { timezone: 'Asia/Kolkata' } } as unknown as RequestUser;
}

function makeDto(books: PageStatsUploadDto['books']): PageStatsUploadDto {
  return { deviceId: DEVICE_ID, deviceModel: 'Kobo Libra 2', pluginVersion: '0.1.0', books } as PageStatsUploadDto;
}

function makeSession(startEpoch: number): DerivedKoreaderSession {
  return {
    sessionId: `kor:abcdef12:10:${startEpoch}`,
    startedAt: new Date(startEpoch * 1000),
    endedAt: new Date((startEpoch + 60) * 1000),
    durationSeconds: 60,
    progressDelta: 1,
    endProgress: 10,
  };
}

describe('KoreaderStatsService', () => {
  let koreaderRepo: { getAccessibleLibraryIds: ReturnType<typeof vi.fn>; resolveBookFilesByHashes: ReturnType<typeof vi.fn> };
  let pluginRepo: { ingestAndDeriveForBook: ReturnType<typeof vi.fn> };
  let achievementEvents: { emit: ReturnType<typeof vi.fn> };
  let service: KoreaderStatsService;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    koreaderRepo = {
      getAccessibleLibraryIds: vi.fn().mockResolvedValue([1]),
      resolveBookFilesByHashes: vi.fn().mockResolvedValue(new Map([[HASH_A, { bookFileId: 10, bookId: 20, libraryId: 1 }]])),
    };
    pluginRepo = {
      ingestAndDeriveForBook: vi.fn().mockResolvedValue({ accepted: 2, duplicates: 0, insertedSessions: [], updatedSessions: 0, deletedSessions: 0 }),
    };
    achievementEvents = { emit: vi.fn() };

    service = new KoreaderStatsService(
      koreaderRepo as unknown as KoreaderRepository,
      pluginRepo as unknown as KoreaderPluginRepository,
      achievementEvents as unknown as AchievementEventsService,
    );
  });

  it('rejects requests with more than 500 events in total', async () => {
    const events = Array.from({ length: 501 }, (_, i) => ({ page: 1, startTime: 1000 + i, durationSeconds: 10, totalPages: 100 }));
    await expect(service.uploadPageStats(makeUser(), makeDto([{ hash: HASH_A, events }]))).rejects.toBeInstanceOf(BadRequestException);
    expect(pluginRepo.ingestAndDeriveForBook).not.toHaveBeenCalled();
  });

  it('reports unmatched hashes without ingesting them', async () => {
    const dto = makeDto([
      { hash: HASH_A, events: [{ page: 1, startTime: 1000, durationSeconds: 30, totalPages: 100 }] },
      { hash: HASH_B, events: [{ page: 2, startTime: 2000, durationSeconds: 30, totalPages: 100 }] },
    ]);

    const result = await service.uploadPageStats(makeUser(), dto);

    expect(result.unmatched).toEqual([HASH_B]);
    expect(result.results).toHaveLength(1);
    expect(pluginRepo.ingestAndDeriveForBook).toHaveBeenCalledTimes(1);
    expect(pluginRepo.ingestAndDeriveForBook).toHaveBeenCalledWith({
      userId: 7,
      bookFileId: 10,
      bookId: 20,
      libraryId: 1,
      deviceId: DEVICE_ID,
      events: dto.books[0]!.events,
      timeZone: 'Asia/Kolkata',
    });
  });

  it('returns the max submitted startTime as watermark even when everything is a duplicate', async () => {
    pluginRepo.ingestAndDeriveForBook.mockResolvedValue({
      accepted: 0,
      duplicates: 2,
      insertedSessions: [],
      updatedSessions: 0,
      deletedSessions: 0,
    });
    const dto = makeDto([
      {
        hash: HASH_A,
        events: [
          { page: 1, startTime: 5000, durationSeconds: 30, totalPages: 100 },
          { page: 2, startTime: 9000, durationSeconds: 30, totalPages: 100 },
        ],
      },
    ]);

    const result = await service.uploadPageStats(makeUser(), dto);

    expect(result.results[0]).toEqual({ hash: HASH_A, accepted: 0, duplicates: 2, watermark: 9000 });
  });

  it('emits one reading-session event per inserted session below the backfill threshold', async () => {
    pluginRepo.ingestAndDeriveForBook.mockResolvedValue({
      accepted: 2,
      duplicates: 0,
      insertedSessions: [makeSession(1000), makeSession(5000)],
      updatedSessions: 0,
      deletedSessions: 0,
    });
    const dto = makeDto([{ hash: HASH_A, events: [{ page: 1, startTime: 1000, durationSeconds: 30, totalPages: 100 }] }]);

    await service.uploadPageStats(makeUser(), dto);

    expect(achievementEvents.emit).toHaveBeenCalledTimes(2);
    expect(achievementEvents.emit).toHaveBeenCalledWith(
      ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
      expect.objectContaining({ userId: 7, bookFileId: 10, durationSeconds: 60, timezone: 'Asia/Kolkata' }),
    );
  });

  it('emits a single backfill event when more sessions than the threshold are inserted', async () => {
    pluginRepo.ingestAndDeriveForBook.mockResolvedValue({
      accepted: 30,
      duplicates: 0,
      insertedSessions: Array.from({ length: 21 }, (_, i) => makeSession(1000 + i * 4000)),
      updatedSessions: 0,
      deletedSessions: 0,
    });
    const dto = makeDto([{ hash: HASH_A, events: [{ page: 1, startTime: 1000, durationSeconds: 30, totalPages: 100 }] }]);

    await service.uploadPageStats(makeUser(), dto);

    expect(achievementEvents.emit).toHaveBeenCalledTimes(1);
    expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BACKFILL, { userId: 7 });
  });

  it('normalizes hashes to lowercase before resolution', async () => {
    const dto = makeDto([{ hash: HASH_A.toUpperCase(), events: [{ page: 1, startTime: 1000, durationSeconds: 30, totalPages: 100 }] }]);

    const result = await service.uploadPageStats(makeUser(), dto);

    expect(koreaderRepo.resolveBookFilesByHashes).toHaveBeenCalledWith([HASH_A], [1]);
    expect(result.results[0]!.hash).toBe(HASH_A);
  });
});
