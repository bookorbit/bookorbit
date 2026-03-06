import { integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { books, bookFiles } from './books';
import { emailProviders } from './email-providers';
import { emailTemplates } from './email-templates';

export const emailSendLog = pgTable('email_send_log', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  bookId: integer('book_id').references(() => books.id, { onDelete: 'set null' }),
  bookFileId: integer('book_file_id').references(() => bookFiles.id, { onDelete: 'set null' }),
  providerId: integer('provider_id').references(() => emailProviders.id, { onDelete: 'set null' }),
  templateId: integer('template_id').references(() => emailTemplates.id, { onDelete: 'set null' }),
  toEmail: varchar('to_email', { length: 255 }).notNull(),
  toName: varchar('to_name', { length: 255 }),
  subject: text('subject'),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0),
  nextRetryAt: timestamp('next_retry_at'),
  errorMessage: text('error_message'),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export type EmailSendLog = typeof emailSendLog.$inferSelect;
export type NewEmailSendLog = typeof emailSendLog.$inferInsert;
