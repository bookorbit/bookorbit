import { sql } from 'drizzle-orm';
import { boolean, char, check, index, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Answers from external metadata providers, shared by every user. Holds public catalog data only:
 * no user ids and no raw search terms, which exist here only inside the key hash.
 *
 * `payload` is a JSON string rather than jsonb: scraped text can carry NUL characters and unpaired
 * surrogates that jsonb rejects, and nothing ever queries inside the payload.
 */
export const providerMetadataCache = pgTable(
  'provider_metadata_cache',
  {
    id: serial('id').primaryKey(),
    keyHash: char('key_hash', { length: 64 }).notNull().unique(),
    namespace: varchar('namespace', { length: 16 }).notNull(),
    provider: varchar('provider', { length: 64 }).notNull(),
    operation: varchar('operation', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    schemaVersion: integer('schema_version').notNull(),
    providerVersion: integer('provider_version').notNull(),
    configFingerprint: char('config_fingerprint', { length: 16 }).notNull(),
    maxCandidates: integer('max_candidates'),
    coversValidated: boolean('covers_validated').notNull().default(false),
    payload: text('payload').notNull(),
    payloadBytes: integer('payload_bytes').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }).notNull(),
    upstreamMs: integer('upstream_ms').notNull().default(0),
  },
  (t) => [
    index('provider_metadata_cache_ns_provider_fetched_idx').on(t.namespace, t.provider, t.fetchedAt),
    index('provider_metadata_cache_last_accessed_idx').on(t.lastAccessedAt),
    check('provider_metadata_cache_namespace_chk', sql`${t.namespace} in ('book', 'author')`),
    check('provider_metadata_cache_operation_chk', sql`${t.operation} in ('search', 'lookup')`),
    check('provider_metadata_cache_status_chk', sql`${t.status} in ('results', 'empty', 'found', 'not_found')`),
    check('provider_metadata_cache_payload_bytes_nonnegative_chk', sql`${t.payloadBytes} >= 0`),
  ],
);

export type ProviderMetadataCacheRow = typeof providerMetadataCache.$inferSelect;
export type NewProviderMetadataCacheRow = typeof providerMetadataCache.$inferInsert;
