import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookmarks, type BookmarkRow, type NewBookmark } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class BookmarkRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findByBookId(bookId: number, userId: number) {
    return this.db
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.bookId, bookId), eq(bookmarks.userId, userId)))
      .orderBy(asc(bookmarks.createdAt), asc(bookmarks.id));
  }

  async findExistingByLocation(userId: number, bookId: number, data: Pick<NewBookmark, 'cfi' | 'positionSeconds'>): Promise<BookmarkRow | null> {
    if (data.cfi != null) {
      const [row] = await this.db
        .select()
        .from(bookmarks)
        .where(and(eq(bookmarks.userId, userId), eq(bookmarks.bookId, bookId), eq(bookmarks.cfi, data.cfi)))
        .orderBy(asc(bookmarks.createdAt), asc(bookmarks.id))
        .limit(1);
      return row ?? null;
    }

    if (data.positionSeconds != null) {
      const [row] = await this.db
        .select()
        .from(bookmarks)
        .where(
          and(eq(bookmarks.userId, userId), eq(bookmarks.bookId, bookId), eq(bookmarks.positionSeconds, data.positionSeconds), isNull(bookmarks.cfi)),
        )
        .orderBy(asc(bookmarks.createdAt), asc(bookmarks.id))
        .limit(1);
      return row ?? null;
    }

    return null;
  }

  async create(userId: number, bookId: number, data: Pick<NewBookmark, 'cfi' | 'title' | 'positionSeconds'>) {
    const [row] = await this.db
      .insert(bookmarks)
      .values({ userId, bookId, cfi: data.cfi ?? null, title: data.title, positionSeconds: data.positionSeconds ?? null })
      .returning();
    return row;
  }

  async delete(bookId: number, bookmarkId: number, userId: number) {
    const result = await this.db
      .delete(bookmarks)
      .where(and(eq(bookmarks.id, bookmarkId), eq(bookmarks.bookId, bookId), eq(bookmarks.userId, userId)))
      .returning({ id: bookmarks.id });
    return result.length > 0;
  }
}
