import { bigserial, index, integer, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    actorUsername: varchar('actor_username', { length: 255 }).notNull(),
    action: varchar('action', { length: 100 }).notNull(),
    resource: varchar('resource', { length: 100 }),
    resourceId: integer('resource_id'),
    description: text('description').notNull(),
    ip: varchar('ip', { length: 45 }),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('idx_audit_user_id').on(t.userId),
    index('idx_audit_resource').on(t.resource, t.resourceId),
    index('idx_audit_action').on(t.action),
    index('idx_audit_ip').on(t.ip),
    index('idx_audit_created_at').on(t.createdAt),
    index('idx_audit_reading_insights_access').on(t.resource, t.resourceId, t.action, t.createdAt),
  ],
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
