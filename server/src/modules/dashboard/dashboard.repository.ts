import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lt, max, min, notExists, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { BOOK_FORMATS, isAudioFormat, type ContentFilterRules, type ReadStatus } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { audiobookProgress, bookFiles, bookMetadata, books, readingProgress, userBookStatus } from '../../db/schema';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';

type Db = NodePgDatabase<typeof schema>;
type UpNextInSeriesRow = { id: number };
type RandomCandidateRow = { sampleIndex: number; id: number };
const AUDIO_FORMATS = BOOK_FORMATS.filter(isAudioFormat);
const CONTINUE_READING_EXCLUDED_READ_STATUSES = ['unread', 'read', 'skimmed', 'abandoned'] as const satisfies readonly ReadStatus[];
const DISCOVERY_EXCLUDED_READ_STATUSES = ['reading', 'rereading', 'on_hold', 'read', 'skimmed', 'abandoned'] as const satisfies readonly ReadStatus[];
// Three independent pivots per requested row tolerate moderate collisions from
// sparse eligibility. The ceiling prevents large requests from multiplying probes.
const RANDOM_PIVOT_MULTIPLIER = 3;
const RANDOM_MAX_PIVOTS = 60;

@Injectable()
export class DashboardRepository {
  private readonly randomIdBounds = new Map<string, { minId: number; maxId: number; expiresAt: number }>();

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

    const cfClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .leftJoin(bookFiles, eq(bookFiles.id, books.primaryFileId))
      .leftJoin(readingProgress, and(eq(readingProgress.bookFileId, bookFiles.id), eq(readingProgress.userId, userId)))
      .leftJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, userId)))
      .where(
        and(
          inArray(books.libraryId, accessibleLibraryIds),
          eq(books.status, 'present'),
          or(isNull(bookFiles.format), notInArray(bookFiles.format, AUDIO_FORMATS)),
          sql`${readingProgress.percentage} > 0 and ${readingProgress.percentage} < 100`,
          or(isNull(userBookStatus.bookId), notInArray(userBookStatus.status, [...CONTINUE_READING_EXCLUDED_READ_STATUSES])),
          ...cfClauses,
        ),
      )
      .orderBy(desc(readingProgress.updatedAt), desc(books.id))
      .limit(limit);

    return rows.map((row) => row.id);
  }

  async findContinueListeningBookIds(
    accessibleLibraryIds: number[],
    userId: number,
    limit: number,
    contentFilters?: ContentFilterRules,
  ): Promise<number[]> {
    if (accessibleLibraryIds.length === 0) return [];

    const cfClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .innerJoin(audiobookProgress, and(eq(audiobookProgress.bookId, books.id), eq(audiobookProgress.userId, userId)))
      .innerJoin(
        bookFiles,
        and(
          eq(bookFiles.id, audiobookProgress.currentFileId),
          eq(bookFiles.bookId, books.id),
          eq(bookFiles.role, 'content'),
          inArray(bookFiles.format, AUDIO_FORMATS),
        ),
      )
      .where(
        and(
          inArray(books.libraryId, accessibleLibraryIds),
          eq(books.status, 'present'),
          sql`${audiobookProgress.percentage} > 0 and ${audiobookProgress.percentage} < 100`,
          ...cfClauses,
        ),
      )
      .orderBy(desc(audiobookProgress.updatedAt), desc(books.id))
      .limit(limit);

    return rows.map((row) => row.id);
  }

  async findWantToReadBookIds(accessibleLibraryIds: number[], userId: number, limit: number, contentFilters?: ContentFilterRules): Promise<number[]> {
    if (accessibleLibraryIds.length === 0) return [];

    const cfClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const rows = await this.db
      .select({ id: books.id })
      .from(books)
      .innerJoin(userBookStatus, and(eq(userBookStatus.bookId, books.id), eq(userBookStatus.userId, userId)))
      .where(
        and(inArray(books.libraryId, accessibleLibraryIds), eq(books.status, 'present'), eq(userBookStatus.status, 'want_to_read'), ...cfClauses),
      )
      .orderBy(desc(userBookStatus.updatedAt), desc(books.id))
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

    const bounds = await this.findRandomIdBounds(accessibleLibraryIds);
    if (!bounds) return [];
    const cfClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    // OFFSET 0 keeps these as correlated index lookups. Without it PostgreSQL
    // can flatten them into anti-joins that rescan a user's full status set.
    const hasNoProgress = notExists(
      this.db
        .select({ one: sql`1` })
        .from(readingProgress)
        .where(and(eq(readingProgress.bookFileId, books.primaryFileId), eq(readingProgress.userId, userId), sql`${readingProgress.percentage} <> 0`))
        .offset(0),
    );
    const hasNoExcludedReadStatus = notExists(
      this.db
        .select({ one: sql`1` })
        .from(userBookStatus)
        .where(
          and(
            eq(userBookStatus.bookId, books.id),
            eq(userBookStatus.userId, userId),
            inArray(userBookStatus.status, [...DISCOVERY_EXCLUDED_READ_STATUSES]),
          ),
        )
        .offset(0),
    );
    const eligibility = and(
      inArray(books.libraryId, accessibleLibraryIds),
      eq(books.status, 'present'),
      hasNoProgress,
      hasNoExcludedReadStatus,
      ...cfClauses,
    )!;

    // Independent indexed pivots distribute membership across the id range without
    // paying for a full ORDER BY random() or returning one scan-order neighborhood.
    const pivotCount = Math.min(limit * RANDOM_PIVOT_MULTIPLIER, RANDOM_MAX_PIVOTS);
    const pivots = Array.from({ length: pivotCount }, () => this.randomPivot(bounds));
    const sampledIds = [...new Set(await this.findDistributedRandomCandidates(pivots, eligibility))];
    if (sampledIds.length >= limit) return sampledIds.slice(0, limit);

    const fallbackPivot = this.randomPivot(bounds);
    const findFallbackCandidates = (idPredicate: SQL, orderBy: SQL, candidateLimit: number) =>
      this.db
        .select({ id: books.id })
        .from(books)
        .where(and(eligibility, sampledIds.length > 0 ? notInArray(books.id, sampledIds) : undefined, idPredicate))
        .orderBy(orderBy)
        .limit(candidateLimit);

    const remaining = limit - sampledIds.length;
    const fallbackRows = await findFallbackCandidates(gte(books.id, fallbackPivot), asc(books.id), remaining);
    if (fallbackRows.length < remaining) {
      fallbackRows.push(...(await findFallbackCandidates(lt(books.id, fallbackPivot), desc(books.id), remaining - fallbackRows.length)));
    }

    return [...sampledIds, ...fallbackRows.map((row) => row.id)].slice(0, limit);
  }

  private async findDistributedRandomCandidates(pivots: number[], eligibility: SQL): Promise<number[]> {
    const pivotValues = sql.join(
      pivots.map((pivot, sampleIndex) => sql`(${sampleIndex}::integer, ${pivot}::integer)`),
      sql`, `,
    );
    const result = await this.db.execute<RandomCandidateRow>(sql`
      with pivots(sample_index, pivot_id) as (
        values ${pivotValues}
      )
      select p.sample_index as "sampleIndex", coalesce(forward_candidate.id, wrap_candidate.id) as id
      from pivots p
      left join lateral (
        select ${books.id} as id
        from ${books}
        where ${eligibility} and ${books.id} >= p.pivot_id
        order by ${books.id} asc
        limit 1
      ) forward_candidate on true
      left join lateral (
        select ${books.id} as id
        from ${books}
        where forward_candidate.id is null
          and ${eligibility}
          and ${books.id} < p.pivot_id
        order by ${books.id} desc
        limit 1
      ) wrap_candidate on true
      where coalesce(forward_candidate.id, wrap_candidate.id) is not null
      order by p.sample_index
    `);

    return result.rows.map((row) => row.id);
  }

  private randomPivot(bounds: { minId: number; maxId: number }): number {
    return bounds.minId + Math.floor(Math.random() * (bounds.maxId - bounds.minId + 1));
  }

  private async findRandomIdBounds(accessibleLibraryIds: number[]): Promise<{ minId: number; maxId: number } | null> {
    const now = Date.now();
    const cacheKey = [...accessibleLibraryIds].sort((left, right) => left - right).join(',');
    const cached = this.randomIdBounds.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached;

    const [row] = await this.db
      .select({ minId: min(books.id), maxId: max(books.id) })
      .from(books)
      .where(and(inArray(books.libraryId, accessibleLibraryIds), eq(books.status, 'present')));
    if (row?.minId == null || row.maxId == null) return null;

    const bounds = { minId: row.minId, maxId: row.maxId, expiresAt: now + 60_000 };
    this.randomIdBounds.set(cacheKey, bounds);
    if (this.randomIdBounds.size > 100) this.randomIdBounds.delete(this.randomIdBounds.keys().next().value!);
    return bounds;
  }
}
