import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { audiobookProgress, bookmarks, bookFiles } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface PlaybackStateWrite {
  currentFileId: number;
  positionSeconds: number;
  percentage: number;
  capturedAt: Date;
  operationId: string;
  manifestRevision: string;
}

@Injectable()
export class AudiobookRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  findAudioFiles(bookId: number) {
    return this.db
      .select({
        id: bookFiles.id,
        publicId: bookFiles.publicId,
        absolutePath: bookFiles.absolutePath,
        format: bookFiles.format,
        sizeBytes: bookFiles.sizeBytes,
        durationSeconds: bookFiles.durationSeconds,
        sortOrder: bookFiles.sortOrder,
        mtime: bookFiles.mtime,
        updatedAt: bookFiles.updatedAt,
      })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId));
  }

  async findAsset(bookId: number, publicId: string) {
    const [row] = await this.db
      .select()
      .from(bookFiles)
      .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.publicId, publicId)))
      .limit(1);
    return row ?? null;
  }

  async findPlaybackState(userId: number, bookId: number) {
    const [row] = await this.db
      .select()
      .from(audiobookProgress)
      .where(and(eq(audiobookProgress.userId, userId), eq(audiobookProgress.bookId, bookId)))
      .limit(1);
    return row ?? null;
  }

  async createPlaybackState(userId: number, bookId: number, values: PlaybackStateWrite) {
    const [row] = await this.db
      .insert(audiobookProgress)
      .values({ userId, bookId, ...values, revision: 1 })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  async updatePlaybackState(userId: number, bookId: number, baseRevision: number, values: PlaybackStateWrite) {
    const [row] = await this.db
      .update(audiobookProgress)
      .set({ ...values, revision: sql`${audiobookProgress.revision} + 1`, updatedAt: new Date() })
      .where(and(eq(audiobookProgress.userId, userId), eq(audiobookProgress.bookId, bookId), eq(audiobookProgress.revision, baseRevision)))
      .returning();
    return row ?? null;
  }

  async deletePlaybackState(userId: number, bookId: number) {
    await this.db.delete(audiobookProgress).where(and(eq(audiobookProgress.userId, userId), eq(audiobookProgress.bookId, bookId)));
  }

  findAudioBookmarks(userId: number, bookId: number) {
    return this.db
      .select()
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.userId, userId),
          eq(bookmarks.bookId, bookId),
          isNull(bookmarks.cfi),
          isNotNull(bookmarks.positionSeconds),
          isNull(bookmarks.deletedAt),
        ),
      )
      .orderBy(asc(bookmarks.positionSeconds), asc(bookmarks.id));
  }

  async findAudioBookmark(userId: number, bookId: number, clientId: string) {
    const [row] = await this.db
      .select()
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.userId, userId),
          eq(bookmarks.bookId, bookId),
          eq(bookmarks.clientId, clientId),
          isNull(bookmarks.cfi),
          isNotNull(bookmarks.positionSeconds),
          isNull(bookmarks.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async createAudioBookmark(
    userId: number,
    bookId: number,
    values: { clientId: string; positionSeconds: number; chapterId: string | null; title: string; note: string | null },
  ) {
    const [row] = await this.db
      .insert(bookmarks)
      .values({ userId, bookId, cfi: null, ...values })
      .onConflictDoNothing()
      .returning();
    return row ?? (await this.findAudioBookmark(userId, bookId, values.clientId));
  }

  async updateAudioBookmark(userId: number, bookId: number, clientId: string, values: { title?: string; note?: string | null }) {
    const [row] = await this.db
      .update(bookmarks)
      .set(values)
      .where(
        and(
          eq(bookmarks.userId, userId),
          eq(bookmarks.bookId, bookId),
          eq(bookmarks.clientId, clientId),
          isNull(bookmarks.cfi),
          isNotNull(bookmarks.positionSeconds),
          isNull(bookmarks.deletedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  async deleteAudioBookmark(userId: number, bookId: number, clientId: string) {
    const rows = await this.db
      .update(bookmarks)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(bookmarks.userId, userId),
          eq(bookmarks.bookId, bookId),
          eq(bookmarks.clientId, clientId),
          isNull(bookmarks.cfi),
          isNotNull(bookmarks.positionSeconds),
          isNull(bookmarks.deletedAt),
        ),
      )
      .returning({ id: bookmarks.id });
    return rows.length > 0;
  }
}
