import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { koreaderBookmarkLinks, type KoreaderBookmarkLink } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface BookmarkLinkUpsert {
  bookmarkId: number;
  userId: number;
  deviceId: string;
  koreaderKey: string;
  deviceDatetime: string | null;
}

/** Owns koreader_bookmark_links: which device holds which bookmark, under which local key. */
@Injectable()
export class KoreaderBookmarkRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findLinksForBookmarks(userId: number, deviceId: string, bookmarkIds: number[]): Promise<KoreaderBookmarkLink[]> {
    if (bookmarkIds.length === 0) return [];
    return this.db
      .select()
      .from(koreaderBookmarkLinks)
      .where(
        and(
          eq(koreaderBookmarkLinks.userId, userId),
          eq(koreaderBookmarkLinks.deviceId, deviceId),
          inArray(koreaderBookmarkLinks.bookmarkId, bookmarkIds),
        ),
      );
  }

  /** Every device's links for these bookmarks; used to decide whether a tombstone can be purged. */
  async findBookmarkIdsWithLinks(userId: number, bookmarkIds: number[]): Promise<Set<number>> {
    if (bookmarkIds.length === 0) return new Set();
    const rows = await this.db
      .select({ bookmarkId: koreaderBookmarkLinks.bookmarkId })
      .from(koreaderBookmarkLinks)
      .where(and(eq(koreaderBookmarkLinks.userId, userId), inArray(koreaderBookmarkLinks.bookmarkId, bookmarkIds)));
    return new Set(rows.map((row) => row.bookmarkId));
  }

  async upsertLink(link: BookmarkLinkUpsert): Promise<void> {
    await this.db
      .insert(koreaderBookmarkLinks)
      .values(link)
      .onConflictDoUpdate({
        target: [koreaderBookmarkLinks.bookmarkId, koreaderBookmarkLinks.deviceId],
        set: { koreaderKey: link.koreaderKey, deviceDatetime: link.deviceDatetime, appliedAt: new Date() },
      });
  }

  async deleteLinks(userId: number, deviceId: string, bookmarkIds: number[]): Promise<number> {
    if (bookmarkIds.length === 0) return 0;
    const rows = await this.db
      .delete(koreaderBookmarkLinks)
      .where(
        and(
          eq(koreaderBookmarkLinks.userId, userId),
          eq(koreaderBookmarkLinks.deviceId, deviceId),
          inArray(koreaderBookmarkLinks.bookmarkId, bookmarkIds),
        ),
      )
      .returning({ id: koreaderBookmarkLinks.id });
    return rows.length;
  }
}
