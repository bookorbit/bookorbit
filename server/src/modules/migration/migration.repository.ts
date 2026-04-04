import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type MigrationRunState = 'draft' | 'preflight_failed' | 'dry_run_ready' | 'running' | 'failed' | 'completed';
const ACTIVE_RUN_STATES: MigrationRunState[] = ['running'];

@Injectable()
export class MigrationRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  listSources() {
    return this.db.select().from(schema.migrationSources).orderBy(desc(schema.migrationSources.id));
  }

  async createSource(values: Pick<schema.NewMigrationSource, 'type' | 'name' | 'connectionConfig' | 'capabilities' | 'createdByUserId'>) {
    const [row] = await this.db.insert(schema.migrationSources).values(values).returning();
    return row;
  }

  async updateSource(id: number, values: Pick<schema.NewMigrationSource, 'type' | 'name' | 'connectionConfig' | 'capabilities' | 'createdByUserId'>) {
    const [row] = await this.db
      .update(schema.migrationSources)
      .set({
        type: values.type,
        name: values.name,
        connectionConfig: values.connectionConfig,
        capabilities: values.capabilities,
        createdByUserId: values.createdByUserId,
      })
      .where(eq(schema.migrationSources.id, id))
      .returning();
    return row ?? null;
  }

  async updateSourceValidation(id: number, patch: Pick<schema.NewMigrationSource, 'capabilities' | 'lastValidatedAt'>) {
    const [row] = await this.db
      .update(schema.migrationSources)
      .set({ capabilities: patch.capabilities, lastValidatedAt: patch.lastValidatedAt })
      .where(eq(schema.migrationSources.id, id))
      .returning();
    return row ?? null;
  }

  findSourceById(id: number) {
    return this.db.query.migrationSources.findFirst({ where: eq(schema.migrationSources.id, id) });
  }

  listTargetUsersForMapping() {
    return this.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(eq(schema.users.active, true))
      .orderBy(asc(schema.users.username));
  }

  async findExistingBookFilePaths(paths: string[]): Promise<Set<string>> {
    const uniquePaths = [...new Set(paths.filter((value) => value.trim().length > 0))];
    if (uniquePaths.length === 0) return new Set();

    const out = new Set<string>();
    const chunkSize = 500;

    for (let index = 0; index < uniquePaths.length; index += chunkSize) {
      const chunk = uniquePaths.slice(index, index + chunkSize);
      const rows = await this.db
        .select({ absolutePath: schema.bookFiles.absolutePath })
        .from(schema.bookFiles)
        .where(inArray(schema.bookFiles.absolutePath, chunk));
      for (const row of rows) out.add(row.absolutePath);
    }

    return out;
  }

  listProfiles(sourceId?: number) {
    if (sourceId === undefined) {
      return this.db.select().from(schema.migrationProfiles).orderBy(desc(schema.migrationProfiles.id));
    }
    return this.db
      .select()
      .from(schema.migrationProfiles)
      .where(eq(schema.migrationProfiles.sourceId, sourceId))
      .orderBy(desc(schema.migrationProfiles.id));
  }

  async createProfile(
    values: Pick<schema.NewMigrationProfile, 'sourceId' | 'name' | 'version' | 'userMappings' | 'pathMappings' | 'scope' | 'createdByUserId'>,
  ) {
    const [row] = await this.db.insert(schema.migrationProfiles).values(values).returning();
    return row;
  }

  findProfileById(id: number) {
    return this.db.query.migrationProfiles.findFirst({ where: eq(schema.migrationProfiles.id, id) });
  }

  async createPlanArtifact(
    values: Pick<
      schema.NewMigrationPlanArtifact,
      'sourceId' | 'profileId' | 'sourceSnapshotHash' | 'profileHash' | 'planHash' | 'plan' | 'summary' | 'createdByUserId'
    >,
  ) {
    const [row] = await this.db.insert(schema.migrationPlanArtifacts).values(values).returning();
    return row;
  }

  listPlanArtifacts(sourceId?: number) {
    if (sourceId === undefined) {
      return this.db.select().from(schema.migrationPlanArtifacts).orderBy(desc(schema.migrationPlanArtifacts.id));
    }
    return this.db
      .select()
      .from(schema.migrationPlanArtifacts)
      .where(eq(schema.migrationPlanArtifacts.sourceId, sourceId))
      .orderBy(desc(schema.migrationPlanArtifacts.id));
  }

  findPlanArtifactById(id: number) {
    return this.db.query.migrationPlanArtifacts.findFirst({ where: eq(schema.migrationPlanArtifacts.id, id) });
  }

  async purgeRunState(sourceId: number): Promise<void> {
    await this.db.delete(schema.migrationRuns).where(eq(schema.migrationRuns.sourceId, sourceId));
    await this.db.delete(schema.migrationPlanArtifacts).where(eq(schema.migrationPlanArtifacts.sourceId, sourceId));
  }

  async findBookTitlesByIds(ids: number[]): Promise<Map<number, string | null>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ bookId: schema.bookMetadata.bookId, title: schema.bookMetadata.title })
      .from(schema.bookMetadata)
      .where(inArray(schema.bookMetadata.bookId, ids));
    return new Map(rows.map((row) => [row.bookId, row.title ?? null]));
  }

  async createRunWithLock(
    values: Pick<
      schema.NewMigrationRun,
      'sourceId' | 'profileId' | 'planArtifactId' | 'targetKey' | 'state' | 'currentStage' | 'triggeredByUserId' | 'startedAt'
    >,
  ): Promise<{ run: typeof schema.migrationRuns.$inferSelect | null; activeRun: typeof schema.migrationRuns.$inferSelect | null }> {
    const targetKey = values.targetKey ?? 'projectx';
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${buildRunLockKey(values.sourceId, targetKey)}))`);

      const [activeRun] = await tx
        .select()
        .from(schema.migrationRuns)
        .where(
          and(
            eq(schema.migrationRuns.sourceId, values.sourceId),
            eq(schema.migrationRuns.targetKey, targetKey),
            inArray(schema.migrationRuns.state, ACTIVE_RUN_STATES),
          ),
        )
        .orderBy(desc(schema.migrationRuns.id))
        .limit(1);

      if (activeRun) return { run: null, activeRun };

      await tx.delete(schema.migrationRuns).where(eq(schema.migrationRuns.sourceId, values.sourceId));

      const [run] = await tx
        .insert(schema.migrationRuns)
        .values({ ...values, targetKey })
        .returning();
      return { run, activeRun: null };
    });
  }

  listRuns(sourceId?: number) {
    if (sourceId === undefined) {
      return this.db.select().from(schema.migrationRuns).orderBy(desc(schema.migrationRuns.id));
    }
    return this.db.select().from(schema.migrationRuns).where(eq(schema.migrationRuns.sourceId, sourceId)).orderBy(desc(schema.migrationRuns.id));
  }

  findRunById(id: number) {
    return this.db.query.migrationRuns.findFirst({ where: eq(schema.migrationRuns.id, id) });
  }

  async updateRunState(
    runId: number,
    state: MigrationRunState,
    patch: Partial<Pick<schema.NewMigrationRun, 'currentStage' | 'startedAt' | 'endedAt' | 'errorMessage'>>,
  ) {
    const [row] = await this.db
      .update(schema.migrationRuns)
      .set({ ...patch, state })
      .where(eq(schema.migrationRuns.id, runId))
      .returning();
    return row ?? null;
  }

  async incrementRunMetric(
    runId: number,
    stage: string,
    entityType: string,
    delta: Partial<Pick<typeof schema.migrationRunMetrics.$inferInsert, 'processed' | 'imported' | 'skipped' | 'unresolved' | 'failed'>>,
  ) {
    const [existing] = await this.db
      .select()
      .from(schema.migrationRunMetrics)
      .where(
        and(
          eq(schema.migrationRunMetrics.runId, runId),
          eq(schema.migrationRunMetrics.stage, stage),
          eq(schema.migrationRunMetrics.entityType, entityType),
        ),
      )
      .limit(1);

    if (!existing) {
      const [inserted] = await this.db
        .insert(schema.migrationRunMetrics)
        .values({
          runId,
          stage,
          entityType,
          processed: delta.processed ?? 0,
          imported: delta.imported ?? 0,
          skipped: delta.skipped ?? 0,
          unresolved: delta.unresolved ?? 0,
          failed: delta.failed ?? 0,
        })
        .returning();
      return inserted;
    }

    const [updated] = await this.db
      .update(schema.migrationRunMetrics)
      .set({
        processed: existing.processed + (delta.processed ?? 0),
        imported: existing.imported + (delta.imported ?? 0),
        skipped: existing.skipped + (delta.skipped ?? 0),
        unresolved: existing.unresolved + (delta.unresolved ?? 0),
        failed: existing.failed + (delta.failed ?? 0),
        updatedAt: sql`now()`,
      })
      .where(eq(schema.migrationRunMetrics.id, existing.id))
      .returning();
    return updated;
  }

  listRunMetrics(runId: number) {
    return this.db
      .select()
      .from(schema.migrationRunMetrics)
      .where(eq(schema.migrationRunMetrics.runId, runId))
      .orderBy(asc(schema.migrationRunMetrics.stage), asc(schema.migrationRunMetrics.entityType));
  }
}

function buildRunLockKey(sourceId: number, targetKey: string): string {
  return `migration-run-lock:${sourceId}:${targetKey}`;
}
