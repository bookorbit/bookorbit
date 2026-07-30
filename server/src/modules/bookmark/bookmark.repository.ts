import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookmarks, type BookmarkRow, type NewBookmark } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** What a device-originated bookmark carries beyond the shared location/title pair. */
export interface DeviceBookmarkFields {
  cfi: string;
  title: string;
  devicePos: string;
  pageno: number | null;
}

@Injectable()
export class BookmarkRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findByBookId(bookId: number, userId: number) {
    return this.db
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.bookId, bookId), eq(bookmarks.userId, userId), isNull(bookmarks.deletedAt)))
      .orderBy(asc(bookmarks.createdAt), asc(bookmarks.id));
  }

  async findLiveByLocation(userId: number, bookId: number, data: Pick<NewBookmark, 'cfi' | 'positionSeconds'>): Promise<BookmarkRow | null> {
    if (data.cfi != null) {
      const [row] = await this.db
        .select()
        .from(bookmarks)
        .where(and(eq(bookmarks.userId, userId), eq(bookmarks.bookId, bookId), eq(bookmarks.cfi, data.cfi), isNull(bookmarks.deletedAt)))
        .orderBy(asc(bookmarks.createdAt), asc(bookmarks.id))
        .limit(1);
      return row ?? null;
    }

    if (data.positionSeconds != null) {
      const [row] = await this.db
        .select()
        .from(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            eq(bookmarks.bookId, bookId),
            eq(bookmarks.positionSeconds, data.positionSeconds),
            isNull(bookmarks.cfi),
            isNull(bookmarks.deletedAt),
          ),
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
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  /**
   * Re-activates the tombstoned row that owns this location. The unique location
   * indexes still cover tombstoned rows, so inserting at a deleted bookmark's CFI
   * would conflict instead of recreating it.
   */
  async restoreAtLocation(
    userId: number,
    bookId: number,
    data: Pick<NewBookmark, 'cfi' | 'positionSeconds'>,
    values: Pick<NewBookmark, 'title' | 'origin' | 'devicePos' | 'pageno'>,
  ): Promise<BookmarkRow | null> {
    const location =
      data.cfi != null
        ? eq(bookmarks.cfi, data.cfi)
        : data.positionSeconds != null
          ? and(eq(bookmarks.positionSeconds, data.positionSeconds), isNull(bookmarks.cfi))
          : null;
    if (!location) return null;

    const [row] = await this.db
      .update(bookmarks)
      .set({
        title: values.title,
        origin: values.origin ?? 'web',
        devicePos: values.devicePos ?? null,
        pageno: values.pageno ?? null,
        deletedAt: null,
      })
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.bookId, bookId), location, isNotNull(bookmarks.deletedAt)))
      .returning();
    return row ?? null;
  }

  /** Soft delete: devices still holding the bookmark learn about it on their next exchange. */
  async softDelete(bookId: number, bookmarkId: number, userId: number) {
    const result = await this.db
      .update(bookmarks)
      .set({ deletedAt: new Date() })
      .where(and(eq(bookmarks.id, bookmarkId), eq(bookmarks.bookId, bookId), eq(bookmarks.userId, userId), isNull(bookmarks.deletedAt)))
      .returning({ id: bookmarks.id });
    return result.length > 0;
  }

  // Sync-facing operations. The bookmarks table stays owned here; the KOReader
  // module drives these through BookmarkSyncService.

  /** Every row of one book, tombstones included, so a sync can see deletions too. */
  async listForSync(userId: number, bookId: number, limit: number): Promise<BookmarkRow[]> {
    return this.db
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.bookId, bookId)))
      .orderBy(asc(bookmarks.id))
      .limit(limit);
  }

  async createFromDevice(userId: number, bookId: number, fields: DeviceBookmarkFields): Promise<BookmarkRow | null> {
    const [row] = await this.db
      .insert(bookmarks)
      .values({
        userId,
        bookId,
        cfi: fields.cfi,
        title: fields.title,
        origin: 'koreader',
        devicePos: fields.devicePos,
        pageno: fields.pageno,
      })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  async updateFromDevice(
    userId: number,
    bookmarkId: number,
    values: Partial<Pick<NewBookmark, 'title' | 'devicePos' | 'pageno'>>,
  ): Promise<BookmarkRow | null> {
    const [row] = await this.db
      .update(bookmarks)
      .set(values)
      .where(and(eq(bookmarks.id, bookmarkId), eq(bookmarks.userId, userId), isNull(bookmarks.deletedAt)))
      .returning();
    return row ?? null;
  }

  async tombstone(userId: number, bookmarkIds: number[]): Promise<number> {
    if (bookmarkIds.length === 0) return 0;
    const rows = await this.db
      .update(bookmarks)
      .set({ deletedAt: new Date() })
      .where(and(eq(bookmarks.userId, userId), inArray(bookmarks.id, bookmarkIds), isNull(bookmarks.deletedAt)))
      .returning({ id: bookmarks.id });
    return rows.length;
  }

  async listPurgeableTombstones(userId: number, deletedBefore: Date, limit: number): Promise<number[]> {
    const rows = await this.db
      .select({ id: bookmarks.id })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), isNotNull(bookmarks.deletedAt), lt(bookmarks.deletedAt, deletedBefore)))
      .orderBy(asc(bookmarks.deletedAt))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  async purge(userId: number, bookmarkIds: number[]): Promise<number> {
    if (bookmarkIds.length === 0) return 0;
    const rows = await this.db
      .delete(bookmarks)
      .where(and(eq(bookmarks.userId, userId), inArray(bookmarks.id, bookmarkIds), isNotNull(bookmarks.deletedAt)))
      .returning({ id: bookmarks.id });
    return rows.length;
  }
}
