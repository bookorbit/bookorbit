import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { and, asc, count, desc, eq, isNull, notExists, notInArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ReadingAttemptOrigin, ReadingAttemptOutcome, ReadStatus, ReadStatusSource } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { readingAttempts, readingSessions, userBookStatus, users } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type AttemptMutation = {
  startedOn?: string | null;
  endedOn?: string | null;
  outcome?: ReadingAttemptOutcome | null;
};

export type AttemptProjection = {
  status: ReadStatus;
  source: ReadStatusSource;
  startedAt: Date | null;
  finishedAt: Date | null;
};

@Injectable()
export class ReadingAttemptRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  transaction<T>(callback: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(callback);
  }

  findLegacyBackfillCandidates(limit: number) {
    return this.db
      .select({
        userId: userBookStatus.userId,
        bookId: userBookStatus.bookId,
        status: userBookStatus.status,
        startedAt: userBookStatus.startedAt,
        finishedAt: userBookStatus.finishedAt,
        settings: users.settings,
      })
      .from(userBookStatus)
      .innerJoin(users, eq(users.id, userBookStatus.userId))
      .where(
        and(
          notInArray(userBookStatus.status, ['unread', 'want_to_read']),
          notExists(
            this.db
              .select({ id: readingAttempts.id })
              .from(readingAttempts)
              .where(
                and(
                  eq(readingAttempts.userId, userBookStatus.userId),
                  eq(readingAttempts.bookId, userBookStatus.bookId),
                  isNull(readingAttempts.deletedAt),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(userBookStatus.userId), asc(userBookStatus.bookId))
      .limit(limit);
  }

  async attachBackfilledSessions(
    tx: Tx,
    userId: number,
    bookId: number,
    attemptId: number,
    timezone: string,
    startedOn: string | null,
    endedOn: string | null,
  ): Promise<void> {
    const boundaries = [eq(readingSessions.userId, userId), eq(readingSessions.bookId, bookId), isNull(readingSessions.attemptId)];
    if (startedOn) boundaries.push(sql`(${readingSessions.startedAt} at time zone ${timezone})::date >= ${startedOn}::date`);
    if (endedOn) boundaries.push(sql`(${readingSessions.startedAt} at time zone ${timezone})::date <= ${endedOn}::date`);
    await tx
      .update(readingSessions)
      .set({ attemptId })
      .where(and(...boundaries));
  }

  async findActive(tx: Tx, userId: number, bookId: number) {
    const [row] = await tx
      .select()
      .from(readingAttempts)
      .where(
        and(
          eq(readingAttempts.userId, userId),
          eq(readingAttempts.bookId, bookId),
          isNull(readingAttempts.outcome),
          isNull(readingAttempts.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    return row ?? null;
  }

  async findLatest(tx: Tx, userId: number, bookId: number) {
    const [row] = await tx
      .select()
      .from(readingAttempts)
      .where(and(eq(readingAttempts.userId, userId), eq(readingAttempts.bookId, bookId), isNull(readingAttempts.deletedAt)))
      .orderBy(desc(readingAttempts.id))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  async hasCompleted(tx: Tx, userId: number, bookId: number): Promise<boolean> {
    const [row] = await tx
      .select({ value: sql<boolean>`true` })
      .from(readingAttempts)
      .where(
        and(
          eq(readingAttempts.userId, userId),
          eq(readingAttempts.bookId, bookId),
          eq(readingAttempts.outcome, 'completed'),
          isNull(readingAttempts.deletedAt),
        ),
      )
      .limit(1);
    return row?.value === true;
  }

  async create(
    tx: Tx,
    values: {
      userId: number;
      bookId: number;
      startedOn: string | null;
      endedOn: string | null;
      outcome: ReadingAttemptOutcome | null;
      origin: ReadingAttemptOrigin;
      externalProvider?: string | null;
      externalId?: string | null;
    },
  ) {
    const [row] = await tx.insert(readingAttempts).values(values).returning();
    return row;
  }

  async createActive(
    tx: Tx,
    values: {
      userId: number;
      bookId: number;
      startedOn: string | null;
      origin: ReadingAttemptOrigin;
      externalProvider?: string | null;
      externalId?: string | null;
    },
  ) {
    const [inserted] = await tx
      .insert(readingAttempts)
      .values({ ...values, endedOn: null, outcome: null })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted;
    const active = await this.findActive(tx, values.userId, values.bookId);
    if (!active) throw new InternalServerErrorException('Active reading attempt conflict did not resolve');
    return active;
  }

  async update(tx: Tx, userId: number, bookId: number, attemptId: number, patch: AttemptMutation) {
    const [row] = await tx
      .update(readingAttempts)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(readingAttempts.id, attemptId),
          eq(readingAttempts.userId, userId),
          eq(readingAttempts.bookId, bookId),
          isNull(readingAttempts.deletedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  async project(tx: Tx, userId: number, bookId: number, projection: AttemptProjection): Promise<void> {
    const now = new Date();
    await tx
      .insert(userBookStatus)
      .values({ userId, bookId, ...projection, updatedAt: now })
      .onConflictDoUpdate({
        target: [userBookStatus.userId, userBookStatus.bookId],
        set: { ...projection, updatedAt: now },
      });
  }

  async findStatus(tx: Tx, userId: number, bookId: number) {
    const [row] = await tx
      .select()
      .from(userBookStatus)
      .where(and(eq(userBookStatus.userId, userId), eq(userBookStatus.bookId, bookId)))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  async list(userId: number, bookId: number, page: number, pageSize: number) {
    const where = and(eq(readingAttempts.userId, userId), eq(readingAttempts.bookId, bookId), isNull(readingAttempts.deletedAt));
    const offset = (page - 1) * pageSize;
    const [items, totals] = await Promise.all([
      this.db
        .select({
          id: readingAttempts.id,
          bookId: readingAttempts.bookId,
          startedOn: readingAttempts.startedOn,
          endedOn: readingAttempts.endedOn,
          outcome: readingAttempts.outcome,
          origin: readingAttempts.origin,
          externalProvider: readingAttempts.externalProvider,
          externalId: readingAttempts.externalId,
          totalSessions: sql<number>`count(${readingSessions.id})::int`,
          totalSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}), 0)::int`,
          createdAt: readingAttempts.createdAt,
          updatedAt: readingAttempts.updatedAt,
        })
        .from(readingAttempts)
        .leftJoin(readingSessions, eq(readingSessions.attemptId, readingAttempts.id))
        .where(where)
        .groupBy(readingAttempts.id)
        .orderBy(desc(readingAttempts.id))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ total: count() }).from(readingAttempts).where(where),
    ]);
    return { items, total: totals[0]?.total ?? 0 };
  }

  async findOwned(userId: number, bookId: number, attemptId: number) {
    const [row] = await this.db
      .select()
      .from(readingAttempts)
      .where(
        and(
          eq(readingAttempts.id, attemptId),
          eq(readingAttempts.userId, userId),
          eq(readingAttempts.bookId, bookId),
          isNull(readingAttempts.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findByExternal(tx: Tx, userId: number, provider: string, externalId: string) {
    const [row] = await tx
      .select()
      .from(readingAttempts)
      .where(and(eq(readingAttempts.userId, userId), eq(readingAttempts.externalProvider, provider), eq(readingAttempts.externalId, externalId)))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  async softDelete(userId: number, bookId: number, attemptId: number): Promise<boolean> {
    const rows = await this.db
      .update(readingAttempts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(readingAttempts.id, attemptId),
          eq(readingAttempts.userId, userId),
          eq(readingAttempts.bookId, bookId),
          isNull(readingAttempts.deletedAt),
        ),
      )
      .returning({ id: readingAttempts.id });
    return rows.length > 0;
  }

  async attachUnassignedSessions(userId: number, bookId: number, attemptId: number, startedAt: Date, endedAt?: Date): Promise<void> {
    const predicates = [
      eq(readingSessions.userId, userId),
      eq(readingSessions.bookId, bookId),
      isNull(readingSessions.attemptId),
      sql`${readingSessions.startedAt} >= ${startedAt}`,
    ];
    if (endedAt) predicates.push(sql`${readingSessions.startedAt} <= ${endedAt}`);
    await this.db
      .update(readingSessions)
      .set({ attemptId })
      .where(and(...predicates));
  }
}
