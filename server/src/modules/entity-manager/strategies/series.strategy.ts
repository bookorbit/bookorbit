import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SQL, and, asc, count, desc, eq, ilike, inArray, isNotNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { buildContentFilterClauses } from '../../../common/utils/content-filter-sql.utils';
import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { bookMetadata, books, bookSeries } from '../../../db/schema';
import type {
  BrowseParams,
  BrowseResult,
  DeleteInput,
  EntityStrategy,
  MergeInput,
  RawCandidatePair,
  RenameInput,
  StrategyDeleteResult,
  StrategyMergeResult,
  StrategyRenameResult,
  StrategySplitResult,
} from './entity-strategy.interface';

type Db = NodePgDatabase<typeof schema>;

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}

function numericIds(ids: (number | string)[]): number[] {
  return [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
}

function sqlNumberList(ids: number[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

@Injectable()
export class SeriesStrategy implements EntityStrategy {
  readonly entityType = 'series' as const;
  readonly isInline = false;

  constructor(@Inject(DB) private readonly db: Db) {}

  async findCandidatePairs(libraryIds: number[], minSimilarity: number): Promise<RawCandidatePair[]> {
    const scopedLibraryIds = numericIds(libraryIds);
    if (scopedLibraryIds.length === 0) return [];
    const similarityThreshold = Math.max(0.1, Math.min(1, minSimilarity));
    const libraryIdList = sqlNumberList(scopedLibraryIds);

    const rows = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('pg_trgm.similarity_threshold', ${similarityThreshold.toString()}, true)`);
      return tx.execute<{ idA: number; idB: number; nameA: string; nameB: string; simScore: number }>(sql`
        SELECT
          s1.id AS "idA",
          s2.id AS "idB",
          s1.name AS "nameA",
          s2.name AS "nameB",
          similarity(s1.name, s2.name) AS "simScore"
        FROM book_series s1
        JOIN book_series s2 ON s1.id < s2.id AND s1.name % s2.name
        WHERE similarity(s1.name, s2.name) >= ${similarityThreshold}
          AND EXISTS (
            SELECT 1 FROM book_metadata bm
            JOIN books b ON b.id = bm.book_id
            WHERE bm.series_id = s1.id AND b.library_id IN (${libraryIdList})
          )
          AND EXISTS (
            SELECT 1 FROM book_metadata bm
            JOIN books b ON b.id = bm.book_id
            WHERE bm.series_id = s2.id AND b.library_id IN (${libraryIdList})
          )
        ORDER BY similarity(s1.name, s2.name) DESC
      `);
    });

    return rows.rows;
  }

  async getAllEntityIds(): Promise<number[]> {
    const rows = await this.db.select({ id: bookSeries.id }).from(bookSeries).orderBy(bookSeries.id);
    return rows.map((row) => row.id);
  }

  async computeCandidatePairsForBatch(outerIds: number[], minSimilarity: number): Promise<RawCandidatePair[]> {
    const batchIds = numericIds(outerIds);
    if (batchIds.length === 0) return [];
    const similarityThreshold = Math.max(0.1, Math.min(1, minSimilarity));
    const batchIdList = sqlNumberList(batchIds);

    const rows = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('pg_trgm.similarity_threshold', ${similarityThreshold.toString()}, true)`);
      return tx.execute<{ idA: number; idB: number; nameA: string; nameB: string; simScore: number }>(sql`
        SELECT
          s1.id AS "idA",
          s2.id AS "idB",
          s1.name AS "nameA",
          s2.name AS "nameB",
          similarity(s1.name, s2.name) AS "simScore"
        FROM (SELECT id, name FROM book_series WHERE id IN (${batchIdList})) s1
        JOIN book_series s2 ON s1.id < s2.id AND s1.name % s2.name
        WHERE similarity(s1.name, s2.name) >= ${similarityThreshold}
      `);
    });

    return rows.rows;
  }

  async browse(params: BrowseParams): Promise<BrowseResult> {
    if (params.libraryIds.length === 0) return { items: [], total: 0 };

    const filterClauses = params.contentFilters ? buildContentFilterClauses(params.contentFilters, this.db) : [];
    const conditions = [inArray(books.libraryId, params.libraryIds), isNotNull(bookMetadata.seriesId), ...filterClauses];
    if (params.search) {
      conditions.push(ilike(bookSeries.name, `%${escapeLike(params.search)}%`) as never);
    }

    const where = and(...conditions)!;
    const bookCountExpr = sql<number>`count(distinct ${bookMetadata.bookId})::int`;

    const [countResult, itemRows] = await Promise.all([
      this.db
        .select({ total: sql<number>`count(distinct ${bookSeries.id})::int` })
        .from(bookSeries)
        .innerJoin(bookMetadata, eq(bookMetadata.seriesId, bookSeries.id))
        .innerJoin(books, eq(books.id, bookMetadata.bookId))
        .where(where),
      this.db
        .select({ id: bookSeries.id, name: bookSeries.name, bookCount: bookCountExpr })
        .from(bookSeries)
        .innerJoin(bookMetadata, eq(bookMetadata.seriesId, bookSeries.id))
        .innerJoin(books, eq(books.id, bookMetadata.bookId))
        .where(where)
        .groupBy(bookSeries.id, bookSeries.name)
        .orderBy(
          params.sortBy === 'bookCount'
            ? params.sortOrder === 'asc'
              ? asc(bookCountExpr)
              : desc(bookCountExpr)
            : params.sortOrder === 'asc'
              ? asc(bookSeries.name)
              : desc(bookSeries.name),
        )
        .limit(params.pageSize)
        .offset((params.page - 1) * params.pageSize),
    ]);

    return {
      items: itemRows.map((row) => ({ id: row.id, name: row.name, bookCount: row.bookCount })),
      total: countResult[0]?.total ?? 0,
    };
  }

  async merge(input: MergeInput): Promise<StrategyMergeResult> {
    const targetId = Number(input.targetId);
    const sourceIds = numericIds(input.sourceIds).filter((id) => id !== targetId);
    if (!Number.isInteger(targetId) || targetId <= 0 || sourceIds.length === 0) return { affectedBookIds: [] };

    const target = await this.findEntityById(targetId);
    if (!target) throw new NotFoundException('series not found');

    const affectedBookIds = await this.findAffectedBookIdsInLibraries(sourceIds, input.libraryIds);
    if (affectedBookIds.length === 0) return { affectedBookIds };

    await this.db.transaction(async (tx) => {
      await tx
        .update(bookMetadata)
        .set({ seriesId: targetId, seriesName: target.name, updatedAt: new Date() })
        .where(and(inArray(bookMetadata.bookId, affectedBookIds), inArray(bookMetadata.seriesId, sourceIds)));
      await this.deleteUnusedSeriesRows(sourceIds, tx as unknown as Db);
    });

    return { affectedBookIds };
  }

  async rename(input: RenameInput): Promise<StrategyRenameResult> {
    const entityId = Number(input.entityId);
    const current = await this.findEntityById(entityId);
    if (!current) throw new NotFoundException('series not found');

    const newName = input.newName.trim();
    if (!newName) throw new BadRequestException('Name cannot be empty');

    const affectedBookIds = await this.findAffectedBookIdsInLibraries([entityId], input.libraryIds);
    if (affectedBookIds.length === 0) {
      return {
        oldName: current.name,
        affectedBookIds,
        wasImplicitMerge: false,
      };
    }

    const target = await this.upsertSeries(newName);
    const wasImplicitMerge = target.id !== entityId;

    await this.db.transaction(async (tx) => {
      await tx
        .update(bookMetadata)
        .set({ seriesId: target.id, seriesName: target.name, updatedAt: new Date() })
        .where(and(inArray(bookMetadata.bookId, affectedBookIds), eq(bookMetadata.seriesId, entityId)));
      await this.deleteUnusedSeriesRows([entityId], tx as unknown as Db);
    });

    return {
      oldName: current.name,
      affectedBookIds,
      wasImplicitMerge,
      mergedEntityId: wasImplicitMerge ? target.id : undefined,
    };
  }

  async deleteEntity(input: DeleteInput): Promise<StrategyDeleteResult> {
    const entityId = Number(input.entityId);
    const entity = await this.findEntityById(entityId);
    if (!entity) throw new NotFoundException('series not found');

    const affectedBookIds = await this.findAffectedBookIdsInLibraries([entityId], input.libraryIds);
    if (affectedBookIds.length > 0) {
      await this.db.transaction(async (tx) => {
        await tx
          .update(bookMetadata)
          .set({ seriesId: null, seriesName: null, updatedAt: new Date() })
          .where(and(inArray(bookMetadata.bookId, affectedBookIds), eq(bookMetadata.seriesId, entityId)));
        await this.deleteUnusedSeriesRows([entityId], tx as unknown as Db);
      });
    }

    return { name: entity.name, affectedBookIds };
  }

  split(): Promise<StrategySplitResult> {
    throw new BadRequestException('Split is not supported for series');
  }

  async findAffectedBookIds(ids: (number | string)[]): Promise<number[]> {
    const seriesIds = numericIds(ids);
    if (seriesIds.length === 0) return [];
    const rows = await this.db.select({ bookId: bookMetadata.bookId }).from(bookMetadata).where(inArray(bookMetadata.seriesId, seriesIds));
    return rows.map((row) => row.bookId);
  }

  async getBookCount(id: number | string): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(bookMetadata)
      .where(eq(bookMetadata.seriesId, Number(id)));
    return row?.count ?? 0;
  }

  async getBookTitles(id: number | string, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ title: sql<string>`COALESCE(${bookMetadata.title}, 'Untitled')` })
      .from(bookMetadata)
      .where(eq(bookMetadata.seriesId, Number(id)))
      .orderBy(asc(bookMetadata.title))
      .limit(limit);
    return rows.map((row) => row.title);
  }

  async findEntityById(id: number | string): Promise<{ id: number; name: string } | null> {
    const [row] = await this.db
      .select({ id: bookSeries.id, name: bookSeries.name })
      .from(bookSeries)
      .where(eq(bookSeries.id, Number(id)))
      .limit(1);
    return row ?? null;
  }

  private async upsertSeries(name: string): Promise<{ id: number; name: string }> {
    const normalized = normalizedName(name);
    const [row] = await this.db
      .insert(bookSeries)
      .values({ name, normalizedName: normalized })
      .onConflictDoUpdate({
        target: bookSeries.normalizedName,
        set: { name, updatedAt: new Date() },
      })
      .returning({ id: bookSeries.id, name: bookSeries.name });
    if (!row) throw new BadRequestException('Unable to resolve series');
    return row;
  }

  private async findAffectedBookIdsInLibraries(seriesIds: number[], libraryIds: number[] | undefined): Promise<number[]> {
    if (seriesIds.length === 0 || !libraryIds || libraryIds.length === 0) return [];
    const rows = await this.db
      .select({ bookId: bookMetadata.bookId })
      .from(bookMetadata)
      .innerJoin(books, eq(books.id, bookMetadata.bookId))
      .where(and(inArray(bookMetadata.seriesId, seriesIds), inArray(books.libraryId, libraryIds)));
    return rows.map((row) => row.bookId);
  }

  private async deleteUnusedSeriesRows(seriesIds: number[], db: Db): Promise<void> {
    const unusedSeriesIds = numericIds(seriesIds);
    if (unusedSeriesIds.length === 0) return;
    const seriesIdList = sqlNumberList(unusedSeriesIds);
    await db.execute(sql`
      DELETE FROM book_series s
      WHERE s.id IN (${seriesIdList})
        AND NOT EXISTS (
          SELECT 1 FROM book_metadata bm
          WHERE bm.series_id = s.id
        )
    `);
  }
}
