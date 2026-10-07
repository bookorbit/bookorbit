import { Inject, Injectable } from '@nestjs/common';
import { type SQL, and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { BookJournalStatus } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookJournalEntries, type BookJournalEntryRow, type NewBookJournalEntry } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export type BookJournalEntryInsert = Omit<NewBookJournalEntry, 'id' | 'updatedAt' | 'deletedAt'>;
export type BookJournalEntryPatch = Partial<
  Pick<NewBookJournalEntry, 'body' | 'quote' | 'chapterTitle' | 'positionPercent' | 'cfi' | 'positionSeconds'>
>;

@Injectable()
export class BookJournalRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Oldest first, the order a journal is read in. */
  findByBook(userId: number, bookId: number, status: BookJournalStatus, limit: number): Promise<BookJournalEntryRow[]> {
    const trashed = status === 'trashed';
    return this.db
      .select()
      .from(bookJournalEntries)
      .where(
        and(
          eq(bookJournalEntries.userId, userId),
          eq(bookJournalEntries.bookId, bookId),
          trashed ? isNotNull(bookJournalEntries.deletedAt) : isNull(bookJournalEntries.deletedAt),
        ),
      )
      .orderBy(asc(bookJournalEntries.createdAt), asc(bookJournalEntries.id))
      .limit(limit);
  }

  /** Any state and any book: the client id is unique per user, not per book. */
  async findByClientId(userId: number, clientId: string): Promise<BookJournalEntryRow | null> {
    const [row] = await this.db
      .select()
      .from(bookJournalEntries)
      .where(and(eq(bookJournalEntries.userId, userId), eq(bookJournalEntries.clientId, clientId)))
      .limit(1);
    return row ?? null;
  }

  /** Returns null when the user already has an entry with this client id. */
  async insert(values: BookJournalEntryInsert): Promise<BookJournalEntryRow | null> {
    const [row] = await this.db
      .insert(bookJournalEntries)
      .values(values)
      .onConflictDoNothing({ target: [bookJournalEntries.userId, bookJournalEntries.clientId] })
      .returning();
    return row ?? null;
  }

  async findActive(userId: number, bookId: number, clientId: string): Promise<BookJournalEntryRow | null> {
    const [row] = await this.db
      .select()
      .from(bookJournalEntries)
      .where(and(...this.identity(userId, bookId, clientId), isNull(bookJournalEntries.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async updateActive(userId: number, bookId: number, clientId: string, patch: BookJournalEntryPatch): Promise<BookJournalEntryRow | null> {
    const [row] = await this.db
      .update(bookJournalEntries)
      .set(patch)
      .where(and(...this.identity(userId, bookId, clientId), isNull(bookJournalEntries.deletedAt)))
      .returning();
    return row ?? null;
  }

  /** `trashed` when this call moved it, `already_trashed` when it was in the trash before. */
  async trash(userId: number, bookId: number, clientId: string): Promise<'trashed' | 'already_trashed' | 'not_found'> {
    const moved = await this.db
      .update(bookJournalEntries)
      .set({ deletedAt: new Date() })
      .where(and(...this.identity(userId, bookId, clientId), isNull(bookJournalEntries.deletedAt)))
      .returning({ id: bookJournalEntries.id });
    if (moved.length > 0) return 'trashed';

    const [existing] = await this.db
      .select({ id: bookJournalEntries.id })
      .from(bookJournalEntries)
      .where(and(...this.identity(userId, bookId, clientId)))
      .limit(1);
    return existing ? 'already_trashed' : 'not_found';
  }

  async restore(userId: number, bookId: number, clientId: string): Promise<BookJournalEntryRow | null> {
    const [row] = await this.db
      .update(bookJournalEntries)
      .set({ deletedAt: null })
      .where(and(...this.identity(userId, bookId, clientId), isNotNull(bookJournalEntries.deletedAt)))
      .returning();
    return row ?? null;
  }

  /** Hard delete, only from the trash. */
  async purge(userId: number, bookId: number, clientId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(bookJournalEntries)
      .where(and(...this.identity(userId, bookId, clientId), isNotNull(bookJournalEntries.deletedAt)))
      .returning({ id: bookJournalEntries.id });
    return deleted.length > 0;
  }

  private identity(userId: number, bookId: number, clientId: string): SQL[] {
    return [eq(bookJournalEntries.userId, userId), eq(bookJournalEntries.bookId, bookId), eq(bookJournalEntries.clientId, clientId)];
  }
}
