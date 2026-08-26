import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import type { IndexerColor, ReleaseUnitChoice } from '@bookorbit/types';

import { bookDockFiles } from './book-dock';
import { bookRequests } from './book-requests';
import { requestIndexers } from './request-indexers';

/**
 * Status and type lists are spelled out rather than interpolated from the shared constants, for
 * the same reason `book-requests.ts` spells its own out: a CHECK body needs literal SQL, and
 * `sql.raw()` would run at import time. `download-clients.schema.test.ts` asserts they still
 * match `@bookorbit/types`.
 */

export const downloadClients = pgTable(
  'download_clients',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    color: varchar('color', { length: 16 }).$type<IndexerColor>(),
    adapterType: varchar('adapter_type', { length: 30 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    priority: integer('priority').notNull().default(1),

    baseUrl: text('base_url').notNull(),
    username: varchar('username', { length: 255 }),
    /** AES-256-GCM blob. Never returned to a client, and never logged. */
    credentialsEnc: text('credentials_enc'),

    /** Tags our torrents in the client so BookOrbit only ever touches its own. */
    category: varchar('category', { length: 100 }).notNull().default('bookorbit'),
    useHardlinks: boolean('use_hardlinks').notNull().default(true),
    /** Per-row SSRF opt-in: clients usually live on the LAN, indexers do not. */
    allowPrivateAddress: boolean('allow_private_address').notNull().default(true),
    settings: jsonb('settings').$type<Record<string, unknown>>(),

    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestOk: boolean('last_test_ok'),
    lastErrorMessage: text('last_error_message'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('download_clients_name_lower_uidx').on(sql`lower(${t.name})`),
    index('download_clients_enabled_priority_idx').on(t.enabled, t.priority),
    check('download_clients_adapter_type_chk', sql`${t.adapterType} in ('qbittorrent', 'transmission', 'deluge')`),

    check('download_clients_priority_range_chk', sql`${t.priority} >= 1 and ${t.priority} <= 100`),
  ],
);

/**
 * Longest-prefix translation from what the client reports to what BookOrbit can open. Mandatory
 * for any deployment where the two containers mount the same storage at different paths.
 */
export const downloadClientPathMappings = pgTable(
  'download_client_path_mappings',
  {
    id: serial('id').primaryKey(),
    downloadClientId: integer('download_client_id')
      .notNull()
      .references(() => downloadClients.id, { onDelete: 'cascade' }),
    remotePath: varchar('remote_path', { length: 4096 }).notNull(),
    localPath: varchar('local_path', { length: 4096 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('download_client_path_mappings_client_remote_uidx').on(t.downloadClientId, t.remotePath)],
);

/**
 * One row per grab attempt, so "retry with a different release" is a new row rather than a
 * mutation that loses what was tried before.
 */
export const bookRequestDownloads = pgTable(
  'book_request_downloads',
  {
    id: serial('id').primaryKey(),
    requestId: integer('request_id')
      .notNull()
      .references(() => bookRequests.id, { onDelete: 'cascade' }),
    /**
     * Null for a direct file, which BookOrbit fetches itself rather than handing to a client, and
     * null again once a client a torrent was handed to is deleted. `source` is what tells those
     * two apart: `direct_url` is ours to poll and clean up, anything else is an orphaned attempt.
     */
    downloadClientId: integer('download_client_id').references(() => downloadClients.id, { onDelete: 'set null' }),

    /** Where the release came from. Set null on delete: the attempt outlives the indexer row. */
    indexerId: integer('indexer_id').references(() => requestIndexers.id, { onDelete: 'set null' }),

    source: varchar('source', { length: 20 }).notNull(),
    /** Grabbed by the automation rather than by a person, which is what makes it retryable. */
    automated: boolean('automated').notNull().default(false),
    releaseTitle: varchar('release_title', { length: 500 }).notNull(),
    releaseGuid: varchar('release_guid', { length: 500 }),
    releaseSizeBytes: bigint('release_size_bytes', { mode: 'number' }),
    releaseSeeders: integer('release_seeders'),
    releaseFormat: varchar('release_format', { length: 20 }),
    freeleech: boolean('freeleech').notNull().default(false),

    /**
     * Null for an attempt that was refused before anything was handed over: a tracker that would
     * not serve the .torrent leaves a record of having been asked, and nothing to poll.
     */
    clientHash: varchar('client_hash', { length: 64 }),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    progressPercent: integer('progress_percent').notNull().default(0),
    downloadedBytes: bigint('downloaded_bytes', { mode: 'number' }).notNull().default(0),
    totalBytes: bigint('total_bytes', { mode: 'number' }),

    /** What the client reported, in its own namespace, and what that mapped to locally. */
    contentPath: text('content_path'),
    localPath: text('local_path'),
    bookDockFileId: integer('book_dock_file_id').references(() => bookDockFiles.id, { onDelete: 'set null' }),

    /**
     * The books this release turned out to hold, kept only while the attempt waits for someone to
     * choose between them. Stored rather than recomputed because recomputing would mean walking
     * the download again, and re-extracting it when the release arrived as an archive.
     */
    releaseUnits: jsonb('release_units').$type<ReleaseUnitChoice[]>(),

    errorMessage: text('error_message'),
    grabbedAt: timestamp('grabbed_at', { withTimezone: true }),
    /** Last tick that saw bytes move. The stall watchdog reads this, not `updatedAt`. */
    lastProgressAt: timestamp('last_progress_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    importedAt: timestamp('imported_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('book_request_downloads_status_idx').on(t.status),
    // Newest attempt first within a request, which is the order both the card's latest attempt
    // and the attempt list are read in. `created_at` served neither: two attempts inserted in one
    // transaction share a timestamp, and the id is what puts them in order.
    index('book_request_downloads_request_latest_idx').on(t.requestId, t.id.desc()),
    index('book_request_downloads_book_dock_file_id_idx').on(t.bookDockFileId),
    // One live attempt per infohash per client: re-grabbing a torrent the client is already
    // working on would produce two rows racing to import the same file. Coalesced because the
    // built-in downloader has no client row, and two direct grabs of one URL would otherwise
    // both be let through to write the same staging file.
    //
    // `needs_review` counts as live. Its bytes are still on disk and still needed: direct staging
    // is keyed by a digest of the URL, so a second request grabbing the same release - an omnibus
    // that matches two different work-level requests - writes into the same directory, and its
    // failure cleanup or its removal then deletes the files the held attempt's import is waiting
    // to read.
    uniqueIndex('book_request_downloads_active_hash_uidx')
      .on(sql`coalesce(${t.downloadClientId}, 0)`, t.clientHash)

      .where(sql`${t.status} in ('queued', 'downloading', 'completed', 'importing', 'needs_review')`),
    check('book_request_downloads_source_chk', sql`${t.source} in ('magnet', 'torrent_file', 'direct_url')`),
    check(
      'book_request_downloads_status_chk',
      sql`${t.status} in ('queued', 'downloading', 'completed', 'importing', 'needs_review', 'imported', 'failed')`,
    ),
    check('book_request_downloads_progress_range_chk', sql`${t.progressPercent} >= 0 and ${t.progressPercent} <= 100`),
  ],
);

export type DownloadClientRow = typeof downloadClients.$inferSelect;
export type NewDownloadClientRow = typeof downloadClients.$inferInsert;
export type DownloadClientPathMappingRow = typeof downloadClientPathMappings.$inferSelect;
export type BookRequestDownloadRow = typeof bookRequestDownloads.$inferSelect;
export type NewBookRequestDownloadRow = typeof bookRequestDownloads.$inferInsert;
