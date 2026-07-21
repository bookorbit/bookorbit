import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { books, bookFiles } from './books';
import { emailProviders } from './email-providers';
import { emailTemplates } from './email-templates';

export const emailSendLog = pgTable(
  'email_send_log',
  {
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
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('email_send_log_user_created_at_idx').on(t.userId, t.createdAt),
    index('email_send_log_book_id_idx').on(t.bookId),
    index('email_send_log_book_file_id_idx').on(t.bookFileId),
    index('email_send_log_created_at_idx').on(t.createdAt),
    index('email_send_log_status_next_retry_idx').on(t.status, t.nextRetryAt),
    check('email_send_log_status_chk', sql`${t.status} in ('pending', 'sent', 'failed')`),
    check('email_send_log_attempt_count_nonnegative_chk', sql`${t.attemptCount} >= 0`),
    check('email_send_log_sent_after_created_chk', sql`${t.sentAt} is null or ${t.sentAt} >= ${t.createdAt}`),
  ],
);

export type EmailSendLog = typeof emailSendLog.$inferSelect;
export type NewEmailSendLog = typeof emailSendLog.$inferInsert;
