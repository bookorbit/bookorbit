import { index, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { readingInsightsSharingLevelEnum, users } from './auth';

export const sharedReadingInsightViewSessions = pgTable(
  'shared_reading_insight_view_sessions',
  {
    id: uuid('id').primaryKey(),
    viewerUserId: integer('viewer_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subjectUserId: integer('subject_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sharingLevel: readingInsightsSharingLevelEnum('sharing_level').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('shared_insight_view_subject_created_idx').on(table.subjectUserId, table.createdAt),
    index('shared_insight_view_expires_idx').on(table.expiresAt),
  ],
);

export type SharedReadingInsightViewSession = typeof sharedReadingInsightViewSessions.$inferSelect;
