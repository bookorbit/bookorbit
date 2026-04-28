import { sql } from 'drizzle-orm';
import { check, integer, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const userFonts = pgTable(
  'user_fonts',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyName: varchar('family_name', { length: 200 }).notNull(),
    originalFileName: varchar('original_file_name', { length: 500 }).notNull(),
    storedFileName: varchar('stored_file_name', { length: 500 }).notNull(),
    format: varchar('format', { length: 10 }).$type<'ttf' | 'otf' | 'woff' | 'woff2'>().notNull(),
    weight: integer('weight').notNull().default(400),
    style: varchar('style', { length: 10 }).$type<'normal' | 'italic'>().notNull().default('normal'),
    fileSize: integer('file_size').notNull(),
    fileHash: varchar('file_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uf_user_hash_uidx').on(t.userId, t.fileHash),
    uniqueIndex('uf_user_family_weight_style_uidx').on(t.userId, t.familyName, t.weight, t.style),
    check('user_fonts_format_chk', sql`${t.format} in ('ttf', 'otf', 'woff', 'woff2')`),
    check('user_fonts_weight_chk', sql`${t.weight} >= 100 and ${t.weight} <= 900 and ${t.weight} % 100 = 0`),
    check('user_fonts_style_chk', sql`${t.style} in ('normal', 'italic')`),
  ],
);

export type UserFontRow = typeof userFonts.$inferSelect;
export type NewUserFont = typeof userFonts.$inferInsert;
