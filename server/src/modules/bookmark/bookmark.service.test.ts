import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { BookmarkService } from './bookmark.service';
import { BookmarkResponseDto } from './dto/bookmark-response.dto';
import type { CreateBookmarkDto } from './dto/create-bookmark.dto';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 1,
    username: 'bookmarker',
    name: 'Book Marker',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeBookmarkRow(overrides?: Record<string, unknown>) {
  return {
    id: 10,
    userId: 1,
    bookId: 5,
    cfi: 'epubcfi(/6/4!/4/2/1:0)',
    title: 'Chapter 1',
    positionSeconds: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeService() {
  const bookmarkRepo = {
    findByBookId: vi.fn(),
    findLiveByLocation: vi.fn(),
    create: vi.fn(),
    restoreAtLocation: vi.fn().mockResolvedValue(null),
    softDelete: vi.fn(),
    findLive: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
  };
  const bookService = {
    verifyBookAccess: vi.fn().mockResolvedValue(undefined),
  };
  const service = new BookmarkService(bookmarkRepo as never, bookService as never);
  return { service, bookmarkRepo, bookService };
}

describe('BookmarkService', () => {
  describe('getBookmarks', () => {
    it('verifies access and returns mapped response DTOs', async () => {
      const { service, bookmarkRepo, bookService } = makeService();
      const user = makeUser();
      bookmarkRepo.findByBookId.mockResolvedValue([makeBookmarkRow()]);

      const result = await service.getBookmarks(5, user);

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, user);
      expect(bookmarkRepo.findByBookId).toHaveBeenCalledWith(5, user.id);
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(BookmarkResponseDto);
      expect(result[0]).not.toHaveProperty('userId');
    });

    it('propagates access errors', async () => {
      const { service, bookService, bookmarkRepo } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.getBookmarks(5, makeUser())).rejects.toThrow(ForbiddenException);
      expect(bookmarkRepo.findByBookId).not.toHaveBeenCalled();
    });
  });

  describe('createBookmark', () => {
    it('returns an existing bookmark for duplicate CFI requests', async () => {
      const { service, bookmarkRepo, bookService } = makeService();
      const user = makeUser();
      const existing = makeBookmarkRow();
      bookmarkRepo.findLiveByLocation.mockResolvedValue(existing);

      const dto: CreateBookmarkDto = { cfi: 'epubcfi(/6/4!/4/2/1:0)', title: 'Chapter 1' };
      const result = await service.createBookmark(5, user, dto);

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, user);
      expect(bookmarkRepo.findLiveByLocation).toHaveBeenCalledWith(1, 5, {
        cfi: 'epubcfi(/6/4!/4/2/1:0)',
        positionSeconds: null,
      });
      expect(bookmarkRepo.create).not.toHaveBeenCalled();
      expect(result.id).toBe(existing.id);
    });

    it('creates and maps a bookmark when no duplicate exists', async () => {
      const { service, bookmarkRepo } = makeService();
      const createdRow = makeBookmarkRow({ id: 12, title: 'Chapter 2' });
      bookmarkRepo.findLiveByLocation.mockResolvedValue(null);
      bookmarkRepo.create.mockResolvedValue(createdRow);

      const result = await service.createBookmark(5, makeUser(), { title: 'Chapter 2', cfi: 'epubcfi(/6/8)' });

      expect(bookmarkRepo.create).toHaveBeenCalledWith(1, 5, { cfi: 'epubcfi(/6/8)', title: 'Chapter 2', positionSeconds: null });
      expect(result).toBeInstanceOf(BookmarkResponseDto);
      expect(result.id).toBe(12);
      expect(result.cfi).toBe('epubcfi(/6/4!/4/2/1:0)');
      expect(result.positionSeconds).toBeNull();
    });

    it('re-reads and returns the existing bookmark when a concurrent duplicate insert is ignored', async () => {
      const { service, bookmarkRepo } = makeService();
      const existing = makeBookmarkRow({ id: 13, title: 'Chapter 2' });
      bookmarkRepo.findLiveByLocation.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
      bookmarkRepo.create.mockResolvedValue(null);

      const result = await service.createBookmark(5, makeUser(), { title: 'Chapter 2', cfi: 'epubcfi(/6/8)' });

      expect(bookmarkRepo.findLiveByLocation).toHaveBeenNthCalledWith(2, 1, 5, { cfi: 'epubcfi(/6/8)', positionSeconds: null });
      expect(result.id).toBe(13);
    });

    it('restores the tombstone that still owns the location instead of failing the insert', async () => {
      const { service, bookmarkRepo } = makeService();
      const restored = makeBookmarkRow({ id: 14, deletedAt: null });
      bookmarkRepo.findLiveByLocation.mockResolvedValue(null);
      bookmarkRepo.create.mockResolvedValue(null);
      bookmarkRepo.restoreAtLocation.mockResolvedValue(restored);

      const result = await service.createBookmark(5, makeUser(), { title: 'Chapter 1', cfi: 'epubcfi(/6/4!/4/2/1:0)' });

      expect(bookmarkRepo.restoreAtLocation).toHaveBeenCalledWith(
        1,
        5,
        { cfi: 'epubcfi(/6/4!/4/2/1:0)', positionSeconds: null },
        { title: 'Chapter 1', origin: 'web', devicePos: null, pageno: null },
      );
      expect(result.id).toBe(14);
    });

    it('propagates access errors and does not query repository', async () => {
      const { service, bookService, bookmarkRepo } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new NotFoundException('Book 5 not found'));

      await expect(service.createBookmark(5, makeUser(), { title: 'x', cfi: 'epubcfi(/6/2)' })).rejects.toThrow(NotFoundException);
      expect(bookmarkRepo.findLiveByLocation).not.toHaveBeenCalled();
      expect(bookmarkRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('updateBookmark', () => {
    it('verifies access, patches only the sent fields and returns the mapped bookmark', async () => {
      const { service, bookmarkRepo, bookService } = makeService();
      const user = makeUser();
      bookmarkRepo.update.mockResolvedValue(makeBookmarkRow({ title: 'Renamed', note: 'Why', updatedAt: new Date('2026-02-01T00:00:00Z') }));

      const result = await service.updateBookmark(5, 10, user, { title: 'Renamed', note: 'Why' });

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, user);
      expect(bookmarkRepo.update).toHaveBeenCalledWith(5, 10, 1, { title: 'Renamed', note: 'Why' });
      expect(result).toBeInstanceOf(BookmarkResponseDto);
      expect(result).toMatchObject({ title: 'Renamed', note: 'Why' });
    });

    it('clears the note with null and leaves the title alone', async () => {
      const { service, bookmarkRepo } = makeService();
      bookmarkRepo.update.mockResolvedValue(makeBookmarkRow({ note: null }));

      await service.updateBookmark(5, 10, makeUser(), { note: null });

      expect(bookmarkRepo.update).toHaveBeenCalledWith(5, 10, 1, { note: null });
    });

    it('reads the live bookmark instead of writing when nothing was sent', async () => {
      const { service, bookmarkRepo } = makeService();
      bookmarkRepo.findLive.mockResolvedValue(makeBookmarkRow());

      await service.updateBookmark(5, 10, makeUser(), {});

      expect(bookmarkRepo.update).not.toHaveBeenCalled();
      expect(bookmarkRepo.findLive).toHaveBeenCalledWith(5, 10, 1);
    });

    it('throws NotFoundException for a missing, tombstoned or foreign bookmark', async () => {
      const { service } = makeService();

      await expect(service.updateBookmark(5, 99, makeUser(), { title: 'x' })).rejects.toThrow('Bookmark 99 not found for book 5');
      await expect(service.updateBookmark(5, 99, makeUser(), {})).rejects.toThrow(NotFoundException);
    });

    it('propagates access errors and skips the update', async () => {
      const { service, bookService, bookmarkRepo } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.updateBookmark(5, 10, makeUser(), { title: 'x' })).rejects.toThrow(ForbiddenException);
      expect(bookmarkRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteBookmark', () => {
    it('verifies access and soft deletes the bookmark', async () => {
      const { service, bookmarkRepo, bookService } = makeService();
      const user = makeUser();
      bookmarkRepo.softDelete.mockResolvedValue(true);

      await expect(service.deleteBookmark(5, 10, user)).resolves.toBeUndefined();

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, user);
      expect(bookmarkRepo.softDelete).toHaveBeenCalledWith(5, 10, 1);
    });

    it('throws NotFoundException with stable message when bookmark is missing', async () => {
      const { service, bookmarkRepo } = makeService();
      bookmarkRepo.softDelete.mockResolvedValue(false);

      await expect(service.deleteBookmark(5, 99, makeUser())).rejects.toThrow(NotFoundException);
      await expect(service.deleteBookmark(5, 99, makeUser())).rejects.toThrow('Bookmark 99 not found for book 5');
    });

    it('propagates access errors and skips delete query', async () => {
      const { service, bookService, bookmarkRepo } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.deleteBookmark(5, 10, makeUser())).rejects.toThrow(ForbiddenException);
      expect(bookmarkRepo.softDelete).not.toHaveBeenCalled();
    });
  });
});
