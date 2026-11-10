import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { LIBRARY_ACCESS_KEY, LibraryAccessLevel } from '../decorators/require-library-access.decorator';
import { LibraryScopeService, meetsAccessLevel } from '../library-scope/library-scope.service';
import { RequestUser } from '../types/request-user';

@Injectable()
export class LibraryAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly libraryScope: LibraryScopeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<LibraryAccessLevel | undefined>(LIBRARY_ACCESS_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<{ user: RequestUser; params?: Record<string, string> }>();
    const user = request.user;

    const rawLibraryId = request.params?.libraryId ?? request.params?.id;
    const libraryId = rawLibraryId === undefined || rawLibraryId.trim() === '' ? Number.NaN : Number(rawLibraryId);
    if (!Number.isInteger(libraryId) || libraryId <= 0) {
      throw new BadRequestException('Missing or invalid libraryId');
    }

    const level = await this.libraryScope.levelFor(user, libraryId);
    if (level === null) throw new ForbiddenException('No library access');

    if (!meetsAccessLevel(level, required)) {
      throw new ForbiddenException('Insufficient library access level');
    }

    return true;
  }
}
