import { integer, pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';

import { books } from './books';

export const comicMetadata = pgTable(
  'comic_metadata',
  {
    id: serial('id').primaryKey(),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    issueNumber: text('issue_number'),
    volumeName: text('volume_name'),
    pencillers: text('pencillers').array(),
    inkers: text('inkers').array(),
    colorists: text('colorists').array(),
    letterers: text('letterers').array(),
    coverArtists: text('cover_artists').array(),
    characters: text('characters').array(),
    teams: text('teams').array(),
    locations: text('locations').array(),
    storyArcs: text('story_arcs').array(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [unique('comic_metadata_book_id_unique').on(t.bookId)],
);

export type ComicMetadata = typeof comicMetadata.$inferSelect;
export type NewComicMetadata = typeof comicMetadata.$inferInsert;
