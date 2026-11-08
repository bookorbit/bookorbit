import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AccessLevel } from '@bookorbit/types';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';
import { libraries, userLibraryAccess } from '../../db/schema';

/**
 * The one place that reads a requesting user's own library grants. Everything else asks
 * `LibraryScopeService`, so an API key's library limit applies everywhere at once.
 */
@Injectable()
export class LibraryScopeRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async findAllIds(): Promise<number[]> {
    const rows = await this.db.select({ id: libraries.id }).from(libraries).orderBy(libraries.displayOrder, libraries.name);
    return rows.map(({ id }) => id);
  }

  async findExistingIds(ids: readonly number[]): Promise<number[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: libraries.id })
      .from(libraries)
      .where(inArray(libraries.id, [...ids]))
      .orderBy(libraries.displayOrder, libraries.name);
    return rows.map(({ id }) => id);
  }

  findGrantedLevels(userId: number, accessLevels?: readonly AccessLevel[]): Promise<{ id: number; accessLevel: AccessLevel }[]> {
    return this.db
      .select({ id: libraries.id, accessLevel: userLibraryAccess.accessLevel })
      .from(libraries)
      .innerJoin(
        userLibraryAccess,
        and(
          eq(userLibraryAccess.libraryId, libraries.id),
          eq(userLibraryAccess.userId, userId),
          accessLevels ? inArray(userLibraryAccess.accessLevel, [...accessLevels]) : undefined,
        ),
      )
      .orderBy(libraries.displayOrder, libraries.name);
  }

  async findIsSuperuser(userId: number): Promise<boolean> {
    const row = await this.db.query.users.findFirst({ columns: { isSuperuser: true }, where: eq(schema.users.id, userId) });
    return row?.isSuperuser === true;
  }

  async findGrantedLevel(userId: number, libraryId: number): Promise<AccessLevel | null> {
    const row = await this.db.query.userLibraryAccess.findFirst({
      columns: { accessLevel: true },
      where: and(eq(userLibraryAccess.userId, userId), eq(userLibraryAccess.libraryId, libraryId)),
    });
    return row?.accessLevel ?? null;
  }
}
