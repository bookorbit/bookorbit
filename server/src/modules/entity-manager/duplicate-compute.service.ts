import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { EntityType, FirstClassEntityType } from '@bookorbit/types';
import { INLINE_ENTITY_TYPES } from '@bookorbit/types';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { books, entityDuplicateCandidates, entityDuplicateScanStatus } from '../../db/schema';
import type { EntityBookScope, EntityStrategy } from './strategies/entity-strategy.interface';

type Db = NodePgDatabase<typeof schema>;

const BATCH_SIZE = 1000;

const ENTITY_BOOK_RELATIONS: Record<FirstClassEntityType, { table: string; entityIdColumn: string }> = {
  author: { table: 'book_authors', entityIdColumn: 'author_id' },
  genre: { table: 'book_genres', entityIdColumn: 'genre_id' },
  tag: { table: 'book_tags', entityIdColumn: 'tag_id' },
  narrator: { table: 'book_narrators', entityIdColumn: 'narrator_id' },
  series: { table: 'book_series_memberships', entityIdColumn: 'series_id' },
};

@Injectable()
export class DuplicateComputeService {
  private readonly logger = new Logger(DuplicateComputeService.name);
  private readonly runningJobs = new Set<EntityType>();

  constructor(@Inject(DB) private readonly db: Db) {}

  private isInline(entityType: EntityType): boolean {
    return INLINE_ENTITY_TYPES.includes(entityType as any);
  }

  async getStatus(entityType: EntityType): Promise<typeof entityDuplicateScanStatus.$inferSelect | null> {
    const rows = await this.db.select().from(entityDuplicateScanStatus).where(eq(entityDuplicateScanStatus.entityType, entityType));
    return rows[0] ?? null;
  }

  triggerCompute(entityType: EntityType, strategy: EntityStrategy, threshold: number): void {
    if (this.isInline(entityType)) return;
    if (this.runningJobs.has(entityType)) return;

    this.runningJobs.add(entityType);
    void this.runComputeJob(entityType, strategy, threshold).finally(() => {
      this.runningJobs.delete(entityType);
    });
  }

  async invalidateCandidatesForEntities(entityType: EntityType, entityIds: number[]): Promise<void> {
    if (entityIds.length === 0) return;
    const idsArray = sql.raw(`ARRAY[${entityIds.join(',')}]::int[]`);
    await this.db.execute(sql`
      DELETE FROM ${entityDuplicateCandidates}
      WHERE ${entityDuplicateCandidates.entityType} = ${entityType}
        AND (
          ${entityDuplicateCandidates.entityIdA} = ANY(${idsArray})
          OR ${entityDuplicateCandidates.entityIdB} = ANY(${idsArray})
        )
    `);
  }

  async readCandidatePairs(
    entityType: EntityType,
    minSimilarity: number,
    scope: EntityBookScope,
  ): Promise<
    {
      idA: number;
      idB: number;
      simScore: number;
    }[]
  > {
    if (scope.libraryIds.length === 0 || this.isInline(entityType)) return [];

    const relation = ENTITY_BOOK_RELATIONS[entityType as FirstClassEntityType];
    const relationTable = sql.raw(relation.table);
    const relationEntityId = sql.raw(`scoped_relation.${relation.entityIdColumn}`);
    const relationBookId = sql.raw('scoped_relation.book_id');
    const scopeClauses = [
      sql`${books.libraryId} IN (${sql.join(
        scope.libraryIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    ];
    if (scope.contentFilters) {
      scopeClauses.push(...buildContentFilterClauses(scope.contentFilters, this.db));
    }
    const bookScope = sql.join(scopeClauses, sql` AND `);

    const rows = await this.db.execute<{ idA: number; idB: number; simScore: number }>(sql`
      SELECT
        c.entity_id_a AS "idA",
        c.entity_id_b AS "idB",
        c.sim_score AS "simScore"
      FROM entity_duplicate_candidates c
      WHERE c.entity_type = ${entityType}
        AND c.sim_score >= ${minSimilarity}
        AND EXISTS (
          SELECT 1
          FROM ${relationTable} scoped_relation
          JOIN ${books} ON ${relationBookId} = ${books.id}
          WHERE ${relationEntityId} = c.entity_id_a
            AND ${bookScope}
        )
        AND EXISTS (
          SELECT 1
          FROM ${relationTable} scoped_relation
          JOIN ${books} ON ${relationBookId} = ${books.id}
          WHERE ${relationEntityId} = c.entity_id_b
            AND ${bookScope}
        )
        AND NOT EXISTS (
          SELECT 1 FROM dismissed_duplicate_pairs d
          WHERE d.entity_type = ${entityType}
            AND d.entity_id_a = c.entity_id_a
            AND d.entity_id_b = c.entity_id_b
        )
      ORDER BY c.sim_score DESC
    `);
    return rows.rows;
  }

  private async runComputeJob(entityType: EntityType, strategy: EntityStrategy, threshold: number): Promise<void> {
    const event = 'duplicate_compute';
    const startedAt = Date.now();

    try {
      this.logger.log(`[${event}] [start] entityType=${entityType} threshold=${threshold} - compute started`);

      if (!strategy.getAllEntityIds || !strategy.computeCandidatePairsForBatch) {
        this.logger.warn(`[${event}] [fail] entityType=${entityType} - strategy does not support batch computation`);
        return;
      }

      await this.db
        .insert(entityDuplicateScanStatus)
        .values({ entityType, isComputing: true, threshold, processedCount: 0, errorMessage: null })
        .onConflictDoUpdate({
          target: entityDuplicateScanStatus.entityType,
          set: { isComputing: true, threshold, processedCount: 0, totalCount: null, errorMessage: null },
        });

      await this.db.execute(sql`
        DELETE FROM ${entityDuplicateCandidates}
        WHERE ${entityDuplicateCandidates.entityType} = ${entityType}
      `);

      const allIds = await strategy.getAllEntityIds();
      const totalCount = allIds.length;

      await this.db.update(entityDuplicateScanStatus).set({ totalCount }).where(eq(entityDuplicateScanStatus.entityType, entityType));

      let totalPairs = 0;
      for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
        const batch = allIds.slice(i, i + BATCH_SIZE);
        const pairs = await strategy.computeCandidatePairsForBatch(batch, threshold);

        if (pairs.length > 0) {
          const values = pairs.map((p) => {
            const [canonA, canonB] = Number(p.idA) < Number(p.idB) ? [p.idA, p.idB] : [p.idB, p.idA];
            return { entityType, entityIdA: Number(canonA), entityIdB: Number(canonB), simScore: p.simScore };
          });

          await this.db.insert(entityDuplicateCandidates).values(values).onConflictDoNothing();
          totalPairs += values.length;
        }

        await this.db
          .update(entityDuplicateScanStatus)
          .set({ processedCount: i + batch.length })
          .where(eq(entityDuplicateScanStatus.entityType, entityType));
      }

      await this.db
        .update(entityDuplicateScanStatus)
        .set({ isComputing: false, computedAt: new Date(), totalPairs, processedCount: totalCount })
        .where(eq(entityDuplicateScanStatus.entityType, entityType));

      this.logger.log(`[${event}] [end] entityType=${entityType} durationMs=${Date.now() - startedAt} totalPairs=${totalPairs} - compute completed`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[${event}] [fail] entityType=${entityType} durationMs=${Date.now() - startedAt} error="${msg}" - compute failed`);

      await this.db
        .update(entityDuplicateScanStatus)
        .set({ isComputing: false, errorMessage: msg })
        .where(eq(entityDuplicateScanStatus.entityType, entityType))
        .catch(() => {});
    }
  }
}
