import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { libraries } from './libraries';

export const userAvatarSourceEnum = pgEnum('user_avatar_source', ['none', 'external', 'uploaded']);

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    username: varchar('username', { length: 100 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    active: boolean('active').notNull().default(true),
    isSuperuser: boolean('is_superuser').notNull().default(false),
    isDefaultPassword: boolean('is_default_password').notNull().default(false),
    tokenVersion: integer('token_version').notNull().default(1),
    settings: jsonb('settings').notNull().default({}),
    oidcSubject: text('oidc_subject'),
    oidcIssuer: text('oidc_issuer'),
    avatarUrl: text('avatar_url'),
    avatarSource: userAvatarSourceEnum('avatar_source').notNull().default('none'),
    avatarVersion: integer('avatar_version').notNull().default(0),
    provisioningMethod: varchar('provisioning_method', { length: 20 }).notNull().default('local'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('users_username_lower_uidx').on(sql`lower(${t.username})`),
    uniqueIndex('users_email_lower_uidx')
      .on(sql`lower(${t.email})`)
      .where(sql`${t.email} is not null`),
    uniqueIndex('users_oidc_subject_issuer_uidx')
      .on(t.oidcSubject, t.oidcIssuer)
      .where(sql`${t.oidcSubject} is not null and ${t.oidcIssuer} is not null`),
    check('users_provisioning_method_chk', sql`${t.provisioningMethod} in ('local', 'manual', 'oidc')`),
    check('users_token_version_nonnegative_chk', sql`${t.tokenVersion} >= 0`),
    check('users_avatar_version_nonnegative_chk', sql`${t.avatarVersion} >= 0`),
  ],
);

export const userPermissions = pgTable(
  'user_permissions',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permissionName: varchar('permission_name', { length: 100 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.permissionName] })],
);

export const libraryAccessLevelEnum = pgEnum('library_access_level', ['viewer', 'editor', 'owner']);

export const userLibraryAccess = pgTable(
  'user_library_access',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    accessLevel: libraryAccessLevelEnum('access_level').notNull().default('viewer'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.libraryId] }), index('user_library_access_library_user_idx').on(t.libraryId, t.userId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('refresh_tokens_user_id_idx').on(t.userId),
    index('refresh_tokens_expires_at_idx').on(t.expiresAt),
    check('refresh_tokens_expires_after_created_chk', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('password_reset_tokens_user_id_idx').on(t.userId),
    index('password_reset_tokens_expires_at_idx').on(t.expiresAt),
    check('password_reset_tokens_expires_after_created_chk', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const appSettings = pgTable('app_settings', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
