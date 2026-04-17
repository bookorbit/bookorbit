import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq, and } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { LIBRARY_ACCESS_KEY, LibraryAccessLevel } from '../decorators/require-library-access.decorator';
import { RequestUser } from '../types/request-user';

const ACCESS_RANK: Record<LibraryAccessLevel, number> = { viewer: 1, editor: 2, owner: 3 };

@Injectable()
export class LibraryAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<LibraryAccessLevel | undefined>(LIBRARY_ACCESS_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<{ user: RequestUser; params?: Record<string, string> }>();
    const user = request.user;

    if (user.isSuperuser) return true;

    const rawLibraryId = request.params?.libraryId ?? request.params?.id ?? '';
    const libraryId = Number.parseInt(rawLibraryId, 10);
    if (!Number.isInteger(libraryId) || libraryId <= 0) {
      throw new BadRequestException('Missing or invalid libraryId');
    }

    const row = await this.db.query.userLibraryAccess.findFirst({
      where: and(eq(schema.userLibraryAccess.userId, user.id), eq(schema.userLibraryAccess.libraryId, libraryId)),
    });

    if (!row) throw new ForbiddenException('No library access');

    if (ACCESS_RANK[row.accessLevel] < ACCESS_RANK[required]) {
      throw new ForbiddenException('Insufficient library access level');
    }

    return true;
  }
}
