import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { BOOK_REQUEST_MEDIA_KINDS } from '@bookorbit/types';
import type { BookRequestMetadataSource } from '@bookorbit/types';

import { books } from './books';
import { bookDockFiles } from './book-dock';
import { libraries, libraryFolders } from './libraries';
import { users } from './auth';

export const bookRequestMediaKindEnum = pgEnum('book_request_media_kind', BOOK_REQUEST_MEDIA_KINDS);

/**
 * Status lists are spelled out rather than interpolated from the shared constants. A CHECK body
 * and an index predicate need literal SQL, and `sql.raw()` would run at import time - which some
 * repository tests cannot survive, because they mock `drizzle-orm` down to the few helpers they
 * use. `book-requests.schema.test.ts` asserts both lists still match `@bookorbit/types`.
 */

export const bookRequests = pgTable(
  'book_requests',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaKind: bookRequestMediaKindEnum('media_kind').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),

    title: varchar('title', { length: 500 }).notNull(),
    subtitle: varchar('subtitle', { length: 500 }),
    authors: jsonb('authors').$type<string[]>().notNull().default([]),
    seriesName: varchar('series_name', { length: 500 }),
    seriesIndex: integer('series_index'),
    isbn10: varchar('isbn10', { length: 20 }),
    isbn13: varchar('isbn13', { length: 20 }),
    publishedYear: integer('published_year'),
    language: varchar('language', { length: 20 }),
    coverUrl: text('cover_url'),
    providerKey: varchar('provider_key', { length: 50 }),
    providerId: varchar('provider_id', { length: 255 }),
    metadataSources: jsonb('metadata_sources').$type<BookRequestMetadataSource[]>().notNull().default([]),

    preferredFormats: jsonb('preferred_formats').$type<string[]>().notNull().default([]),
    note: text('note'),

    targetLibraryId: integer('target_library_id').references(() => libraries.id, { onDelete: 'set null' }),
    targetFolderId: integer('target_folder_id').references(() => libraryFolders.id, { onDelete: 'set null' }),

    /**
     * The account that filed this on the requester's behalf, when one did.
     *
     * Null on every request somebody made themselves, which is nearly all of them. Set only when an
     * integration holding `manage_book_requests` named a different requester, so the row itself can
     * answer why somebody has a request they do not remember making.
     *
     * Not left to the audit log, which records the same fact against a retention window: a request
     * outlives its audit row, and the answer has to still be there when it is asked.
     *
     * Set null on delete rather than cascade: retiring the integration account must not delete the
     * requests it filed for other people.
     */
    createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),

    decidedByUserId: integer('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),

    matchedBookId: integer('matched_book_id').references(() => books.id, { onDelete: 'set null' }),
    bookDockFileId: integer('book_dock_file_id').references(() => bookDockFiles.id, { onDelete: 'set null' }),
    statusReason: text('status_reason'),
    /**
     * The classified form of `statusReason`, so the UI can translate it. Null wherever a failure
     * was never classified, which is every path except automation handing a request back.
     */
    failureCode: varchar('failure_code', { length: 50 }),
    failureMeta: jsonb('failure_meta').$type<Record<string, string | number>>(),

    /**
     * Created by somebody fulfilling it themselves. Badged in the queue and never waiting on a
     * decision, so it reads very differently from an ordinary request.
     */
    selfServe: boolean('self_serve').notNull().default(false),

    /**
     * Who may drive fulfilment, when that is somebody other than the requester.
     *
     * One live request per work, so a self-fulfiller whose own submission collides with somebody
     * else's undriven request has to be able to take that row on rather than be subscribed to work
     * they cannot act on. Null on every request nobody has claimed, and on self-serve rows created
     * before this column existed, where the requester is the fulfiller by construction.
     *
     * Set null on delete rather than cascade: losing the fulfiller must not take the requester's
     * request with it, and clearing the column hands it back to them and to the moderators.
     */
    fulfillerUserId: integer('fulfiller_user_id').references(() => users.id, { onDelete: 'set null' }),

    dedupeKey: varchar('dedupe_key', { length: 500 }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('book_requests_user_status_idx').on(t.userId, t.status),
    index('book_requests_status_created_at_idx').on(t.status, t.createdAt),
    index('book_requests_target_library_id_idx').on(t.targetLibraryId),
    // The two orders the queue can be sorted into. `created_at` alone rather than only alongside
    // status, because the default list has no status filter on it.
    index('book_requests_created_at_idx').on(t.createdAt),
    index('book_requests_title_idx').on(t.title),
    // Drives the content-filter exemption, which asks "did this user request this book" once per
    // candidate row while a restricted reader browses. Partial because only fulfilled requests
    // carry a matched book, so at library scale the index stays a fraction of the table.
    index('book_requests_matched_book_user_idx')
      .on(t.matchedBookId, t.userId)
      .where(sql`${t.matchedBookId} is not null`),
    // Partial on purpose. The sweeper asks for self-serve rows of a given status and age every ten
    // minutes, which is selective enough to scan a long way at library scale without it, and the
    // predicate keeps every ordinary request out of the index entirely.
    index('book_requests_self_serve_idx')
      .on(t.selfServe, t.status, t.createdAt)
      .where(sql`${t.selfServe}`),
    // One live claim per work. A second requester is attached as a subscriber instead, which is
    // what keeps two people wanting the same book from becoming two grabs of the same torrent.
    uniqueIndex('book_requests_active_dedupe_key_uidx')
      .on(t.dedupeKey)
      .where(sql`${t.status} in ('pending', 'approved', 'searching', 'grabbed', 'downloading', 'importing', 'needs_review')`),
    check(
      'book_requests_status_chk',
      sql`${t.status} in ('pending', 'approved', 'rejected', 'cancelled', 'searching', 'grabbed', 'downloading', 'importing', 'needs_review', 'available', 'failed')`,
    ),
    check('book_requests_series_index_nonnegative_chk', sql`${t.seriesIndex} is null or ${t.seriesIndex} >= 0`),
  ],
);

/**
 * Every key a request's work could have hashed to, not only the one it was filed under.
 *
 * A row stores one `dedupeKey`, the most specific one available, and the unique index enforces one
 * live claim on it. That is enough when two people reach a book the same way, and not enough when
 * they do not: a request keyed `isbn13:...` never collides with a free-text one keyed
 * `work:title:author:ebook`, so the same book gets requested twice and grabbed twice.
 *
 * These aliases improve *detection*, and deliberately do not try to become the constraint. A
 * partial unique index cannot reference another table's status column, so the hard guard stays on
 * `book_requests.dedupe_key` and this narrows the window rather than closing it. Free-text
 * identity is weak by nature; the form also shows the requester what it found before they commit.
 */
export const bookRequestDedupeAliases = pgTable(
  'book_request_dedupe_aliases',
  {
    requestId: integer('request_id')
      .notNull()
      .references(() => bookRequests.id, { onDelete: 'cascade' }),
    dedupeKey: varchar('dedupe_key', { length: 500 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.requestId, t.dedupeKey] }),
    // The lookup direction: given a handful of candidate keys, which live request already holds one.
    index('book_request_dedupe_aliases_key_idx').on(t.dedupeKey),
  ],
);

export type BookRequestDedupeAliasRow = typeof bookRequestDedupeAliases.$inferSelect;

export const bookRequestSubscribers = pgTable(
  'book_request_subscribers',
  {
    requestId: integer('request_id')
      .notNull()
      .references(() => bookRequests.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.userId] }), index('book_request_subscribers_user_id_idx').on(t.userId)],
);

/**
 * "Stop showing me this." Personal rather than a column on the request, because a request has a
 * requester, a set of subscribers and an approver queue looking at the same row, and one of them
 * tidying their own list must not take it off anybody else's.
 */
export const bookRequestDismissals = pgTable(
  'book_request_dismissals',
  {
    requestId: integer('request_id')
      .notNull()
      .references(() => bookRequests.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.userId] }), index('book_request_dismissals_user_id_idx').on(t.userId)],
);

export type BookRequestRow = typeof bookRequests.$inferSelect;
export type NewBookRequestRow = typeof bookRequests.$inferInsert;
