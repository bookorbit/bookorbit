import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { libraries, libraryFolders } from './libraries';

/**
 * A library's own drop folder inside the Book Dock, at `<BOOK_DOCK_PATH>/_libraries/<folderName>`.
 * The folder is mapped to its library only through this row, never by guessing from a name, so a
 * renamed library keeps its folder until a manager renames it too.
 *
 * Nullable override columns inherit the global Book Dock setting of the same name.
 */
export const libraryDocks = pgTable(
  'library_docks',
  {
    id: serial('id').primaryKey(),
    libraryId: integer('library_id')
      .notNull()
      .unique()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    folderName: varchar('folder_name', { length: 255 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /**
     * Set when the dock is turned on. Null afterwards only when that folder was removed from the
     * library, and then new arrivals wait for a manager to choose one rather than silently filing
     * into whichever folder happens to be first.
     */
    targetFolderId: integer('target_folder_id').references(() => libraryFolders.id, { onDelete: 'set null' }),
    autoFetchMetadata: boolean('auto_fetch_metadata'),
    autoFinalizeEnabled: boolean('auto_finalize_enabled'),
    autoFinalizeThreshold: integer('auto_finalize_threshold'),
    autoFinalizeMetadataMode: varchar('auto_finalize_metadata_mode', { length: 20 }),
    autoJoin: boolean('auto_join').notNull().default(false),
    keepOriginal: boolean('keep_original').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('library_docks_folder_name_lower_uidx').on(sql`lower(${t.folderName})`),
    index('library_docks_target_folder_id_idx').on(t.targetFolderId),
    check(
      'library_docks_auto_finalize_threshold_chk',
      sql`${t.autoFinalizeThreshold} is null or (${t.autoFinalizeThreshold} >= 50 and ${t.autoFinalizeThreshold} <= 100)`,
    ),
    check(
      'library_docks_auto_finalize_metadata_mode_chk',
      sql`${t.autoFinalizeMetadataMode} is null or ${t.autoFinalizeMetadataMode} in ('safe_merge', 'fetched_only', 'embedded_only')`,
    ),
  ],
);

export type LibraryDockRow = typeof libraryDocks.$inferSelect;
export type NewLibraryDockRow = typeof libraryDocks.$inferInsert;
