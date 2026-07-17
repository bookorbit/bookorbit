import { check, index, integer, pgTable, primaryKey, real, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { users } from './auth';
import { books } from './books';

export const bookDuplicateScans = pgTable(
  'book_duplicate_scans',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    libraryIds: integer('library_ids').array().notNull(),
    requestedLibraryId: integer('requested_library_id'),
    similarityPercent: integer('similarity_percent').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    processedBooks: integer('processed_books').notNull().default(0),
    totalBooks: integer('total_books'),
    totalGroups: integer('total_groups'),
    errorCode: varchar('error_code', { length: 50 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('book_duplicate_scans_user_created_idx').on(t.userId, sql`${t.createdAt} desc`),
    index('book_duplicate_scans_status_idx').on(t.status),
    check('book_duplicate_scans_similarity_chk', sql`${t.similarityPercent} between 70 and 100`),
    check('book_duplicate_scans_status_chk', sql`${t.status} in ('queued', 'running', 'completed', 'failed')`),
  ],
);

export const bookDuplicateScanKeys = pgTable(
  'book_duplicate_scan_keys',
  {
    scanId: integer('scan_id')
      .notNull()
      .references(() => bookDuplicateScans.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 20 }).notNull(),
    value: text('value').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scanId, t.bookId, t.kind, t.value] }),
    index('book_duplicate_scan_keys_lookup_idx').on(t.scanId, t.kind, t.value, t.bookId),
    check('book_duplicate_scan_keys_kind_chk', sql`${t.kind} in ('file_hash', 'isbn', 'exact_metadata')`),
  ],
);

export const bookDuplicateGroups = pgTable(
  'book_duplicate_groups',
  {
    id: serial('id').primaryKey(),
    scanId: integer('scan_id')
      .notNull()
      .references(() => bookDuplicateScans.id, { onDelete: 'cascade' }),
    rootBookId: integer('root_book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    reasons: text('reasons').array().notNull(),
    maxTitleSimilarity: real('max_title_similarity'),
    memberCount: integer('member_count').notNull(),
  },
  (t) => [
    uniqueIndex('book_duplicate_groups_scan_root_uidx').on(t.scanId, t.rootBookId),
    index('book_duplicate_groups_scan_id_idx').on(t.scanId, t.id),
    index('book_duplicate_groups_scan_member_count_idx').on(t.scanId, t.memberCount),
  ],
);

export const bookDuplicatePairs = pgTable(
  'book_duplicate_pairs',
  {
    scanId: integer('scan_id')
      .notNull()
      .references(() => bookDuplicateScans.id, { onDelete: 'cascade' }),
    groupId: integer('group_id').references(() => bookDuplicateGroups.id, { onDelete: 'cascade' }),
    bookIdA: integer('book_id_a')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    bookIdB: integer('book_id_b')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    reasons: text('reasons').array().notNull(),
    titleSimilarity: real('title_similarity'),
  },
  (t) => [
    primaryKey({ columns: [t.scanId, t.bookIdA, t.bookIdB] }),
    index('book_duplicate_pairs_group_idx').on(t.groupId),
    index('book_duplicate_pairs_scan_a_idx').on(t.scanId, t.bookIdA),
    index('book_duplicate_pairs_scan_b_idx').on(t.scanId, t.bookIdB),
    check('book_duplicate_pairs_order_chk', sql`${t.bookIdA} < ${t.bookIdB}`),
  ],
);

export const bookDuplicateGroupMembers = pgTable(
  'book_duplicate_group_members',
  {
    groupId: integer('group_id')
      .notNull()
      .references(() => bookDuplicateGroups.id, { onDelete: 'cascade' }),
    scanId: integer('scan_id')
      .notNull()
      .references(() => bookDuplicateScans.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.scanId, t.bookId] }), index('book_duplicate_group_members_group_idx').on(t.groupId, t.bookId)],
);

export type BookDuplicateScanRow = typeof bookDuplicateScans.$inferSelect;
