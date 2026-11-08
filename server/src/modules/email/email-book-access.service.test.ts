import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { BookReadService } from '../book/book-read.service';
import { LibraryService } from '../library/library.service';
import { EmailBookAccessService } from './email-book-access.service';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

describe('EmailBookAccessService', () => {
  const user: RequestUser = {
    id: 9,
    username: 'reader9',
    name: 'Reader Nine',
    email: 'reader9@example.com',
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'manual',
    isSuperuser: false,
    permissions: [],

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };

  let service: EmailBookAccessService;
  let bookReadService: { findLibraryIdsByBookIds: ReturnType<typeof vi.fn> };
  let libraryService: { verifyAccess: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    bookReadService = {
      findLibraryIdsByBookIds: vi.fn(),
      checkBookPassesContentFilters: vi.fn().mockResolvedValue(true),
    };
    libraryService = {
      verifyAccess: vi.fn().mockResolvedValue(undefined),
    };
    service = new EmailBookAccessService(bookReadService as unknown as BookReadService, libraryService as unknown as LibraryService);
  });

  it('verifies access for each unique book id', async () => {
    bookReadService.findLibraryIdsByBookIds.mockResolvedValue([
      { id: 1, libraryId: 10 },
      { id: 2, libraryId: 11 },
    ]);

    await service.assertUserCanAccessBooks([1, 2, 1], user);

    expect(bookReadService.findLibraryIdsByBookIds).toHaveBeenCalledWith([1, 2]);
    expect(libraryService.verifyAccess).toHaveBeenCalledTimes(2);
    expect(libraryService.verifyAccess).toHaveBeenCalledWith(expect.objectContaining({ id: user.id, isSuperuser: user.isSuperuser }), 10);
    expect(libraryService.verifyAccess).toHaveBeenCalledWith(expect.objectContaining({ id: user.id, isSuperuser: user.isSuperuser }), 11);
  });

  it('throws NotFoundException when any requested book is missing', async () => {
    bookReadService.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 10 }]);

    await expect(service.assertUserCanAccessBooks([1, 2], user)).rejects.toThrow(NotFoundException);
  });

  it('propagates ForbiddenException from library access checks', async () => {
    bookReadService.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 10 }]);
    libraryService.verifyAccess.mockRejectedValue(new ForbiddenException('No access to this library'));

    await expect(service.assertUserCanAccessBook(1, user)).rejects.toThrow(ForbiddenException);
  });
});
