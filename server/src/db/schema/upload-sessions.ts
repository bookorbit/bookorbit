import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { books } from './books';
import { libraries, libraryFolders } from './libraries';

export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),
    targetKind: varchar('target_kind', { length: 30 }).notNull(),
    targetLibraryId: integer('target_library_id').references(() => libraries.id, { onDelete: 'set null' }),
    targetFolderId: integer('target_folder_id').references(() => libraryFolders.id, { onDelete: 'set null' }),
    targetBookId: integer('target_book_id').references(() => books.id, { onDelete: 'set null' }),
    filename: varchar('filename', { length: 500 }).notNull(),
    contentType: varchar('content_type', { length: 200 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    receivedBytes: bigint('received_bytes', { mode: 'number' }).notNull().default(0),
    stagingPath: text('staging_path').notNull().unique(),
    status: varchar('status', { length: 20 }).notNull().default('receiving'),
    expectedSha256: varchar('expected_sha256', { length: 64 }),
    errorCode: varchar('error_code', { length: 80 }),
    errorMessage: text('error_message'),
    resultBookId: integer('result_book_id').references(() => books.id, { onDelete: 'set null' }),
    resultBookDockFileId: integer('result_book_dock_file_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('upload_sessions_user_idempotency_uidx').on(t.userId, t.idempotencyKey),
    index('upload_sessions_user_created_idx').on(t.userId, sql`${t.createdAt} desc`),
    index('upload_sessions_status_expires_idx').on(t.status, t.expiresAt),
    check('upload_sessions_target_kind_chk', sql`${t.targetKind} in ('library', 'existing_book', 'book_dock')`),
    check('upload_sessions_status_chk', sql`${t.status} in ('receiving', 'processing', 'completed', 'failed', 'cancelled', 'expired')`),
    check('upload_sessions_size_positive_chk', sql`${t.sizeBytes} > 0`),
    check('upload_sessions_received_range_chk', sql`${t.receivedBytes} >= 0 and ${t.receivedBytes} <= ${t.sizeBytes}`),
  ],
);

export type UploadSessionRow = typeof uploadSessions.$inferSelect;
export type NewUploadSessionRow = typeof uploadSessions.$inferInsert;
