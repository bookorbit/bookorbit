import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import type { FontNamedInstance } from '@bookorbit/types';

import { users } from './auth';

/**
 * Columns describing a variable font's `wght` axis, null on a static face. `weight` still
 * records the default instance, so the per-family uniqueness rules are unaffected: a
 * variable file occupies exactly one weight/style slot like any other upload.
 */
const variableFontColumns = {
  weightMin: integer('weight_min'),
  weightMax: integer('weight_max'),
  instances: jsonb('instances').$type<FontNamedInstance[]>(),
};

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
    ...variableFontColumns,
    fileSize: integer('file_size').notNull(),
    fileHash: varchar('file_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('uf_user_hash_uidx').on(t.userId, t.fileHash),
    uniqueIndex('uf_user_family_weight_style_uidx').on(t.userId, t.familyName, t.weight, t.style),
    check('user_fonts_format_chk', sql`${t.format} in ('ttf', 'otf', 'woff', 'woff2')`),
    check('user_fonts_weight_chk', sql`${t.weight} >= 1 and ${t.weight} <= 1000`),
    check('user_fonts_style_chk', sql`${t.style} in ('normal', 'italic')`),
    check(
      'user_fonts_weight_range_chk',
      sql`(${t.weightMin} is null) = (${t.weightMax} is null) and (${t.weightMin} is null or (${t.weightMin} >= 1 and ${t.weightMax} <= 1000 and ${t.weightMin} < ${t.weightMax}))`,
    ),
  ],
);

export type UserFontRow = typeof userFonts.$inferSelect;
export type NewUserFont = typeof userFonts.$inferInsert;

/**
 * Administrator-curated fonts offered to every user of the web reader. Kept in its own
 * table rather than as a nullable-owner variant of `user_fonts` so the per-user unique
 * indexes stay strict and neither scope can constrain the other.
 */
export const serverFonts = pgTable(
  'server_fonts',
  {
    id: serial('id').primaryKey(),
    // Kept for auditing only. Nulled rather than cascaded so removing the administrator
    // who uploaded a font does not take the font away from everyone else.
    uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    familyName: varchar('family_name', { length: 200 }).notNull(),
    originalFileName: varchar('original_file_name', { length: 500 }).notNull(),
    storedFileName: varchar('stored_file_name', { length: 500 }).notNull(),
    format: varchar('format', { length: 10 }).$type<'ttf' | 'otf' | 'woff' | 'woff2'>().notNull(),
    weight: integer('weight').notNull().default(400),
    style: varchar('style', { length: 10 }).$type<'normal' | 'italic'>().notNull().default('normal'),
    ...variableFontColumns,
    fileSize: integer('file_size').notNull(),
    fileHash: varchar('file_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('sf_hash_uidx').on(t.fileHash),
    uniqueIndex('sf_family_weight_style_uidx').on(t.familyName, t.weight, t.style),
    check('server_fonts_format_chk', sql`${t.format} in ('ttf', 'otf', 'woff', 'woff2')`),
    check('server_fonts_weight_chk', sql`${t.weight} >= 1 and ${t.weight} <= 1000`),
    check('server_fonts_style_chk', sql`${t.style} in ('normal', 'italic')`),
    check(
      'server_fonts_weight_range_chk',
      sql`(${t.weightMin} is null) = (${t.weightMax} is null) and (${t.weightMin} is null or (${t.weightMin} >= 1 and ${t.weightMax} <= 1000 and ${t.weightMin} < ${t.weightMax}))`,
    ),
  ],
);

export type ServerFontRow = typeof serverFonts.$inferSelect;
export type NewServerFont = typeof serverFonts.$inferInsert;
