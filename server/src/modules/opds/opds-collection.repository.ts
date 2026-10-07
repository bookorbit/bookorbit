import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, exists, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ContentFilterRules } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { books, collectionBooks, collections, userLibraryAccess } from '../../db/schema';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class OpdsCollectionRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findById(id: number) {
    return this.db
      .select({ userId: collections.userId, isPublic: collections.isPublic, mediaType: collections.mediaType })
      .from(collections)
      .where(eq(collections.id, id))
      .limit(1);
  }

  findVisibleForUser(userId: number, isSuperuser: boolean, contentFilters?: ContentFilterRules) {
    const libraryAccess = isSuperuser
      ? undefined
      : exists(
          this.db
            .select({ one: sql`1` })
            .from(userLibraryAccess)
            .where(and(eq(userLibraryAccess.userId, userId), eq(userLibraryAccess.libraryId, books.libraryId))),
        );
    const filterClauses = !isSuperuser && contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];

    return this.db
      .select({ id: collections.id, name: collections.name, bookCount: sql<number>`count(${books.id})::int` })
      .from(collections)
      .leftJoin(collectionBooks, eq(collectionBooks.collectionId, collections.id))
      .leftJoin(books, and(eq(books.id, collectionBooks.bookId), eq(books.status, 'present'), libraryAccess, ...filterClauses))
      .where(this.visibleForUser(userId))
      .groupBy(collections.id)
      .orderBy(collections.name);
  }

  async countVisibleForUser(userId: number): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(collections).where(this.visibleForUser(userId));
    return Number(row?.total ?? 0);
  }

  private visibleForUser(userId: number) {
    return and(or(eq(collections.userId, userId), eq(collections.isPublic, true)), eq(collections.mediaType, 'books'));
  }
}
