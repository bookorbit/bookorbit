import { integer, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

export const libraries = pgTable('libraries', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  icon: varchar('icon', { length: 100 }),
  scanMode: varchar('scan_mode', { length: 20 }).notNull().default('auto'),
  pollInterval: integer('poll_interval_seconds').default(300),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const libraryFolders = pgTable('library_folders', {
  id: serial('id').primaryKey(),
  libraryId: integer('library_id')
    .notNull()
    .references(() => libraries.id, { onDelete: 'cascade' }),
  path: varchar('path', { length: 4096 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Library = typeof libraries.$inferSelect;
export type NewLibrary = typeof libraries.$inferInsert;

export type LibraryFolder = typeof libraryFolders.$inferSelect;
export type NewLibraryFolder = typeof libraryFolders.$inferInsert;
