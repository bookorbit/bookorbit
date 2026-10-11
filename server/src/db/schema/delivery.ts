import { index, integer, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { DeliveryArtifactMetadata } from '@bookorbit/types';
import { users } from './auth';
import { bookFiles } from './books';

export const deliveryArtifacts = pgTable(
  'delivery_artifacts',
  {
    selectionId: varchar('selection_id', { length: 64 }).primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookFileId: integer('book_file_id')
      .notNull()
      .references(() => bookFiles.id, { onDelete: 'cascade' }),
    scope: varchar('scope', { length: 128 }).notNull(),
    metadata: jsonb('metadata').$type<DeliveryArtifactMetadata>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('delivery_artifacts_owner_file_idx').on(table.userId, table.bookFileId)],
);

export const deliveryInspections = pgTable('delivery_inspections', {
  bookFileId: integer('book_file_id')
    .primaryKey()
    .references(() => bookFiles.id, { onDelete: 'cascade' }),
  sourceRevision: varchar('source_revision', { length: 64 }).notNull(),
  detectorVersion: varchar('detector_version', { length: 40 }).notNull(),
  state: varchar('state', { length: 24 }).$type<'verified_absent' | 'verified_present' | 'failed'>().notNull(),
  retryAt: timestamp('retry_at', { withTimezone: true }),
  checkedAt: timestamp('checked_at', { withTimezone: true }).defaultNow().notNull(),
});
