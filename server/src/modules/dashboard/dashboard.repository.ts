import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, books, readingProgress } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class DashboardRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findRecentlyAddedBookIds(accessibleLibraryIds: number[], limit: number): Promise<number[]> {
    if (accessibleLibraryIds.length === 0) return [];
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .where(inArray(books.libraryId, accessibleLibraryIds))
      .orderBy(desc(books.addedAt), desc(books.id))
      .limit(limit);

    return rows.map((row) => row.id);
  }

  async findContinueReadingBookIds(accessibleLibraryIds: number[], userId: number, limit: number): Promise<number[]> {
    if (accessibleLibraryIds.length === 0) return [];
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .innerJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .innerJoin(
        readingProgress,
        and(
          eq(readingProgress.bookFileId, bookFiles.id),
          eq(readingProgress.userId, userId),
          gt(readingProgress.percentage, 0),
          lt(readingProgress.percentage, 100),
        ),
      )
      .where(inArray(books.libraryId, accessibleLibraryIds))
      .orderBy(desc(readingProgress.updatedAt), desc(books.id))
      .limit(limit);

    return rows.map((row) => row.id);
  }

  async findRandomBookIds(accessibleLibraryIds: number[], userId: number, limit: number): Promise<number[]> {
    if (accessibleLibraryIds.length === 0) return [];
    if (limit <= 0) return [];

    const unreadFilter = and(
      inArray(books.libraryId, accessibleLibraryIds),
      eq(books.status, 'present'),
      or(isNull(readingProgress.bookFileId), eq(readingProgress.percentage, 0)),
    );

    const [bounds] = await this.db
      .select({
        minId: sql<number | null>`min(${books.id})`,
        maxId: sql<number | null>`max(${books.id})`,
      })
      .from(books)
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .leftJoin(readingProgress, and(eq(readingProgress.bookFileId, bookFiles.id), eq(readingProgress.userId, userId)))
      .where(unreadFilter);

    if (bounds?.minId == null || bounds.maxId == null || bounds.minId > bounds.maxId) return [];

    const range = bounds.maxId - bounds.minId + 1;
    const anchorId = bounds.minId + Math.floor(Math.random() * range);

    const firstPass = await this.db
      .select({ id: books.id })
      .from(books)
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .leftJoin(readingProgress, and(eq(readingProgress.bookFileId, bookFiles.id), eq(readingProgress.userId, userId)))
      .where(and(unreadFilter, gte(books.id, anchorId)))
      .orderBy(books.id)
      .limit(limit);

    const remaining = limit - firstPass.length;
    const secondPass =
      remaining > 0
        ? await this.db
            .select({ id: books.id })
            .from(books)
            .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
            .leftJoin(readingProgress, and(eq(readingProgress.bookFileId, bookFiles.id), eq(readingProgress.userId, userId)))
            .where(and(unreadFilter, lt(books.id, anchorId)))
            .orderBy(books.id)
            .limit(remaining)
        : [];

    return [...firstPass, ...secondPass].map((row) => row.id);
  }
}
