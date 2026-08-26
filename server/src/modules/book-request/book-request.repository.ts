import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, notExists, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ACTIVE_BOOK_REQUEST_STATUSES } from '@bookorbit/types';
import type {
  BookRequestMediaKind,
  BookRequestRequesterOption,
  BookRequestSortDirection,
  BookRequestSortField,
  BookRequestStatus,
} from '@bookorbit/types';

import { isUniqueViolation } from '../../common/utils/db-error.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  authors,
  bookAuthors,
  bookDockFiles,
  bookMetadata,
  bookRequestDedupeAliases,
  bookRequestDismissals,
  bookRequestDownloads,
  bookRequestSubscribers,
  bookRequests,
  books,
  libraries,
  libraryFolders,
  users,
  type BookRequestRow,
  type NewBookRequestRow,
} from '../../db/schema';

/**
 * What happened to a grab claim. `moved` is somebody else's decision landing first; `duplicate` is
 * another live request already holding the dedupe claim on the same work.
 */
export type GrabClaimOutcome = 'claimed' | 'moved' | 'duplicate';

type Db = NodePgDatabase<typeof schema>;
/** What the write helpers below need, so they take a transaction as readily as the pool. */
type RequestWriteExecutor = Pick<Db, 'insert'>;
type RequestReadExecutor = Pick<Db, 'select'>;

/**
 * A new `statusReason` clears the classified fields unless the caller supplies them, so a stale
 * code can never translate a failure that is no longer there.
 */
function withFailureFields(data: Partial<NewBookRequestRow>): Partial<NewBookRequestRow> {
  return 'statusReason' in data && !('failureCode' in data) ? { ...data, failureCode: null, failureMeta: null } : data;
}

/**
 * In-flight self-serve work one person is driving, which is what bounds their tracker traffic.
 *
 * Driving it, not having asked for it: a request somebody else claimed is their download to run,
 * and a request this person claimed counts against them even though the row names another
 * requester. An unclaimed self-serve row is driven by whoever created it.
 */
async function countLiveSelfServe(executor: RequestReadExecutor, userId: number): Promise<number> {
  const [row] = await executor
    .select({ total: count() })
    .from(bookRequests)
    .where(
      and(
        eq(bookRequests.selfServe, true),
        inArray(bookRequests.status, [...ACTIVE_BOOK_REQUEST_STATUSES]),
        or(eq(bookRequests.fulfillerUserId, userId), and(isNull(bookRequests.fulfillerUserId), eq(bookRequests.userId, userId))),
      ),
    );
  return row?.total ?? 0;
}

const REQUESTER_OPTION_LIMIT = 100;

/**
 * The two states an untouched self-serve row can be sitting in. Anything further along has a
 * download behind it, and anything settled is nobody's problem.
 */
const ABANDONABLE_SELF_SERVE_STATUSES: readonly BookRequestStatus[] = ['approved', 'searching'];

/**
 * An arbitrary but stable namespace for the per-user advisory lock the self-serve cap is counted
 * under, so it cannot collide with a lock any other feature takes on the same user id.
 */
const SELF_SERVE_CAP_LOCK_NAMESPACE = 248_001;

export interface ListRequestsOptions {
  page: number;
  limit: number;
  status?: BookRequestStatus;
  mediaKind?: BookRequestMediaKind;
  /** Exact original requester. Unlike userId, this does not include subscribers. */
  requesterUserId?: number;
  /** Restricts to requests this user owns or subscribes to. Omitted for the approver queue. */
  userId?: number;
  /** Drops the rows this user has hidden. Applies to the approver queue too: dismissal is personal. */
  excludeDismissedFor?: number;
  /** Narrows to self-served rows, or to the ones that went through approval. */
  selfServe?: boolean;
  sortBy?: BookRequestSortField;
  sortDir?: BookRequestSortDirection;
}

export interface BookRequestJoinedRow {
  request: BookRequestRow;
  requesterUsername: string;
  requesterName: string;
  decidedByUsername: string | null;
  targetLibraryName: string | null;
}

/** A book that shares a title with a search candidate, plus the authors that decide the match. */
export interface OwnedTitleMatch {
  bookId: number;
  authorNames: string[];
}

export interface OwnedMatchLookup {
  byIsbn13: Map<string, number>;
  byTitle: Map<string, OwnedTitleMatch[]>;
}

@Injectable()
export class BookRequestRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findAll(opts: ListRequestsOptions): Promise<{ items: BookRequestJoinedRow[]; total: number }> {
    const conditions: SQL[] = [];
    if (opts.status) conditions.push(eq(bookRequests.status, opts.status));
    if (opts.mediaKind) conditions.push(eq(bookRequests.mediaKind, opts.mediaKind));
    if (opts.requesterUserId !== undefined) conditions.push(eq(bookRequests.userId, opts.requesterUserId));
    if (opts.selfServe !== undefined) conditions.push(eq(bookRequests.selfServe, opts.selfServe));
    if (opts.userId !== undefined) {
      const subscribed = this.db
        .select({ id: bookRequestSubscribers.requestId })
        .from(bookRequestSubscribers)
        .where(eq(bookRequestSubscribers.userId, opts.userId));
      conditions.push(or(eq(bookRequests.userId, opts.userId), inArray(bookRequests.id, subscribed)) as SQL);
    }
    if (opts.excludeDismissedFor !== undefined) {
      const dismissed = this.db
        .select({ id: bookRequestDismissals.requestId })
        .from(bookRequestDismissals)
        .where(eq(bookRequestDismissals.userId, opts.excludeDismissedFor));
      conditions.push(notInArray(bookRequests.id, dismissed));
    }

    const where = conditions.length ? and(...conditions) : undefined;
    const direction = opts.sortDir === 'asc' ? asc : desc;
    const SORT_COLUMNS = {
      createdAt: bookRequests.createdAt,
      title: bookRequests.title,
      mediaKind: bookRequests.mediaKind,
      requester: users.name,
      status: bookRequests.status,
    } as const;
    // The id tie-break runs the same way as the sort, so a row cannot sit on both sides of a page
    // boundary when two requests share a title or a timestamp.
    const orderBy = [direction(SORT_COLUMNS[opts.sortBy ?? 'createdAt']), direction(bookRequests.id)];

    const [rows, [totals]] = await Promise.all([
      this.db
        .select({
          request: bookRequests,
          requesterUsername: users.username,
          requesterName: users.name,
          targetLibraryName: libraries.name,
        })
        .from(bookRequests)
        .innerJoin(users, eq(users.id, bookRequests.userId))
        .leftJoin(libraries, eq(libraries.id, bookRequests.targetLibraryId))
        .where(where)
        .orderBy(...orderBy)
        .limit(opts.limit)
        .offset((opts.page - 1) * opts.limit),
      this.db.select({ total: count() }).from(bookRequests).where(where),
    ]);

    const decidedByNames = await this.findUsernames(rows.map((r) => r.request.decidedByUserId));

    return {
      items: rows.map((row) => ({
        ...row,
        decidedByUsername: row.request.decidedByUserId != null ? (decidedByNames.get(row.request.decidedByUserId) ?? null) : null,
      })),
      total: totals?.total ?? 0,
    };
  }

  /**
   * Who the moderator filter can be pointed at, narrowed by a search rather than by luck.
   *
   * The limit stays: a select with every requester on an instance in it is not a control anybody
   * can use. What the search adds is that the limit bounds the *answer* rather than the question,
   * so somebody who sorts past the hundredth name is still reachable by typing it.
   */
  async findRequesterOptions(search: string | null): Promise<BookRequestRequesterOption[]> {
    const term = search?.trim();
    const pattern = term ? `%${term.replace(/[\\%_]/g, '\\$&')}%` : null;

    return this.db
      .selectDistinct({ userId: users.id, username: users.username, name: users.name })
      .from(bookRequests)
      .innerJoin(users, eq(users.id, bookRequests.userId))
      .where(pattern === null ? undefined : or(ilike(users.name, pattern), ilike(users.username, pattern)))
      .orderBy(asc(users.name), asc(users.username), asc(users.id))
      .limit(REQUESTER_OPTION_LIMIT);
  }

  async findById(id: number): Promise<BookRequestJoinedRow | undefined> {
    const [row] = await this.db
      .select({
        request: bookRequests,
        requesterUsername: users.username,
        requesterName: users.name,
        targetLibraryName: libraries.name,
      })
      .from(bookRequests)
      .innerJoin(users, eq(users.id, bookRequests.userId))
      .leftJoin(libraries, eq(libraries.id, bookRequests.targetLibraryId))
      .where(eq(bookRequests.id, id))
      .limit(1);

    if (!row) return undefined;

    const names = await this.findUsernames([row.request.decidedByUserId]);
    return {
      ...row,
      decidedByUsername: row.request.decidedByUserId != null ? (names.get(row.request.decidedByUserId) ?? null) : null,
    };
  }

  private async findUsernames(ids: Array<number | null>): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter((id): id is number => id != null))];
    if (unique.length === 0) return new Map();
    const rows = await this.db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, unique));
    return new Map(rows.map((r) => [r.id, r.username]));
  }

  /**
   * The aliases go in with the row rather than after it: a request that exists without them is one
   * the next requester will not collide with, and nothing would ever notice.
   */
  async create(data: NewBookRequestRow, aliasKeys: string[] = []): Promise<BookRequestRow> {
    return this.db.transaction(async (tx) => this.insertWithAliases(tx, data, aliasKeys));
  }

  /**
   * `create`, refused once the caller already has `maxLive` self-serve requests in flight.
   *
   * Counted inside the transaction and behind a per-user advisory lock, because counting and then
   * inserting is not a cap: two submissions for different works each see nine and each proceed,
   * and the limit an operator was promised turns out to be a suggestion. The lock is per user, so
   * two people submitting at the same time never wait on each other. Null means the cap refused.
   */
  async createWithinSelfServeCap(data: NewBookRequestRow, aliasKeys: string[], maxLive: number): Promise<BookRequestRow | null> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${SELF_SERVE_CAP_LOCK_NAMESPACE}, ${data.userId})`);
      if ((await countLiveSelfServe(tx, data.userId)) >= maxLive) return null;
      return this.insertWithAliases(tx, data, aliasKeys);
    });
  }

  private async insertWithAliases(tx: RequestWriteExecutor, data: NewBookRequestRow, aliasKeys: string[]): Promise<BookRequestRow> {
    const [row] = await tx.insert(bookRequests).values(data).returning();

    const keys = [...new Set(aliasKeys)].filter((key) => key !== row.dedupeKey);
    if (keys.length > 0) {
      await tx.insert(bookRequestDedupeAliases).values(keys.map((dedupeKey) => ({ requestId: row.id, dedupeKey })));
    }
    return row;
  }

  /**
   * Writing a new `statusReason` clears the classified fields unless the caller supplies them,
   * which is the invariant that keeps a stale code from translating a failure that is no longer
   * there. Enforced here rather than at each call site because most writers of `statusReason`
   * have never heard of a code and should not have to.
   */
  async update(id: number, data: Partial<NewBookRequestRow>): Promise<BookRequestRow | undefined> {
    const [row] = await this.db.update(bookRequests).set(withFailureFields(data)).where(eq(bookRequests.id, id)).returning();
    return row;
  }

  /**
   * `update`, refused unless the row is still in one of the statuses the caller decided against.
   *
   * Every lifecycle transition reads the request, decides, and writes, and the gap between the
   * read and the write is real: a moderator clicks while a twenty-second client poll is in flight,
   * two moderators click at once, an import spends minutes extracting an archive. An unconditional
   * write lets the later one land whether or not it was ever entitled to, so the loser's decision
   * is silently undone and both are told they succeeded. Returns undefined when the row moved on,
   * which is the caller's cue to refuse rather than to report success.
   */
  async updateIf(id: number, expected: readonly BookRequestStatus[], data: Partial<NewBookRequestRow>): Promise<BookRequestRow | undefined> {
    if (expected.length === 0) return undefined;
    const [row] = await this.db
      .update(bookRequests)
      .set(withFailureFields(data))
      .where(and(eq(bookRequests.id, id), inArray(bookRequests.status, [...expected])))
      .returning();
    return row;
  }

  /**
   * Moves a request out of the grabbable set atomically, so only the first of two concurrent
   * attempts proceeds. The duplicate-hash index already stops the same release twice; this is what
   * stops two *different* releases being started for one request.
   *
   * `duplicate` is the third outcome, and it is reachable through the documented retry path rather
   * than through any race: `failed` sits outside the partial unique index on an active dedupe key,
   * so once a request fails, the work can legitimately be requested again. Claiming the failed one
   * moves it back inside the index, where the new request is already sitting. Uncaught, the 23505
   * reached the approver as a 500 on the "try another release" button.
   */
  async claimForGrab(id: number, from: readonly BookRequestStatus[]): Promise<GrabClaimOutcome> {
    try {
      return (await this.updateIf(id, from, { status: 'grabbed' })) !== undefined ? 'claimed' : 'moved';
    } catch (error) {
      if (isUniqueViolation(error)) return 'duplicate';
      throw error;
    }
  }

  /** The live request holding a claim on this work, if any. */
  async findActiveByDedupeKey(dedupeKey: string): Promise<BookRequestRow | undefined> {
    const [row] = await this.db
      .select()
      .from(bookRequests)
      .where(and(eq(bookRequests.dedupeKey, dedupeKey), inArray(bookRequests.status, [...ACTIVE_BOOK_REQUEST_STATUSES])))
      .limit(1);
    return row;
  }

  /**
   * Batched form, so annotating a page of search results is one query. Takes every key shape a
   * candidate could hash to, not just its preferred one: the same work reached through two
   * providers can produce two different keys, and missing that is what turns one wanted book
   * into two grabs.
   */
  async findActiveByDedupeKeys(dedupeKeys: string[]): Promise<Map<string, BookRequestRow>> {
    if (dedupeKeys.length === 0) return new Map();

    const live = inArray(bookRequests.status, [...ACTIVE_BOOK_REQUEST_STATUSES]);
    const [direct, aliased] = await Promise.all([
      this.db
        .select()
        .from(bookRequests)
        .where(and(inArray(bookRequests.dedupeKey, dedupeKeys), live)),
      this.db
        .select({ key: bookRequestDedupeAliases.dedupeKey, request: bookRequests })
        .from(bookRequestDedupeAliases)
        .innerJoin(bookRequests, eq(bookRequests.id, bookRequestDedupeAliases.requestId))
        .where(and(inArray(bookRequestDedupeAliases.dedupeKey, dedupeKeys), live)),
    ]);

    // Keyed by the key that was *asked about*, not by the one the row was filed under, because the
    // caller probes its candidates in order of specificity and looks each one up by name.
    const matches = new Map<string, BookRequestRow>();
    // Aliases first, so a row found both ways is the one that owns the key rather than borrows it.
    for (const row of aliased) matches.set(row.key, row.request);
    for (const row of direct) matches.set(row.dedupeKey, row);
    return matches;
  }

  async addSubscriber(requestId: number, userId: number): Promise<void> {
    await this.db.insert(bookRequestSubscribers).values({ requestId, userId }).onConflictDoNothing();
  }

  /** True when a subscription was actually there to remove, so the caller can 404 on a stale one. */
  async removeSubscriber(requestId: number, userId: number): Promise<boolean> {
    const rows = await this.db
      .delete(bookRequestSubscribers)
      .where(and(eq(bookRequestSubscribers.requestId, requestId), eq(bookRequestSubscribers.userId, userId)))
      .returning({ userId: bookRequestSubscribers.userId });
    return rows.length > 0;
  }

  async isSubscriber(requestId: number, userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: bookRequestSubscribers.userId })
      .from(bookRequestSubscribers)
      .where(and(eq(bookRequestSubscribers.requestId, requestId), eq(bookRequestSubscribers.userId, userId)))
      .limit(1);
    return row !== undefined;
  }

  async findSubscribedRequestIds(userId: number, requestIds: number[]): Promise<Set<number>> {
    if (requestIds.length === 0) return new Set();
    const rows = await this.db
      .select({ requestId: bookRequestSubscribers.requestId })
      .from(bookRequestSubscribers)
      .where(and(eq(bookRequestSubscribers.userId, userId), inArray(bookRequestSubscribers.requestId, requestIds)));
    return new Set(rows.map((r) => r.requestId));
  }

  /**
   * Who may see each of these requests without managing all of them: the requester and everybody
   * subscribed. Moderators are deliberately absent - they reach every request, so listing them
   * per request would mean reading the whole permission table on every progress tick.
   *
   * One query for the batch, because the caller is the poll loop and asking per download would
   * add a round trip per active transfer per tick.
   */
  async findRequestViewerIds(requestIds: number[]): Promise<Map<number, number[]>> {
    if (requestIds.length === 0) return new Map();
    const [owners, subscribed] = await Promise.all([
      this.db.select({ requestId: bookRequests.id, userId: bookRequests.userId }).from(bookRequests).where(inArray(bookRequests.id, requestIds)),
      this.db
        .select({ requestId: bookRequestSubscribers.requestId, userId: bookRequestSubscribers.userId })
        .from(bookRequestSubscribers)
        .where(inArray(bookRequestSubscribers.requestId, requestIds)),
    ]);

    const map = new Map<number, number[]>();
    for (const row of [...owners, ...subscribed]) {
      const bucket = map.get(row.requestId);
      if (!bucket) map.set(row.requestId, [row.userId]);
      else if (!bucket.includes(row.userId)) bucket.push(row.userId);
    }
    return map;
  }

  async findSubscribers(requestIds: number[]): Promise<Map<number, Array<{ userId: number; username: string; name: string }>>> {
    if (requestIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        requestId: bookRequestSubscribers.requestId,
        userId: bookRequestSubscribers.userId,
        username: users.username,
        name: users.name,
      })
      .from(bookRequestSubscribers)
      .innerJoin(users, eq(users.id, bookRequestSubscribers.userId))
      .where(inArray(bookRequestSubscribers.requestId, requestIds));

    const map = new Map<number, Array<{ userId: number; username: string; name: string }>>();
    for (const row of rows) {
      const bucket = map.get(row.requestId) ?? [];
      bucket.push({ userId: row.userId, username: row.username, name: row.name });
      map.set(row.requestId, bucket);
    }
    return map;
  }

  async dismiss(requestId: number, userId: number): Promise<void> {
    await this.db.insert(bookRequestDismissals).values({ requestId, userId }).onConflictDoNothing();
  }

  /**
   * Hiding a request, refused unless it is still in one of the statuses the caller checked for.
   *
   * The guard lives in a transaction rather than in the insert because the two rows are in
   * different tables: locking the request for the length of the insert is what stops a retry
   * re-grabbing it in the gap and leaving live work hidden from the person driving it.
   */
  async dismissIf(requestId: number, userId: number, expected: readonly BookRequestStatus[]): Promise<boolean> {
    if (expected.length === 0) return false;
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select({ status: bookRequests.status }).from(bookRequests).where(eq(bookRequests.id, requestId)).for('update').limit(1);
      if (!row || !expected.includes(row.status as BookRequestStatus)) return false;
      await tx.insert(bookRequestDismissals).values({ requestId, userId }).onConflictDoNothing();
      return true;
    });
  }

  async restore(requestId: number, userId: number): Promise<void> {
    await this.db.delete(bookRequestDismissals).where(and(eq(bookRequestDismissals.requestId, requestId), eq(bookRequestDismissals.userId, userId)));
  }

  /** Batched, so a page of rows costs one query to annotate with the viewer's own dismissals. */
  async findDismissedRequestIds(userId: number, requestIds: number[]): Promise<Set<number>> {
    if (requestIds.length === 0) return new Set();
    const rows = await this.db
      .select({ requestId: bookRequestDismissals.requestId })
      .from(bookRequestDismissals)
      .where(and(eq(bookRequestDismissals.userId, userId), inArray(bookRequestDismissals.requestId, requestIds)));
    return new Set(rows.map((r) => r.requestId));
  }

  /** Everyone's, not one viewer's: a request coming back to life belongs on every list again. */
  async clearDismissals(requestId: number): Promise<void> {
    await this.db.delete(bookRequestDismissals).where(eq(bookRequestDismissals.requestId, requestId));
  }

  /**
   * Subscribers, dismissals and download attempts all cascade from the request row.
   *
   * `expected` is the same guard `updateIf` applies to a status change: deleting is a lifecycle
   * transition too, and a request re-grabbed between the caller's read and this delete must not
   * disappear from under the transfer it just started.
   */
  async remove(id: number, expected: readonly BookRequestStatus[]): Promise<boolean> {
    if (expected.length === 0) return false;
    const rows = await this.db
      .delete(bookRequests)
      .where(and(eq(bookRequests.id, id), inArray(bookRequests.status, [...expected])))
      .returning({ id: bookRequests.id });
    return rows.length > 0;
  }

  /** Requester plus every subscriber, for "it landed" notifications. */
  async findInterestedUserIds(requestId: number): Promise<number[]> {
    const [row] = await this.db.select({ userId: bookRequests.userId }).from(bookRequests).where(eq(bookRequests.id, requestId)).limit(1);
    if (!row) return [];
    const subs = await this.db
      .select({ userId: bookRequestSubscribers.userId })
      .from(bookRequestSubscribers)
      .where(eq(bookRequestSubscribers.requestId, requestId));
    return [...new Set([row.userId, ...subs.map((s) => s.userId)])];
  }

  /**
   * Self-serve rows nobody ever grabbed anything for: a search somebody opened and walked away
   * from. They matter because a live row holds the dedupe claim on its work, so an abandoned one
   * quietly subscribes the next person to ask for that book to a request nobody is driving.
   *
   * Bounded, because this runs on a timer and a backlog must not turn into one enormous sweep.
   */
  async findAbandonedSelfServe(olderThan: Date, limit: number): Promise<BookRequestRow[]> {
    const withAttempt = this.db
      .select({ id: bookRequestDownloads.requestId })
      .from(bookRequestDownloads)
      .where(eq(bookRequestDownloads.requestId, bookRequests.id));

    return this.db
      .select()
      .from(bookRequests)
      .where(
        and(
          eq(bookRequests.selfServe, true),
          inArray(bookRequests.status, [...ABANDONABLE_SELF_SERVE_STATUSES]),
          lt(bookRequests.createdAt, olderThan),
          notExists(withAttempt),
        ),
      )
      .orderBy(asc(bookRequests.createdAt))
      .limit(limit);
  }

  /**
   * Conditional, so a row somebody picked a release for between the sweep reading it and acting on
   * it is left alone rather than cancelled out from under them.
   */
  async cancelAbandoned(id: number, reason: string, code: string): Promise<boolean> {
    const rows = await this.db
      .update(bookRequests)
      .set({ status: 'cancelled', statusReason: reason, failureCode: code, decidedAt: new Date() })
      .where(and(eq(bookRequests.id, id), inArray(bookRequests.status, [...ABANDONABLE_SELF_SERVE_STATUSES])))
      .returning({ id: bookRequests.id });
    return rows.length > 0;
  }

  /**
   * Requests still sitting at `searching` that nothing is searching.
   *
   * `searching` is claimed by a fire-and-forget task that lives only in this process, so the
   * status outlives the work every time: the task dies with a restart, or throws somewhere its
   * own handler cannot reach. What is left keeps the dedupe claim on its work, which quietly
   * subscribes everybody who asks for that book next to a request nobody is driving.
   *
   * Bounded, because a backlog must not turn into one enormous sweep.
   */
  async findStrandedSearching(olderThan: Date, limit: number): Promise<BookRequestRow[]> {
    return this.db
      .select()
      .from(bookRequests)
      .where(and(eq(bookRequests.status, 'searching'), lt(bookRequests.updatedAt, olderThan)))
      .orderBy(asc(bookRequests.updatedAt))
      .limit(limit);
  }

  /**
   * Approved requests nothing has found a release for yet and that are due another look.
   *
   * Three conditions, and each one keeps a class of request out of the sweep rather than being
   * decided again per row afterwards. `approved` alone, so nothing in flight is disturbed and a
   * settled request is never reopened. A destination, because a grab refuses a request with
   * nowhere to file the book and re-declaring that every night would rewrite the same reason on a
   * row nobody is going to act on until a person edits it. And a cut-off, so a book that never
   * appears stops costing tracker traffic.
   *
   * The interval itself is per-row rather than one constant: it doubles for each week the request
   * has been waiting, capped, so a growing backlog of old requests does not become a growing
   * nightly load against every configured tracker. `updated_at` is the clock because a pass writes
   * the status twice, so a request that was searched at all has a fresh one.
   *
   * Bounded, and oldest first, so a backlog is worked off across ticks instead of in one sweep.
   */
  async findDueForResearch(
    baseIntervalHours: number,
    maxAgeDays: number,
    backoffCap: number,
    weekMs: number,
    limit: number,
  ): Promise<BookRequestRow[]> {
    return this.db
      .select()
      .from(bookRequests)
      .where(
        and(
          eq(bookRequests.status, 'approved'),
          sql`${bookRequests.targetLibraryId} is not null`,
          sql`${bookRequests.createdAt} > now() - make_interval(days => ${maxAgeDays})`,
          sql`now() - ${bookRequests.updatedAt} >= make_interval(hours => ${baseIntervalHours}) * least(
            ${backoffCap}::double precision,
            power(2, floor(extract(epoch from now() - ${bookRequests.createdAt}) * 1000 / ${weekMs}))
          )`,
        ),
      )
      .orderBy(asc(bookRequests.updatedAt))
      .limit(limit);
  }

  /**
   * Hands an undriven request to a self-fulfiller who asked for the same work.
   *
   * One live request per work, so their own submission cannot open a second row; without this
   * they are attached to somebody else's as a subscriber and then refused by every fulfilment
   * route, which is a dead end with no explanation on it. Approving it is the honest reading of
   * what they did: they asked for this book and said they would fetch it themselves.
   *
   * Conditional on the row still being unclaimed and still in a status nobody has acted on, and
   * capped under the same per-user advisory lock a fresh self-serve submission is, because a claim
   * is in-flight work for them exactly as an insert would have been. Null means it was refused.
   */
  async claimForSelfServe(
    id: number,
    fulfillerUserId: number,
    expected: readonly BookRequestStatus[],
    maxLive: number,
  ): Promise<BookRequestRow | null> {
    if (expected.length === 0) return null;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${SELF_SERVE_CAP_LOCK_NAMESPACE}, ${fulfillerUserId})`);
      if ((await countLiveSelfServe(tx, fulfillerUserId)) >= maxLive) return null;

      const [row] = await tx
        .update(bookRequests)
        .set({ selfServe: true, fulfillerUserId, status: 'approved', decidedByUserId: fulfillerUserId, decidedAt: new Date() })
        .where(
          and(
            eq(bookRequests.id, id),
            inArray(bookRequests.status, [...expected]),
            eq(bookRequests.selfServe, false),
            isNull(bookRequests.fulfillerUserId),
          ),
        )
        .returning();
      return row ?? null;
    });
  }

  async countByStatuses(statuses: readonly BookRequestStatus[], excludeDismissedFor?: number): Promise<number> {
    const conditions: SQL[] = [];
    if (statuses.length) conditions.push(inArray(bookRequests.status, statuses));
    if (excludeDismissedFor !== undefined) {
      const dismissed = this.db
        .select({ id: bookRequestDismissals.requestId })
        .from(bookRequestDismissals)
        .where(eq(bookRequestDismissals.userId, excludeDismissedFor));
      conditions.push(notInArray(bookRequests.id, dismissed));
    }
    const [row] = await this.db
      .select({ total: count() })
      .from(bookRequests)
      .where(conditions.length ? and(...conditions) : undefined);
    return row?.total ?? 0;
  }

  /** Owned or subscribed, so the summary count agrees with what `findAll` puts on the page. */
  async countForUser(userId: number, statuses: readonly BookRequestStatus[], excludeDismissed = false): Promise<number> {
    const subscribed = this.db
      .select({ id: bookRequestSubscribers.requestId })
      .from(bookRequestSubscribers)
      .where(eq(bookRequestSubscribers.userId, userId));

    const conditions: SQL[] = [or(eq(bookRequests.userId, userId), inArray(bookRequests.id, subscribed)) as SQL];
    if (statuses.length) conditions.push(inArray(bookRequests.status, statuses));
    if (excludeDismissed) {
      const dismissed = this.db
        .select({ id: bookRequestDismissals.requestId })
        .from(bookRequestDismissals)
        .where(eq(bookRequestDismissals.userId, userId));
      conditions.push(notInArray(bookRequests.id, dismissed));
    }
    const [row] = await this.db
      .select({ total: count() })
      .from(bookRequests)
      .where(and(...conditions));
    return row?.total ?? 0;
  }

  /**
   * "Do we already have this?" for a page of search candidates.
   *
   * Bounded by the candidate list, never by the library. ISBN13 rides `bm_isbn13_idx` and the
   * title probe uses `lower(title)` verbatim so it rides `bm_title_lower_idx` - normalizing any
   * harder than the index expression would turn this into a sequential scan over every book on
   * the instance.
   *
   * The title probe carries each match's authors back with it, because a title on its own is not
   * an identity: three different books called "It" would otherwise all read as owned.
   */
  async findOwnedMatches(isbn13s: string[], lowerTitles: string[], libraryIds: number[] | null): Promise<OwnedMatchLookup> {
    const byIsbn13 = new Map<string, number>();
    const byTitle = new Map<string, OwnedTitleMatch[]>();
    if (libraryIds !== null && libraryIds.length === 0) return { byIsbn13, byTitle };

    const scope = libraryIds !== null ? [inArray(books.libraryId, libraryIds)] : [];
    const present = eq(books.status, 'present');

    if (isbn13s.length) {
      const rows = await this.db
        .select({ bookId: books.id, isbn13: bookMetadata.isbn13 })
        .from(bookMetadata)
        .innerJoin(books, eq(books.id, bookMetadata.bookId))
        .where(and(inArray(bookMetadata.isbn13, isbn13s), present, ...scope));
      for (const row of rows) if (row.isbn13 && !byIsbn13.has(row.isbn13)) byIsbn13.set(row.isbn13, row.bookId);
    }

    if (lowerTitles.length) {
      const titleKey = sql<string>`lower(${bookMetadata.title})`;
      const rows = await this.db
        .select({ bookId: books.id, titleKey, authorName: authors.name })
        .from(bookMetadata)
        .innerJoin(books, eq(books.id, bookMetadata.bookId))
        .leftJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
        .leftJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(and(inArray(titleKey, lowerTitles), present, ...scope));

      const byBookId = new Map<number, OwnedTitleMatch>();
      for (const row of rows) {
        const bucket = byTitle.get(row.titleKey) ?? [];
        let match = byBookId.get(row.bookId);
        if (!match) {
          match = { bookId: row.bookId, authorNames: [] };
          byBookId.set(row.bookId, match);
          bucket.push(match);
          byTitle.set(row.titleKey, bucket);
        }
        if (row.authorName) match.authorNames.push(row.authorName);
      }
    }

    return { byIsbn13, byTitle };
  }

  /** Which library a filed book landed in, so a link to it can be offered only to who can open it. */
  async findBookLibraryId(bookId: number): Promise<number | null> {
    const [row] = await this.db.select({ libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);
    return row?.libraryId ?? null;
  }

  /**
   * Guards "mark fulfilled" against pointing a request at a book row that is not there, and
   * against pointing it at one the person closing the request could not otherwise open.
   *
   * `libraryIds` is null for somebody who reaches every library, and the empty array is a real
   * answer rather than a missing filter: a reader with access to nothing can name nothing.
   */
  async bookExists(bookId: number, libraryIds: number[] | null): Promise<boolean> {
    if (libraryIds !== null && libraryIds.length === 0) return false;
    const where = libraryIds === null ? eq(books.id, bookId) : and(eq(books.id, bookId), inArray(books.libraryId, libraryIds));
    const [row] = await this.db.select({ id: books.id }).from(books).where(where).limit(1);
    return row !== undefined;
  }

  /**
   * Same guard for the dock file: without it a stale id is a foreign key error, so a 500, and an
   * id belonging to somebody else is a reference the actor could never have opened.
   *
   * `uploaderId` is null for somebody who may manage every dock item; otherwise only their own
   * uploads count, which is the same rule the dock itself applies.
   */
  async bookDockFileExists(fileId: number, uploaderId: number | null): Promise<boolean> {
    const where = uploaderId === null ? eq(bookDockFiles.id, fileId) : and(eq(bookDockFiles.id, fileId), eq(bookDockFiles.uploadedBy, uploaderId));
    const [row] = await this.db.select({ id: bookDockFiles.id }).from(bookDockFiles).where(where).limit(1);
    return row !== undefined;
  }

  /**
   * Names for the libraries the instance defaults point at. One query for all three media rather
   * than one per medium, and the media usually share fewer libraries than there are of them.
   */
  async findLibraryNames(libraryIds: number[]): Promise<Map<number, string>> {
    if (libraryIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: libraries.id, name: libraries.name })
      .from(libraries)
      .where(inArray(libraries.id, [...new Set(libraryIds)]));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /**
   * The fallback destination when a request names a library but no folder. Finalize refuses to
   * resolve a destination without one, and the Book Dock's global default folder is usually unset
   * and belongs to a different library anyway.
   */
  async findFirstFolderId(libraryId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ id: libraryFolders.id })
      .from(libraryFolders)
      .where(eq(libraryFolders.libraryId, libraryId))
      .orderBy(libraryFolders.id)
      .limit(1);
    return row?.id ?? null;
  }

  /**
   * A folder from another library would carry the book into that library at finalize time, and
   * the foreign key cannot see the mismatch because both ids are individually valid.
   */
  async folderBelongsToLibrary(folderId: number, libraryId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: libraryFolders.id })
      .from(libraryFolders)
      .where(and(eq(libraryFolders.id, folderId), eq(libraryFolders.libraryId, libraryId)))
      .limit(1);
    return row !== undefined;
  }
}
