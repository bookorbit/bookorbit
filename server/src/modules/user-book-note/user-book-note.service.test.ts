import { beforeEach, describe, expect, it, vi } from 'vitest';

import { USER_BOOK_NOTE_MAX_LENGTH, UserBookNoteService } from './user-book-note.service';

describe('UserBookNoteService', () => {
  let repo: {
    findOne: ReturnType<typeof vi.fn>;
    findByBookIds: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  let service: UserBookNoteService;

  beforeEach(() => {
    repo = {
      findOne: vi.fn(),
      findByBookIds: vi.fn(),
      upsert: vi.fn(),
    };
    service = new UserBookNoteService(repo as never);
  });

  it('normalizes blank notes to null and trims text', async () => {
    const updatedAt = new Date('2026-07-01T12:00:00.000Z');
    repo.upsert.mockResolvedValue({ userId: 1, bookId: 2, note: 'review', updatedAt });

    await expect(service.setNote(1, 2, '  review  ', updatedAt)).resolves.toEqual({
      note: 'review',
      updatedAt: '2026-07-01T12:00:00.000Z',
    });
    expect(repo.upsert).toHaveBeenCalledWith(1, 2, 'review', updatedAt);

    repo.upsert.mockResolvedValue({ userId: 1, bookId: 2, note: null, updatedAt });
    await service.setNote(1, 2, '   ', updatedAt);
    expect(repo.upsert).toHaveBeenLastCalledWith(1, 2, null, updatedAt);
  });

  it('caps notes at the sync contract limit', () => {
    const value = 'a'.repeat(USER_BOOK_NOTE_MAX_LENGTH + 10);

    expect(service.normalizeNote(value)).toHaveLength(USER_BOOK_NOTE_MAX_LENGTH);
  });

  it('findOne maps the repository row to a dto and returns null when missing', async () => {
    const updatedAt = new Date('2026-07-02T00:00:00.000Z');
    repo.findOne.mockResolvedValue({ userId: 1, bookId: 2, note: 'review', updatedAt });

    await expect(service.findOne(1, 2)).resolves.toEqual({ note: 'review', updatedAt: '2026-07-02T00:00:00.000Z' });

    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne(1, 2)).resolves.toBeNull();
  });

  it('findRow returns the raw repository row', async () => {
    const updatedAt = new Date('2026-07-03T00:00:00.000Z');
    const row = { userId: 1, bookId: 2, note: 'review', updatedAt };
    repo.findOne.mockResolvedValue(row);

    await expect(service.findRow(1, 2)).resolves.toEqual(row);
  });

  it('findByBookIds maps rows by book id', async () => {
    const updatedAt = new Date('2026-07-04T00:00:00.000Z');
    repo.findByBookIds.mockResolvedValue([
      { userId: 1, bookId: 2, note: 'a', updatedAt },
      { userId: 1, bookId: 3, note: null, updatedAt },
    ]);

    const result = await service.findByBookIds(1, [2, 3]);

    expect(repo.findByBookIds).toHaveBeenCalledWith(1, [2, 3]);
    expect(result.get(2)).toEqual({ note: 'a', updatedAt: '2026-07-04T00:00:00.000Z' });
    expect(result.get(3)).toEqual({ note: null, updatedAt: '2026-07-04T00:00:00.000Z' });
  });
});
