import { boolean, integer, pgTable, serial, timestamp, unique, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { emailTemplates } from './email-templates';

export const emailRecipients = pgTable(
  'email_recipients',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    deviceType: varchar('device_type', { length: 20 }),
    preferredFormat: varchar('preferred_format', { length: 20 }),
    defaultTemplateId: integer('default_template_id').references(() => emailTemplates.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [unique().on(t.userId, t.email)],
);

export const emailRecipientGroups = pgTable(
  'email_recipient_groups',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    defaultTemplateId: integer('default_template_id').references(() => emailTemplates.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [unique().on(t.userId, t.name)],
);

export const emailRecipientGroupMembers = pgTable(
  'email_recipient_group_members',
  {
    groupId: integer('group_id')
      .notNull()
      .references(() => emailRecipientGroups.id, { onDelete: 'cascade' }),
    recipientId: integer('recipient_id')
      .notNull()
      .references(() => emailRecipients.id, { onDelete: 'cascade' }),
  },
  (t) => [unique().on(t.groupId, t.recipientId)],
);

export type EmailRecipient = typeof emailRecipients.$inferSelect;
export type NewEmailRecipient = typeof emailRecipients.$inferInsert;

export type EmailRecipientGroup = typeof emailRecipientGroups.$inferSelect;
export type NewEmailRecipientGroup = typeof emailRecipientGroups.$inferInsert;

export type EmailRecipientGroupMember = typeof emailRecipientGroupMembers.$inferSelect;
