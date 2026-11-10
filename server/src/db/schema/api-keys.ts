import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, primaryKey, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { libraries } from './libraries';

export const apiKeys = pgTable(
  'api_keys',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The administrator who issued the key for its owner; null when the owner created it. */
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 100 }).notNull(),
    /** SHA-256 of the whole token. The token itself is never stored. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    tokenHint: varchar('token_hint', { length: 8 }).notNull(),
    audience: varchar('audience', { length: 20 }).notNull().default('api'),
    access: varchar('access', { length: 10 }).notNull().default('read'),
    permissions: text('permissions')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    admin: boolean('admin').notNull().default(false),
    /** True when the key is limited to the libraries in `api_key_libraries`, even once they are all gone. */
    libraryLimited: boolean('library_limited').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastUsedIp: varchar('last_used_ip', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('api_keys_user_active_idx')
      .on(t.userId)
      .where(sql`${t.revokedAt} is null`),
    index('api_keys_created_by_idx').on(t.createdBy),
    check('api_keys_audience_chk', sql`${t.audience} in ('api', 'opds', 'koreader')`),
    check('api_keys_access_chk', sql`${t.access} in ('read', 'write')`),
    check('api_keys_admin_not_library_limited_chk', sql`not (${t.admin} and ${t.libraryLimited})`),
    check('api_keys_expires_after_created_chk', sql`${t.expiresAt} is null or ${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const apiKeyLibraries = pgTable(
  'api_key_libraries',
  {
    apiKeyId: integer('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.apiKeyId, t.libraryId] }), index('api_key_libraries_library_idx').on(t.libraryId)],
);

export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;
