import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, exists, inArray, notExists, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import { refreshPrimaryAuthorSortNamesForBooks } from '../../../db/book-author-sort-key';
import * as schema from '../../../db/schema';
import { authors, bookAuthors, books, bookMetadata } from '../../../db/schema';
import { buildContentFilterClauses } from '../../../common/utils/content-filter-sql.utils';
import { accentInsensitiveIlike } from '../../../common/utils/accent-insensitive-search.utils';
import {
  chooseCanonicalMetadataTextRow,
  normalizeMetadataText,
  normalizeMetadataTextKey,
  normalizeMetadataTextKeySql,
} from '../../../common/utils/metadata-text-normalize.utils';
import { AuthorImageStorageService } from '../../authors/author-image-storage.service';
import { AuthorsRepository } from '../../authors/authors.repository';
import { AuthorEnrichmentOrchestratorService } from '../../authors/author-enrichment-orchestrator.service';
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

const AUTHOR_ENRICHMENT_REASONS = { AUTHOR_MERGE_TARGET: 'author_merge_target' as const };
const NORMALIZED_AUTHOR_NAME_SQL = normalizeMetadataTextKeySql(authors.name);

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

@Injectable()
export class AuthorStrategy implements EntityStrategy {
  readonly entityType = 'author' as const;
  readonly isInline = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authorsRepo: AuthorsRepository,
    private readonly authorImageStorage: AuthorImageStorageService,
    private readonly enrichmentOrchestrator: AuthorEnrichmentOrchestratorService,
  ) {}

  async findCandidatePairs(libraryIds: number[], minSimilarity: number): Promise<RawCandidatePair[]> {
    const similarityThreshold = Math.max(0.1, Math.min(1, minSimilarity));

    let libraryFilter = sql``;
    if (libraryIds.length > 0) {
      const idsLiteral = sql.raw(`(${libraryIds.join(',')})`);
      libraryFilter = sql` AND EXISTS (
        SELECT 1 FROM book_authors ba JOIN books b ON ba.book_id = b.id
        WHERE ba.author_id = a1.id AND b.library_id IN ${idsLiteral}
      )
      AND EXISTS (
        SELECT 1 FROM book_authors ba JOIN books b ON ba.book_id = b.id
        WHERE ba.author_id = a2.id AND b.library_id IN ${idsLiteral}
      )`;
    }

    const rows = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('pg_trgm.similarity_threshold', ${similarityThreshold.toString()}, true)`);
      return tx.execute<{
        idA: number;
        idB: number;
        nameA: string;
        nameB: string;
        sortNameA: string | null;
        sortNameB: string | null;
        hasPhotoA: boolean;
        hasPhotoB: boolean;
        simScore: number;
      }>(sql`
        SELECT
          a1.id AS "idA", a2.id AS "idB",
          a1.name AS "nameA", a2.name AS "nameB",
          a1.sort_name AS "sortNameA", a2.sort_name AS "sortNameB",
          a1.has_photo AS "hasPhotoA", a2.has_photo AS "hasPhotoB",
          similarity(a1.name, a2.name) AS "simScore"
        FROM authors a1
        JOIN authors a2 ON a1.id < a2.id AND a1.name % a2.name
        WHERE similarity(a1.name, a2.name) >= ${similarityThreshold}
        ${libraryFilter}
        ORDER BY similarity(a1.name, a2.name) DESC
      `);
    });

    return rows.rows;
  }

  async getAllEntityIds(): Promise<number[]> {
    const rows = await this.db.execute<{ id: number }>(sql`SELECT id FROM authors ORDER BY id`);
    return rows.rows.map((r) => r.id);
  }

  async computeCandidatePairsForBatch(outerIds: number[], minSimilarity: number): Promise<RawCandidatePair[]> {
    const similarityThreshold = Math.max(0.1, Math.min(1, minSimilarity));
    const idsArray = sql.raw(`ARRAY[${outerIds.join(',')}]::int[]`);

    const rows = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('pg_trgm.similarity_threshold', ${similarityThreshold.toString()}, true)`);
      return tx.execute<{
        idA: number;
        idB: number;
        nameA: string;
        nameB: string;
        sortNameA: string | null;
        sortNameB: string | null;
        hasPhotoA: boolean;
        hasPhotoB: boolean;
        simScore: number;
      }>(sql`
        SELECT
          a1.id AS "idA", a2.id AS "idB",
          a1.name AS "nameA", a2.name AS "nameB",
          a1.sort_name AS "sortNameA", a2.sort_name AS "sortNameB",
          a1.has_photo AS "hasPhotoA", a2.has_photo AS "hasPhotoB",
          similarity(a1.name, a2.name) AS "simScore"
        FROM (SELECT id, name, sort_name, has_photo FROM authors WHERE id = ANY(${idsArray})) a1
        JOIN authors a2 ON a1.id < a2.id AND a1.name % a2.name
        WHERE similarity(a1.name, a2.name) >= ${similarityThreshold}
      `);
    });

    return rows.rows;
  }

  async browse(params: BrowseParams): Promise<BrowseResult> {
    const bookCountExpr = sql<number>`count(distinct ${bookAuthors.bookId})::int`;

    const nameCondition = params.search ? accentInsensitiveIlike(authors.name, `%${escapeLike(params.search)}%`) : undefined;

    const cfClauses = params.contentFilters ? buildContentFilterClauses(params.contentFilters, this.db) : [];
    const libraryBookIds =
      params.libraryIds.length > 0
        ? this.db
            .select({ id: books.id })
            .from(books)
            .where(and(inArray(books.libraryId, params.libraryIds), ...cfClauses))
        : null;

    const joinCondition = libraryBookIds
      ? and(eq(bookAuthors.authorId, authors.id), inArray(bookAuthors.bookId, libraryBookIds))
      : and(eq(bookAuthors.authorId, authors.id), sql`false`);

    const hasScopedBooks = libraryBookIds
      ? exists(
          this.db
            .select({ one: sql`1` })
            .from(bookAuthors)
            .where(and(eq(bookAuthors.authorId, authors.id), inArray(bookAuthors.bookId, libraryBookIds))),
        )
      : undefined;
    const isGloballyEmpty = notExists(
      this.db
        .select({ one: sql`1` })
        .from(bookAuthors)
        .where(eq(bookAuthors.authorId, authors.id)),
    );
    const visibilityCondition =
      params.bookCount === 'empty' ? isGloballyEmpty : hasScopedBooks ? or(hasScopedBooks, isGloballyEmpty) : isGloballyEmpty;

    const countQuery = this.db
      .select({ total: sql<number>`count(distinct ${authors.id})::int` })
      .from(authors)
      .where(and(nameCondition, visibilityCondition));

    const itemQuery = this.db
      .select({
        id: authors.id,
        name: authors.name,
        sortName: authors.sortName,
        hasPhoto: authors.hasPhoto,
        bookCount: bookCountExpr,
      })
      .from(authors)
      .leftJoin(bookAuthors, joinCondition)
      .where(and(nameCondition, visibilityCondition))
      .groupBy(authors.id, authors.name, authors.sortName, authors.hasPhoto)
      .$dynamic();

    itemQuery
      .orderBy(
        params.sortBy === 'bookCount'
          ? params.sortOrder === 'asc'
            ? asc(bookCountExpr)
            : desc(bookCountExpr)
          : params.sortOrder === 'asc'
            ? asc(authors.name)
            : desc(authors.name),
      )
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    const [countResult, itemRows] = await Promise.all([countQuery, itemQuery]);

    return {
      items: itemRows.map((r) => ({ id: r.id, name: r.name, bookCount: r.bookCount, sortName: r.sortName, hasPhoto: r.hasPhoto })),
      total: countResult[0]?.total ?? 0,
    };
  }

  async merge(input: MergeInput): Promise<StrategyMergeResult> {
    const targetId = input.targetId as number;
    const sourceIds = input.sourceIds as number[];
    const fieldsResolved: string[] = [];

    const targetAuthor = await this.db
      .select({ id: authors.id, sortName: authors.sortName, description: authors.description, hasPhoto: authors.hasPhoto })
      .from(authors)
      .where(eq(authors.id, targetId))
      .limit(1);

    if (!targetAuthor[0]) throw new NotFoundException('Target author not found');
    const target = targetAuthor[0];

    for (const sourceId of sourceIds) {
      const [source] = await this.db
        .select({ sortName: authors.sortName, description: authors.description })
        .from(authors)
        .where(eq(authors.id, sourceId))
        .limit(1);
      if (!source) continue;

      const updates: Partial<{ sortName: string | null; description: string | null }> = {};
      if (!target.sortName && source.sortName) {
        updates.sortName = source.sortName;
        target.sortName = source.sortName;
        fieldsResolved.push('sortName');
      }
      if (!target.description && source.description) {
        updates.description = source.description;
        target.description = source.description;
        fieldsResolved.push('description');
      }
      if (Object.keys(updates).length > 0) {
        await this.authorsRepo.updateAuthorById(targetId, updates);
      }
    }

    let imagePromoted = false;
    if (!target.hasPhoto) {
      for (const sourceId of sourceIds) {
        const promoted = await this.authorImageStorage.promoteImage(sourceId, targetId);
        if (promoted) {
          await this.db.update(authors).set({ hasPhoto: true }).where(eq(authors.id, targetId));
          imagePromoted = true;
          fieldsResolved.push('photo');
          break;
        }
      }
    }

    const affectedBookIds = await this.findAffectedBookIds(sourceIds);
    await this.authorsRepo.mergeAuthors(targetId, sourceIds);

    for (const sourceId of sourceIds) {
      await this.authorImageStorage.deleteAuthorDir(sourceId);
    }

    await this.enrichmentOrchestrator.schedule(targetId, AUTHOR_ENRICHMENT_REASONS.AUTHOR_MERGE_TARGET);

    return { affectedBookIds, imagePromoted, fieldsResolved: [...new Set(fieldsResolved)] };
  }

  async rename(input: RenameInput): Promise<StrategyRenameResult> {
    const entityId = input.entityId as number;
    const [entity] = await this.db.select({ name: authors.name }).from(authors).where(eq(authors.id, entityId)).limit(1);
    if (!entity) throw new NotFoundException('Author not found');

    const oldName = entity.name;
    const displayName = normalizeMetadataText(input.newName);
    const normalizedName = normalizeMetadataTextKey(displayName);
    if (!displayName || !normalizedName) throw new BadRequestException('Name cannot be empty');

    const existingRows = await this.db
      .select({ id: authors.id, name: authors.name })
      .from(authors)
      .where(eq(NORMALIZED_AUTHOR_NAME_SQL, normalizedName));
    const mergeTarget = this.selectPreferredAuthorMatch(existingRows, entityId, displayName);
    if (mergeTarget) {
      const mergeResult = await this.merge({ targetId: mergeTarget.id, sourceIds: [entityId], userId: input.userId });
      return { oldName, affectedBookIds: mergeResult.affectedBookIds, wasImplicitMerge: true, mergedEntityId: mergeTarget.id };
    }

    await this.authorsRepo.updateAuthorById(entityId, { name: displayName });
    const affectedBookIds = await this.findAffectedBookIds([entityId]);
    return { oldName, affectedBookIds, wasImplicitMerge: false };
  }

  async deleteEntity(input: DeleteInput): Promise<StrategyDeleteResult> {
    const entityId = input.entityId as number;
    const [entity] = await this.db.select({ name: authors.name }).from(authors).where(eq(authors.id, entityId)).limit(1);
    if (!entity) throw new NotFoundException('Author not found');

    const affectedBookIds = await this.findAffectedBookIds([entityId]);

    if (input.mode === 'soft') {
      await this.db.delete(bookAuthors).where(eq(bookAuthors.authorId, entityId));
      await refreshPrimaryAuthorSortNamesForBooks(this.db, affectedBookIds);
    } else {
      await this.authorsRepo.deleteAuthors([entityId]);
      await this.authorImageStorage.deleteAuthorDir(entityId);
    }

    return { name: entity.name, affectedBookIds };
  }

  async split(input: SplitInput): Promise<StrategySplitResult> {
    const [entity] = await this.db.select({ name: authors.name }).from(authors).where(eq(authors.id, input.entityId)).limit(1);
    if (!entity) throw new NotFoundException('Author not found');

    const affectedBookIds = await this.findAffectedBookIds([input.entityId]);
    const newEntities: { id: number; name: string }[] = [];

    await this.db.transaction(async (tx) => {
      const seenNewNames = new Set<string>();
      for (const name of input.newNames) {
        const displayName = normalizeMetadataText(name);
        const normalizedName = normalizeMetadataTextKey(displayName);
        if (!displayName || !normalizedName) continue;
        if (seenNewNames.has(normalizedName)) continue;
        seenNewNames.add(normalizedName);

        const existingRows = await tx
          .select({ id: authors.id, name: authors.name })
          .from(authors)
          .where(eq(NORMALIZED_AUTHOR_NAME_SQL, normalizedName));
        const existing = this.selectPreferredAuthorMatch(existingRows, input.entityId as number, displayName);
        if (existing) {
          newEntities.push({ id: existing.id, name: existing.name });
        } else {
          const [inserted] = await tx.insert(authors).values({ name: displayName }).returning({ id: authors.id });
          newEntities.push({ id: inserted!.id, name: displayName });
        }
      }
      if (newEntities.length === 0) throw new BadRequestException('At least one name is required');

      const bookRows = await tx
        .select({ bookId: bookAuthors.bookId, displayOrder: bookAuthors.displayOrder })
        .from(bookAuthors)
        .where(eq(bookAuthors.authorId, input.entityId));

      for (const newEntity of newEntities) {
        if (bookRows.length > 0) {
          await tx
            .insert(bookAuthors)
            .values(bookRows.map((r) => ({ bookId: r.bookId, authorId: newEntity.id, displayOrder: r.displayOrder })))
            .onConflictDoNothing();
        }
      }

      await tx.delete(bookAuthors).where(eq(bookAuthors.authorId, input.entityId));
      await tx.delete(authors).where(eq(authors.id, input.entityId));
      await refreshPrimaryAuthorSortNamesForBooks(tx, affectedBookIds);
    });

    await this.authorImageStorage.deleteAuthorDir(input.entityId);

    return { originalName: entity.name, newEntities, affectedBookIds };
  }

  private selectPreferredAuthorMatch(
    rows: { id: number; name: string }[],
    excludedAuthorId: number,
    displayName: string,
  ): { id: number; name: string } | null {
    return chooseCanonicalMetadataTextRow(rows, { desiredName: displayName, excludedId: excludedAuthorId });
  }

  async findAffectedBookIds(ids: (number | string)[]): Promise<number[]> {
    const numericIds = ids as number[];
    if (numericIds.length === 0) return [];
    const rows = await this.db.selectDistinct({ bookId: bookAuthors.bookId }).from(bookAuthors).where(inArray(bookAuthors.authorId, numericIds));
    return rows.map((r) => r.bookId);
  }

  async getBookCount(id: number | string): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(bookAuthors)
      .where(eq(bookAuthors.authorId, id as number));
    return row?.count ?? 0;
  }

  async getBookTitles(id: number | string, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ title: sql<string>`COALESCE(${bookMetadata.title}, 'Untitled')` })
      .from(bookAuthors)
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
      .where(eq(bookAuthors.authorId, id as number))
      .orderBy(asc(bookMetadata.title))
      .limit(limit);
    return rows.map((r) => r.title);
  }

  async findEntityById(id: number | string): Promise<{ id: number; name: string } | null> {
    const [row] = await this.db
      .select({ id: authors.id, name: authors.name })
      .from(authors)
      .where(eq(authors.id, id as number))
      .limit(1);
    return row ?? null;
  }
}
