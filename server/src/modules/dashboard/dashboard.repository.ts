import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ContentFilterRules } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { audiobookProgress, bookFiles, bookMetadata, books, readingProgress, userBookStatus } from '../../db/schema';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';

type Db = NodePgDatabase<typeof schema>;
type UpNextInSeriesRow = { id: number };

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

  async findUpNextInSeriesBookIds(
    accessibleLibraryIds: number[],
    userId: number,
    limit: number,
    contentFilters?: ContentFilterRules,
  ): Promise<number[]> {
    if (accessibleLibraryIds.length === 0) return [];
    if (limit <= 0) return [];

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
    const completionPredicate = sql<boolean>`${userBookStatus.status} in ('read', 'skimmed') or ${mergedProgress} >= 100`;
    const cfClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const libraryIdList = sql.join(
      accessibleLibraryIds.map((libraryId) => sql`${libraryId}`),
      sql`, `,
    );
    const filterSql = cfClauses.length > 0 ? sql`and ${sql.join(cfClauses, sql` and `)}` : sql``;

    const rows = await this.db.execute<UpNextInSeriesRow>(sql`
      with scoped_series_books as (
        select
          ${books.id} as id,
          ${books.libraryId} as library_id,
	          ${bookMetadata.seriesId} as series_id,
          ${bookMetadata.seriesIndex} as series_index,
          ${books.addedAt} as added_at,
          ${mergedProgress} as current_progress,
          case
            when ${completionPredicate} then true
            else false
          end as is_completed,
          case
            when ${completionPredicate}
              then greatest(
                coalesce(${userBookStatus.updatedAt}, to_timestamp(0)),
                coalesce(${mergedUpdatedAt}, to_timestamp(0))
              )
            else null
          end as completion_updated_at
        from ${books}
        inner join ${bookMetadata} on ${bookMetadata.bookId} = ${books.id}
        left join ${bookFiles} on ${bookFiles.id} = ${books.primaryFileId}
        left join ${readingProgress} on ${readingProgress.bookFileId} = ${bookFiles.id} and ${readingProgress.userId} = ${userId}
        left join ${audiobookProgress} on ${audiobookProgress.bookId} = ${books.id} and ${audiobookProgress.userId} = ${userId}
        left join ${userBookStatus} on ${userBookStatus.bookId} = ${books.id} and ${userBookStatus.userId} = ${userId}
        where ${books.libraryId} in (${libraryIdList})
          and ${books.status} = 'present'
	          and ${bookMetadata.seriesId} is not null
          and ${bookMetadata.seriesIndex} is not null
          ${filterSql}
      ),
      ordered_series as (
        select
          ssb.id,
          ssb.library_id,
	          ssb.series_id,
          ssb.series_index,
          ssb.added_at,
          ssb.current_progress,
          ssb.is_completed,
          ssb.completion_updated_at,
          lag(ssb.is_completed) over (
	            partition by ssb.library_id, ssb.series_id
            order by ssb.series_index asc, ssb.added_at asc, ssb.id asc
          ) as previous_is_completed,
          lag(ssb.completion_updated_at) over (
	            partition by ssb.library_id, ssb.series_id
            order by ssb.series_index asc, ssb.added_at asc, ssb.id asc
          ) as previous_completion_updated_at
        from scoped_series_books ssb
      ),
      next_candidates as (
	        select distinct on (os.library_id, os.series_id)
          os.id,
          os.previous_completion_updated_at
        from ordered_series os
        where os.previous_is_completed = true
          and os.is_completed = false
          and os.current_progress = 0
	        order by os.library_id, os.series_id, os.series_index asc, os.added_at asc, os.id asc
      )
      select nc.id
      from next_candidates nc
      order by nc.previous_completion_updated_at desc nulls last, nc.id desc
      limit ${limit}
    `);

    return rows.rows.map((row) => row.id);
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
