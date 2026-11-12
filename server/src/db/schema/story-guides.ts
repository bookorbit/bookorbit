import { bigint, check, index, integer, jsonb, pgTable, smallint, timestamp, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { bookFiles } from './books';

/** A story section as the text key covers it, for the guide's content check and the build's limits. */
export interface BookFileTextSection {
  /** Index in the reader's `book.sections`. */
  s: number;
  title: string | null;
  /** The section's raw text length, in UTF-16 code units. */
  chars: number;
  /** First 8 hex characters of the SHA-256 of the section's flattened text. */
  h: string;
  /** The story's range in the raw text. */
  start: number;
  end: number;
  words: number;
}

/**
 * What a book file's text is, read once per (size, mtime, extraction version) by the key job, so
 * status and builds never open the file. A metadata write-back changes the bytes and the row is
 * read again, but the text and so the key stay the same.
 */
export const bookFileTexts = pgTable(
  'book_file_texts',
  {
    fileId: integer('file_id')
      .primaryKey()
      .references(() => bookFiles.id, { onDelete: 'cascade' }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    mtime: timestamp('mtime', { withTimezone: true }),
    extractionVersion: smallint('extraction_version').notNull(),
    /** `ready`, `unreadable` or `too-large`. */
    outcome: varchar('outcome', { length: 16 }).notNull(),
    textKey: varchar('text_key', { length: 64 }),
    /** The key under the previous extraction version, while its guide moves to this one. */
    previousKey: varchar('previous_key', { length: 64 }),
    /** Two-letter code; null when the language was refused. */
    language: varchar('language', { length: 16 }),
    words: integer('words').notNull().default(0),
    sections: jsonb('sections').$type<BookFileTextSection[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('book_file_texts_text_key_idx').on(t.textKey),
    index('book_file_texts_extraction_version_idx').on(t.extractionVersion),
    check('book_file_texts_outcome_chk', sql`${t.outcome} in ('ready', 'unreadable', 'too-large')`),
    check('book_file_texts_ready_key_chk', sql`${t.outcome} <> 'ready' or ${t.textKey} is not null`),
  ],
);

export type BookFileTextRow = typeof bookFileTexts.$inferSelect;
export type NewBookFileTextRow = typeof bookFileTexts.$inferInsert;
