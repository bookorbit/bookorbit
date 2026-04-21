import { Inject, Injectable } from '@nestjs/common';
import { and, eq, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { EntityType } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { dismissedDuplicatePairs, dismissedInlineDuplicatePairs } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class EntityManagerRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async insertDismissedPair(entityType: EntityType, idA: number, idB: number, reason: string | undefined, dismissedBy: number): Promise<void> {
    const [canonA, canonB] = idA < idB ? [idA, idB] : [idB, idA];
    await this.db
      .insert(dismissedDuplicatePairs)
      .values({ entityType, entityIdA: canonA, entityIdB: canonB, reason: reason ?? null, dismissedBy })
      .onConflictDoNothing();
  }

  async deleteDismissedPair(entityType: EntityType, idA: number, idB: number): Promise<void> {
    const [canonA, canonB] = idA < idB ? [idA, idB] : [idB, idA];
    await this.db
      .delete(dismissedDuplicatePairs)
      .where(
        and(
          eq(dismissedDuplicatePairs.entityType, entityType),
          eq(dismissedDuplicatePairs.entityIdA, canonA),
          eq(dismissedDuplicatePairs.entityIdB, canonB),
        ),
      );
  }

  async deleteDismissedPairsForEntity(entityType: EntityType, entityId: number): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM ${dismissedDuplicatePairs}
      WHERE ${dismissedDuplicatePairs.entityType} = ${entityType}
      AND (${dismissedDuplicatePairs.entityIdA} = ${entityId} OR ${dismissedDuplicatePairs.entityIdB} = ${entityId})
    `);
  }

  async findDismissedPairs(
    entityType: EntityType,
  ): Promise<{ id: number; entityIdA: number; entityIdB: number; reason: string | null; dismissedAt: Date }[]> {
    return this.db
      .select({
        id: dismissedDuplicatePairs.id,
        entityIdA: dismissedDuplicatePairs.entityIdA,
        entityIdB: dismissedDuplicatePairs.entityIdB,
        reason: dismissedDuplicatePairs.reason,
        dismissedAt: dismissedDuplicatePairs.dismissedAt,
      })
      .from(dismissedDuplicatePairs)
      .where(eq(dismissedDuplicatePairs.entityType, entityType));
  }

  async getDismissedPairSet(entityType: EntityType): Promise<Set<string>> {
    const pairs = await this.findDismissedPairs(entityType);
    const set = new Set<string>();
    for (const pair of pairs) {
      set.add(`${pair.entityIdA}:${pair.entityIdB}`);
      set.add(`${pair.entityIdB}:${pair.entityIdA}`);
    }
    return set;
  }

  // Inline dismissals

  async insertInlineDismissedPair(
    entityType: EntityType,
    valueA: string,
    valueB: string,
    reason: string | undefined,
    dismissedBy: number,
  ): Promise<void> {
    const [canonA, canonB] = valueA < valueB ? [valueA, valueB] : [valueB, valueA];
    await this.db
      .insert(dismissedInlineDuplicatePairs)
      .values({ entityType, valueA: canonA, valueB: canonB, reason: reason ?? null, dismissedBy })
      .onConflictDoNothing();
  }

  async deleteInlineDismissedPair(entityType: EntityType, valueA: string, valueB: string): Promise<void> {
    const [canonA, canonB] = valueA < valueB ? [valueA, valueB] : [valueB, valueA];
    await this.db
      .delete(dismissedInlineDuplicatePairs)
      .where(
        and(
          eq(dismissedInlineDuplicatePairs.entityType, entityType),
          eq(dismissedInlineDuplicatePairs.valueA, canonA),
          eq(dismissedInlineDuplicatePairs.valueB, canonB),
        ),
      );
  }

  async deleteInlineDismissedPairsForValue(entityType: EntityType, value: string): Promise<void> {
    await this.db
      .delete(dismissedInlineDuplicatePairs)
      .where(
        and(
          eq(dismissedInlineDuplicatePairs.entityType, entityType),
          or(eq(dismissedInlineDuplicatePairs.valueA, value), eq(dismissedInlineDuplicatePairs.valueB, value)),
        ),
      );
  }

  async findInlineDismissedPairs(
    entityType: EntityType,
  ): Promise<{ id: number; valueA: string; valueB: string; reason: string | null; dismissedAt: Date }[]> {
    return this.db
      .select({
        id: dismissedInlineDuplicatePairs.id,
        valueA: dismissedInlineDuplicatePairs.valueA,
        valueB: dismissedInlineDuplicatePairs.valueB,
        reason: dismissedInlineDuplicatePairs.reason,
        dismissedAt: dismissedInlineDuplicatePairs.dismissedAt,
      })
      .from(dismissedInlineDuplicatePairs)
      .where(eq(dismissedInlineDuplicatePairs.entityType, entityType));
  }

  async getInlineDismissedPairSet(entityType: EntityType): Promise<Set<string>> {
    const pairs = await this.findInlineDismissedPairs(entityType);
    const set = new Set<string>();
    for (const pair of pairs) {
      set.add(`${pair.valueA}:${pair.valueB}`);
      set.add(`${pair.valueB}:${pair.valueA}`);
    }
    return set;
  }
}
