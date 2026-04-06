import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, serial, text, timestamp, unique, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const emailProviders = pgTable(
  'email_providers',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    host: varchar('host', { length: 255 }).notNull(),
    port: integer('port').notNull(),
    username: varchar('username', { length: 255 }),
    passwordEnc: text('password_enc'),
    fromName: varchar('from_name', { length: 255 }),
    fromAddress: varchar('from_address', { length: 255 }),
    auth: boolean('auth').notNull().default(true),
    ssl: boolean('ssl').notNull().default(false),
    startTls: boolean('start_tls').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    isShared: boolean('is_shared').notNull().default(false),
    isSystemProvider: boolean('is_system_provider').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    unique().on(t.userId, t.name),
    unique('email_providers_id_user_id_unique').on(t.id, t.userId),
    uniqueIndex('email_providers_one_default_per_user_uidx')
      .on(t.userId)
      .where(sql`${t.isDefault} = true and ${t.userId} is not null`),
    uniqueIndex('email_providers_one_system_provider_uidx')
      .on(t.isSystemProvider)
      .where(sql`${t.isSystemProvider} = true`),
    check('email_providers_port_range_chk', sql`${t.port} >= 1 and ${t.port} <= 65535`),
  ],
);

export type EmailProvider = typeof emailProviders.$inferSelect;
export type NewEmailProvider = typeof emailProviders.$inferInsert;
