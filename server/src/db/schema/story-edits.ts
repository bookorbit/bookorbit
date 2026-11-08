import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { STORY_EDIT_KIND_MAX_LENGTH } from '@bookorbit/types';

import { users } from './auth';
import { books } from './books';
import { timestamptz } from './columns';

/** A reader's corrections to a book's people, places and terms. Stored as given; never interpreted. */
export const storyEdits = pgTable(
  'story_edits',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    // Client-generated, so a correction made offline keeps its identity across retries and devices.
    id: uuid('id').notNull(),
    kind: varchar('kind', { length: STORY_EDIT_KIND_MAX_LENGTH }).notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    position: doublePrecision('position'),
    // The client's time of the change, which decides between two writes to one id.
    clientUpdatedAt: timestamptz('client_updated_at').notNull(),
    deleted: boolean('deleted').notNull().default(false),
    // Drawn from one sequence on every write, so a reader's `since` cursor only ever moves forward.
    revision: bigserial('revision', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.bookId, t.id] }),
    index('story_edits_user_book_revision_idx').on(t.userId, t.bookId, t.revision),
    index('story_edits_book_id_idx').on(t.bookId),
    check('story_edits_kind_not_empty_chk', sql`char_length(${t.kind}) >= 1`),
    check('story_edits_data_object_chk', sql`jsonb_typeof(${t.data}) = 'object'`),
    check('story_edits_position_range_chk', sql`${t.position} is null or (${t.position} >= 0 and ${t.position} <= 1)`),
  ],
);

export type StoryEditRow = typeof storyEdits.$inferSelect;
export type NewStoryEditRow = typeof storyEdits.$inferInsert;
