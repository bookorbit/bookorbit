import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { libraries } from './libraries';

export const users = pgTable('users', {
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
  provisioningMethod: varchar('provisioning_method', { length: 20 }).notNull().default('local'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
});

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
  (t) => [primaryKey({ columns: [t.userId, t.libraryId] })],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('refresh_tokens_user_id_idx').on(t.userId)],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('password_reset_tokens_user_id_idx').on(t.userId)],
);

export const appSettings = pgTable('app_settings', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
