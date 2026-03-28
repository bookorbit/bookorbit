import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserBookStatusService } from './user-book-status.service';
import type { UserBookStatusRow } from '../../db/schema';

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
  findOne: vi.fn(),
  findByBookIds: vi.fn(),
  upsert: vi.fn(),
};

let service: UserBookStatusService;

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.upsert.mockResolvedValue(undefined);
  service = new UserBookStatusService(mockRepo as any);
});

describe('setManual', () => {
  it('calls upsert with source manual and correct args', async () => {
    await service.setManual(1, 10, 'reading');
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    const [userId, bookId, status, source] = mockRepo.upsert.mock.calls[0];
    expect(userId).toBe(1);
    expect(bookId).toBe(10);
    expect(status).toBe('reading');
    expect(source).toBe('manual');
  });

  it('passes a Date instance for now', async () => {
    await service.setManual(1, 10, 'read');
    const now = mockRepo.upsert.mock.calls[0][4];
    expect(now).toBeInstanceOf(Date);
  });
});

describe('autoUpdate — default thresholds', () => {
  it('does not call upsert when no existing record and percentage is below reading threshold', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await service.autoUpdate(1, 10, 0.1);
    expect(mockRepo.upsert).not.toHaveBeenCalled();
  });

  it('calls upsert with reading when no existing record and percentage equals reading threshold', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await service.autoUpdate(1, 10, 0.25);
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('reading');
  });

  it('calls upsert with reading when no existing record and percentage is above reading but below finish', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await service.autoUpdate(1, 10, 50);
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('reading');
  });

  it('calls upsert with read when no existing record and percentage equals finish threshold', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await service.autoUpdate(1, 10, 98);
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('read');
  });

  it('calls upsert with read when no existing record and percentage is above finish threshold', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await service.autoUpdate(1, 10, 100);
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('read');
  });
});

describe('autoUpdate — custom thresholds', () => {
  it('derives unread when percentage is below custom reading threshold', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'reading', source: 'auto' }));
    await service.autoUpdate(1, 10, 0.5, 1, 90);
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('unread');
  });

  it('derives reading when percentage equals custom reading threshold', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await service.autoUpdate(1, 10, 1.0, 1, 90);
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('reading');
  });

  it('derives read when percentage equals custom finish threshold', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await service.autoUpdate(1, 10, 90, 1, 90);
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('read');
  });

  it('falls back to default thresholds when null is passed', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await service.autoUpdate(1, 10, 0.25, null, null);
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('reading');
  });

  it('falls back to default thresholds when undefined is passed', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await service.autoUpdate(1, 10, 98, undefined, undefined);
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('read');
  });
});

describe('autoUpdate — existing record logic', () => {
  it('calls upsert when existing auto record is unread and derived is reading', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'unread', source: 'auto' }));
    await service.autoUpdate(1, 10, 50);
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('reading');
  });

  it('does not call upsert when existing auto record matches derived status', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'reading', source: 'auto' }));
    await service.autoUpdate(1, 10, 50);
    expect(mockRepo.upsert).not.toHaveBeenCalled();
  });

  it('calls upsert when existing auto record is reading and derived is read', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'reading', source: 'auto' }));
    await service.autoUpdate(1, 10, 99);
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('read');
  });

  it('does not call upsert when existing record source is manual', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'unread', source: 'manual' }));
    await service.autoUpdate(1, 10, 100);
    expect(mockRepo.upsert).not.toHaveBeenCalled();
  });

  it('calls upsert with unread when existing auto read record drops below reading threshold', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ status: 'read', source: 'auto' }));
    await service.autoUpdate(1, 10, 0.1);
    expect(mockRepo.upsert).toHaveBeenCalledOnce();
    expect(mockRepo.upsert.mock.calls[0][2]).toBe('unread');
  });
});

describe('findOne', () => {
  it('returns null when repo returns null', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    const result = await service.findOne(1, 10);
    expect(result).toBeNull();
  });

  it('maps row to DTO with all fields as ISO strings', async () => {
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

  it('returns null startedAt and finishedAt when they are null on the row', async () => {
    mockRepo.findOne.mockResolvedValue(makeRow({ startedAt: null, finishedAt: null }));
    const result = await service.findOne(1, 10);
    expect(result?.startedAt).toBeNull();
    expect(result?.finishedAt).toBeNull();
  });
});

describe('findByBookIds', () => {
  it('returns empty Map when repo returns empty array', async () => {
    mockRepo.findByBookIds.mockResolvedValue([]);
    const result = await service.findByBookIds(1, []);
    expect(result.size).toBe(0);
  });

  it('maps a single row correctly into the Map', async () => {
    const updated = new Date('2024-05-01T00:00:00.000Z');
    mockRepo.findByBookIds.mockResolvedValue([makeRow({ bookId: 10, status: 'reading', source: 'auto', updatedAt: updated })]);
    const result = await service.findByBookIds(1, [10]);
    expect(result.size).toBe(1);
    expect(result.get(10)).toEqual({
      status: 'reading',
      source: 'auto',
      startedAt: null,
      finishedAt: null,
      updatedAt: updated.toISOString(),
    });
  });

  it('maps multiple rows keyed by bookId', async () => {
    const updated1 = new Date('2024-05-01T00:00:00.000Z');
    const updated2 = new Date('2024-06-01T00:00:00.000Z');
    mockRepo.findByBookIds.mockResolvedValue([
      makeRow({ bookId: 10, status: 'reading', source: 'auto', updatedAt: updated1 }),
      makeRow({ bookId: 20, status: 'read', source: 'manual', updatedAt: updated2 }),
    ]);
    const result = await service.findByBookIds(1, [10, 20]);
    expect(result.size).toBe(2);
    expect(result.get(10)?.status).toBe('reading');
    expect(result.get(20)?.status).toBe('read');
  });
});
