import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AiJobSkipReason } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { aiArtifacts, aiJobs, aiJobSteps } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export type CachedUnit = { outcome: 'ok'; result: unknown } | { outcome: 'skipped'; reason: AiJobSkipReason };

export interface CacheScope {
  feature: string;
  subjectKey: string;
  step: string;
}

export interface SavedUnit {
  unit: string;
  fingerprint: string;
  generation: number;
  value: CachedUnit;
  model: string | null;
  tokens: number;
  costMicros: number | null;
  jobId: string;
}

/** Fingerprints are looked up in batches this size. */
const LOOKUP_BATCH = 500;

/** The step cache: one row per unit and fingerprint. */
@Injectable()
export class AiJobStepRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The cached units among these, by unit id. Hits are stamped as used by the job. */
  async lookup(scope: CacheScope, units: readonly { unit: string; fingerprint: string }[], jobId: string): Promise<Map<string, CachedUnit>> {
    const found = new Map<string, CachedUnit>();
    for (let start = 0; start < units.length; start += LOOKUP_BATCH) {
      const batch = units.slice(start, start + LOOKUP_BATCH);
      const wanted = new Map(batch.map((entry) => [entry.unit, entry.fingerprint]));
      const rows = await this.db
        .select({
          id: aiJobSteps.id,
          unit: aiJobSteps.unit,
          fingerprint: aiJobSteps.fingerprint,
          outcome: aiJobSteps.outcome,
          skipReason: aiJobSteps.skipReason,
          result: aiJobSteps.result,
        })
        .from(aiJobSteps)
        .where(
          and(
            eq(aiJobSteps.feature, scope.feature),
            eq(aiJobSteps.subjectKey, scope.subjectKey),
            eq(aiJobSteps.step, scope.step),
            inArray(
              aiJobSteps.fingerprint,
              batch.map((entry) => entry.fingerprint),
            ),
          ),
        );
      const hitIds: number[] = [];
      for (const row of rows) {
        if (wanted.get(row.unit) !== row.fingerprint) continue;
        hitIds.push(row.id);
        found.set(
          row.unit,
          row.outcome === 'skipped'
            ? { outcome: 'skipped', reason: (row.skipReason ?? 'refused') as AiJobSkipReason }
            : { outcome: 'ok', result: row.result },
        );
      }
      if (hitIds.length > 0) {
        await this.db.update(aiJobSteps).set({ usedAt: new Date(), jobId }).where(inArray(aiJobSteps.id, hitIds));
      }
    }
    return found;
  }

  /** Two writers of one fingerprint read the same inputs, so whichever result landed first is kept. */
  async save(scope: CacheScope, saved: SavedUnit): Promise<void> {
    await this.db
      .insert(aiJobSteps)
      .values({
        ...scope,
        unit: saved.unit,
        fingerprint: saved.fingerprint,
        generation: saved.generation,
        outcome: saved.value.outcome,
        skipReason: saved.value.outcome === 'skipped' ? saved.value.reason : null,
        result: saved.value.outcome === 'ok' ? (saved.value.result ?? null) : null,
        model: saved.model,
        tokens: saved.tokens,
        costMicros: saved.costMicros,
        jobId: saved.jobId,
      })
      .onConflictDoUpdate({
        target: [aiJobSteps.feature, aiJobSteps.subjectKey, aiJobSteps.step, aiJobSteps.unit, aiJobSteps.fingerprint],
        set: { usedAt: new Date(), jobId: saved.jobId },
      });
  }

  /**
   * Removes units unused since `before` that neither the subject's current artifact (same
   * generation) nor an unfinished job of the subject can still use.
   */
  async removeUnused(before: Date, limit = 5000): Promise<number> {
    const result = await this.db.execute(sql`
      delete from ${aiJobSteps}
      where id in (
        select s.id from ${aiJobSteps} s
        where s.used_at < ${before}
          and not exists (
            select 1 from ${aiArtifacts} a
            where a.feature = s.feature and a.subject_key = s.subject_key and a.generation = s.generation
          )
          and not exists (
            select 1 from ${aiJobs} j
            where j.feature = s.feature and j.subject_key = s.subject_key and j.status in ('queued', 'running', 'paused')
          )
        limit ${limit}
      )
    `);
    return result.rowCount ?? 0;
  }

  /** Every cached unit of a subject, for a delete that asks for it. */
  async removeSubject(feature: string, subjectKey: string): Promise<void> {
    await this.db.delete(aiJobSteps).where(and(eq(aiJobSteps.feature, feature), eq(aiJobSteps.subjectKey, subjectKey)));
  }
}
