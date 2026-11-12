import { sql } from 'drizzle-orm';
import { bigserial, boolean, check, index, integer, jsonb, pgTable, primaryKey, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import type { StoryGuideFixTarget } from '@bookorbit/types';

import { users } from './auth';
import { timestamptz } from './columns';

/**
 * Fixes made to a story guide for everyone, keyed by the text they fix rather than a book file, so
 * every file with the same text shares them, and they outlive the guide they were made on: a later
 * build applies them again.
 */
export const storyGuideFixes = pgTable(
  'story_guide_fixes',
  {
    textKey: varchar('text_key', { length: 64 }).notNull(),
    // Client-generated, so a fix made offline keeps its identity across retries and devices.
    id: uuid('id').notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    target: jsonb('target').$type<StoryGuideFixTarget>().notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    fromSection: integer('from_section'),
    fromOffset: integer('from_offset'),
    // The client's time of the change, which decides between two writes to one id.
    clientUpdatedAt: timestamptz('client_updated_at').notNull(),
    // The client's time of the first write, which orders fixes for applying.
    madeAt: timestamptz('made_at').notNull(),
    deleted: boolean('deleted').notNull().default(false),
    // Drawn under the text's write lock, so a `since` cursor only ever moves forward.
    revision: bigserial('revision', { mode: 'number' }).notNull(),
    updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.textKey, t.id] }),
    index('story_guide_fixes_text_revision_idx').on(t.textKey, t.revision),
    index('story_guide_fixes_tombstone_idx')
      .on(t.updatedAt)
      .where(sql`${t.deleted}`),
    index('story_guide_fixes_updated_by_idx').on(t.updatedBy),
    check('story_guide_fixes_kind_not_empty_chk', sql`char_length(${t.kind}) >= 1`),
    check('story_guide_fixes_target_object_chk', sql`jsonb_typeof(${t.target}) = 'object'`),
    check('story_guide_fixes_data_object_chk', sql`jsonb_typeof(${t.data}) = 'object'`),
    check(
      'story_guide_fixes_from_chk',
      sql`(${t.fromSection} is null and ${t.fromOffset} is null) or (${t.fromSection} >= 0 and ${t.fromOffset} >= 0)`,
    ),
  ],
);

export type StoryGuideFixRow = typeof storyGuideFixes.$inferSelect;
export type NewStoryGuideFixRow = typeof storyGuideFixes.$inferInsert;
