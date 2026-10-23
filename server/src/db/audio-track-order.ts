import { and, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { planAudioTrackOrderRepair } from '../common/utils/book-media.utils';
import * as schema from './schema';

/**
 * Puts a book's stored audio track order back in natural path order after a write that numbered
 * only some of its files, and returns how many tracks it renumbered. Call it inside the writer's
 * transaction: it takes the book row lock, so writers serialize on it and the one that finishes
 * last numbers every row the others left behind.
 */
export async function realignAudioTrackOrder(tx: Pick<NodePgDatabase<typeof schema>, 'select' | 'update'>, bookId: number): Promise<number> {
  await tx.select({ id: schema.books.id }).from(schema.books).where(eq(schema.books.id, bookId)).for('update');
  const files = await tx
    .select({
      id: schema.bookFiles.id,
      absolutePath: schema.bookFiles.absolutePath,
      format: schema.bookFiles.format,
      sortOrder: schema.bookFiles.sortOrder,
    })
    .from(schema.bookFiles)
    .where(eq(schema.bookFiles.bookId, bookId));

  const changes = planAudioTrackOrderRepair(files);
  if (changes.length === 0) return 0;

  const sortOrder = sql.join(
    [sql`case ${schema.bookFiles.id}`, ...changes.map((change) => sql`when ${change.id} then ${change.sortOrder}::integer`), sql`end`],
    sql` `,
  );
  await tx
    .update(schema.bookFiles)
    .set({ sortOrder })
    .where(
      and(
        eq(schema.bookFiles.bookId, bookId),
        inArray(
          schema.bookFiles.id,
          changes.map((change) => change.id),
        ),
      ),
    );
  return changes.length;
}
