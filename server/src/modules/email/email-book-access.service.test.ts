import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { BookReadService } from '../book/book-read.service';
import { LibraryService } from '../library/library.service';
import { EmailBookAccessService } from './email-book-access.service';

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
  };

  let service: EmailBookAccessService;
  let bookReadService: { findLibraryIdsByBookIds: ReturnType<typeof vi.fn> };
  let libraryService: { verifyUserAccess: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    bookReadService = {
      findLibraryIdsByBookIds: vi.fn(),
    };
    libraryService = {
      verifyUserAccess: vi.fn().mockResolvedValue(undefined),
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
    expect(libraryService.verifyUserAccess).toHaveBeenCalledTimes(2);
    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, 10, user.isSuperuser);
    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, 11, user.isSuperuser);
  });

  it('throws NotFoundException when any requested book is missing', async () => {
    bookReadService.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 10 }]);

    await expect(service.assertUserCanAccessBooks([1, 2], user)).rejects.toThrow(NotFoundException);
  });

  it('propagates ForbiddenException from library access checks', async () => {
    bookReadService.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 10 }]);
    libraryService.verifyUserAccess.mockRejectedValue(new ForbiddenException('No access to this library'));

    await expect(service.assertUserCanAccessBook(1, user)).rejects.toThrow(ForbiddenException);
  });
});
