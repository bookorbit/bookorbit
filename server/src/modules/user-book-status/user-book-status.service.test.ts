import { InternalServerErrorException } from '@nestjs/common';
import type { ReadStatus, ReadStatusSource } from '@bookorbit/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserBookStatusRow } from '../../db/schema';
import { UserBookStatusRepository } from './user-book-status.repository';
import type { SessionBoundaries } from './user-book-status.repository';
import { UserBookStatusService } from './user-book-status.service';

function makeRow(overrides: Partial<UserBookStatusRow> = {}): UserBookStatusRow {
  return {
    userId: 1,
    bookId: 10,
    status: 'unread',
    source: 'auto',
    startedAt: null,
    finishedAt: null,
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

const mockRepo = {
  findOne: vi.fn<(...args: [number, number]) => Promise<UserBookStatusRow | null>>(),
  findByBookIds: vi.fn<(...args: [number, number[]]) => Promise<UserBookStatusRow[]>>(),
  upsert: vi.fn<(...args: [number, number, ReadStatus, ReadStatusSource, Date, (UserBookStatusRow | null)?]) => Promise<void>>(),
  upsertState:
    vi.fn<
      (
        ...args: [number, number, { status: ReadStatus; source: ReadStatusSource; startedAt: Date | null; finishedAt: Date | null; updatedAt: Date }]
      ) => Promise<void>
    >(),
  findSessionBoundariesForBook: vi.fn<(...args: [number, number]) => Promise<SessionBoundaries>>(),
};
const mockAchievementEvents = {
  emit: vi.fn(),
};

let service: UserBookStatusService;

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.findOne.mockResolvedValue(null);
  mockRepo.findByBookIds.mockResolvedValue([]);
  mockRepo.upsert.mockResolvedValue(undefined);
  mockRepo.upsertState.mockResolvedValue(undefined);
  mockRepo.findSessionBoundariesForBook.mockResolvedValue({ firstStartedAt: null, lastEndedAt: null });
  service = new UserBookStatusService(mockRepo as unknown as UserBookStatusRepository, mockAchievementEvents as never);
});

describe('setManual', () => {
  it('preserves existing dates while setting status and source to manual', async () => {
    const started = new Date('2026-04-01T00:00:00.000Z');
    const finished = new Date('2026-04-10T00:00:00.000Z');
    mockRepo.findOne.mockResolvedValue(makeRow({ startedAt: started, finishedAt: finished, status: 'reading', source: 'auto' }));

    await service.setManual(1, 10, 'reading');

    expect(mockRepo.upsertState).toHaveBeenCalledOnce();
    const [userId, bookId, state] = mockRepo.upsertState.mock.calls[0];
    expect(userId).toBe(1);
    expect(bookId).toBe(10);
    expect(state).toMatchObject({
      status: 'reading',
      source: 'manual',
      startedAt: started,
      finishedAt: finished,
    });
    expect(state.updatedAt).toBeInstanceOf(Date);
    expect(mockRepo.upsert).not.toHaveBeenCalled();
    expect(mockAchievementEvents.emit).not.toHaveBeenCalled();
  });

  it('seeds startedAt from sessions when no existing row has a date', async () => {
    const firstSession = new Date('2024-06-01T10:00:00.000Z');
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.findSessionBoundariesForBook.mockResolvedValue({ firstStartedAt: firstSession, lastEndedAt: new Date('2024-12-01T22:00:00.000Z') });

    await service.setManual(1, 10, 'reading');

    expect(mockRepo.findSessionBoundariesForBook).toHaveBeenCalledOnce();
    expect(mockRepo.upsertState).toHaveBeenCalledOnce();
    expect(mockRepo.upsertState.mock.calls[0]?.[2]).toMatchObject({
      status: 'reading',
      source: 'manual',
      startedAt: firstSession,
      finishedAt: null,
    });
  });

  it('seeds startedAt and finishedAt from sessions when status is read and existing has null dates', async () => {
    const firstSession = new Date('2024-06-01T10:00:00.000Z');
    const lastSession = new Date('2024-12-01T22:00:00.000Z');
    mockRepo.findOne.mockResolvedValue(makeRow({ startedAt: null, finishedAt: null, status: 'reading', source: 'auto' }));
    mockRepo.findSessionBoundariesForBook.mockResolvedValue({ firstStartedAt: firstSession, lastEndedAt: lastSession });

    await service.setManual(1, 10, 'read');

    expect(mockRepo.findSessionBoundariesForBook).toHaveBeenCalledOnce();
    expect(mockRepo.upsertState.mock.calls[0]?.[2]).toMatchObject({
      status: 'read',
      source: 'manual',
      startedAt: firstSession,
      finishedAt: lastSession,
    });
  });

  it('does not fetch session boundaries when existing row already has startedAt', async () => {
    const started = new Date('2026-04-01T00:00:00.000Z');
    mockRepo.findOne.mockResolvedValue(makeRow({ startedAt: started, finishedAt: null, status: 'reading', source: 'auto' }));

    await service.setManual(1, 10, 'reading');

    expect(mockRepo.findSessionBoundariesForBook).not.toHaveBeenCalled();
  });
});

describe('updateManual', () => {
  it('updates only provided fields and preserves omitted values', async () => {
    const existingStarted = new Date('2026-04-01T00:00:00.000Z');
    const existingFinished = new Date('2026-04-15T00:00:00.000Z');
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'read', source: 'auto', startedAt: existingStarted, finishedAt: existingFinished }));

    const nextStarted = new Date('2026-04-02T00:00:00.000Z');
    const result = await service.updateManual(1, 10, { startedAt: nextStarted });

    expect(mockRepo.upsertState).toHaveBeenCalledOnce();
    expect(mockRepo.upsertState.mock.calls[0]?.[2]).toMatchObject({
      status: 'read',
      source: 'manual',
      startedAt: nextStarted,
      finishedAt: existingFinished,
    });
    expect(result.status).toBe('read');
    expect(result.startedAt).toBe(nextStarted.toISOString());
    expect(result.finishedAt).toBe(existingFinished.toISOString());
  });

  it('allows explicit null clearing for date fields', async () => {
    const existingStarted = new Date('2026-04-01T00:00:00.000Z');
    const existingFinished = new Date('2026-04-15T00:00:00.000Z');
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'read', source: 'manual', startedAt: existingStarted, finishedAt: existingFinished }));

    const result = await service.updateManual(1, 10, { startedAt: null, finishedAt: null });

    expect(mockRepo.upsertState).toHaveBeenCalledOnce();
    expect(mockRepo.upsertState.mock.calls[0]?.[2]).toMatchObject({
      status: 'read',
      startedAt: null,
      finishedAt: null,
    });
    expect(result.startedAt).toBeNull();
    expect(result.finishedAt).toBeNull();
  });

  it('does not persist a no-op clear when no row exists', async () => {
    mockRepo.findOne.mockResolvedValue(null);

    const result = await service.updateManual(1, 10, { startedAt: null, finishedAt: null });

    expect(mockRepo.upsertState).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'unread',
      source: 'manual',
      startedAt: null,
      finishedAt: null,
    });
    expect(mockAchievementEvents.emit).not.toHaveBeenCalled();
  });

  it('emits achievement event only when a status patch changes the status', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'unread', source: 'auto' }));

    await service.updateManual(1, 10, { status: 'reading' });
    expect(mockAchievementEvents.emit).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'reading', source: 'manual' }));

    await service.updateManual(1, 10, { startedAt: new Date('2026-04-01T00:00:00.000Z') });
    expect(mockAchievementEvents.emit).not.toHaveBeenCalled();
  });

  it('does not seed dates or fetch boundaries for unread and want_to_read statuses', async () => {
    mockRepo.findSessionBoundariesForBook.mockResolvedValue({
      firstStartedAt: new Date('2024-06-01T10:00:00.000Z'),
      lastEndedAt: new Date('2024-12-01T22:00:00.000Z'),
    });

    for (const status of ['unread', 'want_to_read'] as const) {
      vi.clearAllMocks();
      mockRepo.findOne.mockResolvedValue(makeRow({ startedAt: null, finishedAt: null, status: 'reading', source: 'auto' }));
      mockRepo.upsertState.mockResolvedValue(undefined);
      mockRepo.findSessionBoundariesForBook.mockResolvedValue({
        firstStartedAt: new Date('2024-06-01T10:00:00.000Z'),
        lastEndedAt: new Date('2024-12-01T22:00:00.000Z'),
      });

      const result = await service.updateManual(1, 10, { status });

      expect(mockRepo.findSessionBoundariesForBook).not.toHaveBeenCalled();
      expect(result.startedAt).toBeNull();
      expect(result.finishedAt).toBeNull();
    }
  });

  it('does not seed finishedAt when the last session ended before the explicit startedAt', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.findSessionBoundariesForBook.mockResolvedValue({
      firstStartedAt: new Date('2024-06-01T10:00:00.000Z'),
      lastEndedAt: new Date('2024-12-01T22:00:00.000Z'),
    });

    const explicitStartedAt = new Date('2025-06-01T00:00:00.000Z');
    const result = await service.updateManual(1, 10, { status: 'read', startedAt: explicitStartedAt });

    expect(result.startedAt).toBe(explicitStartedAt.toISOString());
    expect(result.finishedAt).toBeNull();
  });

  it('seeds finishedAt when the last session ended after the seeded startedAt', async () => {
    const firstSession = new Date('2024-06-01T10:00:00.000Z');
    const lastSession = new Date('2024-12-01T22:00:00.000Z');
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'reading', source: 'auto', startedAt: null, finishedAt: null }));
    mockRepo.findSessionBoundariesForBook.mockResolvedValue({ firstStartedAt: firstSession, lastEndedAt: lastSession });

    const result = await service.updateManual(1, 10, { status: 'read' });

    expect(result.startedAt).toBe(firstSession.toISOString());
    expect(result.finishedAt).toBe(lastSession.toISOString());
  });

  it('does not fetch session boundaries when explicit null is provided for startedAt', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'reading', source: 'manual', startedAt: null, finishedAt: null }));

    const result = await service.updateManual(1, 10, { startedAt: null });

    expect(mockRepo.findSessionBoundariesForBook).not.toHaveBeenCalled();
    expect(result.startedAt).toBeNull();
  });

  it('does not fetch session boundaries when startedAt is already set on existing row', async () => {
    const existing = new Date('2026-01-01T00:00:00.000Z');
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'unread', source: 'auto', startedAt: existing, finishedAt: null }));

    await service.updateManual(1, 10, { status: 'reading' });

    expect(mockRepo.findSessionBoundariesForBook).not.toHaveBeenCalled();
    const state = mockRepo.upsertState.mock.calls[0]?.[2];
    expect(state?.startedAt).toEqual(existing);
  });

  it('does not seed finishedAt for non-read statuses even when session boundaries exist', async () => {
    const lastSession = new Date('2024-12-01T22:00:00.000Z');
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'unread', source: 'auto', startedAt: null, finishedAt: null }));
    mockRepo.findSessionBoundariesForBook.mockResolvedValue({ firstStartedAt: new Date('2024-06-01T10:00:00.000Z'), lastEndedAt: lastSession });

    const result = await service.updateManual(1, 10, { status: 'reading' });

    expect(result.finishedAt).toBeNull();
  });

  it('leaves finishedAt null when sessions have no data and status is read', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'reading', source: 'auto', startedAt: null, finishedAt: null }));
    mockRepo.findSessionBoundariesForBook.mockResolvedValue({ firstStartedAt: null, lastEndedAt: null });

    const result = await service.updateManual(1, 10, { status: 'read' });

    expect(result.startedAt).toBeNull();
    expect(result.finishedAt).toBeNull();
  });
});

describe('bulkSetManual', () => {
  it('returns early when no book ids are provided', async () => {
    await service.bulkSetManual(1, [], 'reading');
    expect(mockRepo.findByBookIds).not.toHaveBeenCalled();
    expect(mockRepo.upsertState).not.toHaveBeenCalled();
    expect(mockAchievementEvents.emit).not.toHaveBeenCalled();
  });

  it('preserves existing dates and emits events only for changed statuses', async () => {
    const existingStarted = new Date('2026-04-01T00:00:00.000Z');
    const existingFinished = new Date('2026-04-12T00:00:00.000Z');
    mockRepo.findByBookIds.mockResolvedValue([
      makeRow({ bookId: 10, status: 'unread', source: 'auto', startedAt: existingStarted, finishedAt: existingFinished }),
      makeRow({ bookId: 11, status: 'reading', source: 'manual', startedAt: existingStarted, finishedAt: null }),
    ]);

    await service.bulkSetManual(1, [10, 11, 12], 'reading');

    expect(mockRepo.upsertState).toHaveBeenCalledTimes(3);
    expect(mockRepo.upsertState).toHaveBeenCalledWith(
      1,
      10,
      expect.objectContaining({ status: 'reading', source: 'manual', startedAt: existingStarted, finishedAt: existingFinished }),
    );
    expect(mockRepo.upsertState).toHaveBeenCalledWith(
      1,
      11,
      expect.objectContaining({ status: 'reading', source: 'manual', startedAt: existingStarted, finishedAt: null }),
    );
    expect(mockRepo.upsertState).toHaveBeenCalledWith(
      1,
      12,
      expect.objectContaining({ status: 'reading', source: 'manual', startedAt: null, finishedAt: null }),
    );

    expect(mockAchievementEvents.emit).toHaveBeenCalledTimes(2);
    expect(mockAchievementEvents.emit).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ userId: 1, bookId: 10, previousStatus: 'unread', newStatus: 'reading' }),
    );
    expect(mockAchievementEvents.emit).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ userId: 1, bookId: 12, previousStatus: null, newStatus: 'reading' }),
    );
  });
});

describe('autoUpdate with default thresholds', () => {
  it.each([
    { percentage: 0.1, expectedStatus: null },
    { percentage: 0.25, expectedStatus: 'reading' },
    { percentage: 50, expectedStatus: 'reading' },
    { percentage: 98, expectedStatus: 'read' },
    { percentage: 100, expectedStatus: 'read' },
  ])('derives expected status for percentage=$percentage', async ({ percentage, expectedStatus }) => {
    await service.autoUpdate(1, 10, percentage);

    if (expectedStatus === null) {
      expect(mockRepo.upsert).not.toHaveBeenCalled();
      expect(mockRepo.upsertState).not.toHaveBeenCalled();
      return;
    }

    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe(expectedStatus);
  });
});

describe('autoUpdate with custom thresholds', () => {
  it.each([
    { percentage: 0.5, readingThreshold: 1, finishThreshold: 90, existingStatus: 'reading', expectedStatus: 'unread' },
    { percentage: 1, readingThreshold: 1, finishThreshold: 90, existingStatus: 'unread', expectedStatus: 'reading' },
    { percentage: 90, readingThreshold: 1, finishThreshold: 90, existingStatus: 'reading', expectedStatus: 'read' },
  ])(
    'derives expected status for percentage=$percentage',
    async ({ percentage, readingThreshold, finishThreshold, existingStatus, expectedStatus }) => {
      mockRepo.findOne.mockResolvedValue(makeRow({ status: existingStatus, source: 'auto' }));

      await service.autoUpdate(1, 10, percentage, readingThreshold, finishThreshold);

      expect(mockRepo.upsert).toHaveBeenCalledOnce();
      expect(mockRepo.upsert.mock.calls[0][2]).toBe(expectedStatus);
    },
  );

  it('falls back to defaults for null and undefined thresholds', async () => {
    await service.autoUpdate(1, 10, 98, null, undefined);

    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('read');
  });
});

describe('autoUpdate normalization and guard behavior', () => {
  it('does not override manual statuses', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'unread', source: 'manual' }));

    await service.autoUpdate(1, 10, 100);

    expect(mockRepo.upsert).not.toHaveBeenCalled();
    expect(mockRepo.upsertState).not.toHaveBeenCalled();
  });

  it('skips updates when derived status is unchanged', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'reading', source: 'auto' }));

    await service.autoUpdate(1, 10, 50);

    expect(mockRepo.upsert).not.toHaveBeenCalled();
  });

  it('passes existing row to upsert for lifecycle derivation', async () => {
    const existing = makeRow({ status: 'reading', source: 'auto' });
    mockRepo.findOne.mockResolvedValue(existing);

    await service.autoUpdate(1, 10, 99);

    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][5]).toBe(existing);
  });

  it('clamps percentage values outside 0..100', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'reading', source: 'auto' }));

    await service.autoUpdate(1, 10, 120);
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('read');

    vi.clearAllMocks();
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'read', source: 'auto' }));
    mockRepo.upsert.mockResolvedValue(undefined);

    await service.autoUpdate(1, 10, -12);
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('unread');
  });

  it('treats non-finite percentages as 0', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'reading', source: 'auto' }));

    await service.autoUpdate(1, 10, Number.NaN);

    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('unread');
  });

  it('falls back to default thresholds for non-finite values', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'unread', source: 'auto' }));

    await service.autoUpdate(1, 10, 50, Number.NaN, Number.POSITIVE_INFINITY);

    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('reading');
  });

  it('clamps custom thresholds into the 0..100 range', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'unread', source: 'auto' }));

    await service.autoUpdate(1, 10, 50, -5, 150);

    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('reading');
  });

  it('normalizes inverted thresholds to keep read threshold <= finish threshold', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'reading', source: 'auto' }));

    await service.autoUpdate(1, 10, 79, 90, 80);

    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('unread');
  });
});

describe('findOne', () => {
  it('returns null when repo returns null', async () => {
    const result = await service.findOne(1, 10);
    expect(result).toBeNull();
  });

  it('maps valid rows into DTO shape', async () => {
    const started = new Date('2024-03-01T08:00:00.000Z');
    const finished = new Date('2024-06-01T12:00:00.000Z');
    const updated = new Date('2024-06-01T12:00:00.000Z');
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'read', source: 'manual', startedAt: started, finishedAt: finished, updatedAt: updated }));

    const result = await service.findOne(1, 10);

    expect(result).toEqual({
      status: 'read',
      source: 'manual',
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      updatedAt: updated.toISOString(),
    });
  });

  it('throws when row status is invalid', async () => {
    mockRepo.findOne.mockResolvedValue(
      makeRow({
        status: 'not_a_status' as unknown as UserBookStatusRow['status'],
      }),
    );

    await expect(service.findOne(1, 10)).rejects.toThrowError(InternalServerErrorException);
  });

  it('throws when row source is invalid', async () => {
    mockRepo.findOne.mockResolvedValue(
      makeRow({
        source: 'not_a_source' as unknown as UserBookStatusRow['source'],
      }),
    );

    await expect(service.findOne(1, 10)).rejects.toThrowError(InternalServerErrorException);
  });
});

describe('findByBookIds', () => {
  it('returns empty map when repo returns no rows', async () => {
    const result = await service.findByBookIds(1, []);
    expect(result.size).toBe(0);
  });

  it('maps rows keyed by bookId', async () => {
    const updated1 = new Date('2024-05-01T00:00:00.000Z');
    const updated2 = new Date('2024-06-01T00:00:00.000Z');
    mockRepo.findByBookIds.mockResolvedValue([
      makeRow({ bookId: 10, status: 'reading', source: 'auto', updatedAt: updated1 }),
      makeRow({ bookId: 20, status: 'read', source: 'manual', updatedAt: updated2 }),
    ]);

    const result = await service.findByBookIds(1, [10, 20]);

    expect(result.size).toBe(2);
    expect(result.get(10)).toEqual({
      status: 'reading',
      source: 'auto',
      startedAt: null,
      finishedAt: null,
      updatedAt: updated1.toISOString(),
    });
    expect(result.get(20)?.status).toBe('read');
  });
});
