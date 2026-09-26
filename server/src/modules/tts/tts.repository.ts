import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { ttsBookPreferences, ttsProviders, ttsReadingPosition, ttsUserPreferences } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class TtsRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---- Providers ----

  findAllProviders() {
    return this.db.select().from(ttsProviders).orderBy(ttsProviders.displayOrder, ttsProviders.id);
  }

  findEnabledProviders() {
    return this.db.select().from(ttsProviders).where(eq(ttsProviders.enabled, true)).orderBy(ttsProviders.displayOrder, ttsProviders.id);
  }

  findProviderById(id: number) {
    return this.db.query.ttsProviders.findFirst({ where: eq(ttsProviders.id, id) });
  }

  async insertProvider(data: schema.NewTtsProvider) {
    const [row] = await this.db.insert(ttsProviders).values(data).returning();
    return row!;
  }

  async updateProvider(id: number, data: Partial<schema.NewTtsProvider>) {
    const [row] = await this.db.update(ttsProviders).set(data).where(eq(ttsProviders.id, id)).returning();
    return row ?? null;
  }

  async deleteProvider(id: number) {
    await this.db.delete(ttsProviders).where(eq(ttsProviders.id, id));
  }

  /** Applied in one transaction so a partial write cannot leave two providers claiming one slot. */
  async updateProviderOrder(entries: Array<{ id: number; displayOrder: number }>) {
    if (entries.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const entry of entries) {
        await tx.update(ttsProviders).set({ displayOrder: entry.displayOrder }).where(eq(ttsProviders.id, entry.id));
      }
    });
  }

  // ---- User preferences ----

  findUserPreferences(userId: number) {
    return this.db.query.ttsUserPreferences.findFirst({ where: eq(ttsUserPreferences.userId, userId) });
  }

  async upsertUserPreferences(userId: number, data: Partial<schema.NewTtsUserPreference>) {
    const [row] = await this.db
      .insert(ttsUserPreferences)
      .values({ userId, ...data })
      .onConflictDoUpdate({
        target: ttsUserPreferences.userId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async deleteUserPreferences(userId: number) {
    await this.db.delete(ttsUserPreferences).where(eq(ttsUserPreferences.userId, userId));
  }

  // ---- Book preferences ----

  findBookPreferences(userId: number, bookId: number) {
    return this.db.query.ttsBookPreferences.findFirst({
      where: and(eq(ttsBookPreferences.userId, userId), eq(ttsBookPreferences.bookId, bookId)),
    });
  }

  findAllBookPreferences(userId: number) {
    return this.db.select().from(ttsBookPreferences).where(eq(ttsBookPreferences.userId, userId));
  }

  async upsertBookPreferences(userId: number, bookId: number, data: Partial<schema.NewTtsBookPreference>) {
    const [row] = await this.db
      .insert(ttsBookPreferences)
      .values({ userId, bookId, ...data })
      .onConflictDoUpdate({
        target: [ttsBookPreferences.userId, ttsBookPreferences.bookId],
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async deleteBookPreferences(userId: number, bookId: number) {
    await this.db.delete(ttsBookPreferences).where(and(eq(ttsBookPreferences.userId, userId), eq(ttsBookPreferences.bookId, bookId)));
  }

  // ---- TTS reading position ----

  findPosition(userId: number, bookFileId: number) {
    return this.db.query.ttsReadingPosition.findFirst({
      where: and(eq(ttsReadingPosition.userId, userId), eq(ttsReadingPosition.bookFileId, bookFileId)),
    });
  }

  async upsertPosition(userId: number, bookFileId: number, cfi: string, chapterIndex: number | null) {
    const [row] = await this.db
      .insert(ttsReadingPosition)
      .values({ userId, bookFileId, cfi, chapterIndex: chapterIndex ?? null })
      .onConflictDoUpdate({
        target: [ttsReadingPosition.userId, ttsReadingPosition.bookFileId],
        set: { cfi, chapterIndex: chapterIndex ?? null, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async deletePosition(userId: number, bookFileId: number) {
    await this.db.delete(ttsReadingPosition).where(and(eq(ttsReadingPosition.userId, userId), eq(ttsReadingPosition.bookFileId, bookFileId)));
  }
}
