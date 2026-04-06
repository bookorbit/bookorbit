import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, integer, pgTable, primaryKey, serial, timestamp, unique, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    unique().on(t.userId, t.email),
    uniqueIndex('email_recipients_user_email_lower_uidx').on(t.userId, sql`lower(${t.email})`),
    uniqueIndex('email_recipients_one_default_per_user_uidx')
      .on(t.userId)
      .where(sql`${t.isDefault} = true`),
    uniqueIndex('email_recipients_id_user_id_uidx').on(t.id, t.userId),
    check('email_recipients_device_type_chk', sql`${t.deviceType} is null or ${t.deviceType} in ('kindle', 'kobo', 'other')`),
    check(
      'email_recipients_preferred_format_chk',
      sql`${t.preferredFormat} is null or ${t.preferredFormat} in ('epub', 'pdf', 'mobi', 'azw3', 'cbz', 'cbr')`,
    ),
  ],
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [unique().on(t.userId, t.name), uniqueIndex('email_recipient_groups_id_user_id_uidx').on(t.id, t.userId)],
);

export const emailRecipientGroupMembers = pgTable(
  'email_recipient_group_members',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: integer('group_id')
      .notNull()
      .references(() => emailRecipientGroups.id, { onDelete: 'cascade' }),
    recipientId: integer('recipient_id')
      .notNull()
      .references(() => emailRecipients.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.recipientId] }),
    foreignKey({
      columns: [t.groupId, t.userId],
      foreignColumns: [emailRecipientGroups.id, emailRecipientGroups.userId],
      name: 'email_recipient_group_members_group_user_fk',
    }),
    foreignKey({
      columns: [t.recipientId, t.userId],
      foreignColumns: [emailRecipients.id, emailRecipients.userId],
      name: 'email_recipient_group_members_recipient_user_fk',
    }),
  ],
);

export type EmailRecipient = typeof emailRecipients.$inferSelect;
export type NewEmailRecipient = typeof emailRecipients.$inferInsert;

export type EmailRecipientGroup = typeof emailRecipientGroups.$inferSelect;
export type NewEmailRecipientGroup = typeof emailRecipientGroups.$inferInsert;

export type EmailRecipientGroupMember = typeof emailRecipientGroupMembers.$inferSelect;
