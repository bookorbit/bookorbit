import { sql } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import type { MetadataHttpProviderInfo, MetadataHttpProviderStatus } from '@bookorbit/types';

import { users } from './auth';
import { bytea } from './columns';

/**
 * Metadata providers an admin registered by URL. Each one is somebody else's HTTP service speaking
 * the book-metadata-provider spec; BookOrbit stores only how to reach it and what it said about
 * itself. The key is pinned from the provider's own `/provider/info` on registration and never
 * changes, because stored ids, ratings and field rules are filed under it.
 */
export const metadataHttpProviders = pgTable(
  'metadata_http_providers',
  {
    id: serial('id').primaryKey(),
    key: varchar('key', { length: 32 }).notNull(),
    baseUrl: text('base_url').notNull(),
    /** AES-256-GCM blob of the whole `Authorization` header. Never returned, never logged. */
    authorizationEnc: text('authorization_enc'),
    /** Off until the admin turns it on, so a provider is never searched before it has been seen. */
    enabled: boolean('enabled').notNull().default(false),
    /**
     * A provider in a container beside BookOrbit lives on a private address by definition, so this
     * is an explicit per-row opt-in rather than a default, the same stance as indexers.
     */
    allowPrivateAddress: boolean('allow_private_address').notNull().default(false),
    timeoutMs: integer('timeout_ms').notNull().default(10_000),
    info: jsonb('info').$type<MetadataHttpProviderInfo>(),
    infoFetchedAt: timestamp('info_fetched_at', { withTimezone: true }),
    status: varchar('status', { length: 20 }).$type<MetadataHttpProviderStatus>().notNull().default('ok'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastError: text('last_error'),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('metadata_http_providers_key_uq').on(t.key),
    check('metadata_http_providers_timeout_chk', sql`${t.timeoutMs} >= 2000 and ${t.timeoutMs} <= 30000`),
    check('metadata_http_providers_status_chk', sql`${t.status} in ('ok', 'stale', 'unreachable', 'key_changed', 'incompatible')`),
    check('metadata_http_providers_failures_chk', sql`${t.consecutiveFailures} >= 0`),
  ],
);

export type MetadataHttpProviderRow = typeof metadataHttpProviders.$inferSelect;
export type NewMetadataHttpProviderRow = typeof metadataHttpProviders.$inferInsert;

/**
 * BookOrbit's own copy of each provider's icon, downloaded from its `avatarUrl`. Browsers load it
 * from BookOrbit, so they never contact the provider, which may sit on a network they cannot reach.
 * Kept apart from the provider row so listing providers never reads the image bytes.
 */
export const metadataHttpProviderIcons = pgTable('metadata_http_provider_icons', {
  providerId: integer('provider_id')
    .primaryKey()
    .references(() => metadataHttpProviders.id, { onDelete: 'cascade' }),
  /** The `avatarUrl` it came from, so a changed URL is fetched again. */
  sourceUrl: text('source_url').notNull(),
  contentType: varchar('content_type', { length: 32 }).notNull(),
  /** Short content hash, also the cache-busting version in the icon's URL. */
  hash: varchar('hash', { length: 16 }).notNull(),
  data: bytea('data').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export type MetadataHttpProviderIconRow = typeof metadataHttpProviderIcons.$inferSelect;
