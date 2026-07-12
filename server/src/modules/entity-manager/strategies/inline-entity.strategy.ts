import { BadRequestException, Inject } from '@nestjs/common';
import { SQL, asc, count, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { InlineEntityType } from '@bookorbit/types';
import { DB } from '../../../db';
import { accentInsensitiveIlike } from '../../../common/utils/accent-insensitive-search.utils';
import * as schema from '../../../db/schema';
import { bookMetadata } from '../../../db/schema';
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

export abstract class InlineEntityStrategy implements EntityStrategy {
  abstract readonly entityType: InlineEntityType;
  readonly isInline = true;

  protected abstract readonly fieldName: string;
  protected abstract readonly rawFieldName: string;

  constructor(@Inject(DB) protected readonly db: Db) {}

  protected get field() {
    return (bookMetadata as any)[this.fieldName];
  }

  protected normalizeInputValue(value: string): string | null {
    const trimmed = value.trim();
    return trimmed || null;
  }

  protected buildIdentityEqualsCondition(alias: string, value: string): SQL {
    return sql`${sql.raw(`${alias}.${this.rawFieldName}`)} = ${value}`;
  }

  async findCandidatePairs(libraryIds: number[], minSimilarity: number): Promise<RawCandidatePair[]> {
    const similarityThreshold = Math.max(0.1, Math.min(1, minSimilarity));
    const f = sql.raw(this.rawFieldName);
    const hasLibraryFilter = libraryIds.length > 0;
    const idsLiteral = hasLibraryFilter ? sql.raw(`(${libraryIds.join(',')})`) : sql``;

    const v1LibraryFilter = hasLibraryFilter
      ? sql`AND EXISTS (SELECT 1 FROM books b1 WHERE b1.id = bm1.book_id AND b1.library_id IN ${idsLiteral})`
      : sql``;
    const v2LibraryFilter = hasLibraryFilter
      ? sql`AND EXISTS (SELECT 1 FROM books b2 WHERE b2.id = bm2.book_id AND b2.library_id IN ${idsLiteral})`
      : sql``;

    const rows = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('pg_trgm.similarity_threshold', ${similarityThreshold.toString()}, true)`);
      return tx.execute<{
        idA: string;
        idB: string;
        nameA: string;
        nameB: string;
        simScore: number;
      }>(sql`
        SELECT DISTINCT ON (LEAST(LOWER(v1.val), LOWER(v2.val)), GREATEST(LOWER(v1.val), LOWER(v2.val)))
          v1.val AS "idA", v2.val AS "idB",
          v1.val AS "nameA", v2.val AS "nameB",
          similarity(LOWER(v1.val), LOWER(v2.val)) AS "simScore"
        FROM (
          SELECT DISTINCT bm1.${f} AS val, bm1.book_id
          FROM book_metadata bm1
          WHERE bm1.${f} IS NOT NULL AND bm1.${f} <> ''
          ${v1LibraryFilter}
        ) v1
        CROSS JOIN (
          SELECT DISTINCT bm2.${f} AS val, bm2.book_id
          FROM book_metadata bm2
          WHERE bm2.${f} IS NOT NULL AND bm2.${f} <> ''
          ${v2LibraryFilter}
        ) v2
        WHERE v1.val <> v2.val
        AND LOWER(v1.val) % LOWER(v2.val)
        AND similarity(LOWER(v1.val), LOWER(v2.val)) >= ${similarityThreshold}
        ORDER BY LEAST(LOWER(v1.val), LOWER(v2.val)), GREATEST(LOWER(v1.val), LOWER(v2.val)), similarity(LOWER(v1.val), LOWER(v2.val)) DESC
      `);
    });

    return rows.rows;
  }

  async browse(params: BrowseParams): Promise<BrowseResult> {
    const f = sql.raw(this.rawFieldName);

    let searchFilter = sql``;
    if (params.search) {
      searchFilter = sql` AND ${accentInsensitiveIlike(sql`bm.${f}`, '%' + escapeLike(params.search) + '%')}`;
    }

    const idsLiteral = sql.raw(`(${params.libraryIds.join(',')})`);

    const countQuery = await this.db.execute<{ total: number }>(sql`
      SELECT count(DISTINCT bm.${f})::int AS total
      FROM book_metadata bm
      JOIN books b ON b.id = bm.book_id
      WHERE b.library_id IN ${idsLiteral}
      AND bm.${f} IS NOT NULL AND bm.${f} <> ''
      ${searchFilter}
    `);

    const orderCol = params.sortBy === 'bookCount' ? 'book_count' : 'name';
    const orderDir = sql.raw(params.sortOrder === 'asc' ? 'ASC' : 'DESC');

    const itemsQuery = await this.db.execute<{ name: string; bookCount: number }>(sql`
      SELECT bm.${f} AS name, count(*)::int AS "bookCount"
      FROM book_metadata bm
      JOIN books b ON b.id = bm.book_id
      WHERE b.library_id IN ${idsLiteral}
      AND bm.${f} IS NOT NULL AND bm.${f} <> ''
      ${searchFilter}
      GROUP BY bm.${f}
      ORDER BY ${orderCol === 'book_count' ? sql`count(*)::int` : sql.raw('name')} ${orderDir}
      LIMIT ${params.pageSize} OFFSET ${(params.page - 1) * params.pageSize}
    `);

    return {
      items: itemsQuery.rows.map((r) => ({ id: r.name, name: r.name, bookCount: r.bookCount })),
      total: countQuery.rows[0]?.total ?? 0,
    };
  }

  async merge(input: MergeInput): Promise<StrategyMergeResult> {
    const targetValue = input.targetId as string;
    const sourceValues = input.sourceIds as string[];

    const affectedBookIds = await this.findAffectedBookIds(sourceValues);

    for (const sourceValue of sourceValues) {
      await this.db.execute(sql`
        UPDATE book_metadata bm SET ${sql.raw(this.rawFieldName)} = ${targetValue}
        FROM books b
        WHERE bm.book_id = b.id
        AND bm.${sql.raw(this.rawFieldName)} = ${sourceValue}
      `);
    }

    return { affectedBookIds };
  }

  async rename(input: RenameInput): Promise<StrategyRenameResult> {
    const currentValue = input.entityId as string;
    const trimmed = this.normalizeInputValue(input.newName);
    if (!trimmed) throw new BadRequestException('Name cannot be empty');

    const idsLiteral = sql.raw(`(${input.libraryIds.join(',')})`);

    const existingCount = await this.db.execute<{ cnt: number }>(sql`
      SELECT count(DISTINCT bm.book_id)::int AS cnt
      FROM book_metadata bm
      JOIN books b ON b.id = bm.book_id
      WHERE b.library_id IN ${idsLiteral}
      AND bm.${sql.raw(this.rawFieldName)} <> ${currentValue}
      AND ${this.buildIdentityEqualsCondition('bm', trimmed)}
    `);
    const wasImplicitMerge = (existingCount.rows[0]?.cnt ?? 0) > 0;

    const affectedRows = await this.db.execute<{ bookId: number }>(sql`
      UPDATE book_metadata bm SET ${sql.raw(this.rawFieldName)} = ${trimmed}
      FROM books b
      WHERE bm.book_id = b.id
      AND b.library_id IN ${idsLiteral}
      AND bm.${sql.raw(this.rawFieldName)} = ${currentValue}
      RETURNING bm.book_id AS "bookId"
    `);

    return {
      oldName: currentValue,
      affectedBookIds: affectedRows.rows.map((r) => r.bookId),
      wasImplicitMerge,
      mergedEntityId: wasImplicitMerge ? trimmed : undefined,
    };
  }

  async deleteEntity(input: DeleteInput): Promise<StrategyDeleteResult> {
    const value = input.entityId as string;
    const idsLiteral = sql.raw(`(${input.libraryIds.join(',')})`);

    const affectedRows = await this.db.execute<{ bookId: number }>(sql`
      UPDATE book_metadata bm SET ${sql.raw(this.rawFieldName)} = NULL
      FROM books b
      WHERE bm.book_id = b.id
      AND b.library_id IN ${idsLiteral}
      AND bm.${sql.raw(this.rawFieldName)} = ${value}
      RETURNING bm.book_id AS "bookId"
    `);

    return { name: value, affectedBookIds: affectedRows.rows.map((r) => r.bookId) };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  split(_input: SplitInput): Promise<StrategySplitResult> {
    throw new BadRequestException('Split is not supported for inline entity types');
  }

  async findAffectedBookIds(ids: (number | string)[]): Promise<number[]> {
    const values = ids as string[];
    if (values.length === 0) return [];

    const placeholders = values.map((v) => sql`${v}`);
    const inClause = sql.join(placeholders, sql`, `);

    const rows = await this.db.execute<{ bookId: number }>(sql`
      SELECT DISTINCT bm.book_id AS "bookId"
      FROM book_metadata bm
      WHERE bm.${sql.raw(this.rawFieldName)} IN (${inClause})
    `);

    return rows.rows.map((r) => r.bookId);
  }

  async getBookCount(id: number | string): Promise<number> {
    const value = id as string;
    const [row] = await this.db.select({ count: count() }).from(bookMetadata).where(eq(this.field, value));
    return row?.count ?? 0;
  }

  async getBookTitles(id: number | string, limit: number): Promise<string[]> {
    const value = id as string;
    const rows = await this.db
      .select({ title: sql<string>`COALESCE(${bookMetadata.title}, 'Untitled')` })
      .from(bookMetadata)
      .where(eq(this.field, value))
      .orderBy(asc(bookMetadata.title))
      .limit(limit);
    return rows.map((r) => r.title);
  }

  async findEntityById(id: number | string): Promise<{ id: string; name: string } | null> {
    const value = id as string;
    const [row] = await this.db.select({ name: this.field }).from(bookMetadata).where(eq(this.field, value)).limit(1);
    if (!row) return null;
    return { id: value, name: (row as any).name ?? value };
  }
}
