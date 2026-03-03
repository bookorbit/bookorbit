import { index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { bookFiles, books } from './books';
import { users } from './auth';

export const fileWriteLog = pgTable(
  'file_write_log',
  {
    id: serial('id').primaryKey(),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    bookFileId: integer('book_file_id').references(() => bookFiles.id, { onDelete: 'set null' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    format: varchar('format', { length: 20 }).notNull(),
    status: varchar('status', { length: 10 }).notNull(),
    fieldsWritten: jsonb('fields_written').$type<string[]>(),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    triggeredBy: varchar('triggered_by', { length: 10 }).notNull(),
    writtenAt: timestamp('written_at').defaultNow().notNull(),
  },
  (t) => [index('fwl_book_id_idx').on(t.bookId)],
);

export type FileWriteLog = typeof fileWriteLog.$inferSelect;
export type NewFileWriteLog = typeof fileWriteLog.$inferInsert;
