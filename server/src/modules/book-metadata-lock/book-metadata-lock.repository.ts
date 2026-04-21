import { Inject, Injectable } from '@nestjs/common';
import type { BookMetadataLockField } from '@bookorbit/types';
import { eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import { bookMetadata } from '../../db/schema';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class BookMetadataLockRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findLockedFields(bookId: number): Promise<string[]> {
    const [row] = await this.db
      .select({ lockedFields: bookMetadata.lockedFields })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);
    return row?.lockedFields ?? [];
  }

  async findLockedFieldsByBookIds(bookIds: number[]): Promise<Map<number, string[]>> {
    if (bookIds.length === 0) return new Map();
    const rows = await this.db
      .select({ bookId: bookMetadata.bookId, lockedFields: bookMetadata.lockedFields })
      .from(bookMetadata)
      .where(inArray(bookMetadata.bookId, bookIds));
    return new Map(rows.map((r) => [r.bookId, r.lockedFields ?? []]));
  }

  async replaceLockedFields(bookId: number, lockedFields: BookMetadataLockField[]): Promise<void> {
    const now = new Date();
    await this.db
      .insert(bookMetadata)
      .values({ bookId, lockedFields, updatedAt: now })
      .onConflictDoUpdate({ target: bookMetadata.bookId, set: { lockedFields, updatedAt: now } });
  }

  async bulkReplaceLockedFields(bookIds: number[], lockedFields: BookMetadataLockField[]): Promise<void> {
    if (bookIds.length === 0) return;
    const now = new Date();
    await this.db
      .insert(bookMetadata)
      .values(bookIds.map((bookId) => ({ bookId, lockedFields, updatedAt: now })))
      .onConflictDoUpdate({ target: bookMetadata.bookId, set: { lockedFields, updatedAt: now } });
  }
}
