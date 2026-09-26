import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import type { IndexerColor, IndexerManagerType, NetworkProfile } from '@bookorbit/types';

export const requestIndexerManagers = pgTable(
  'request_indexer_managers',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    color: varchar('color', { length: 16 }).$type<IndexerColor>(),
    type: varchar('type', { length: 30 }).$type<IndexerManagerType>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    baseUrl: text('base_url').notNull(),
    credentialsEnc: text('credentials_enc').notNull(),
    allowPrivateAddress: boolean('allow_private_address').notNull().default(false),
    syncNewIndexers: boolean('sync_new_indexers').notNull().default(true),
    perIndexerTimeoutSeconds: integer('per_indexer_timeout_seconds').notNull().default(20),
    overallSearchBudgetSeconds: integer('overall_search_budget_seconds').notNull().default(60),
    autoExpandCategories: boolean('auto_expand_categories').notNull().default(false),
    inheritSeedLimits: boolean('inherit_seed_limits').notNull().default(true),
    networkProfile: jsonb('network_profile').$type<NetworkProfile>(),
    version: varchar('version', { length: 100 }),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestOk: boolean('last_test_ok'),
    lastErrorMessage: text('last_error_message'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSyncOk: boolean('last_sync_ok'),
    lastSyncError: text('last_sync_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('request_indexer_managers_name_lower_uidx').on(sql`lower(${t.name})`),
    check('request_indexer_managers_type_chk', sql`${t.type} in ('prowlarr')`),
    check('request_indexer_managers_timeout_chk', sql`${t.perIndexerTimeoutSeconds} between 5 and 180`),
    check('request_indexer_managers_budget_chk', sql`${t.overallSearchBudgetSeconds} between 5 and 300`),
  ],
);

export type RequestIndexerManagerRow = typeof requestIndexerManagers.$inferSelect;
export type NewRequestIndexerManagerRow = typeof requestIndexerManagers.$inferInsert;
