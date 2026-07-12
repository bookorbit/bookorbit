import { BadRequestException, Inject, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, exists, inArray, notExists, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgColumn, PgTableWithColumns } from 'drizzle-orm/pg-core';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { books, bookMetadata } from '../../../db/schema';
import { buildContentFilterClauses } from '../../../common/utils/content-filter-sql.utils';
import { accentInsensitiveIlike } from '../../../common/utils/accent-insensitive-search.utils';
import type {
  BrowseParams,
  BrowseResult,
  DeleteInput,
  EntityStrategy,
  MergeInput,
  RawCandidatePair,
  RenameInput,
  SplitInput,
  StrategyDeleteResult,
  StrategyMergeResult,
  StrategyRenameResult,
  StrategySplitResult,
} from './entity-strategy.interface';

type Db = NodePgDatabase<typeof schema>;

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

export abstract class JunctionEntityStrategy implements EntityStrategy {
  abstract readonly entityType: 'genre' | 'tag' | 'narrator';
  readonly isInline = false;

  protected abstract readonly entityTable: PgTableWithColumns<any>;
  protected abstract readonly junctionTable: PgTableWithColumns<any>;
  protected abstract readonly entityIdCol: PgColumn;
  protected abstract readonly junctionEntityIdCol: PgColumn;
  protected abstract readonly junctionBookIdCol: PgColumn;
  protected abstract readonly nameCol: PgColumn;
  protected abstract readonly rawTableName: string;
  protected abstract readonly rawJunctionTable: string;
  protected abstract readonly rawEntityIdCol: string;
  protected abstract readonly hasCascade: boolean;

  constructor(@Inject(DB) protected readonly db: Db) {}

  async findCandidatePairs(libraryIds: number[], minSimilarity: number): Promise<RawCandidatePair[]> {
    const similarityThreshold = Math.max(0.1, Math.min(1, minSimilarity));
    const t = sql.raw(this.rawTableName);
    const jt = sql.raw(this.rawJunctionTable);
    const ec = sql.raw(this.rawEntityIdCol);

    let libraryFilter = sql``;
    if (libraryIds.length > 0) {
      const idsLiteral = sql.raw(`(${libraryIds.join(',')})`);
      libraryFilter = sql`
        AND EXISTS (
          SELECT 1 FROM ${jt} jj JOIN books b ON jj.book_id = b.id
          WHERE jj.${ec} = e1.id AND b.library_id IN ${idsLiteral}
        )
        AND EXISTS (
          SELECT 1 FROM ${jt} jj JOIN books b ON jj.book_id = b.id
          WHERE jj.${ec} = e2.id AND b.library_id IN ${idsLiteral}
        )`;
    }

    const rows = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('pg_trgm.similarity_threshold', ${similarityThreshold.toString()}, true)`);
      return tx.execute<{
        idA: number;
        idB: number;
        nameA: string;
        nameB: string;
        simScore: number;
      }>(sql`
        SELECT
          e1.id AS "idA", e2.id AS "idB",
          e1.name AS "nameA", e2.name AS "nameB",
          similarity(e1.name, e2.name) AS "simScore"
        FROM ${t} e1
        JOIN ${t} e2 ON e1.id < e2.id AND e1.name % e2.name
        WHERE similarity(e1.name, e2.name) >= ${similarityThreshold}
        ${libraryFilter}
        ORDER BY similarity(e1.name, e2.name) DESC
      `);
    });

    return rows.rows;
  }

  async getAllEntityIds(): Promise<number[]> {
    const t = sql.raw(this.rawTableName);
    const rows = await this.db.execute<{ id: number }>(sql`SELECT id FROM ${t} ORDER BY id`);
    return rows.rows.map((r) => r.id);
  }

  async computeCandidatePairsForBatch(outerIds: number[], minSimilarity: number): Promise<RawCandidatePair[]> {
    const similarityThreshold = Math.max(0.1, Math.min(1, minSimilarity));
    const t = sql.raw(this.rawTableName);
    const idsArray = sql.raw(`ARRAY[${outerIds.join(',')}]::int[]`);

    const rows = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('pg_trgm.similarity_threshold', ${similarityThreshold.toString()}, true)`);
      return tx.execute<{
        idA: number;
        idB: number;
        nameA: string;
        nameB: string;
        simScore: number;
      }>(sql`
        SELECT
          e1.id AS "idA", e2.id AS "idB",
          e1.name AS "nameA", e2.name AS "nameB",
          similarity(e1.name, e2.name) AS "simScore"
        FROM (SELECT id, name FROM ${t} WHERE id = ANY(${idsArray})) e1
        JOIN ${t} e2 ON e1.id < e2.id AND e1.name % e2.name
        WHERE similarity(e1.name, e2.name) >= ${similarityThreshold}
      `);
    });

    return rows.rows;
  }

  async browse(params: BrowseParams): Promise<BrowseResult> {
    const cfClauses = params.contentFilters ? buildContentFilterClauses(params.contentFilters, this.db) : [];
    const bookSubquery =
      params.libraryIds.length > 0
        ? this.db
            .select({ id: books.id })
            .from(books)
            .where(and(inArray(books.libraryId, params.libraryIds), ...cfClauses))
        : null;

    const nameCondition = params.search ? (accentInsensitiveIlike(this.nameCol, `%${escapeLike(params.search)}%`) as any) : undefined;
    const joinCondition = bookSubquery
      ? and(eq(this.junctionEntityIdCol, this.entityIdCol), inArray(this.junctionBookIdCol, bookSubquery))
      : and(eq(this.junctionEntityIdCol, this.entityIdCol), sql`false`);
    const bookCountExpr = sql<number>`count(distinct ${this.junctionBookIdCol})::int`;

    const hasScopedBooks = bookSubquery
      ? exists(
          this.db
            .select({ one: sql`1` })
            .from(this.junctionTable)
            .where(and(eq(this.junctionEntityIdCol, this.entityIdCol), inArray(this.junctionBookIdCol, bookSubquery))),
        )
      : undefined;
    const isGloballyEmpty = notExists(
      this.db
        .select({ one: sql`1` })
        .from(this.junctionTable)
        .where(eq(this.junctionEntityIdCol, this.entityIdCol)),
    );
    const visibilityCondition =
      params.bookCount === 'empty' ? isGloballyEmpty : hasScopedBooks ? or(hasScopedBooks, isGloballyEmpty) : isGloballyEmpty;

    const countQuery = this.db
      .select({ total: sql<number>`count(distinct ${this.entityIdCol})::int` })
      .from(this.entityTable)
      .where(and(nameCondition, visibilityCondition));

    const itemQuery = this.db
      .select({ id: this.entityIdCol, name: this.nameCol, bookCount: bookCountExpr })
      .from(this.entityTable)
      .leftJoin(this.junctionTable, joinCondition)
      .where(and(nameCondition, visibilityCondition))
      .groupBy(this.entityIdCol, this.nameCol)
      .$dynamic();

    itemQuery
      .orderBy(
        params.sortBy === 'bookCount'
          ? params.sortOrder === 'asc'
            ? asc(bookCountExpr)
            : desc(bookCountExpr)
          : params.sortOrder === 'asc'
            ? asc(this.nameCol)
            : desc(this.nameCol),
      )
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    const [countResult, itemRows] = await Promise.all([countQuery, itemQuery]);

    return {
      items: itemRows.map((r: any) => ({ id: r.id, name: r.name, bookCount: r.bookCount })),
      total: (countResult[0] as any)?.total ?? 0,
    };
  }

  async merge(input: MergeInput): Promise<StrategyMergeResult> {
    const targetId = input.targetId as number;
    const sourceIds = input.sourceIds as number[];

    const target = await this.findEntityById(targetId);
    if (!target) throw new NotFoundException(`${this.entityType} not found`);

    const affectedBookIds = await this.findAffectedBookIds(sourceIds);

    await this.db.transaction(async (tx) => {
      const sourceRelations = await tx
        .selectDistinct({ bookId: this.junctionBookIdCol })
        .from(this.junctionTable)
        .where(inArray(this.junctionEntityIdCol, sourceIds));

      if (sourceRelations.length > 0) {
        await tx
          .insert(this.junctionTable)
          .values(sourceRelations.map((r: any) => this.buildJunctionRow(r.bookId, targetId)))
          .onConflictDoNothing();
      }

      await tx.delete(this.junctionTable).where(inArray(this.junctionEntityIdCol, sourceIds));
      await tx.delete(this.entityTable).where(inArray(this.entityIdCol, sourceIds));
    });

    return { affectedBookIds };
  }

  async rename(input: RenameInput): Promise<StrategyRenameResult> {
    const entityId = input.entityId as number;
    const [entity] = await this.db.select({ name: this.nameCol }).from(this.entityTable).where(eq(this.entityIdCol, entityId)).limit(1);
    if (!entity) throw new NotFoundException(`${this.entityType} not found`);

    const oldName = (entity as any).name as string;
    const trimmed = input.newName.trim();
    if (!trimmed) throw new BadRequestException('Name cannot be empty');

    const [existing] = await this.db.select({ id: this.entityIdCol }).from(this.entityTable).where(eq(this.nameCol, trimmed)).limit(1);
    if (existing && (existing as any).id !== entityId) {
      const existingId = (existing as any).id as number;
      const mergeResult = await this.merge({ targetId: existingId, sourceIds: [entityId], userId: input.userId });
      return { oldName, affectedBookIds: mergeResult.affectedBookIds, wasImplicitMerge: true, mergedEntityId: existingId };
    }

    await this.db.update(this.entityTable).set({ name: trimmed }).where(eq(this.entityIdCol, entityId));
    const affectedBookIds = await this.findAffectedBookIds([entityId]);
    return { oldName, affectedBookIds, wasImplicitMerge: false };
  }

  async deleteEntity(input: DeleteInput): Promise<StrategyDeleteResult> {
    const entityId = input.entityId as number;
    const [entity] = await this.db.select({ name: this.nameCol }).from(this.entityTable).where(eq(this.entityIdCol, entityId)).limit(1);
    if (!entity) throw new NotFoundException(`${this.entityType} not found`);

    const affectedBookIds = await this.findAffectedBookIds([entityId]);

    if (input.mode === 'soft') {
      await this.db.delete(this.junctionTable).where(eq(this.junctionEntityIdCol, entityId));
    } else {
      if (!this.hasCascade) {
        await this.db.transaction(async (tx) => {
          await tx.delete(this.junctionTable).where(eq(this.junctionEntityIdCol, entityId));
          await tx.delete(this.entityTable).where(eq(this.entityIdCol, entityId));
        });
      } else {
        await this.db.delete(this.entityTable).where(eq(this.entityIdCol, entityId));
      }
    }

    return { name: (entity as any).name, affectedBookIds };
  }

  async split(input: SplitInput): Promise<StrategySplitResult> {
    const [entity] = await this.db.select({ name: this.nameCol }).from(this.entityTable).where(eq(this.entityIdCol, input.entityId)).limit(1);
    if (!entity) throw new NotFoundException(`${this.entityType} not found`);

    const affectedBookIds = await this.findAffectedBookIds([input.entityId]);
    const newEntities: { id: number; name: string }[] = [];

    await this.db.transaction(async (tx) => {
      for (const name of input.newNames) {
        const trimmed = name.trim();
        const [existing] = await tx.select({ id: this.entityIdCol }).from(this.entityTable).where(eq(this.nameCol, trimmed)).limit(1);
        if (existing) {
          newEntities.push({ id: (existing as any).id, name: trimmed });
        } else {
          const [inserted] = await tx.insert(this.entityTable).values({ name: trimmed }).returning({ id: this.entityIdCol });
          newEntities.push({ id: (inserted as any).id, name: trimmed });
        }
      }

      const bookRows = await tx
        .selectDistinct({ bookId: this.junctionBookIdCol })
        .from(this.junctionTable)
        .where(eq(this.junctionEntityIdCol, input.entityId));

      for (const newEntity of newEntities) {
        if (bookRows.length > 0) {
          await tx
            .insert(this.junctionTable)
            .values(bookRows.map((r: any) => this.buildJunctionRow(r.bookId, newEntity.id)))
            .onConflictDoNothing();
        }
      }

      await tx.delete(this.junctionTable).where(eq(this.junctionEntityIdCol, input.entityId));
      await tx.delete(this.entityTable).where(eq(this.entityIdCol, input.entityId));
    });

    return { originalName: (entity as any).name, newEntities, affectedBookIds };
  }

  async findAffectedBookIds(ids: (number | string)[]): Promise<number[]> {
    const numericIds = ids as number[];
    if (numericIds.length === 0) return [];
    const rows = await this.db
      .selectDistinct({ bookId: this.junctionBookIdCol })
      .from(this.junctionTable)
      .where(inArray(this.junctionEntityIdCol, numericIds));
    return rows.map((r: any) => r.bookId);
  }

  async getBookCount(id: number | string): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(this.junctionTable)
      .where(eq(this.junctionEntityIdCol, id as number));
    return row?.count ?? 0;
  }

  async getBookTitles(id: number | string, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ title: sql<string>`COALESCE(${bookMetadata.title}, 'Untitled')` })
      .from(this.junctionTable)
      .innerJoin(books, eq(books.id, this.junctionBookIdCol))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(eq(this.junctionEntityIdCol, id as number))
      .orderBy(asc(bookMetadata.title))
      .limit(limit);
    return rows.map((r) => r.title);
  }

  async findEntityById(id: number | string): Promise<{ id: number; name: string } | null> {
    const [row] = await this.db
      .select({ id: this.entityIdCol, name: this.nameCol })
      .from(this.entityTable)
      .where(eq(this.entityIdCol, id as number))
      .limit(1);
    if (!row) return null;
    return { id: (row as any).id, name: (row as any).name };
  }

  protected abstract buildJunctionRow(bookId: number, entityId: number): Record<string, unknown>;
}
