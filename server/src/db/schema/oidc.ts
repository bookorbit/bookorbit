import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const oidcProviders = pgTable(
  'oidc_providers',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    enabled: boolean('enabled').notNull().default(false),
    issuerUri: text('issuer_uri').notNull().unique(),
    clientId: text('client_id').notNull(),
    clientSecret: text('client_secret'),
    scopes: text('scopes').notNull().default('openid profile email'),
    iconUrl: text('icon_url'),
    claimMapping: jsonb('claim_mapping').notNull().default({ username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' }),
    autoProvision: jsonb('auto_provision').notNull().default({ enabled: false, allowLocalLinking: false, defaultPermissionNames: [] }),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [index('oidc_providers_enabled_order_idx').on(t.enabled, t.displayOrder)],
);

export const oidcIdentities = pgTable(
  'oidc_identities',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: integer('provider_id')
      .notNull()
      .references(() => oidcProviders.id, { onDelete: 'cascade' }),
    oidcSubject: text('oidc_subject').notNull(),
    oidcIssuer: text('oidc_issuer').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('oidc_identities_provider_subject_uidx').on(t.providerId, t.oidcSubject),
    uniqueIndex('oidc_identities_user_provider_uidx').on(t.userId, t.providerId),
    uniqueIndex('oidc_identities_issuer_subject_uidx').on(t.oidcIssuer, t.oidcSubject),
    index('oidc_identities_user_id_idx').on(t.userId),
  ],
);

export const oidcPermissionGrants = pgTable(
  'oidc_permission_grants',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: integer('provider_id')
      .notNull()
      .references(() => oidcProviders.id, { onDelete: 'cascade' }),
    permissionName: varchar('permission_name', { length: 100 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.providerId, t.permissionName] })],
);

export const oidcStates = pgTable(
  'oidc_states',
  {
    state: text('state').primaryKey(),
    providerId: integer('provider_id')
      .notNull()
      .references(() => oidcProviders.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    meta: text('meta'),
  },
  (t) => [index('oidc_states_expires_at_idx').on(t.expiresAt)],
);

export const oidcUsedJtis = pgTable(
  'oidc_used_jtis',
  {
    jti: text('jti').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('oidc_used_jtis_expires_at_idx').on(t.expiresAt)],
);

export const oidcSessions = pgTable(
  'oidc_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: integer('provider_id').references(() => oidcProviders.id, { onDelete: 'set null' }),
    oidcSubject: text('oidc_subject').notNull(),
    oidcIssuer: text('oidc_issuer').notNull(),
    oidcSessionId: text('oidc_session_id'),
    idTokenHint: text('id_token_hint'),
    idpRefreshToken: text('idp_refresh_token'),
    revoked: boolean('revoked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('oidc_sessions_user_active_idx')
      .on(t.userId)
      .where(sql`${t.revoked} = false`),
    index('oidc_sessions_subject_issuer_idx').on(t.oidcSubject, t.oidcIssuer),
    index('oidc_sessions_sid_idx').on(t.oidcSessionId),
    index('oidc_sessions_expires_at_idx').on(t.expiresAt),
    index('oidc_sessions_provider_id_idx').on(t.providerId),
  ],
);

export const oidcGroupMappings = pgTable(
  'oidc_group_mappings',
  {
    id: serial('id').primaryKey(),
    providerId: integer('provider_id')
      .notNull()
      .references(() => oidcProviders.id, { onDelete: 'cascade' }),
    oidcGroupClaim: text('oidc_group_claim').notNull(),
    permissionName: varchar('permission_name', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('oidc_group_mappings_provider_claim_uidx').on(t.providerId, t.oidcGroupClaim)],
);

export type OidcProvider = typeof oidcProviders.$inferSelect;
export type NewOidcProvider = typeof oidcProviders.$inferInsert;
export type OidcIdentity = typeof oidcIdentities.$inferSelect;
export type OidcGroupMapping = typeof oidcGroupMappings.$inferSelect;
