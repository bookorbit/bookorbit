import { Inject, Injectable } from '@nestjs/common';
import type { AudiobookChapter } from '@bookorbit/types';
import { and, count, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookChapterVersions, bookFiles, bookMetadata, users } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

// Writes keep 20 per book; this only bounds the read if rows ever arrive another way.
const VERSIONS_LISTED = 50;

const VERSION_COLUMNS = {
  id: bookChapterVersions.id,
  source: bookChapterVersions.source,
  chapterCount: bookChapterVersions.chapterCount,
  createdAt: bookChapterVersions.createdAt,
  createdById: bookChapterVersions.createdBy,
  createdByName: users.name,
};

@Injectable()
export class ChapterEditorRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findChapterRow(bookId: number) {
    const [row] = await this.db
      .select({
        chapters: bookMetadata.chapters,
        source: bookMetadata.chaptersSource,
        updatedAt: bookMetadata.chaptersUpdatedAt,
        updatedById: bookMetadata.chaptersUpdatedBy,
        updatedByName: users.name,
        audibleId: bookMetadata.audibleId,
        durationSeconds: bookMetadata.durationSeconds,
      })
      .from(bookMetadata)
      .leftJoin(users, eq(users.id, bookMetadata.chaptersUpdatedBy))
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);
    return row ? { ...row, chapters: (row.chapters as AudiobookChapter[] | null) ?? null } : null;
  }

  findTrackRows(bookId: number) {
    return this.db
      .select({
        id: bookFiles.id,
        fileHash: bookFiles.fileHash,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        durationSeconds: bookFiles.durationSeconds,
        sortOrder: bookFiles.sortOrder,
      })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId));
  }

  findEbookFiles(bookId: number) {
    return this.db
      .select({ id: bookFiles.id, format: bookFiles.format, role: bookFiles.role, mediaOverlayAvailable: bookFiles.mediaOverlayAvailable })
      .from(bookFiles)
      .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.format, 'epub')))
      .orderBy(bookFiles.id);
  }

  async countVersions(bookId: number): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(bookChapterVersions).where(eq(bookChapterVersions.bookId, bookId));
    return row?.total ?? 0;
  }

  listVersions(bookId: number) {
    return this.db
      .select(VERSION_COLUMNS)
      .from(bookChapterVersions)
      .leftJoin(users, eq(users.id, bookChapterVersions.createdBy))
      .where(eq(bookChapterVersions.bookId, bookId))
      .orderBy(desc(bookChapterVersions.createdAt), desc(bookChapterVersions.id))
      .limit(VERSIONS_LISTED);
  }

  async findVersion(bookId: number, versionId: number) {
    const [row] = await this.db
      .select({ ...VERSION_COLUMNS, chapters: bookChapterVersions.chapters })
      .from(bookChapterVersions)
      .leftJoin(users, eq(users.id, bookChapterVersions.createdBy))
      .where(and(eq(bookChapterVersions.bookId, bookId), eq(bookChapterVersions.id, versionId)))
      .limit(1);
    return row ?? null;
  }
}
