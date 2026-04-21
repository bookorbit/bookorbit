import { check, foreignKey, index, integer, jsonb, pgTable, serial, text, timestamp, unique, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { users } from './auth';

export const migrationSources = pgTable(
  'migration_sources',
  {
    id: serial('id').primaryKey(),
    type: varchar('type', { length: 50 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    connectionConfig: jsonb('connection_config').notNull(),
    capabilities: jsonb('capabilities'),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('migration_sources_type_name_uidx').on(t.type, t.name),
    index('migration_sources_created_by_user_id_idx').on(t.createdByUserId),
  ],
);

export const migrationProfiles = pgTable(
  'migration_profiles',
  {
    id: serial('id').primaryKey(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => migrationSources.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    version: integer('version').notNull().default(1),
    userMappings: jsonb('user_mappings').notNull(),
    pathMappings: jsonb('path_mappings')
      .notNull()
      .default(sql`'[]'::jsonb`),
    scope: jsonb('scope')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('migration_profiles_source_name_version_uidx').on(t.sourceId, t.name, t.version),
    unique('migration_profiles_id_source_id_unique').on(t.id, t.sourceId),
    index('migration_profiles_source_id_idx').on(t.sourceId),
    check('migration_profiles_version_positive_chk', sql`${t.version} >= 1`),
  ],
);

export const migrationPlanArtifacts = pgTable(
  'migration_plan_artifacts',
  {
    id: serial('id').primaryKey(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => migrationSources.id, { onDelete: 'cascade' }),
    profileId: integer('profile_id')
      .notNull()
      .references(() => migrationProfiles.id, { onDelete: 'cascade' }),
    sourceSnapshotHash: varchar('source_snapshot_hash', { length: 128 }).notNull(),
    profileHash: varchar('profile_hash', { length: 128 }).notNull(),
    planHash: varchar('plan_hash', { length: 128 }).notNull(),
    plan: jsonb('plan').notNull(),
    sourceData: jsonb('source_data'),
    summary: jsonb('summary').notNull(),
    createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('migration_plan_artifacts_plan_hash_uidx').on(t.planHash),
    unique('migration_plan_artifacts_id_source_profile_unique').on(t.id, t.sourceId, t.profileId),
    index('migration_plan_artifacts_source_id_idx').on(t.sourceId),
    index('migration_plan_artifacts_profile_id_idx').on(t.profileId),
    foreignKey({
      columns: [t.profileId, t.sourceId],
      foreignColumns: [migrationProfiles.id, migrationProfiles.sourceId],
      name: 'migration_plan_artifacts_profile_source_fk',
    }),
  ],
);

export const migrationRuns = pgTable(
  'migration_runs',
  {
    id: serial('id').primaryKey(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => migrationSources.id, { onDelete: 'cascade' }),
    profileId: integer('profile_id')
      .notNull()
      .references(() => migrationProfiles.id, { onDelete: 'cascade' }),
    planArtifactId: integer('plan_artifact_id').references(() => migrationPlanArtifacts.id, { onDelete: 'set null' }),
    targetKey: varchar('target_key', { length: 100 }).notNull().default('bookorbit'),
    state: varchar('state', { length: 32 }).notNull().default('draft'),
    currentStage: varchar('current_stage', { length: 64 }),
    triggeredByUserId: integer('triggered_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('migration_runs_source_target_state_idx').on(t.sourceId, t.targetKey, t.state),
    index('migration_runs_state_idx').on(t.state),
    foreignKey({
      columns: [t.profileId, t.sourceId],
      foreignColumns: [migrationProfiles.id, migrationProfiles.sourceId],
      name: 'migration_runs_profile_source_fk',
    }),
    foreignKey({
      columns: [t.planArtifactId, t.sourceId, t.profileId],
      foreignColumns: [migrationPlanArtifacts.id, migrationPlanArtifacts.sourceId, migrationPlanArtifacts.profileId],
      name: 'migration_runs_plan_artifact_source_profile_fk',
    }),
    check('migration_runs_state_chk', sql`"state" IN ('draft', 'preflight_failed', 'dry_run_ready', 'running', 'failed', 'completed')`),
    check('migration_runs_started_before_ended_chk', sql`${t.endedAt} is null or ${t.startedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
  ],
);

export const migrationRunMetrics = pgTable(
  'migration_run_metrics',
  {
    id: serial('id').primaryKey(),
    runId: integer('run_id')
      .notNull()
      .references(() => migrationRuns.id, { onDelete: 'cascade' }),
    stage: varchar('stage', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    processed: integer('processed').notNull().default(0),
    imported: integer('imported').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    unresolved: integer('unresolved').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('migration_run_metrics_run_stage_entity_uidx').on(t.runId, t.stage, t.entityType),
    index('migration_run_metrics_run_id_idx').on(t.runId),
    check('migration_run_metrics_processed_nonnegative_chk', sql`${t.processed} >= 0`),
    check('migration_run_metrics_imported_nonnegative_chk', sql`${t.imported} >= 0`),
    check('migration_run_metrics_skipped_nonnegative_chk', sql`${t.skipped} >= 0`),
    check('migration_run_metrics_unresolved_nonnegative_chk', sql`${t.unresolved} >= 0`),
    check('migration_run_metrics_failed_nonnegative_chk', sql`${t.failed} >= 0`),
  ],
);

export type MigrationSource = typeof migrationSources.$inferSelect;
export type NewMigrationSource = typeof migrationSources.$inferInsert;

export type MigrationProfile = typeof migrationProfiles.$inferSelect;
export type NewMigrationProfile = typeof migrationProfiles.$inferInsert;

export type MigrationPlanArtifact = typeof migrationPlanArtifacts.$inferSelect;
export type NewMigrationPlanArtifact = typeof migrationPlanArtifacts.$inferInsert;

export type MigrationRun = typeof migrationRuns.$inferSelect;
export type NewMigrationRun = typeof migrationRuns.$inferInsert;
