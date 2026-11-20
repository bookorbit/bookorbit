import { Inject, Injectable } from '@nestjs/common';
import type { AiEffort } from '@bookorbit/types';
import { and, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { aiStepTimings, type AiStepTimingRow, type NewAiStepTimingRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

/** Runs kept per step, connection, model and effort: an estimate reads the median of these. */
export const AI_STEP_TIMINGS_KEPT = 5;

export interface AiStepTimingKey {
  feature: string;
  connectionId: number;
  model: string;
  /** One effort's runs, null for runs without one; left out, every effort's. */
  effort?: AiEffort | null;
}

function sameEffort(effort: AiEffort | null | undefined): SQL {
  return effort ? eq(aiStepTimings.effort, effort) : isNull(aiStepTimings.effort);
}

@Injectable()
export class AiStepTimingRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Saves a completed job's timings, then drops all but the newest few runs of each step it timed. */
  async record(rows: readonly NewAiStepTimingRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.transaction(async (tx) => {
      await tx.insert(aiStepTimings).values([...rows]);
      for (const row of rows) {
        const older = tx
          .select({ id: aiStepTimings.id })
          .from(aiStepTimings)
          .where(
            and(
              eq(aiStepTimings.feature, row.feature),
              eq(aiStepTimings.connectionId, row.connectionId),
              eq(aiStepTimings.model, row.model),
              sameEffort(row.effort),
              eq(aiStepTimings.step, row.step),
            ),
          )
          .orderBy(desc(aiStepTimings.createdAt), desc(aiStepTimings.id))
          .offset(AI_STEP_TIMINGS_KEPT);
        await tx.delete(aiStepTimings).where(inArray(aiStepTimings.id, older));
      }
    });
  }

  /** Every kept run of a feature, newest first: a handful per step, connection, model and effort. */
  forFeature(feature: string): Promise<AiStepTimingRow[]> {
    return this.db
      .select()
      .from(aiStepTimings)
      .where(eq(aiStepTimings.feature, feature))
      .orderBy(desc(aiStepTimings.createdAt), desc(aiStepTimings.id));
  }

  /** Forgets what one model on one connection managed for a feature, at one effort or at all of them. */
  async remove(key: AiStepTimingKey): Promise<number> {
    const rows = await this.db
      .delete(aiStepTimings)
      .where(
        and(
          eq(aiStepTimings.feature, key.feature),
          eq(aiStepTimings.connectionId, key.connectionId),
          eq(aiStepTimings.model, key.model),
          key.effort === undefined ? undefined : sameEffort(key.effort),
        ),
      )
      .returning({ id: aiStepTimings.id });
    return rows.length;
  }
}
