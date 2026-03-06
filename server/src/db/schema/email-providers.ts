import { boolean, integer, pgTable, serial, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core';

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
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [unique().on(t.userId, t.name)],
);

export type EmailProvider = typeof emailProviders.$inferSelect;
export type NewEmailProvider = typeof emailProviders.$inferInsert;
