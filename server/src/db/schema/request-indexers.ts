import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import type { BookRequestMediaKind, IndexerCategoryMap, IndexerColor, IndexerSettings, NetworkProfile } from '@bookorbit/types';

/**
 * Configured indexer instances. The adapter *types* live in code; no tracker is bundled, and a
 * row carries the operator's own credentials.
 */
export const requestIndexers = pgTable(
  'request_indexers',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    /**
     * The operator's own colour for this source, as a slug from `INDEXER_COLORS` rather than a
     * colour value: the picker resolves it to a token tuned per theme, and a stored hex could not
     * be. Null is the ordinary state, and reads as the neutral chip the picker showed before
     * colours existed.
     */
    color: varchar('color', { length: 16 }).$type<IndexerColor>(),
    adapterType: varchar('adapter_type', { length: 30 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    baseUrl: text('base_url').notNull(),
    /** AES-256-GCM blob: a torznab API key or a tracker session id. Never returned, never logged. */
    credentialsEnc: text('credentials_enc'),
    /**
     * Off by default, unlike a download client: a public tracker has no business resolving to a
     * private address. A self-hosted torznab proxy on the LAN is the one common exception, so it
     * is an explicit per-row opt-in with the implication stated in the UI.
     */
    allowPrivateAddress: boolean('allow_private_address').notNull().default(false),

    /** Which of this indexer's own categories to search per requested medium. */
    categories: jsonb('categories').$type<IndexerCategoryMap>(),
    /**
     * Media the operator has taken this source out of. An opt-out, so a row written before a
     * medium existed is not excluded from it, and so the default state is the one an operator who
     * has never opened this expects. Narrowing only: a source whose adapter does not carry a
     * medium is already left out of that search, and listing it here changes nothing.
     */
    disabledMediaKinds: jsonb('disabled_media_kinds').$type<BookRequestMediaKind[]>().notNull().default([]),
    /**
     * Whether this source is to be searched by title and author even when the request states an
     * ISBN. An opt-out for the same reason the line above is: indexing the identifier is the better
     * default, and this exists for a catalogue that holds ISBNs against the wrong rows, where an
     * exact search returns a confidently wrong book. Meaningless for an adapter that never searches
     * one, and stored anyway so the answer survives a change of adapter.
     */
    isbnSearchDisabled: boolean('isbn_search_disabled').notNull().default(false),
    /** Adapter-specific knobs that do not deserve a column of their own. */
    settings: jsonb('settings').$type<IndexerSettings>(),
    /**
     * How to reach this source, where the default path does not work: its own resolvers, or a
     * proxy to egress through. Operator configuration; the containment policy is unchanged, and
     * still applies to whatever address the configured resolver returns.
     */
    networkProfile: jsonb('network_profile').$type<NetworkProfile>(),

    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestOk: boolean('last_test_ok'),
    lastErrorMessage: text('last_error_message'),

    /**
     * How the last real search against this source went, as opposed to the last time an operator
     * pressed Test. The two answer different questions: a caps call can succeed against a tracker
     * that has been refusing every search since Tuesday, and the picker's live failure list is
     * gone the moment the drawer closes.
     */
    lastSearchAt: timestamp('last_search_at', { withTimezone: true }),
    lastSearchOk: boolean('last_search_ok'),
    lastSearchError: text('last_search_error'),
    /**
     * Reset to zero by any successful search. A source that has failed the last several searches
     * in a row is a different fact from one that failed once, and it is the only one worth
     * putting a badge on a settings row for.
     */
    searchFailureStreak: integer('search_failure_streak').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('request_indexers_name_lower_uidx').on(sql`lower(${t.name})`),
    index('request_indexers_enabled_idx').on(t.enabled),
    // A slug, not a list. Two reasons: a row whose adapter was removed from the build has to
    // survive so the operator can see and replace it rather than losing a stored credential, and
    // externally loaded adapters name themselves. `IndexerRegistry.require()` is what actually
    // rejects an unknown type, loudly, at search and grab time.
    check('request_indexers_adapter_type_chk', sql`${t.adapterType} ~ '^[a-z0-9][a-z0-9-]{0,29}$'`),
  ],
);

export type RequestIndexerRow = typeof requestIndexers.$inferSelect;
export type NewRequestIndexerRow = typeof requestIndexers.$inferInsert;
