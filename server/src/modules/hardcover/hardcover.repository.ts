import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { HardcoverBookState, HardcoverUserSetting, NewHardcoverBookState, NewHardcoverUserSetting } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface BookSyncData {
  bookId: number;
  isbn13: string | null;
  isbn10: string | null;
  title: string | null;
  authorName: string | null;
  hardcoverMetadataId: string | null;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  rating: number | null;
  progress: number | null;
}

@Injectable()
export class HardcoverRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---- User Settings ----

  async findSettings(userId: number): Promise<HardcoverUserSetting | undefined> {
    return this.db.query.hardcoverUserSettings.findFirst({
      where: eq(schema.hardcoverUserSettings.userId, userId),
    });
  }

  async upsertSettings(
    userId: number,
    data: Partial<Omit<HardcoverUserSetting, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<HardcoverUserSetting> {
    const [row] = await this.db
      .insert(schema.hardcoverUserSettings)
      .values({ userId, ...data } as NewHardcoverUserSetting)
      .onConflictDoUpdate({
        target: schema.hardcoverUserSettings.userId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async deleteSettings(userId: number): Promise<void> {
    await this.db.delete(schema.hardcoverUserSettings).where(eq(schema.hardcoverUserSettings.userId, userId));
  }

  // ---- Book State ----

  async findBookState(userId: number, bookId: number): Promise<HardcoverBookState | undefined> {
    return this.db.query.hardcoverBookState.findFirst({
      where: and(eq(schema.hardcoverBookState.userId, userId), eq(schema.hardcoverBookState.bookId, bookId)),
    });
  }

  async findBookStatesByBookIds(userId: number, bookIds: number[]): Promise<HardcoverBookState[]> {
    if (bookIds.length === 0) return [];
    return this.db.query.hardcoverBookState.findMany({
      where: and(eq(schema.hardcoverBookState.userId, userId), inArray(schema.hardcoverBookState.bookId, bookIds)),
    });
  }

  async upsertBookState(data: NewHardcoverBookState): Promise<HardcoverBookState> {
    const [row] = await this.db
      .insert(schema.hardcoverBookState)
      .values(data)
      .onConflictDoUpdate({
        target: [schema.hardcoverBookState.userId, schema.hardcoverBookState.bookId],
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  // ---- Sync Settings ----

  async updateLastSyncedAt(userId: number, at: Date): Promise<void> {
    await this.db.update(schema.hardcoverUserSettings).set({ lastSyncedAt: at }).where(eq(schema.hardcoverUserSettings.userId, userId));
  }

  // ---- Books for sync ----

  async findSyncableBooks(userId: number): Promise<BookSyncData[]> {
    const maxProgressSq = this.db
      .select({
        bookId: schema.books.id,
        maxProgress: sql<number>`max(${schema.readingProgress.percentage})`.as('max_progress'),
      })
      .from(schema.books)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.bookId, schema.books.id))
      .innerJoin(schema.readingProgress, and(eq(schema.readingProgress.bookFileId, schema.bookFiles.id), eq(schema.readingProgress.userId, userId)))
      .groupBy(schema.books.id)
      .as('max_progress_sq');

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
        bookId: schema.books.id,
        isbn13: schema.bookMetadata.isbn13,
        isbn10: schema.bookMetadata.isbn10,
        title: schema.bookMetadata.title,
        authorName: firstAuthorSq.authorName,
        hardcoverMetadataId: schema.bookMetadata.hardcoverId,
        status: schema.userBookStatus.status,
        startedAt: schema.userBookStatus.startedAt,
        finishedAt: schema.userBookStatus.finishedAt,
        rating: schema.userBookRatings.rating,
        progress: maxProgressSq.maxProgress,
      })
      .from(schema.books)
      .innerJoin(
        schema.userBookStatus,
        and(eq(schema.userBookStatus.bookId, schema.books.id), eq(schema.userBookStatus.userId, userId), ne(schema.userBookStatus.status, 'unread')),
      )
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
      .leftJoin(schema.userBookRatings, and(eq(schema.userBookRatings.bookId, schema.books.id), eq(schema.userBookRatings.userId, userId)))
      .leftJoin(maxProgressSq, eq(maxProgressSq.bookId, schema.books.id))
      .leftJoin(firstAuthorSq, eq(firstAuthorSq.bookId, schema.books.id));

    return rows as BookSyncData[];
  }

  async findSyncableBook(userId: number, bookId: number): Promise<BookSyncData | null> {
    const rows = await this.findSyncableBooks(userId);
    return rows.find((r) => r.bookId === bookId) ?? null;
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
