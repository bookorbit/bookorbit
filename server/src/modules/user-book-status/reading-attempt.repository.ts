import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { and, asc, count, desc, eq, exists, gte, lt, lte, like, isNull, notExists, notInArray, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ReadingAttemptOrigin, ReadingAttemptOutcome, ReadStatus, ReadStatusSource } from '@bookorbit/types';

import { buildSessionIdPrefix } from '../../common/utils/koreader-session-id.utils';
import { minimumProgressAtThreshold } from '../../common/utils/progress-threshold.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { readingAttempts, readingSessions, userBookStatus, users } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
export type AttemptTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

type Tx = AttemptTransaction;

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

  bookTransaction<T>(userId: number, bookId: number, callback: (tx: Tx) => Promise<T>): Promise<T> {
    return this.transaction(async (tx) => {
      // There may be no active row to lock when progress and page stats both see a restart.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`reading-attempt:${userId}:${bookId}`}, 0))`);
      return callback(tx);
    });
  }

  async finishThreshold(tx: Tx, libraryId: number) {
    const [library] = await tx
      .select({ threshold: schema.libraries.markAsFinishedPercentComplete })
      .from(schema.libraries)
      .where(eq(schema.libraries.id, libraryId));
    return library!.threshold;
  }

  async precedingStatsOpening(tx: Tx, scope: { userId: number; bookId: number; bookFileId: number; deviceId: string }, from: Date, before: Date) {
    const { userId, bookId, bookFileId, deviceId } = scope;
    // A short first sitting stores too little activity to open an attempt on its own. Match its
    // first raw page to the actual derived session, excluding deleted sittings and device copies.
    const prior = tx
      .select({ startedAt: readingSessions.startedAt, attemptId: readingSessions.attemptId })
      .from(readingSessions)
      .where(
        and(
          eq(readingSessions.userId, userId),
          eq(readingSessions.bookId, bookId),
          eq(readingSessions.bookFileId, bookFileId),
          like(readingSessions.sessionId, buildSessionIdPrefix(deviceId, bookFileId) + '%'),
          gte(readingSessions.startedAt, from),
          lt(readingSessions.startedAt, before),
        ),
      )
      .orderBy(desc(readingSessions.startedAt))
      .limit(1)
      .as('previous_sitting');
    const page = schema.koreaderPageStats;
    const [opening] = await tx
      .select({ startedAt: prior.startedAt })
      .from(prior)
      .where(
        and(
          isNull(prior.attemptId),
          exists(
            tx
              .select({ id: page.id })
              .from(page)
              .where(
                and(
                  eq(page.userId, userId),
                  eq(page.bookFileId, bookFileId),
                  eq(page.deviceId, deviceId),
                  lte(page.page, 1),
                  eq(page.startTime, sql`extract(epoch from ${prior.startedAt})::bigint`),
                ),
              ),
          ),
        ),
      );
    return opening?.startedAt;
  }

  async findPendingStatsFinish(tx: Tx, userId: number, bookId: number, from: Date, threshold: number) {
    const [session] = await tx
      .select({ startedAt: readingSessions.startedAt, endedAt: readingSessions.endedAt, progressDelta: readingSessions.progressDelta })
      .from(readingSessions)
      .where(
        and(
          eq(readingSessions.userId, userId),
          eq(readingSessions.bookId, bookId),
          isNull(readingSessions.attemptId),
          eq(readingSessions.source, 'koreader'),
          like(readingSessions.sessionId, 'kor:%'),
          gte(readingSessions.startedAt, from),
          gte(readingSessions.endProgress, minimumProgressAtThreshold(threshold)),
        ),
      )
      .orderBy(asc(readingSessions.startedAt), asc(readingSessions.id))
      .limit(1);
    return session;
  }

  async attachPendingStats(tx: Tx, userId: number, bookId: number, attemptId: number, from: Date, through: Date) {
    await tx
      .update(readingSessions)
      .set({ attemptId })
      .where(
        and(
          eq(readingSessions.userId, userId),
          eq(readingSessions.bookId, bookId),
          isNull(readingSessions.attemptId),
          eq(readingSessions.source, 'koreader'),
          like(readingSessions.sessionId, 'kor:%'),
          gte(readingSessions.startedAt, from),
          lte(readingSessions.startedAt, through),
        ),
      );
  }

  async firstAttemptSession(tx: Tx, userId: number, bookId: number, attemptId: number) {
    const [first] = await tx
      .select({
        startedAt: readingSessions.startedAt,
        bookFileId: readingSessions.bookFileId,
        source: readingSessions.source,
        startProgress: sql<number | null>`${readingSessions.endProgress} - ${readingSessions.progressDelta}`,
      })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), eq(readingSessions.bookId, bookId), eq(readingSessions.attemptId, attemptId)))
      .orderBy(asc(readingSessions.startedAt), asc(readingSessions.id))
      .limit(1);
    return first;
  }

  async linkDatedStats(tx: Tx, userId: number, bookId: number, sessionIds: string[], timeZone: string) {
    // Only a unique date match owns an offline session. Two reads can share a calendar day.
    const result = await tx.execute(sql`
      with matches as (
        select s.id, min(a.id) as attempt_id from reading_sessions s
        join reading_attempts a on a.user_id = s.user_id and a.book_id = s.book_id and a.deleted_at is null
          and (a.started_on <= (s.started_at at time zone ${timeZone})::date or
            (a.started_on is null and (a.outcome is null or a.ended_on = (s.started_at at time zone ${timeZone})::date)))
          and (a.outcome is null or a.ended_on >= (s.ended_at at time zone ${timeZone})::date)
        where s.user_id = ${userId} and s.book_id = ${bookId} and s.attempt_id is null
          and s.session_id = any(${sql.param(sessionIds)}::text[])
        group by s.id having count(*) = 1
      )
      update reading_sessions s set attempt_id = matches.attempt_id from matches
      where s.id = matches.id and s.attempt_id is null`);
    return (result.rowCount ?? 0) > 0;
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

  /**
   * The read that ended, or began, most recently. An undated read stands for one before BookOrbit kept
   * history, such as the earlier read a reread implies, so it ranks behind every dated one. Taken by id,
   * that earlier read recorded at a reread outranked the read just finished, and its missing dates
   * replaced the book's started and finished dates.
   */
  async findLatest(tx: Tx, userId: number, bookId: number, excludeId?: number) {
    const [row] = await tx
      .select()
      .from(readingAttempts)
      .where(
        and(
          eq(readingAttempts.userId, userId),
          eq(readingAttempts.bookId, bookId),
          isNull(readingAttempts.deletedAt),
          excludeId !== undefined ? ne(readingAttempts.id, excludeId) : undefined,
        ),
      )
      .orderBy(sql`coalesce(${readingAttempts.endedOn}, ${readingAttempts.startedOn}) desc nulls last`, desc(readingAttempts.id))
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
          rating: readingAttempts.rating,
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

  async findOwned(userId: number, bookId: number, attemptId: number, tx?: Tx) {
    const query = (tx ?? this.db)
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
    const [row] = await (tx ? query.for('update') : query);
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
