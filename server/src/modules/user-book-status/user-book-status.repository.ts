import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { userBookStatus } from '../../db/schema';
import type { ReadStatus, ReadStatusSource } from '@projectx/types';
import type { UserBookStatusRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export type UserBookStatusLifecycle = Pick<UserBookStatusRow, 'startedAt' | 'finishedAt'>;

export function deriveLifecycle(status: ReadStatus, now: Date, existing: UserBookStatusRow | null): UserBookStatusLifecycle {
  switch (status) {
    case 'unread':
    case 'want_to_read':
      return { startedAt: null, finishedAt: null };
    case 'reading':
    case 'on_hold':
    case 'rereading':
    case 'skimmed':
    case 'abandoned':
      return { startedAt: existing?.startedAt ?? now, finishedAt: null };
    case 'read':
      return { startedAt: existing?.startedAt ?? now, finishedAt: now };
  }
}

@Injectable()
export class UserBookStatusRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findOne(userId: number, bookId: number) {
    const [row] = await this.db
      .select()
      .from(userBookStatus)
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.bookId, bookId)))
      .limit(1);
    return row ?? null;
  }

  async findByBookIds(userId: number, bookIds: number[]) {
    if (bookIds.length === 0) return [];
    return this.db
      .select()
      .from(userBookStatus)
      .where(and(eq(userBookStatus.userId, userId), inArray(userBookStatus.bookId, bookIds)));
  }

  async upsert(
    userId: number,
    bookId: number,
    status: ReadStatus,
    source: ReadStatusSource,
    now: Date,
    existing?: Awaited<ReturnType<typeof this.findOne>>,
  ): Promise<void> {
    const row = existing !== undefined ? existing : await this.findOne(userId, bookId);
    const { startedAt, finishedAt } = deriveLifecycle(status, now, row);

    await this.db
      .insert(userBookStatus)
      .values({ userId, bookId, status, source, startedAt, finishedAt, updatedAt: now })
      .onConflictDoUpdate({
        target: [userBookStatus.userId, userBookStatus.bookId],
        set: { status, source, startedAt, finishedAt, updatedAt: now },
      });
  }
}
