import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookmarks } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class BookmarkRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findByBookId(bookId: number, userId: number) {
    return this.db
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.bookId, bookId), eq(bookmarks.userId, userId)));
  }

  async create(userId: number, bookId: number, cfi: string, title: string) {
    const [row] = await this.db.insert(bookmarks).values({ userId, bookId, cfi, title }).returning();
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
