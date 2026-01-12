import { ForbiddenException, Injectable } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { GrantLibraryAccessDto } from './dto/grant-library-access.dto';
import { LibraryRepository } from './library.repository';

@Injectable()
export class LibraryService {
  constructor(private readonly libraryRepo: LibraryRepository) {}

  async verifyUserAccess(userId: number, libraryId: number, isSuperuser: boolean): Promise<void> {
    if (isSuperuser) return;
    const hasAccess = await this.libraryRepo.hasUserAccess(userId, libraryId);
    if (!hasAccess) throw new ForbiddenException('No access to this library');
  }

  findAll(user: RequestUser) {
    const isSuperuser = user.roles.some((r) => r.isSuperuser);
    return isSuperuser ? this.libraryRepo.findAll() : this.libraryRepo.findAllForUser(user.id);
  }

  getAccess(libraryId: number) {
    return this.libraryRepo.getAccess(libraryId);
  }

  grantAccess(libraryId: number, dto: GrantLibraryAccessDto) {
    return this.libraryRepo.grantAccess(libraryId, dto.userId, dto.accessLevel);
  }

  updateAccess(libraryId: number, userId: number, accessLevel: 'viewer' | 'editor' | 'owner') {
    return this.libraryRepo.updateAccess(libraryId, userId, accessLevel);
  }

  revokeAccess(libraryId: number, userId: number) {
    return this.libraryRepo.revokeAccess(libraryId, userId);
  }
}
