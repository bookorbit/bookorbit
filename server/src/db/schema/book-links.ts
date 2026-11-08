import { index, integer, pgTable, serial, timestamp } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { books } from './books';

/**
 * Books that are the same work kept as separate records, often in different libraries, and shown
 * as one. Links are library-wide like metadata. A group with fewer than two members means "not
 * linked" everywhere.
 */
export const bookLinkGroups = pgTable('book_link_groups', {
  id: serial('id').primaryKey(),
  /** The default representative. Null means the lowest visible id. */
  leadBookId: integer('lead_book_id').references(() => books.id, { onDelete: 'set null' }),
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const bookLinks = pgTable(
  'book_links',
  {
    /** A book is in at most one group. */
    bookId: integer('book_id')
      .primaryKey()
      .references(() => books.id, { onDelete: 'cascade' }),
    groupId: integer('group_id')
      .notNull()
      .references(() => bookLinkGroups.id, { onDelete: 'cascade' }),
    linkedByUserId: integer('linked_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('book_links_group_book_idx').on(t.groupId, t.bookId)],
);
