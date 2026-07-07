import { Inject, Injectable } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { NewStorygraphBookState, NewStorygraphUserSetting, StorygraphBookState, StorygraphUserSetting } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface BookSyncData {
  bookId: number;
  isbn13: string | null;
  isbn10: string | null;
  title: string | null;
  authorName: string | null;
  format: string | null;
  status: string;
  progress: number | null;
}

@Injectable()
export class StorygraphRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---- User Settings ----

  async findSettings(userId: number): Promise<StorygraphUserSetting | undefined> {
    return this.db.query.storygraphUserSettings.findFirst({
      where: eq(schema.storygraphUserSettings.userId, userId),
    });
  }

  async upsertSettings(
    userId: number,
    data: Partial<Omit<StorygraphUserSetting, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<StorygraphUserSetting> {
    const [row] = await this.db
      .insert(schema.storygraphUserSettings)
      .values({ userId, ...data } as NewStorygraphUserSetting)
      .onConflictDoUpdate({
        target: schema.storygraphUserSettings.userId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async deleteSettings(userId: number): Promise<void> {
    await this.db.delete(schema.storygraphUserSettings).where(eq(schema.storygraphUserSettings.userId, userId));
  }

  async userHasStorygraphSyncPermission(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({
        isSuperuser: schema.users.isSuperuser,
        permissionName: schema.userPermissions.permissionName,
      })
      .from(schema.users)
      .leftJoin(
        schema.userPermissions,
        and(eq(schema.userPermissions.userId, schema.users.id), eq(schema.userPermissions.permissionName, Permission.StorygraphSync)),
      )
      .where(and(eq(schema.users.id, userId), eq(schema.users.active, true)))
      .limit(1);

    return row?.isSuperuser === true || row?.permissionName === Permission.StorygraphSync;
  }

  // ---- Book State ----

  async findBookState(userId: number, bookId: number): Promise<StorygraphBookState | undefined> {
    return this.db.query.storygraphBookState.findFirst({
      where: and(eq(schema.storygraphBookState.userId, userId), eq(schema.storygraphBookState.bookId, bookId)),
    });
  }

  async findBookStatesByBookIds(userId: number, bookIds: number[]): Promise<StorygraphBookState[]> {
    if (bookIds.length === 0) return [];
    return this.db.query.storygraphBookState.findMany({
      where: and(eq(schema.storygraphBookState.userId, userId), inArray(schema.storygraphBookState.bookId, bookIds)),
    });
  }

  async upsertBookState(data: NewStorygraphBookState): Promise<StorygraphBookState> {
    const [row] = await this.db
      .insert(schema.storygraphBookState)
      .values(data)
      .onConflictDoUpdate({
        target: [schema.storygraphBookState.userId, schema.storygraphBookState.bookId],
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async setBookSyncOverride(userId: number, bookId: number, syncOverride: 'included' | 'excluded' | null): Promise<StorygraphBookState> {
    const [row] = await this.db
      .insert(schema.storygraphBookState)
      .values({ userId, bookId, syncOverride })
      .onConflictDoUpdate({
        target: [schema.storygraphBookState.userId, schema.storygraphBookState.bookId],
        set: { syncOverride, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  // Clears the cached match and last-synced snapshot so the next sync re-runs matching from
  // scratch instead of trusting a previous (possibly wrong) match.
  async clearBookMatch(userId: number, bookId: number): Promise<void> {
    await this.upsertBookState({
      userId,
      bookId,
      storygraphBookId: null,
      matchMethod: null,
      matchError: null,
      lastSyncedAt: null,
    });
  }

  // ---- Sync Settings ----

  async updateLastSyncedAt(userId: number, at: Date): Promise<void> {
    await this.db.update(schema.storygraphUserSettings).set({ lastSyncedAt: at }).where(eq(schema.storygraphUserSettings.userId, userId));
  }

  async updateSessionCookie(userId: number, sessionCookie: string): Promise<void> {
    await this.db
      .update(schema.storygraphUserSettings)
      .set({ sessionCookie, updatedAt: new Date() })
      .where(eq(schema.storygraphUserSettings.userId, userId));
  }

  // ---- Books for sync ----

  async findSyncableBooks(userId: number): Promise<BookSyncData[]> {
    return this.findBookSyncDataForUser(userId, undefined, false);
  }

  async findSyncableBook(userId: number, bookId: number): Promise<BookSyncData | null> {
    const [row] = await this.findBookSyncDataForUser(userId, bookId, false);
    return row ?? null;
  }

  async findBookSyncData(userId: number, bookId: number): Promise<BookSyncData | null> {
    const [row] = await this.findBookSyncDataForUser(userId, bookId, true);
    return row ?? null;
  }

  private async findBookSyncDataForUser(userId: number, bookId?: number, includeUnread = false): Promise<BookSyncData[]> {
    const bookFilter = bookId !== undefined ? eq(schema.books.id, bookId) : undefined;
    const statusFilter = includeUnread ? undefined : ne(schema.userBookStatus.status, 'unread');

    const maxProgressSq = this.db
      .select({
        bookId: schema.books.id,
        maxProgress: sql<number>`max(${schema.readingProgress.percentage})`.as('max_progress'),
      })
      .from(schema.books)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.bookId, schema.books.id))
      .innerJoin(schema.readingProgress, and(eq(schema.readingProgress.bookFileId, schema.bookFiles.id), eq(schema.readingProgress.userId, userId)))
      .where(bookFilter)
      .groupBy(schema.books.id)
      .as('max_progress_sq');

    const firstAuthorSq = this.db
      .select({
        bookId: schema.bookAuthors.bookId,
        authorName: sql<string>`min(${schema.authors.name})`.as('author_name'),
      })
      .from(schema.bookAuthors)
      .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .where(bookId !== undefined ? eq(schema.bookAuthors.bookId, bookId) : undefined)
      .groupBy(schema.bookAuthors.bookId)
      .as('first_author_sq');

    const rows = await this.db
      .select({
        bookId: schema.books.id,
        isbn13: schema.bookMetadata.isbn13,
        isbn10: schema.bookMetadata.isbn10,
        title: schema.bookMetadata.title,
        authorName: firstAuthorSq.authorName,
        format: schema.bookFiles.format,
        status: sql<string>`coalesce(${schema.userBookStatus.status}, 'unread')`,
        progress: maxProgressSq.maxProgress,
      })
      .from(schema.books)
      .leftJoin(schema.userBookStatus, and(eq(schema.userBookStatus.bookId, schema.books.id), eq(schema.userBookStatus.userId, userId)))
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
      .leftJoin(maxProgressSq, eq(maxProgressSq.bookId, schema.books.id))
      .leftJoin(firstAuthorSq, eq(firstAuthorSq.bookId, schema.books.id))
      .leftJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
      .where(and(bookFilter, statusFilter));

    return rows as BookSyncData[];
  }

  // Books whose most recent sync attempt recorded an error — powers the manual-sync failure list.
  async findBooksWithSyncErrors(
    userId: number,
  ): Promise<{ bookId: number; title: string | null; authorName: string | null; syncError: string; lastAttemptAt: Date | null }[]> {
    const firstAuthorSq = this.db
      .select({
        bookId: schema.bookAuthors.bookId,
        authorName: sql<string>`min(${schema.authors.name})`.as('author_name'),
      })
      .from(schema.bookAuthors)
      .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .groupBy(schema.bookAuthors.bookId)
      .as('first_author_sq');

    const rows = await this.db
      .select({
        bookId: schema.storygraphBookState.bookId,
        title: schema.bookMetadata.title,
        authorName: firstAuthorSq.authorName,
        syncError: schema.storygraphBookState.syncError,
        lastAttemptAt: schema.storygraphBookState.lastSyncedAt,
      })
      .from(schema.storygraphBookState)
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.storygraphBookState.bookId))
      .leftJoin(firstAuthorSq, eq(firstAuthorSq.bookId, schema.storygraphBookState.bookId))
      .where(and(eq(schema.storygraphBookState.userId, userId), isNotNull(schema.storygraphBookState.syncError)));

    return rows as { bookId: number; title: string | null; authorName: string | null; syncError: string; lastAttemptAt: Date | null }[];
  }

  async findBookIdByFileId(bookFileId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ bookId: schema.bookFiles.bookId })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.id, bookFileId))
      .limit(1);
    return row?.bookId ?? null;
  }
}
