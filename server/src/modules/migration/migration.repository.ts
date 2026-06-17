import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
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

  async deleteSource(id: number) {
    const [row] = await this.db.delete(schema.migrationSources).where(eq(schema.migrationSources.id, id)).returning();
    return row ?? null;
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

  async createProfile(values: Pick<schema.NewMigrationProfile, 'sourceId' | 'name' | 'userMappings' | 'pathMappings' | 'scope' | 'createdByUserId'>) {
    return this.db.transaction(async (tx) => {
      const [versionRow] = await tx.select({ maxVersion: sql<number>`COALESCE(MAX(version), 0)` }).from(
        tx
          .select({ version: schema.migrationProfiles.version })
          .from(schema.migrationProfiles)
          .where(and(eq(schema.migrationProfiles.sourceId, values.sourceId), eq(schema.migrationProfiles.name, values.name)))
          .for('update')
          .as('locked'),
      );

      const nextVersion = (versionRow?.maxVersion ?? 0) + 1;
      const [row] = await tx
        .insert(schema.migrationProfiles)
        .values({ ...values, version: nextVersion })
        .returning();
      return row;
    });
  }

  findProfileById(id: number) {
    return this.db.query.migrationProfiles.findFirst({ where: eq(schema.migrationProfiles.id, id) });
  }

  async updateProfileScope(id: number, scope: unknown) {
    const [row] = await this.db.update(schema.migrationProfiles).set({ scope }).where(eq(schema.migrationProfiles.id, id)).returning();
    return row ?? null;
  }

  async createPlanArtifact(
    values: Pick<
      schema.NewMigrationPlanArtifact,
      'sourceId' | 'profileId' | 'sourceSnapshotHash' | 'profileHash' | 'planHash' | 'plan' | 'sourceData' | 'summary' | 'createdByUserId'
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

  async updatePlanArtifact(id: number, values: { plan: unknown; sourceData?: unknown; summary: unknown }) {
    const [row] = await this.db
      .update(schema.migrationPlanArtifacts)
      .set({ plan: values.plan, sourceData: values.sourceData, summary: values.summary })
      .where(eq(schema.migrationPlanArtifacts.id, id))
      .returning();
    return row;
  }

  async purgeRunState(sourceId: number): Promise<void> {
    await this.db
      .delete(schema.migrationRuns)
      .where(and(eq(schema.migrationRuns.sourceId, sourceId), sql`${schema.migrationRuns.state} != 'completed'`));

    const completedRuns = await this.db
      .select({ planArtifactId: schema.migrationRuns.planArtifactId })
      .from(schema.migrationRuns)
      .where(and(eq(schema.migrationRuns.sourceId, sourceId), eq(schema.migrationRuns.state, 'completed')));
    const retainedArtifactIds = completedRuns.map((row) => row.planArtifactId).filter((id): id is number => id != null);

    if (retainedArtifactIds.length === 0) {
      await this.db.delete(schema.migrationPlanArtifacts).where(eq(schema.migrationPlanArtifacts.sourceId, sourceId));
      return;
    }

    await this.db
      .delete(schema.migrationPlanArtifacts)
      .where(and(eq(schema.migrationPlanArtifacts.sourceId, sourceId), notInArray(schema.migrationPlanArtifacts.id, retainedArtifactIds)));
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
    const targetKey = values.targetKey ?? 'bookorbit';
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${buildRunLockKey()}))`);

      const [activeRun] = await tx
        .select()
        .from(schema.migrationRuns)
        .where(inArray(schema.migrationRuns.state, ACTIVE_RUN_STATES))
        .orderBy(desc(schema.migrationRuns.id))
        .limit(1);

      if (activeRun) return { run: null, activeRun };

      await tx
        .delete(schema.migrationRuns)
        .where(and(eq(schema.migrationRuns.sourceId, values.sourceId), sql`${schema.migrationRuns.state} != 'completed'`));

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

  async setRunMetric(
    runId: number,
    stage: string,
    entityType: string,
    values: Partial<Pick<typeof schema.migrationRunMetrics.$inferInsert, 'processed' | 'imported' | 'skipped' | 'unresolved' | 'failed'>>,
  ) {
    const [row] = await this.db
      .insert(schema.migrationRunMetrics)
      .values({
        runId,
        stage,
        entityType,
        processed: values.processed ?? 0,
        imported: values.imported ?? 0,
        skipped: values.skipped ?? 0,
        unresolved: values.unresolved ?? 0,
        failed: values.failed ?? 0,
      })
      .onConflictDoUpdate({
        target: [schema.migrationRunMetrics.runId, schema.migrationRunMetrics.stage, schema.migrationRunMetrics.entityType],
        set: {
          processed: sql`excluded.processed`,
          imported: sql`excluded.imported`,
          skipped: sql`excluded.skipped`,
          unresolved: sql`excluded.unresolved`,
          failed: sql`excluded.failed`,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return row;
  }

  async clearStageMetrics(runId: number, stage: string): Promise<void> {
    await this.db
      .delete(schema.migrationRunMetrics)
      .where(and(eq(schema.migrationRunMetrics.runId, runId), eq(schema.migrationRunMetrics.stage, stage)));
  }

  async hasStageMetrics(runId: number, stage: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.migrationRunMetrics.id })
      .from(schema.migrationRunMetrics)
      .where(and(eq(schema.migrationRunMetrics.runId, runId), eq(schema.migrationRunMetrics.stage, stage)))
      .limit(1);
    return rows.length > 0;
  }

  listRunMetrics(runId: number) {
    return this.db
      .select()
      .from(schema.migrationRunMetrics)
      .where(eq(schema.migrationRunMetrics.runId, runId))
      .orderBy(asc(schema.migrationRunMetrics.stage), asc(schema.migrationRunMetrics.entityType));
  }
}

function buildRunLockKey(): string {
  return 'migration-run-lock:global';
}
