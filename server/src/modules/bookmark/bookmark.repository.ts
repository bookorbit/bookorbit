import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookmarks, type BookmarkOrigin, type BookmarkRow, type NewBookmark } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** What a device-originated bookmark carries beyond the shared location/title pair. */
export interface DeviceBookmarkFields {
  bookFileId?: number;
  cfi: string;
  title: string;
  devicePos: string;
  pageno: number | null;
  /** The device family the bookmark came from; KOReader when omitted. */
  origin?: BookmarkOrigin;
  /** Set only by devices that keep a note apart from the title (Kobo). */
  note?: string | null;
}

@Injectable()
export class BookmarkRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findByBookId(bookId: number, userId: number) {
    return this.db
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.bookId, bookId), eq(bookmarks.userId, userId), isNotNull(bookmarks.cfi), isNull(bookmarks.deletedAt)))
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

  async create(userId: number, bookId: number, data: Pick<NewBookmark, 'cfi' | 'title' | 'positionSeconds' | 'bookFileId'>) {
    const [row] = await this.db
      .insert(bookmarks)
      .values({
        userId,
        bookId,
        bookFileId: data.bookFileId ?? null,
        cfi: data.cfi ?? null,
        title: data.title,
        positionSeconds: data.positionSeconds ?? null,
      })
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
    values: Pick<NewBookmark, 'title' | 'origin' | 'devicePos' | 'pageno' | 'bookFileId'> & { note?: string | null },
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
        bookFileId: values.bookFileId ?? null,
        ...(values.note !== undefined ? { note: values.note } : {}),
        deletedAt: null,
      })
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.bookId, bookId), location, isNotNull(bookmarks.deletedAt)))
      .returning();
    return row ?? null;
  }

  /** A live, located (CFI) bookmark the user owns; the same rows the web list and delete see. */
  async findLive(bookId: number, bookmarkId: number, userId: number): Promise<BookmarkRow | null> {
    const [row] = await this.db
      .select()
      .from(bookmarks)
      .where(and(...this.liveConditions(bookId, bookmarkId, userId)))
      .limit(1);
    return row ?? null;
  }

  async update(
    bookId: number,
    bookmarkId: number,
    userId: number,
    values: Partial<Pick<NewBookmark, 'title' | 'note'>>,
  ): Promise<BookmarkRow | null> {
    const [row] = await this.db
      .update(bookmarks)
      .set({ ...values, updatedAt: new Date() })
      .where(and(...this.liveConditions(bookId, bookmarkId, userId)))
      .returning();
    return row ?? null;
  }

  /** Soft delete: devices still holding the bookmark learn about it on their next exchange. */
  async softDelete(bookId: number, bookmarkId: number, userId: number) {
    const result = await this.db
      .update(bookmarks)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(bookmarks.id, bookmarkId),
          eq(bookmarks.bookId, bookId),
          eq(bookmarks.userId, userId),
          isNotNull(bookmarks.cfi),
          isNull(bookmarks.deletedAt),
        ),
      )
      .returning({ id: bookmarks.id });
    return result.length > 0;
  }

  private liveConditions(bookId: number, bookmarkId: number, userId: number) {
    return [
      eq(bookmarks.id, bookmarkId),
      eq(bookmarks.bookId, bookId),
      eq(bookmarks.userId, userId),
      isNotNull(bookmarks.cfi),
      isNull(bookmarks.deletedAt),
    ];
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

  /**
   * The EPUB a client read when it saved a CFI without naming the file: the book's only EPUB, else the
   * one the user read last, which is the one the client is on while it adds the bookmark.
   */
  async findLikelySourceFileId(userId: number, bookId: number): Promise<number | null> {
    const epubs = await this.db
      .select({ id: schema.bookFiles.id })
      .from(schema.bookFiles)
      .where(and(eq(schema.bookFiles.bookId, bookId), eq(schema.bookFiles.format, 'epub')))
      .limit(2);
    if (epubs.length <= 1) return epubs[0]?.id ?? null;

    const [lastRead] = await this.db
      .select({ id: schema.readingProgress.bookFileId })
      .from(schema.readingProgress)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.readingProgress.bookFileId))
      .where(and(eq(schema.readingProgress.userId, userId), eq(schema.bookFiles.bookId, bookId), eq(schema.bookFiles.format, 'epub')))
      .orderBy(desc(schema.readingProgress.lastReadAt))
      .limit(1);
    return lastRead?.id ?? null;
  }

  async createFromDevice(userId: number, bookId: number, fields: DeviceBookmarkFields): Promise<BookmarkRow | null> {
    const [row] = await this.db
      .insert(bookmarks)
      .values({
        userId,
        bookId,
        cfi: fields.cfi,
        title: fields.title,
        origin: fields.origin ?? 'koreader',
        devicePos: fields.devicePos,
        pageno: fields.pageno,
        bookFileId: fields.bookFileId ?? null,
        note: fields.note ?? null,
      })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  // Bookkeeping, not an edit: updated_at is the content clock that device pushes and Kobo ETags compare,
  // so it keeps its value instead of taking the $onUpdateFn stamp.
  async captureSourceFile(userId: number, bookmarkId: number, cfi: string, bookFileId: number): Promise<void> {
    await this.db
      .update(bookmarks)
      .set({ bookFileId, updatedAt: sql`${bookmarks.updatedAt}` })
      .where(and(eq(bookmarks.id, bookmarkId), eq(bookmarks.userId, userId), eq(bookmarks.cfi, cfi), isNull(bookmarks.bookFileId)));
  }

  async captureSourceFileById(userId: number, bookmarkId: number, bookFileId: number): Promise<void> {
    await this.db
      .update(bookmarks)
      .set({ bookFileId, updatedAt: sql`${bookmarks.updatedAt}` })
      .where(and(eq(bookmarks.id, bookmarkId), eq(bookmarks.userId, userId), isNull(bookmarks.bookFileId)));
  }

  async updateFromDevice(
    userId: number,
    bookmarkId: number,
    values: Partial<Pick<NewBookmark, 'title' | 'devicePos' | 'pageno' | 'note'>>,
  ): Promise<BookmarkRow | null> {
    const [row] = await this.db
      .update(bookmarks)
      .set(values)
      .where(and(eq(bookmarks.id, bookmarkId), eq(bookmarks.userId, userId), isNull(bookmarks.deletedAt)))
      .returning();
    return row ?? null;
  }

  /** Sets a device's note only when the device edited it after the row last changed, so an echo never wins. */
  async applyDeviceNote(userId: number, bookmarkId: number, note: string | null, editedAt: Date): Promise<BookmarkRow | null> {
    const [row] = await this.db
      .update(bookmarks)
      .set({ note })
      .where(
        and(
          eq(bookmarks.id, bookmarkId),
          eq(bookmarks.userId, userId),
          isNull(bookmarks.deletedAt),
          lt(bookmarks.updatedAt, editedAt),
          sql`${bookmarks.note} is distinct from ${note}`,
        ),
      )
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
