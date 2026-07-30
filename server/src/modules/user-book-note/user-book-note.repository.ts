import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { chunk } from '../../common/utils/batch.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { userBookNotes } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const BATCH_QUERY_SIZE = 200;

@Injectable()
export class UserBookNoteRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findOne(userId: number, bookId: number) {
    const [row] = await this.db
      .select()
      .from(userBookNotes)
      .where(and(eq(userBookNotes.userId, userId), eq(userBookNotes.bookId, bookId)))
      .limit(1);
    return row ?? null;
  }

  async findByBookIds(userId: number, bookIds: number[]) {
    if (bookIds.length === 0) return [];
    return this.db
      .select()
      .from(userBookNotes)
      .where(and(eq(userBookNotes.userId, userId), inArray(userBookNotes.bookId, bookIds)));
  }

  /**
   * Entries must already be deduplicated by book: Postgres rejects an ON CONFLICT
   * DO UPDATE that would touch the same row twice in one statement.
   */
  async upsertMany(userId: number, entries: { bookId: number; note: string | null }[], updatedAt = new Date()) {
    for (const batch of chunk(entries, BATCH_QUERY_SIZE)) {
      await this.db
        .insert(userBookNotes)
        .values(batch.map((entry) => ({ userId, bookId: entry.bookId, note: entry.note, updatedAt })))
        .onConflictDoUpdate({
          target: [userBookNotes.userId, userBookNotes.bookId],
          set: { note: sql`excluded.note`, updatedAt: sql`excluded.updated_at` },
        });
    }
  }

  async upsert(userId: number, bookId: number, note: string | null, updatedAt = new Date()) {
    const [row] = await this.db
      .insert(userBookNotes)
      .values({ userId, bookId, note, updatedAt })
      .onConflictDoUpdate({
        target: [userBookNotes.userId, userBookNotes.bookId],
        set: { note, updatedAt },
      })
      .returning();
    return row!;
  }
}
