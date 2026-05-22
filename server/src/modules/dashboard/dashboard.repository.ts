import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ContentFilterRules } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { audiobookProgress, bookFiles, books, readingProgress } from '../../db/schema';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class DashboardRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findRecentlyAddedBookIds(accessibleLibraryIds: number[], limit: number, contentFilters?: ContentFilterRules): Promise<number[]> {
    if (accessibleLibraryIds.length === 0) return [];
    const cfClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .where(and(inArray(books.libraryId, accessibleLibraryIds), ...cfClauses))
      .orderBy(desc(books.addedAt), desc(books.id))
      .limit(limit);

    return rows.map((row) => row.id);
  }

  async findContinueReadingBookIds(
    accessibleLibraryIds: number[],
    userId: number,
    limit: number,
    contentFilters?: ContentFilterRules,
  ): Promise<number[]> {
    if (accessibleLibraryIds.length === 0) return [];
    const mergedProgress = sql<number>`
      coalesce(
        case
          when ${readingProgress.updatedAt} is null then ${audiobookProgress.percentage}
          when ${audiobookProgress.updatedAt} is null then ${readingProgress.percentage}
          when ${readingProgress.updatedAt} >= ${audiobookProgress.updatedAt} then ${readingProgress.percentage}
          else ${audiobookProgress.percentage}
        end,
        ${readingProgress.percentage},
        ${audiobookProgress.percentage},
        0
      )
    `;
    const mergedUpdatedAt = sql<Date | null>`
      case
        when ${readingProgress.updatedAt} is null then ${audiobookProgress.updatedAt}
        when ${audiobookProgress.updatedAt} is null then ${readingProgress.updatedAt}
        when ${readingProgress.updatedAt} >= ${audiobookProgress.updatedAt} then ${readingProgress.updatedAt}
        else ${audiobookProgress.updatedAt}
      end
    `;

    const cfClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .leftJoin(readingProgress, and(eq(readingProgress.bookFileId, bookFiles.id), eq(readingProgress.userId, userId)))
      .leftJoin(audiobookProgress, and(eq(audiobookProgress.bookId, books.id), eq(audiobookProgress.userId, userId)))
      .where(and(inArray(books.libraryId, accessibleLibraryIds), sql`${mergedProgress} > 0 and ${mergedProgress} < 100`, ...cfClauses))
      .orderBy(desc(mergedUpdatedAt), desc(books.id))
      .limit(limit);

    return rows.map((row) => row.id);
  }

  async findRandomBookIds(accessibleLibraryIds: number[], userId: number, limit: number, contentFilters?: ContentFilterRules): Promise<number[]> {
    if (accessibleLibraryIds.length === 0) return [];
    if (limit <= 0) return [];

    const cfClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .leftJoin(readingProgress, and(eq(readingProgress.bookFileId, bookFiles.id), eq(readingProgress.userId, userId)))
      .where(
        and(
          inArray(books.libraryId, accessibleLibraryIds),
          eq(books.status, 'present'),
          or(isNull(readingProgress.bookFileId), eq(readingProgress.percentage, 0)),
          ...cfClauses,
        ),
      )
      .orderBy(sql`random()`)
      .limit(limit);

    return rows.map((row) => row.id);
  }
}
