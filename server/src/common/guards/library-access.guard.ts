import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq, and } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { LIBRARY_ACCESS_KEY, LibraryAccessLevel } from '../decorators/require-library-access.decorator';
import { LIBRARY_TYPE_KEY, OPTIONAL_LIBRARY_TYPE_KEY } from '../decorators/require-library-type.decorator';
import type { LibraryType } from '@bookorbit/types';
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
    const requiredType = this.reflector.getAllAndOverride<LibraryType | undefined>(LIBRARY_TYPE_KEY, [context.getHandler(), context.getClass()]);
    const optionalType = this.reflector.getAllAndOverride<boolean | undefined>(OPTIONAL_LIBRARY_TYPE_KEY, [context.getHandler(), context.getClass()]);
    if (!required && !requiredType) return true;

    const request = context.switchToHttp().getRequest<{ user: RequestUser; params?: Record<string, string>; body?: { libraryId?: unknown } }>();
    const user = request.user;

    const rawLibraryId = request.params?.libraryId ?? request.params?.id ?? request.body?.libraryId;
    const isMissingLibraryId =
      rawLibraryId === undefined || rawLibraryId === null || (typeof rawLibraryId === 'string' && rawLibraryId.trim() === '');
    if (isMissingLibraryId && requiredType && optionalType && !required) return true;
    const libraryId = typeof rawLibraryId === 'string' && rawLibraryId.trim() === '' ? Number.NaN : Number(rawLibraryId);
    if (!Number.isInteger(libraryId) || libraryId <= 0) {
      throw new BadRequestException('Missing or invalid libraryId');
    }

    if (requiredType) {
      const library = await this.db.query.libraries.findFirst({
        columns: { type: true },
        where: eq(schema.libraries.id, libraryId),
      });
      if (!library) throw new NotFoundException('Library not found');
      if (library.type !== requiredType) {
        throw new BadRequestException(`This endpoint requires a ${requiredType} library`);
      }
    }

    if (!required || user.isSuperuser) return true;

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
