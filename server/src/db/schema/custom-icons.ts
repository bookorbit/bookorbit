import { sql } from 'drizzle-orm';
import { check, integer, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { CUSTOM_ICON_NAME_MAX_LENGTH, CUSTOM_ICON_SLUG_MAX_LENGTH } from '@bookorbit/types';

export const customIcons = pgTable(
  'custom_icons',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: CUSTOM_ICON_SLUG_MAX_LENGTH }).notNull(),
    name: varchar('name', { length: CUSTOM_ICON_NAME_MAX_LENGTH }).notNull(),
    originalFileName: varchar('original_file_name', { length: 255 }).notNull(),
    storedFileName: varchar('stored_file_name', { length: 255 }).notNull(),
    fileSize: integer('file_size').notNull(),
    fileHash: varchar('file_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('custom_icons_slug_uidx').on(t.slug),
    check('custom_icons_slug_chk', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' or ${t.slug} ~ '^[a-z0-9]$'`),
    check('custom_icons_file_size_positive_chk', sql`${t.fileSize} > 0`),
  ],
);

export type CustomIconRow = typeof customIcons.$inferSelect;
export type NewCustomIcon = typeof customIcons.$inferInsert;
