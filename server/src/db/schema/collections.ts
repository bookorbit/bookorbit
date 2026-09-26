import { sql } from 'drizzle-orm';
import { bigserial, check, index, boolean, integer, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import type { MediaType } from '@bookorbit/types';

import { books } from './books';
import { podcasts } from './podcasts';
import { users } from './auth';

export const collections = pgTable(
  'collections',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** A collection holds one medium: books go in collection_books, shows in collection_podcasts. */
    mediaType: varchar('media_type', { length: 20 }).$type<MediaType>().notNull().default('books'),
    name: text('name').notNull(),
    icon: text('icon'),
    description: text('description'),
    isPublic: boolean('is_public').notNull().default(false),
    syncToKobo: boolean('sync_to_kobo').notNull().default(false),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('collections_user_media_type_name_uidx').on(t.userId, t.mediaType, t.name),
    index('collections_user_display_name_idx').on(t.userId, t.displayOrder, t.name),
    index('collections_public_display_name_idx').on(t.isPublic, t.displayOrder, t.name),
    check('collections_media_type_chk', sql`${t.mediaType} in ('books', 'podcasts')`),
    /** Kobo takes books only, so a podcast collection must never carry the sync flag. */
    check('collections_kobo_books_only_chk', sql`${t.syncToKobo} = false or ${t.mediaType} = 'books'`),
  ],
);

export const collectionBooks = pgTable(
  'collection_books',
  {
    collectionId: integer('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
    // `added_at` defaults to now(), which is the transaction timestamp, so every book added in
    // one request shares it. This sequence is what actually keeps membership in insertion order.
    position: bigserial('position', { mode: 'number' }),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.bookId] }),
    index('collection_books_book_id_idx').on(table.bookId),
    index('collection_books_collection_position_idx').on(table.collectionId, table.position),
  ],
);

/** Podcast collections group shows. Episodes stay the queue's and the scopes' concern. */
export const collectionPodcasts = pgTable(
  'collection_podcasts',
  {
    collectionId: integer('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    podcastId: integer('podcast_id')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.collectionId, table.podcastId] }), index('collection_podcasts_podcast_id_idx').on(table.podcastId)],
);

export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
