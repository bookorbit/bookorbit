import { sql } from 'drizzle-orm';
import { boolean, integer, pgTable, serial, text, timestamp, unique, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const emailTemplates = pgTable(
  'email_templates',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    subject: text('subject').notNull(),
    bodyText: text('body_text').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    unique().on(t.userId, t.name),
    uniqueIndex('email_templates_one_default_per_user_uidx')
      .on(t.userId)
      .where(sql`${t.isDefault} = true and ${t.userId} is not null`),
    uniqueIndex('email_templates_system_name_unique')
      .on(t.name)
      .where(sql`${t.userId} is null`),
  ],
);

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;
