import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const oidcSessions = pgTable(
  'oidc_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    oidcSubject: text('oidc_subject').notNull(),
    oidcIssuer: text('oidc_issuer').notNull(),
    oidcSessionId: text('oidc_session_id'),
    idTokenHint: text('id_token_hint'),
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
  ],
);

export const oidcGroupMappings = pgTable('oidc_group_mappings', {
  id: serial('id').primaryKey(),
  oidcGroupClaim: text('oidc_group_claim').notNull().unique(),
  permissionName: varchar('permission_name', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
