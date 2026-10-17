import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { isUniqueViolation } from '../../common/utils/db-error.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';

/** A device's dogear link with the state of the bookmark behind it. */
export interface KoboBookmarkLinkState {
  bookmarkId: number;
  externalKey: string;
  location: unknown;
  bookmarkUpdatedAt: Date;
  bookmarkDeletedAt: Date | null;
}

const REMOVED_BOOK_LIMIT = 500;

@Injectable()
export class KoboBookmarkLinkRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  findForBook(userId: number, deviceId: number, bookId: number): Promise<KoboBookmarkLinkState[]> {
    return this.db
      .select({
        bookmarkId: schema.koboBookmarkLinks.bookmarkId,
        externalKey: schema.koboBookmarkLinks.externalKey,
        location: schema.koboBookmarkLinks.location,
        bookmarkUpdatedAt: schema.bookmarks.updatedAt,
        bookmarkDeletedAt: schema.bookmarks.deletedAt,
      })
      .from(schema.koboBookmarkLinks)
      .innerJoin(schema.bookmarks, eq(schema.bookmarks.id, schema.koboBookmarkLinks.bookmarkId))
      .where(
        and(
          eq(schema.koboBookmarkLinks.userId, userId),
          eq(schema.koboBookmarkLinks.deviceId, deviceId),
          eq(schema.koboBookmarkLinks.bookId, bookId),
        ),
      );
  }

  findByExternalKeys(userId: number, deviceId: number, externalKeys: string[]) {
    if (externalKeys.length === 0) return Promise.resolve([]);
    return this.db
      .select()
      .from(schema.koboBookmarkLinks)
      .where(
        and(
          eq(schema.koboBookmarkLinks.userId, userId),
          eq(schema.koboBookmarkLinks.deviceId, deviceId),
          inArray(schema.koboBookmarkLinks.externalKey, externalKeys),
        ),
      );
  }

  /**
   * Links a dogear to its bookmark. Two dogears the device placed at one spot land on the same
   * bookmark, which keeps the first link; the device drops the other once it is no longer served.
   */
  async link(values: typeof schema.koboBookmarkLinks.$inferInsert): Promise<boolean> {
    try {
      await this.db
        .insert(schema.koboBookmarkLinks)
        .values(values)
        .onConflictDoUpdate({
          target: [schema.koboBookmarkLinks.deviceId, schema.koboBookmarkLinks.externalKey],
          set: { bookmarkId: values.bookmarkId, bookId: values.bookId, location: values.location, updatedAt: new Date() },
        });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async updateLocation(userId: number, deviceId: number, externalKey: string, location: unknown): Promise<void> {
    await this.db
      .update(schema.koboBookmarkLinks)
      .set({ location, updatedAt: new Date() })
      .where(
        and(
          eq(schema.koboBookmarkLinks.userId, userId),
          eq(schema.koboBookmarkLinks.deviceId, deviceId),
          eq(schema.koboBookmarkLinks.externalKey, externalKey),
        ),
      );
  }

  async deleteForBookmarks(userId: number, deviceId: number, bookmarkIds: number[]): Promise<number> {
    if (bookmarkIds.length === 0) return 0;
    const deleted = await this.db
      .delete(schema.koboBookmarkLinks)
      .where(
        and(
          eq(schema.koboBookmarkLinks.userId, userId),
          eq(schema.koboBookmarkLinks.deviceId, deviceId),
          inArray(schema.koboBookmarkLinks.bookmarkId, bookmarkIds),
        ),
      )
      .returning({ id: schema.koboBookmarkLinks.id });
    return deleted.length;
  }

  /** Books holding a dogear on this device whose bookmark was deleted in BookOrbit. */
  async findBookIdsWithRemovedBookmarks(userId: number, deviceId: number): Promise<number[]> {
    const rows = await this.db
      .selectDistinct({ bookId: schema.koboBookmarkLinks.bookId })
      .from(schema.koboBookmarkLinks)
      .innerJoin(schema.bookmarks, eq(schema.bookmarks.id, schema.koboBookmarkLinks.bookmarkId))
      .where(and(eq(schema.koboBookmarkLinks.userId, userId), eq(schema.koboBookmarkLinks.deviceId, deviceId), isNotNull(schema.bookmarks.deletedAt)))
      .limit(REMOVED_BOOK_LIMIT);
    return rows.map((row) => row.bookId);
  }
}
