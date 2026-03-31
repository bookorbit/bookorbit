import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class ReaderPreferencesRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findPreference(userId: number, bookFileId: number) {
    return this.db.query.readerPreferences.findFirst({
      where: and(eq(schema.readerPreferences.userId, userId), eq(schema.readerPreferences.bookFileId, bookFileId)),
    });
  }

  async upsertPreference(userId: number, bookFileId: number, settings: Record<string, unknown>) {
    const now = new Date();
    await this.db
      .insert(schema.readerPreferences)
      .values({ userId, bookFileId, settings, updatedAt: now })
      .onConflictDoUpdate({
        target: [schema.readerPreferences.userId, schema.readerPreferences.bookFileId],
        set: { settings, updatedAt: now },
      });
  }

  async deletePreference(userId: number, bookFileId: number) {
    await this.db
      .delete(schema.readerPreferences)
      .where(and(eq(schema.readerPreferences.userId, userId), eq(schema.readerPreferences.bookFileId, bookFileId)));
  }

  async findAllDefaults(userId: number) {
    return this.db.query.readerDefaultPreferences.findMany({
      where: eq(schema.readerDefaultPreferences.userId, userId),
    });
  }

  async upsertDefault(userId: number, formatGroup: string, settings: Record<string, unknown>) {
    const now = new Date();
    await this.db
      .insert(schema.readerDefaultPreferences)
      .values({ userId, formatGroup, settings, updatedAt: now })
      .onConflictDoUpdate({
        target: [schema.readerDefaultPreferences.userId, schema.readerDefaultPreferences.formatGroup],
        set: { settings, updatedAt: now },
      });
  }

  async deleteDefault(userId: number, formatGroup: string) {
    await this.db
      .delete(schema.readerDefaultPreferences)
      .where(and(eq(schema.readerDefaultPreferences.userId, userId), eq(schema.readerDefaultPreferences.formatGroup, formatGroup)));
  }
}
