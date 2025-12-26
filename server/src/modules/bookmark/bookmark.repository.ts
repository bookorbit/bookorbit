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

  async findByBookId(bookId: number) {
    return this.db.select().from(bookmarks).where(eq(bookmarks.bookId, bookId));
  }

  async create(bookId: number, cfi: string, title: string) {
    const [row] = await this.db.insert(bookmarks).values({ bookId, cfi, title }).returning();
    return row;
  }

  async delete(bookId: number, bookmarkId: number) {
    const result = await this.db
      .delete(bookmarks)
      .where(and(eq(bookmarks.id, bookmarkId), eq(bookmarks.bookId, bookId)))
      .returning({ id: bookmarks.id });
    return result.length > 0;
  }
}
