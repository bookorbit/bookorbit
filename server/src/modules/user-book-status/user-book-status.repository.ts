import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, max, min } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { readingSessions, userBookStatus } from '../../db/schema';
import type { ReadStatus, ReadStatusSource } from '@bookorbit/types';
import type { UserBookStatusRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export type UserBookStatusLifecycle = Pick<UserBookStatusRow, 'startedAt' | 'finishedAt'>;
export type UserBookStatusState = Pick<UserBookStatusRow, 'status' | 'source' | 'startedAt' | 'finishedAt' | 'updatedAt'>;

export interface SessionBoundaries {
  firstStartedAt: Date | null;
  lastEndedAt: Date | null;
}

export function deriveLifecycle(
  status: ReadStatus,
  now: Date,
  existing: UserBookStatusRow | null,
  sessionBoundaries?: SessionBoundaries,
): UserBookStatusLifecycle {
  switch (status) {
    case 'unread':
    case 'want_to_read':
      return { startedAt: null, finishedAt: null };
    case 'reading':
    case 'on_hold':
    case 'rereading':
    case 'skimmed':
    case 'abandoned':
      return { startedAt: existing?.startedAt ?? sessionBoundaries?.firstStartedAt ?? now, finishedAt: null };
    case 'read':
      return { startedAt: existing?.startedAt ?? sessionBoundaries?.firstStartedAt ?? now, finishedAt: now };
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

  async findSessionBoundariesForBook(userId: number, bookId: number): Promise<SessionBoundaries> {
    const [row] = await this.db
      .select({
        firstStartedAt: min(readingSessions.startedAt),
        lastEndedAt: max(readingSessions.endedAt),
      })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), eq(readingSessions.bookId, bookId)));

    return {
      firstStartedAt: (row?.firstStartedAt as Date | null | undefined) ?? null,
      lastEndedAt: (row?.lastEndedAt as Date | null | undefined) ?? null,
    };
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

    const needsSessionBoundaries = status !== 'unread' && status !== 'want_to_read' && row?.startedAt == null;
    const sessionBoundaries = needsSessionBoundaries ? await this.findSessionBoundariesForBook(userId, bookId) : undefined;

    const { startedAt, finishedAt } = deriveLifecycle(status, now, row, sessionBoundaries);

    await this.db
      .insert(userBookStatus)
      .values({ userId, bookId, status, source, startedAt, finishedAt, updatedAt: now })
      .onConflictDoUpdate({
        target: [userBookStatus.userId, userBookStatus.bookId],
        set: { status, source, startedAt, finishedAt, updatedAt: now },
      });
  }

  async upsertState(userId: number, bookId: number, state: UserBookStatusState): Promise<void> {
    await this.db
      .insert(userBookStatus)
      .values({
        userId,
        bookId,
        status: state.status,
        source: state.source,
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
        updatedAt: state.updatedAt,
      })
      .onConflictDoUpdate({
        target: [userBookStatus.userId, userBookStatus.bookId],
        set: {
          status: state.status,
          source: state.source,
          startedAt: state.startedAt,
          finishedAt: state.finishedAt,
          updatedAt: state.updatedAt,
        },
      });
  }
}
