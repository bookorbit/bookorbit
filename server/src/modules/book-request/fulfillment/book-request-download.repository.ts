import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES,
  IN_FLIGHT_BOOK_REQUEST_DOWNLOAD_STATUSES,
  UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES,
} from '@bookorbit/types';
import type { BookRequestDownloadStatus, IndexerColor } from '@bookorbit/types';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import {
  bookRequestDownloads,
  bookRequests,
  downloadClients,
  requestIndexers,
  type BookRequestDownloadRow,
  type NewBookRequestDownloadRow,
} from '../../../db/schema';

/** Newest first, and bounded: an attempt list is something a person reads, not a full history. */
const MAX_ATTEMPTS_PER_REQUEST = 20;

/** What the import heartbeat may touch: exactly the two statuses the watchdog ages by `updatedAt`. */
const IMPORT_HEARTBEAT_STATUSES: readonly BookRequestDownloadStatus[] = ['completed', 'importing'];

/**
 * How many live attempts one deleted account's requests are detached in one pass. Far past
 * anything a person accumulates; it is here so a pathological account cannot turn one deletion
 * into an unbounded run of client calls. Exported so the caller can say when it was reached
 * rather than reporting a truncated sweep as a complete one.
 */
export const MAX_DETACH_ON_OWNER_DELETE = 500;

type Db = NodePgDatabase<typeof schema>;

export interface BookRequestDownloadJoinedRow {
  download: BookRequestDownloadRow;
  downloadClientName: string | null;
  downloadClientColor: IndexerColor | null;
  /** Null once the indexer row is gone, or for a magnet somebody pasted by hand. */
  indexerName: string | null;
  indexerColor: IndexerColor | null;
}

@Injectable()
export class BookRequestDownloadRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(data: NewBookRequestDownloadRow): Promise<BookRequestDownloadRow> {
    const [row] = await this.db.insert(bookRequestDownloads).values(data).returning();
    return row;
  }

  async update(id: number, data: Partial<NewBookRequestDownloadRow>): Promise<BookRequestDownloadRow | undefined> {
    const [row] = await this.db.update(bookRequestDownloads).set(data).where(eq(bookRequestDownloads.id, id)).returning();
    return row;
  }

  /**
   * Says "these are still being worked on" without changing anything about them.
   *
   * Import concurrency is one, so a finished download can wait behind another for as long as that
   * one takes, and a running import writes nothing for the whole extraction. The watchdog ages a
   * `completed` or `importing` attempt by `updatedAt`, so with no heartbeat queue depth alone
   * fails a healthy import and a genuinely slow one is failed while it is still running.
   */
  async touch(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.db
      .update(bookRequestDownloads)
      .set({ updatedAt: new Date() })
      .where(and(inArray(bookRequestDownloads.id, ids), inArray(bookRequestDownloads.status, [...IMPORT_HEARTBEAT_STATUSES])))
      .returning({ id: bookRequestDownloads.id });
    return rows.length;
  }

  /**
   * `update`, refused unless the attempt is still in one of the statuses the caller decided
   * against. Everything that writes an attempt reads it first, and a client poll can take twenty
   * seconds to answer: without this, a stale poll returns a cancelled attempt to `downloading`
   * and, if the client had reported completion, carries a settled request into an import.
   */
  async updateIf(
    id: number,
    expected: readonly BookRequestDownloadStatus[],
    data: Partial<NewBookRequestDownloadRow>,
  ): Promise<BookRequestDownloadRow | undefined> {
    if (expected.length === 0) return undefined;
    const [row] = await this.db
      .update(bookRequestDownloads)
      .set(data)
      .where(and(eq(bookRequestDownloads.id, id), inArray(bookRequestDownloads.status, [...expected])))
      .returning();
    return row;
  }

  /**
   * Takes every attempt for one request that still has work behind it out of the active set, in
   * one statement.
   *
   * For the moment a person settles a request under a live transfer. An attempt left in flight is
   * one the poll loop keeps asking the client about and keeps writing progress back from, onto a
   * request that has already been decided.
   */
  async failInFlightForRequest(requestId: number, reason: string): Promise<number> {
    const rows = await this.db
      .update(bookRequestDownloads)
      .set({ status: 'failed', errorMessage: reason })
      .where(and(eq(bookRequestDownloads.requestId, requestId), inArray(bookRequestDownloads.status, [...IN_FLIGHT_BOOK_REQUEST_DOWNLOAD_STATUSES])))
      .returning({ id: bookRequestDownloads.id });
    return rows.length;
  }

  async findById(id: number): Promise<BookRequestDownloadRow | undefined> {
    const [row] = await this.db.select().from(bookRequestDownloads).where(eq(bookRequestDownloads.id, id)).limit(1);
    return row;
  }

  async findByBookDockFileId(fileId: number): Promise<BookRequestDownloadRow | undefined> {
    const [row] = await this.db
      .select()
      .from(bookRequestDownloads)
      .where(eq(bookRequestDownloads.bookDockFileId, fileId))
      .orderBy(desc(bookRequestDownloads.id))
      .limit(1);
    return row;
  }

  /**
   * Only what the poll loop can still report on, so a quiet instance makes no HTTP calls. A
   * direct file is ours whether or not a client row exists; a torrent whose client was deleted
   * is left to the watchdog, because nothing can be asked about it any more.
   */
  async findActive(): Promise<BookRequestDownloadRow[]> {
    return this.db
      .select()
      .from(bookRequestDownloads)
      .where(
        and(
          inArray(bookRequestDownloads.status, [...ACTIVE_BOOK_REQUEST_DOWNLOAD_STATUSES]),
          or(eq(bookRequestDownloads.source, 'direct_url'), isNotNull(bookRequestDownloads.downloadClientId)),
        ),
      );
  }

  /**
   * Finished downloads that never claimed a Book Dock row, which means the import never started.
   * Once a row has one, retrying would link the file a second time, so a crash after that point is
   * left to the watchdog rather than replayed.
   */
  async findCompletedAwaitingImport(): Promise<BookRequestDownloadRow[]> {
    return this.db
      .select()
      .from(bookRequestDownloads)
      .where(and(eq(bookRequestDownloads.status, 'completed'), isNull(bookRequestDownloads.bookDockFileId)));
  }

  /**
   * `basis` picks what "old" means. A stalled download is measured from the last time bytes
   * moved; a stuck import is measured from its last state change, because its `lastProgressAt`
   * belongs to the download that already finished and would make every import look ancient.
   */
  async findByStatusOlderThan(
    statuses: BookRequestDownloadStatus[],
    cutoff: Date,
    basis: 'progress' | 'state-change',
  ): Promise<BookRequestDownloadRow[]> {
    if (statuses.length === 0) return [];
    const age =
      basis === 'progress'
        ? sql`coalesce(${bookRequestDownloads.lastProgressAt}, ${bookRequestDownloads.grabbedAt}, ${bookRequestDownloads.createdAt})`
        : sql`${bookRequestDownloads.updatedAt}`;

    return this.db
      .select()
      .from(bookRequestDownloads)
      .where(and(inArray(bookRequestDownloads.status, statuses), lt(age, cutoff)));
  }

  /**
   * Attempts one download client is still working on, which is what makes deleting it unsafe.
   *
   * The FK nulls on delete, so a torrent whose client is removed stops being pollable, mappable
   * and removable in the same instant while the client goes on seeding it. Counting first is what
   * lets the operator be told that rather than discover it.
   */
  async countInFlightForClient(clientId: number): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(bookRequestDownloads)
      .where(
        and(eq(bookRequestDownloads.downloadClientId, clientId), inArray(bookRequestDownloads.status, [...IN_FLIGHT_BOOK_REQUEST_DOWNLOAD_STATUSES])),
      );
    return row?.total ?? 0;
  }

  /**
   * Live attempts behind the requests one person owns or fulfils, read before their account is
   * deleted. The cascade takes every tracking row with it, so this is the last moment anything
   * knows which torrents and staged files belong to work nobody will ever poll again.
   */
  async findInFlightForOwner(userId: number): Promise<BookRequestDownloadRow[]> {
    const rows = await this.db
      .select({ download: bookRequestDownloads })
      .from(bookRequestDownloads)
      .innerJoin(bookRequests, eq(bookRequests.id, bookRequestDownloads.requestId))
      .where(
        and(
          inArray(bookRequestDownloads.status, [...IN_FLIGHT_BOOK_REQUEST_DOWNLOAD_STATUSES]),
          or(eq(bookRequests.userId, userId), eq(bookRequests.fulfillerUserId, userId)),
        ),
      )
      .limit(MAX_DETACH_ON_OWNER_DELETE);
    return rows.map((row) => row.download);
  }

  /**
   * The staging directories something might still read: a transfer in flight, or finished bytes
   * an import or a held review has not finished with. Every other directory under the direct
   * download root is spent, which is what the bootstrap reap acts on.
   */
  async findLiveDirectHashes(): Promise<string[]> {
    const rows = await this.db
      .select({ clientHash: bookRequestDownloads.clientHash })
      .from(bookRequestDownloads)
      .where(
        and(
          eq(bookRequestDownloads.source, 'direct_url'),
          isNotNull(bookRequestDownloads.clientHash),
          inArray(bookRequestDownloads.status, [...UNSETTLED_BOOK_REQUEST_DOWNLOAD_STATUSES]),
        ),
      );
    return rows.map((row) => row.clientHash).filter((hash): hash is string => hash !== null);
  }

  /** How many times the automation has already tried this request, which is what bounds retries. */
  async countAutomatedForRequest(requestId: number): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(bookRequestDownloads)
      .where(and(eq(bookRequestDownloads.requestId, requestId), eq(bookRequestDownloads.automated, true)));
    return row?.count ?? 0;
  }

  /**
   * `indexerId:guid` for every release already handed to a client for this request, so a retry
   * picks the next one down rather than the one that just failed.
   */
  async findTriedReleaseKeys(requestId: number): Promise<Set<string>> {
    const rows = await this.db
      .select({ indexerId: bookRequestDownloads.indexerId, releaseGuid: bookRequestDownloads.releaseGuid })
      .from(bookRequestDownloads)
      .where(eq(bookRequestDownloads.requestId, requestId));

    const keys = new Set<string>();
    for (const row of rows) {
      // A hand-pasted magnet has neither, and there is nothing about it to match a release on.
      if (row.indexerId === null || row.releaseGuid === null) continue;
      keys.add(`${row.indexerId}:${row.releaseGuid}`);
    }
    return keys;
  }

  /**
   * The newest attempt per request, which is the one a card shows.
   *
   * The narrowing to one id per request happens in the database, not here. This runs on every list
   * render, and reading every attempt to keep the first of each would grow with the history behind
   * each row: automated retries are capped, but manual grabs and recorded refusals are not, so a
   * page of twenty requests could carry an unbounded number of rows across the wire to discard all
   * but twenty of them.
   */
  async findLatestForRequests(requestIds: number[]): Promise<Map<number, BookRequestDownloadJoinedRow>> {
    if (requestIds.length === 0) return new Map();

    const newest = this.db
      .selectDistinctOn([bookRequestDownloads.requestId], { id: bookRequestDownloads.id })
      .from(bookRequestDownloads)
      .where(inArray(bookRequestDownloads.requestId, requestIds))
      .orderBy(bookRequestDownloads.requestId, desc(bookRequestDownloads.id))
      .as('newest_attempt');

    const rows = await this.db
      .select({
        download: bookRequestDownloads,
        downloadClientName: downloadClients.name,
        downloadClientColor: downloadClients.color,
        indexerName: requestIndexers.name,
        indexerColor: requestIndexers.color,
      })
      .from(bookRequestDownloads)
      .innerJoin(newest, eq(newest.id, bookRequestDownloads.id))
      .leftJoin(downloadClients, eq(downloadClients.id, bookRequestDownloads.downloadClientId))
      .leftJoin(requestIndexers, eq(requestIndexers.id, bookRequestDownloads.indexerId));

    return new Map(rows.map((row) => [row.download.requestId, row]));
  }

  /**
   * Every attempt made for one request, newest first, refusals included.
   *
   * The refusals are the point: a request that ended up downloading from the second source says
   * nothing, on its own, about the first one having been asked and having said no.
   */
  async findForRequest(requestId: number): Promise<BookRequestDownloadJoinedRow[]> {
    return this.db
      .select({
        download: bookRequestDownloads,
        downloadClientName: downloadClients.name,
        downloadClientColor: downloadClients.color,
        indexerName: requestIndexers.name,
        indexerColor: requestIndexers.color,
      })
      .from(bookRequestDownloads)
      .leftJoin(downloadClients, eq(downloadClients.id, bookRequestDownloads.downloadClientId))
      .leftJoin(requestIndexers, eq(requestIndexers.id, bookRequestDownloads.indexerId))
      .where(eq(bookRequestDownloads.requestId, requestId))
      .orderBy(desc(bookRequestDownloads.id))
      .limit(MAX_ATTEMPTS_PER_REQUEST);
  }
}
