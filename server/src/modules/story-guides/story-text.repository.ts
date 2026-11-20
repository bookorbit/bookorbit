import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, lt, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, bookFileTexts, type BookFileTextRow, type NewBookFileTextRow } from '../../db/schema';
import type { StoryTextFile } from './story-text.types';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class StoryTextRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async find(fileId: number): Promise<BookFileTextRow | null> {
    const [row] = await this.db.select().from(bookFileTexts).where(eq(bookFileTexts.fileId, fileId)).limit(1);
    return row ?? null;
  }

  async findFile(fileId: number): Promise<StoryTextFile | null> {
    const [row] = await this.db
      .select({
        id: bookFiles.id,
        bookId: bookFiles.bookId,
        absolutePath: bookFiles.absolutePath,
        sizeBytes: bookFiles.sizeBytes,
        mtime: bookFiles.mtime,
        format: bookFiles.format,
      })
      .from(bookFiles)
      .where(eq(bookFiles.id, fileId))
      .limit(1);
    return row ?? null;
  }

  async save(row: NewBookFileTextRow): Promise<BookFileTextRow> {
    const update = { ...row };
    delete update.createdAt;
    const [saved] = await this.db
      .insert(bookFileTexts)
      .values(row)
      .onConflictDoUpdate({ target: bookFileTexts.fileId, set: { ...update, fileId: row.fileId, updatedAt: new Date() } })
      .returning();
    return saved;
  }

  /**
   * Files read under an older extraction version, and files refused as too large, in file order, for
   * the background recompute. The limits are constants a release may raise, so a refusal is checked
   * again at every start.
   */
  async staleFileIds(extractionVersion: number, afterFileId: number, limit: number): Promise<number[]> {
    const rows = await this.db
      .select({ fileId: bookFileTexts.fileId })
      .from(bookFileTexts)
      .where(
        and(
          or(lt(bookFileTexts.extractionVersion, extractionVersion), eq(bookFileTexts.outcome, 'too-large')),
          gt(bookFileTexts.fileId, afterFileId),
        ),
      )
      .orderBy(asc(bookFileTexts.fileId))
      .limit(limit);
    return rows.map((row) => row.fileId);
  }

  async countFilesWithKey(textKey: string): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(bookFileTexts).where(eq(bookFileTexts.textKey, textKey));
    return row?.value ?? 0;
  }
}
