import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { aiArtifacts, type AiArtifactRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export type AiArtifactInfo = Omit<AiArtifactRow, 'payload'>;

/** Written only by a job's completion (`AiJobRepository.complete`); read and removed here. */
@Injectable()
export class AiArtifactRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Everything but the payload, which can be large. */
  async findInfo(feature: string, subjectKey: string): Promise<AiArtifactInfo | null> {
    const [row] = await this.db
      .select({
        id: aiArtifacts.id,
        feature: aiArtifacts.feature,
        subjectKey: aiArtifacts.subjectKey,
        format: aiArtifacts.format,
        pipeline: aiArtifacts.pipeline,
        generation: aiArtifacts.generation,
        sha256: aiArtifacts.sha256,
        size: aiArtifacts.size,
        coverage: aiArtifacts.coverage,
        models: aiArtifacts.models,
        costMicros: aiArtifacts.costMicros,
        jobId: aiArtifacts.jobId,
        builtAt: aiArtifacts.builtAt,
      })
      .from(aiArtifacts)
      .where(this.subject(feature, subjectKey))
      .limit(1);
    return row ?? null;
  }

  async findWithPayload(feature: string, subjectKey: string): Promise<AiArtifactRow | null> {
    const [row] = await this.db.select().from(aiArtifacts).where(this.subject(feature, subjectKey)).limit(1);
    return row ?? null;
  }

  async remove(feature: string, subjectKey: string): Promise<boolean> {
    const rows = await this.db.delete(aiArtifacts).where(this.subject(feature, subjectKey)).returning({ id: aiArtifacts.id });
    return rows.length > 0;
  }

  /**
   * Gives a subject's artifact a new key, unless the new key already has one. It keeps its
   * pipeline, so a feature whose pipeline names its text rules sees it as outdated.
   */
  async move(feature: string, fromKey: string, toKey: string): Promise<boolean> {
    if (fromKey === toKey) return false;
    const existing = alias(aiArtifacts, 'existing');
    const rows = await this.db
      .update(aiArtifacts)
      .set({ subjectKey: toKey })
      .where(
        and(
          this.subject(feature, fromKey),
          notExists(
            this.db
              .select({ id: existing.id })
              .from(existing)
              .where(and(eq(existing.feature, feature), eq(existing.subjectKey, toKey))),
          ),
        ),
      )
      .returning({ id: aiArtifacts.id });
    return rows.length > 0;
  }

  async removeAll(feature: string): Promise<number> {
    const rows = await this.db.delete(aiArtifacts).where(eq(aiArtifacts.feature, feature)).returning({ id: aiArtifacts.id });
    return rows.length;
  }

  /** How many artifacts a feature stores, and their size in bytes. */
  async summary(feature: string): Promise<{ count: number; bytes: number }> {
    const [row] = await this.db
      .select({ count: count(), bytes: sql<string>`coalesce(sum(${aiArtifacts.size}), 0)` })
      .from(aiArtifacts)
      .where(eq(aiArtifacts.feature, feature));
    return { count: row?.count ?? 0, bytes: Number(row?.bytes ?? 0) };
  }

  async countForFeature(feature: string): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(aiArtifacts).where(eq(aiArtifacts.feature, feature));
    return row?.value ?? 0;
  }

  private subject(feature: string, subjectKey: string) {
    return and(eq(aiArtifacts.feature, feature), eq(aiArtifacts.subjectKey, subjectKey));
  }
}
