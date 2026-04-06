import { foreignKey, integer, pgTable, serial, timestamp } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { emailProviders } from './email-providers';
import { emailRecipients } from './email-recipients';
import { emailTemplates } from './email-templates';

export const emailPreferences = pgTable(
  'email_preferences',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    defaultProviderId: integer('default_provider_id').references(() => emailProviders.id, { onDelete: 'set null' }),
    defaultRecipientId: integer('default_recipient_id').references(() => emailRecipients.id, { onDelete: 'set null' }),
    defaultTemplateId: integer('default_template_id').references(() => emailTemplates.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    foreignKey({
      columns: [t.defaultRecipientId, t.userId],
      foreignColumns: [emailRecipients.id, emailRecipients.userId],
      name: 'email_preferences_default_recipient_owner_fk',
    }),
  ],
);

export type EmailPreferences = typeof emailPreferences.$inferSelect;
export type NewEmailPreferences = typeof emailPreferences.$inferInsert;
