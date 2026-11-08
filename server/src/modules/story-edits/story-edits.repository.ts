import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { storyEdits, type StoryEditRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/**
 * An arbitrary but stable namespace for the per-user advisory lock every write takes, so it cannot
 * collide with a lock any other feature takes on the same user id.
 */
export const STORY_EDITS_WRITE_LOCK_NAMESPACE = 248_017;

export interface StoryEditWrite {
  userId: number;
  bookId: number;
  id: string;
  kind: string;
  data: Record<string, unknown>;
  position: number | null;
  clientUpdatedAt: Date;
  deleted: boolean;
}

/** `kept` when the stored row is newer than the write, `refused` when a new live row would pass the cap. */
export type StoryEditWriteOutcome = { outcome: 'written' | 'kept'; row: StoryEditRow } | { outcome: 'refused' };

@Injectable()
export class StoryEditsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  listSince(userId: number, bookId: number, sinceRevision: number, limit: number): Promise<StoryEditRow[]> {
    return this.db
      .select()
      .from(storyEdits)
      .where(and(eq(storyEdits.userId, userId), eq(storyEdits.bookId, bookId), gt(storyEdits.revision, sinceRevision)))
      .orderBy(asc(storyEdits.revision))
      .limit(limit);
  }

  /**
   * Upsert on (user, book, id), last writer winning on the client's time.
   *
   * Every write for a user runs behind one advisory lock and draws its revision inside it. A
   * sequence alone hands out numbers in call order, not commit order: a reader could see revision
   * 11 committed, advance its cursor past it, and never see 10 once it commits. Serialising a
   * user's writes makes revision order and commit order the same, and makes the cap count exact.
   */
  /**
   * Gives every row on the book a new revision, one reader at a time under the writers' lock, so a
   * device whose cursor already passed the rows' old revisions still reads them. Returns the readers.
   */
  async redrawRevisions(bookId: number): Promise<number> {
    const readers = await this.db.selectDistinct({ userId: storyEdits.userId }).from(storyEdits).where(eq(storyEdits.bookId, bookId));
    for (const { userId } of readers) {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${STORY_EDITS_WRITE_LOCK_NAMESPACE}, ${userId})`);
        await tx
          .update(storyEdits)
          .set({ revision: sql`nextval(pg_get_serial_sequence('story_edits', 'revision'))` })
          .where(and(eq(storyEdits.userId, userId), eq(storyEdits.bookId, bookId)));
      });
    }
    return readers.length;
  }

  async write(values: StoryEditWrite, perBookMax: number): Promise<StoryEditWriteOutcome> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${STORY_EDITS_WRITE_LOCK_NAMESPACE}, ${values.userId})`);
      const identity = and(eq(storyEdits.userId, values.userId), eq(storyEdits.bookId, values.bookId), eq(storyEdits.id, values.id));

      const [existing] = await tx.select().from(storyEdits).where(identity).limit(1);
      if (existing && existing.clientUpdatedAt.getTime() > values.clientUpdatedAt.getTime()) return { outcome: 'kept', row: existing };

      const fields = {
        kind: values.kind,
        data: values.data,
        position: values.position,
        clientUpdatedAt: values.clientUpdatedAt,
        deleted: values.deleted,
      };

      if (existing) {
        const [row] = await tx
          .update(storyEdits)
          .set({ ...fields, revision: sql`nextval(pg_get_serial_sequence('story_edits', 'revision'))` })
          .where(identity)
          .returning();
        return { outcome: 'written', row: row! };
      }

      if (!values.deleted) {
        const [live] = await tx
          .select({ value: count() })
          .from(storyEdits)
          .where(and(eq(storyEdits.userId, values.userId), eq(storyEdits.bookId, values.bookId), eq(storyEdits.deleted, false)));
        if ((live?.value ?? 0) >= perBookMax) return { outcome: 'refused' };
      }

      const [row] = await tx
        .insert(storyEdits)
        .values({ userId: values.userId, bookId: values.bookId, id: values.id, ...fields })
        .returning();
      return { outcome: 'written', row: row! };
    });
  }
}
