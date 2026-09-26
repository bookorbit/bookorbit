import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, serial, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import type { GroupRule, MediaType, PodcastScopeRules, SortSpec } from '@bookorbit/types';

import { users } from './auth';
import { libraries } from './libraries';

export const smartScopes = pgTable(
  'smart_scopes',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Discriminates which rule vocabulary `filter` holds and which query path evaluates it. */
    mediaType: varchar('media_type', { length: 20 }).$type<MediaType>().notNull().default('books'),
    /**
     * Podcast scopes evaluate episodes within one library, mirroring the playlists they replace,
     * so the library owns them. Book scopes span every accessible library and leave this null.
     */
    libraryId: integer('library_id').references(() => libraries.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    icon: varchar('icon', { length: 100 }),
    filter: jsonb('filter').$type<GroupRule | PodcastScopeRules | null>(),
    defaultSort: jsonb('default_sort').$type<SortSpec[]>().notNull().default([]),
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
    unique().on(t.userId, t.mediaType, t.name),
    index('smart_scopes_user_media_type_idx').on(t.userId, t.mediaType),
    check('smart_scopes_media_type_chk', sql`${t.mediaType} in ('books', 'podcasts')`),
    check('smart_scopes_library_scope_chk', sql`(${t.mediaType} = 'podcasts') = (${t.libraryId} is not null)`),
    /** Kobo takes books only, so a podcast scope must never carry the owner sync flag. */
    check('smart_scopes_kobo_books_only_chk', sql`${t.syncToKobo} = false or ${t.mediaType} = 'books'`),
  ],
);

export type SmartScope = typeof smartScopes.$inferSelect;
export type NewSmartScope = typeof smartScopes.$inferInsert;

/**
 * Opt-in Kobo sync for shared scopes. `smartScopes.syncToKobo` only governs the
 * owner's own devices; every other user decides for themselves whether a public
 * scope reaches their Kobo, so nothing lands on a device without consent.
 */
export const smartScopeKoboSubscriptions = pgTable(
  'smart_scope_kobo_subscriptions',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    smartScopeId: integer('smart_scope_id')
      .notNull()
      .references(() => smartScopes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.smartScopeId] }), index('smart_scope_kobo_subscriptions_smart_scope_id_idx').on(t.smartScopeId)],
);

export type SmartScopeKoboSubscription = typeof smartScopeKoboSubscriptions.$inferSelect;
