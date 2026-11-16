import { Inject, Injectable } from '@nestjs/common';
import { asc, count, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sep } from 'path';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookDockKeptFiles, type BookDockKeptFileRow, type NewBookDockKeptFileRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const BATCH_SIZE = 500;

/**
 * Files that left the dock but stayed on disk: filed from a keep-original dock and left seeding, or
 * discarded there (`ignored`). Discovery skips them while they are unchanged.
 */
@Injectable()
export class BookDockKeptFilesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findByPaths(paths: string[]): Promise<BookDockKeptFileRow[]> {
    const found: BookDockKeptFileRow[] = [];
    for (let index = 0; index < paths.length; index += BATCH_SIZE) {
      const batch = paths.slice(index, index + BATCH_SIZE);
      found.push(...(await this.db.select().from(bookDockKeptFiles).where(inArray(bookDockKeptFiles.absolutePath, batch))));
    }
    return found;
  }

  /** A path seen again replaces what was remembered about it. */
  async upsert(rows: NewBookDockKeptFileRow[]): Promise<void> {
    for (let index = 0; index < rows.length; index += BATCH_SIZE) {
      await this.db
        .insert(bookDockKeptFiles)
        .values(rows.slice(index, index + BATCH_SIZE))
        .onConflictDoUpdate({
          target: bookDockKeptFiles.absolutePath,
          set: {
            fileSize: sql`excluded.file_size`,
            mtimeMs: sql`excluded.mtime_ms`,
            dockId: sql`excluded.dock_id`,
            bookId: sql`excluded.book_id`,
            ignored: sql`excluded.ignored`,
          },
        });
    }
  }

  async deleteByIds(ids: number[]): Promise<void> {
    for (let index = 0; index < ids.length; index += BATCH_SIZE) {
      await this.db.delete(bookDockKeptFiles).where(inArray(bookDockKeptFiles.id, ids.slice(index, index + BATCH_SIZE)));
    }
  }

  /** Forgets a deleted file, or everything under a deleted folder. */
  async deleteAtOrUnder(path: string): Promise<number> {
    const deleted = await this.db
      .delete(bookDockKeptFiles)
      .where(or(eq(bookDockKeptFiles.absolutePath, path), sql`starts_with(${bookDockKeptFiles.absolutePath}, ${path + sep})`))
      .returning({ id: bookDockKeptFiles.id });
    return deleted.length;
  }

  /** Keyset pages by id, for walking every entry without loading them all. */
  async findPage(afterId: number | undefined, limit: number): Promise<Array<Pick<BookDockKeptFileRow, 'id' | 'absolutePath'>>> {
    return this.db
      .select({ id: bookDockKeptFiles.id, absolutePath: bookDockKeptFiles.absolutePath })
      .from(bookDockKeptFiles)
      .where(afterId === undefined ? undefined : gt(bookDockKeptFiles.id, afterId))
      .orderBy(asc(bookDockKeptFiles.id))
      .limit(limit);
  }

  /** Files left in place for seeding, per dock. The `null` key is Unsorted. Discarded files are not counted. */
  async countByDock(): Promise<Map<number | null, number>> {
    const rows = await this.db
      .select({ dockId: bookDockKeptFiles.dockId, cnt: count() })
      .from(bookDockKeptFiles)
      .where(eq(bookDockKeptFiles.ignored, false))
      .groupBy(bookDockKeptFiles.dockId);
    return new Map(rows.map((r) => [r.dockId, Number(r.cnt)]));
  }
}
