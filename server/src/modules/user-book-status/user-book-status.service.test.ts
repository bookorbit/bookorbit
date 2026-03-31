import { InternalServerErrorException } from '@nestjs/common';
import type { ReadStatus, ReadStatusSource } from '@projectx/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserBookStatusRow } from '../../db/schema';
import { UserBookStatusRepository } from './user-book-status.repository';
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
};

let service: UserBookStatusService;

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.findOne.mockResolvedValue(null);
  mockRepo.findByBookIds.mockResolvedValue([]);
  mockRepo.upsert.mockResolvedValue(undefined);
  service = new UserBookStatusService(mockRepo as unknown as UserBookStatusRepository);
});

describe('setManual', () => {
  it('calls upsert with manual source', async () => {
    await service.setManual(1, 10, 'reading');

    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    const [userId, bookId, status, source, now] = mockRepo.upsert.mock.calls[0];
    expect(userId).toBe(1);
    expect(bookId).toBe(10);
    expect(status).toBe('reading');
    expect(source).toBe('manual');
    expect(now).toBeInstanceOf(Date);
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
