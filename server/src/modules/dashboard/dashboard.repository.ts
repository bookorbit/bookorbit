import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
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
    const unreadFilter = and(
      inArray(books.libraryId, accessibleLibraryIds),
      or(isNull(readingProgress.bookFileId), eq(readingProgress.percentage, 0)),
    );

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(books)
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .leftJoin(readingProgress, and(eq(readingProgress.bookFileId, bookFiles.id), eq(readingProgress.userId, userId)))
      .where(unreadFilter);

    const totalCandidates = Number(total);
    if (totalCandidates === 0) return [];

    const maxOffset = Math.max(totalCandidates - limit, 0);
    const offset = maxOffset === 0 ? 0 : Math.floor(Math.random() * (maxOffset + 1));

    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .leftJoin(readingProgress, and(eq(readingProgress.bookFileId, bookFiles.id), eq(readingProgress.userId, userId)))
      .where(unreadFilter)
      .orderBy(asc(books.id))
      .limit(limit)
      .offset(offset);
    return rows.map((row) => row.id);
  }
}
