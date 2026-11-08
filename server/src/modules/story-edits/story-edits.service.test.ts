import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { STORY_EDITS_PAGE_MAX, STORY_EDITS_PER_BOOK_MAX } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { StoryEditRow } from '../../db/schema';
import { STORY_EDITS_LIMIT_REACHED, StoryEditsService, toStoryEdit } from './story-edits.service';

const EDIT_ID = '4f9c7a52-3d1e-4b6a-9a51-0c2f6e8d7b13';
const user = { id: 8, username: 'reader', isSuperuser: false, permissions: [] } as unknown as RequestUser;

function row(overrides: Partial<StoryEditRow> = {}): StoryEditRow {
  return {
    userId: 8,
    bookId: 5,
    id: EDIT_ID,
    kind: 'merge',
    data: { from: 'Strider', into: 'Aragorn' },
    position: 0.25,
    clientUpdatedAt: new Date('2026-11-06T10:00:00.000Z'),
    deleted: false,
    revision: 1,
    createdAt: new Date('2026-11-06T10:00:01.000Z'),
    updatedAt: new Date('2026-11-06T10:00:01.000Z'),
    ...overrides,
  };
}

function rows(count: number, firstRevision = 1): StoryEditRow[] {
  return Array.from({ length: count }, (_, index) =>
    row({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, revision: firstRevision + index }),
  );
}

describe('StoryEditsService', () => {
  const repo = { listSince: vi.fn(), write: vi.fn() };
  const bookService = { verifyBookAccess: vi.fn() };
  const service = new StoryEditsService(repo as never, bookService as never);

  beforeEach(() => {
    vi.resetAllMocks();
    bookService.verifyBookAccess.mockResolvedValue(undefined);
  });

  describe('list', () => {
    it('reads from the start by default and asks for one row past the page to learn whether more exist', async () => {
      repo.listSince.mockResolvedValue(rows(2));

      const page = await service.list(5, user, {});

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, user);
      expect(repo.listSince).toHaveBeenCalledWith(8, 5, 0, STORY_EDITS_PAGE_MAX + 1);
      expect(page.hasMore).toBe(false);
      expect(page.cursor).toBe('2');
      expect(page.edits.map((edit) => edit.id)).toEqual(rows(2).map((edit) => edit.id));
    });

    it('treats an empty since as the start', async () => {
      repo.listSince.mockResolvedValue([]);

      const page = await service.list(5, user, { since: '' });

      expect(repo.listSince).toHaveBeenCalledWith(8, 5, 0, STORY_EDITS_PAGE_MAX + 1);
      expect(page).toEqual({ edits: [], cursor: '0', hasMore: false });
    });

    it('trims the extra row, reports more, and puts the cursor on the last row returned', async () => {
      repo.listSince.mockResolvedValue(rows(4, 11));

      const page = await service.list(5, user, { since: '10', limit: 3 });

      expect(repo.listSince).toHaveBeenCalledWith(8, 5, 10, 4);
      expect(page.edits).toHaveLength(3);
      expect(page.cursor).toBe('13');
      expect(page.hasMore).toBe(true);
    });

    it('reports no more on a page that is exactly full', async () => {
      repo.listSince.mockResolvedValue(rows(3, 11));

      const page = await service.list(5, user, { since: '10', limit: 3 });

      expect(page.hasMore).toBe(false);
      expect(page.cursor).toBe('13');
    });

    it('hands back the incoming cursor when nothing changed since it', async () => {
      repo.listSince.mockResolvedValue([]);

      expect(await service.list(5, user, { since: '981' })).toEqual({ edits: [], cursor: '981', hasMore: false });
    });

    it('includes tombstones, so other devices learn of deletes', async () => {
      repo.listSince.mockResolvedValue([row({ deleted: true, revision: 4 })]);

      const page = await service.list(5, user, {});

      expect(page.edits).toEqual([expect.objectContaining({ id: EDIT_ID, deleted: true })]);
    });

    it('reads nothing for a book the reader cannot see', async () => {
      bookService.verifyBookAccess.mockRejectedValue(new NotFoundException('Book 5 not found'));

      await expect(service.list(5, user, {})).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.listSince).not.toHaveBeenCalled();
    });
  });

  describe('put', () => {
    const dto = { kind: 'merge', data: { from: 'Strider', into: 'Aragorn' }, position: 0.25, updatedAt: '2026-11-06T10:00:00.000Z', deleted: false };

    it('writes the correction for the reader, book and id, and answers the stored row', async () => {
      repo.write.mockResolvedValue({ outcome: 'written', row: row() });

      const result = await service.put(5, EDIT_ID, user, dto);

      expect(repo.write).toHaveBeenCalledWith(
        {
          userId: 8,
          bookId: 5,
          id: EDIT_ID,
          kind: 'merge',
          data: dto.data,
          position: 0.25,
          clientUpdatedAt: new Date('2026-11-06T10:00:00.000Z'),
          deleted: false,
        },
        STORY_EDITS_PER_BOOK_MAX,
      );
      expect(result).toEqual({
        id: EDIT_ID,
        kind: 'merge',
        data: { from: 'Strider', into: 'Aragorn' },
        position: 0.25,
        updatedAt: '2026-11-06T10:00:00.000Z',
        deleted: false,
      });
    });

    it('defaults an absent position to null and an absent deleted flag to false', async () => {
      repo.write.mockResolvedValue({ outcome: 'written', row: row({ position: null }) });

      await service.put(5, EDIT_ID, user, { kind: 'note', data: {}, updatedAt: '2026-11-06T10:00:00Z' });

      expect(repo.write.mock.calls[0]![0]).toMatchObject({ position: null, deleted: false });
    });

    it('writes a delete as a tombstone', async () => {
      repo.write.mockResolvedValue({ outcome: 'written', row: row({ deleted: true }) });

      const result = await service.put(5, EDIT_ID, user, { ...dto, deleted: true });

      expect(repo.write.mock.calls[0]![0]).toMatchObject({ deleted: true });
      expect(result.deleted).toBe(true);
    });

    it('answers the stored row unchanged when it is newer than the write', async () => {
      const stored = row({ kind: 'rename', data: { name: 'Elessar' }, clientUpdatedAt: new Date('2026-11-06T11:00:00.000Z'), revision: 9 });
      repo.write.mockResolvedValue({ outcome: 'kept', row: stored });

      const result = await service.put(5, EDIT_ID, user, dto);

      expect(result).toEqual(toStoryEdit(stored));
      expect(result.updatedAt).toBe('2026-11-06T11:00:00.000Z');
    });

    it('answers 409 with a stable code when a new live correction would pass the per-book cap', async () => {
      repo.write.mockResolvedValue({ outcome: 'refused' });

      const error = await service.put(5, EDIT_ID, user, dto).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        errorCode: STORY_EDITS_LIMIT_REACHED,
        errorMeta: { limit: STORY_EDITS_PER_BOOK_MAX },
      });
    });

    it('refuses an ISO 8601 form that does not name an instant', async () => {
      await expect(service.put(5, EDIT_ID, user, { ...dto, updatedAt: '2026-W45-5' })).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.write).not.toHaveBeenCalled();
    });

    it('writes nothing for a book the reader cannot see', async () => {
      bookService.verifyBookAccess.mockRejectedValue(new NotFoundException('Book 5 not found'));

      await expect(service.put(5, EDIT_ID, user, dto)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.write).not.toHaveBeenCalled();
    });
  });
});
