import { boolean, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { bookFiles, books } from './books';
import { users } from './auth';

export interface StaticVoice {
  id: string;
  name: string;
  shortName: string;
  language: string;
  locale: string;
  gender: string;
}

export const ttsProviders = pgTable('tts_providers', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  type: varchar('type', { length: 30 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  baseUrl: varchar('base_url', { length: 500 }),
  apiKey: varchar('api_key', { length: 500 }),
  defaultModel: varchar('default_model', { length: 100 }),
  staticVoices: jsonb('static_voices').$type<StaticVoice[]>(),
  supportsVoiceDiscovery: boolean('supports_voice_discovery').notNull().default(true),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
});

export type TtsProvider = typeof ttsProviders.$inferSelect;
export type NewTtsProvider = typeof ttsProviders.$inferInsert;

export const ttsUserPreferences = pgTable(
  'tts_user_preferences',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: integer('provider_id').references(() => ttsProviders.id, { onDelete: 'set null' }),
    voiceId: varchar('voice_id', { length: 200 }),
    speed: real('speed').notNull().default(1.0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex('tts_user_prefs_user_uidx').on(t.userId)],
);

export type TtsUserPreference = typeof ttsUserPreferences.$inferSelect;
export type NewTtsUserPreference = typeof ttsUserPreferences.$inferInsert;

export const ttsBookPreferences = pgTable(
  'tts_book_preferences',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    providerId: integer('provider_id').references(() => ttsProviders.id, { onDelete: 'set null' }),
    voiceId: varchar('voice_id', { length: 200 }),
    speed: real('speed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex('tts_book_prefs_user_book_uidx').on(t.userId, t.bookId)],
);

export type TtsBookPreference = typeof ttsBookPreferences.$inferSelect;
export type NewTtsBookPreference = typeof ttsBookPreferences.$inferInsert;

export const ttsReadingPosition = pgTable(
  'tts_reading_position',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookFileId: integer('book_file_id')
      .notNull()
      .references(() => bookFiles.id, { onDelete: 'cascade' }),
    cfi: text('cfi').notNull(),
    chapterIndex: integer('chapter_index'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex('tts_reading_pos_user_file_uidx').on(t.userId, t.bookFileId)],
);

export type TtsReadingPosition = typeof ttsReadingPosition.$inferSelect;
export type NewTtsReadingPosition = typeof ttsReadingPosition.$inferInsert;
