import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { BookmarkService } from './bookmark.service';
import { BookmarkResponseDto } from './dto/bookmark-response.dto';
import type { CreateBookmarkDto } from './dto/create-bookmark.dto';

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
    findExistingByLocation: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
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
      bookmarkRepo.findExistingByLocation.mockResolvedValue(existing);

      const dto: CreateBookmarkDto = { cfi: 'epubcfi(/6/4!/4/2/1:0)', title: 'Chapter 1' };
      const result = await service.createBookmark(5, user, dto);

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, user);
      expect(bookmarkRepo.findExistingByLocation).toHaveBeenCalledWith(1, 5, {
        cfi: 'epubcfi(/6/4!/4/2/1:0)',
        positionSeconds: null,
      });
      expect(bookmarkRepo.create).not.toHaveBeenCalled();
      expect(result.id).toBe(existing.id);
    });

    it('returns an existing bookmark for duplicate audio position requests', async () => {
      const { service, bookmarkRepo } = makeService();
      const existing = makeBookmarkRow({ id: 11, cfi: null, positionSeconds: 93.5, title: '00:01:33' });
      bookmarkRepo.findExistingByLocation.mockResolvedValue(existing);

      const result = await service.createBookmark(5, makeUser(), { title: '00:01:33', positionSeconds: 93.5 });

      expect(bookmarkRepo.findExistingByLocation).toHaveBeenCalledWith(1, 5, { cfi: null, positionSeconds: 93.5 });
      expect(bookmarkRepo.create).not.toHaveBeenCalled();
      expect(result.id).toBe(11);
      expect(result.positionSeconds).toBe(93.5);
    });

    it('creates and maps a bookmark when no duplicate exists', async () => {
      const { service, bookmarkRepo } = makeService();
      const createdRow = makeBookmarkRow({ id: 12, cfi: null, positionSeconds: 42, title: '00:00:42' });
      bookmarkRepo.findExistingByLocation.mockResolvedValue(null);
      bookmarkRepo.create.mockResolvedValue(createdRow);

      const result = await service.createBookmark(5, makeUser(), { title: '00:00:42', positionSeconds: 42 });

      expect(bookmarkRepo.create).toHaveBeenCalledWith(1, 5, { cfi: null, title: '00:00:42', positionSeconds: 42 });
      expect(result).toBeInstanceOf(BookmarkResponseDto);
      expect(result.id).toBe(12);
      expect(result.cfi).toBeNull();
      expect(result.positionSeconds).toBe(42);
    });

    it('propagates access errors and does not query repository', async () => {
      const { service, bookService, bookmarkRepo } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new NotFoundException('Book 5 not found'));

      await expect(service.createBookmark(5, makeUser(), { title: 'x', cfi: 'epubcfi(/6/2)' })).rejects.toThrow(NotFoundException);
      expect(bookmarkRepo.findExistingByLocation).not.toHaveBeenCalled();
      expect(bookmarkRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('deleteBookmark', () => {
    it('verifies access and deletes bookmark', async () => {
      const { service, bookmarkRepo, bookService } = makeService();
      const user = makeUser();
      bookmarkRepo.delete.mockResolvedValue(true);

      await expect(service.deleteBookmark(5, 10, user)).resolves.toBeUndefined();

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, user);
      expect(bookmarkRepo.delete).toHaveBeenCalledWith(5, 10, 1);
    });

    it('throws NotFoundException with stable message when bookmark is missing', async () => {
      const { service, bookmarkRepo } = makeService();
      bookmarkRepo.delete.mockResolvedValue(false);

      await expect(service.deleteBookmark(5, 99, makeUser())).rejects.toThrow(NotFoundException);
      await expect(service.deleteBookmark(5, 99, makeUser())).rejects.toThrow('Bookmark 99 not found for book 5');
    });

    it('propagates access errors and skips delete query', async () => {
      const { service, bookService, bookmarkRepo } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.deleteBookmark(5, 10, makeUser())).rejects.toThrow(ForbiddenException);
      expect(bookmarkRepo.delete).not.toHaveBeenCalled();
    });
  });
});
