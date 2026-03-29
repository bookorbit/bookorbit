import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { userBookStatus } from '../../db/schema';
import type { ReadStatus, ReadStatusSource } from '@projectx/types';

type Db = NodePgDatabase<typeof schema>;
const STARTED_FROM_ACTIVE_STATUSES: ReadStatus[] = ['reading', 'on_hold', 'rereading'];
const RESET_FINISHED_AT_STATUSES: ReadStatus[] = ['unread', 'want_to_read', 'reading', 'on_hold', 'rereading', 'skimmed'];

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

    const startedAt = row?.startedAt ?? (STARTED_FROM_ACTIVE_STATUSES.includes(status) ? now : null);
    const finishedAt = status === 'read' ? now : RESET_FINISHED_AT_STATUSES.includes(status) ? null : (row?.finishedAt ?? null);

    await this.db
      .insert(userBookStatus)
      .values({ userId, bookId, status, source, startedAt, finishedAt, updatedAt: now })
      .onConflictDoUpdate({
        target: [userBookStatus.userId, userBookStatus.bookId],
        set: { status, source, startedAt, finishedAt, updatedAt: now },
      });
  }
}
