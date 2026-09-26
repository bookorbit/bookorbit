import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, countDistinct, desc, eq, inArray, isNotNull, isNull, lt, lte, max, or, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { podcastEpisodeMedia, podcastEpisodes, podcastJobs, podcasts } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type PodcastJobInsert = Omit<typeof podcastJobs.$inferInsert, 'status'>;

@Injectable()
export class PodcastJobRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async enqueue(values: PodcastJobInsert): Promise<number | null> {
    const [row] = await this.db
      .insert(podcastJobs)
      .values({ ...values, status: 'queued' })
      .onConflictDoNothing()
      .returning({ id: podcastJobs.id });
    return row?.id ?? null;
  }

  async enqueueDestructive(values: PodcastJobInsert, podcastIds: number[]): Promise<number | null> {
    const lockedPodcastIds = [...new Set(podcastIds)].sort((left, right) => left - right);
    return this.db.transaction(async (tx) => {
      for (const podcastId of lockedPodcastIds) {
        await tx.execute(sql`select pg_advisory_xact_lock(1886350957, ${podcastId})`);
      }
      const [active] = await tx
        .select({ id: podcastJobs.id })
        .from(podcastJobs)
        .where(
          and(
            inArray(podcastJobs.type, ['purge', 'merge']),
            sql`${podcastJobs.status} in ('queued', 'processing')`,
            or(
              inArray(podcastJobs.podcastId, lockedPodcastIds),
              inArray(sql<number>`(${podcastJobs.payload}->>'sourcePodcastId')::int`, lockedPodcastIds),
            ),
          ),
        )
        .limit(1);
      if (active) return null;
      const [row] = await tx
        .insert(podcastJobs)
        .values({ ...values, status: 'queued' })
        .onConflictDoNothing()
        .returning({ id: podcastJobs.id });
      return row?.id ?? null;
    });
  }

  async enqueueMany(values: PodcastJobInsert[]): Promise<Array<{ id: number; episodeId: number | null }>> {
    const inserted: Array<{ id: number; episodeId: number | null }> = [];
    for (let offset = 0; offset < values.length; offset += 250) {
      const chunk = values.slice(offset, offset + 250);
      if (chunk.length === 0) continue;
      const rows = await this.db
        .insert(podcastJobs)
        .values(chunk.map((value) => ({ ...value, status: 'queued' })))
        .onConflictDoNothing()
        .returning({ id: podcastJobs.id, episodeId: podcastJobs.episodeId });
      inserted.push(...rows);
    }
    return inserted;
  }

  async claimNext(types?: readonly string[], leaseMs = 5 * 60_000) {
    if (types?.length === 0) return null;
    for (;;) {
      const [candidate] = await this.db
        .select()
        .from(podcastJobs)
        .where(
          and(
            eq(podcastJobs.status, 'queued'),
            lte(podcastJobs.nextAttemptAt, new Date()),
            eq(podcastJobs.cancelRequested, false),
            types ? inArray(podcastJobs.type, [...types]) : undefined,
          ),
        )
        .orderBy(
          sql`case ${podcastJobs.type} when 'purge' then 0 when 'merge' then 0 when 'file_cleanup' then 1 when 'opml_import' then 2 when 'refresh' then 3 when 'reparse' then 3 when 'import_scan' then 3 when 'digest' then 4 when 'retention' then 5 else 6 end`,
          asc(podcastJobs.nextAttemptAt),
          asc(podcastJobs.createdAt),
          asc(podcastJobs.id),
        )
        .limit(1);
      if (!candidate) return null;
      const now = new Date();
      const [claimed] = await this.db
        .update(podcastJobs)
        .set({
          status: 'processing',
          attemptCount: sql`${podcastJobs.attemptCount} + 1`,
          leaseUntil: new Date(now.getTime() + leaseMs),
          updatedAt: now,
        })
        .where(and(eq(podcastJobs.id, candidate.id), eq(podcastJobs.status, 'queued')))
        .returning();
      if (claimed) return claimed;
    }
  }

  async complete(id: number): Promise<void> {
    await this.db
      .update(podcastJobs)
      .set({
        status: sql`case when ${podcastJobs.cancelRequested} then 'cancelled' else 'completed' end`,
        leaseUntil: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(podcastJobs.id, id));
  }

  async fail(id: number, error: string, retryAt: Date | null): Promise<'queued' | 'failed' | 'cancelled'> {
    const nextStatus = retryAt ? 'queued' : 'failed';
    const [row] = await this.db
      .update(podcastJobs)
      .set({
        status: sql`case when ${podcastJobs.cancelRequested} then 'cancelled' else ${nextStatus} end`,
        nextAttemptAt: retryAt ?? new Date(),
        leaseUntil: null,
        lastError: error.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(podcastJobs.id, id))
      .returning({ status: podcastJobs.status });
    return row?.status === 'cancelled' ? 'cancelled' : row?.status === 'queued' ? 'queued' : 'failed';
  }

  async updateProgress(id: number, current: number, total?: number | null): Promise<void> {
    await this.db
      .update(podcastJobs)
      .set({ progressCurrent: current, progressTotal: total, leaseUntil: new Date(Date.now() + 5 * 60_000), updatedAt: new Date() })
      .where(eq(podcastJobs.id, id));
  }

  /** Used by the local-file import to keep its finished report with the job that produced it. */
  async updatePayload(id: number, payload: Record<string, unknown>): Promise<void> {
    await this.db.update(podcastJobs).set({ payload, updatedAt: new Date() }).where(eq(podcastJobs.id, id));
  }

  async findLatestByType(libraryId: number, type: string) {
    const [row] = await this.db
      .select()
      .from(podcastJobs)
      .where(and(eq(podcastJobs.libraryId, libraryId), eq(podcastJobs.type, type)))
      .orderBy(desc(podcastJobs.createdAt), desc(podcastJobs.id))
      .limit(1);
    return row ?? null;
  }

  /// Scoped to the library as well as the id, so a job id from one library can never be used to
  /// read another's work.
  async findByIdInLibrary(libraryId: number, id: number) {
    const [row] = await this.db
      .select()
      .from(podcastJobs)
      .where(and(eq(podcastJobs.libraryId, libraryId), eq(podcastJobs.id, id)))
      .limit(1);
    return row ?? null;
  }

  async renewLease(id: number, leaseMs = 5 * 60_000): Promise<void> {
    await this.db
      .update(podcastJobs)
      .set({ leaseUntil: new Date(Date.now() + leaseMs), updatedAt: new Date() })
      .where(and(eq(podcastJobs.id, id), eq(podcastJobs.status, 'processing')));
  }

  async cancel(id: number): Promise<void> {
    await this.db
      .update(podcastJobs)
      .set({
        cancelRequested: true,
        status: sql`case when ${podcastJobs.status} = 'queued' then 'cancelled' else ${podcastJobs.status} end`,
        updatedAt: new Date(),
      })
      .where(eq(podcastJobs.id, id));
  }

  async cancelPodcastWork(podcastIds: number[]): Promise<number> {
    if (podcastIds.length === 0) return 0;
    const rows = await this.db
      .update(podcastJobs)
      .set({
        cancelRequested: true,
        status: sql`case when ${podcastJobs.status} = 'queued' then 'cancelled' else ${podcastJobs.status} end`,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(podcastJobs.podcastId, podcastIds),
          // A local import writes episodes into one show, so a purge or a merge has to stop it for
          // the same reason it stops a refresh: the show it is writing into is about to move or go.
          inArray(podcastJobs.type, ['refresh', 'reparse', 'download', 'local_import']),
          sql`${podcastJobs.status} in ('queued', 'processing')`,
        ),
      )
      .returning({ status: podcastJobs.status, type: podcastJobs.type, episodeId: podcastJobs.episodeId });
    const cancelledEpisodeIds = rows.flatMap((row) =>
      row.status === 'cancelled' && row.type === 'download' && row.episodeId !== null ? [row.episodeId] : [],
    );
    if (cancelledEpisodeIds.length > 0) {
      await this.db
        .update(podcastEpisodeMedia)
        .set({ status: 'remote', lastError: null, updatedAt: new Date() })
        .where(and(inArray(podcastEpisodeMedia.episodeId, cancelledEpisodeIds), eq(podcastEpisodeMedia.status, 'queued')));
    }
    return rows.filter((row) => row.status === 'processing').length;
  }

  async hasActiveDestructiveWork(podcastId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: podcastJobs.id })
      .from(podcastJobs)
      .where(
        and(
          inArray(podcastJobs.type, ['purge', 'merge']),
          sql`${podcastJobs.status} in ('queued', 'processing')`,
          sql`(${podcastJobs.podcastId} = ${podcastId} or ${podcastJobs.payload}->>'sourcePodcastId' = ${String(podcastId)})`,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async cancelEpisodeDownload(episodeId: number): Promise<{ processing: number; cancelledBatchIds: string[] }> {
    const rows = await this.db
      .update(podcastJobs)
      .set({
        cancelRequested: true,
        status: sql`case when ${podcastJobs.status} = 'queued' then 'cancelled' else ${podcastJobs.status} end`,
        updatedAt: new Date(),
      })
      .where(and(eq(podcastJobs.episodeId, episodeId), eq(podcastJobs.type, 'download'), sql`${podcastJobs.status} in ('queued', 'processing')`))
      .returning({ status: podcastJobs.status, batchId: podcastJobs.downloadBatchId });
    return {
      processing: rows.filter((row) => row.status === 'processing').length,
      cancelledBatchIds: rows.flatMap((row) => (row.status === 'cancelled' && row.batchId ? [row.batchId] : [])),
    };
  }

  async isCancellationRequested(id: number): Promise<boolean> {
    const [row] = await this.db.select({ cancelRequested: podcastJobs.cancelRequested }).from(podcastJobs).where(eq(podcastJobs.id, id)).limit(1);
    return row?.cancelRequested ?? true;
  }

  async recoverExpiredLeases(): Promise<number> {
    const rows = await this.db
      .update(podcastJobs)
      .set({
        status: sql`case when ${podcastJobs.cancelRequested} then 'cancelled' else 'queued' end`,
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(and(eq(podcastJobs.status, 'processing'), or(lte(podcastJobs.leaseUntil, new Date()), isNull(podcastJobs.leaseUntil))))
      .returning({ id: podcastJobs.id });
    return rows.length;
  }

  async summary(libraryId: number) {
    const rows = await this.db
      .select({ status: podcastJobs.status, count: count() })
      .from(podcastJobs)
      .where(and(eq(podcastJobs.libraryId, libraryId), sql`${podcastJobs.status} in ('queued', 'processing', 'failed')`))
      .groupBy(podcastJobs.status);
    const result = { queued: 0, processing: 0, failed: 0 };
    for (const row of rows) {
      if (row.status === 'queued' || row.status === 'processing' || row.status === 'failed') result[row.status] = Number(row.count);
    }
    return result;
  }

  /**
   * How much of one job type is outstanding in a library, and how far the work in flight has got.
   *
   * The counts and the file totals come from one scan of the same rows: a caller emitting progress
   * needs both on every tick, and asking twice would double the query for no extra truth. `total`
   * stays null until some job has counted what it is about to do, which is a state the run really
   * passes through rather than a missing value.
   */
  async summaryByType(libraryId: number, type: string) {
    const rows = await this.db
      .select({
        status: podcastJobs.status,
        count: count(),
        processed: sql<string | null>`sum(${podcastJobs.progressCurrent})`,
        total: sql<string | null>`sum(${podcastJobs.progressTotal})`,
      })
      .from(podcastJobs)
      .where(and(eq(podcastJobs.libraryId, libraryId), eq(podcastJobs.type, type), sql`${podcastJobs.status} in ('queued', 'processing', 'failed')`))
      .groupBy(podcastJobs.status);
    const result = { queued: 0, processing: 0, failed: 0, processed: 0, total: null as number | null };
    for (const row of rows) {
      if (row.status !== 'queued' && row.status !== 'processing' && row.status !== 'failed') continue;
      result[row.status] = Number(row.count);
      // Only work still on its way says anything about the bar; a failed job's counters describe a
      // run that stopped.
      if (row.status === 'failed') continue;
      result.processed += Number(row.processed ?? 0);
      if (row.total !== null) result.total = (result.total ?? 0) + Number(row.total);
    }
    return result;
  }

  /**
   * Returns every item in the user's newest unresolved bulk-download batches. The first query only
   * chooses at most five batch IDs; the second is therefore bounded by five 100-item bulk requests
   * while still including completed siblings needed for truthful totals.
   */
  /**
   * Download counters for one library, aggregated in the database rather than by loading the
   * batches. The activity poll only needs the numbers, and a library mid-import can hold thousands
   * of outstanding download rows.
   */
  async downloadSummary(libraryId: number, userId: number) {
    const [rows, batches] = await Promise.all([
      this.db
        .select({ status: podcastJobs.status, count: count() })
        .from(podcastJobs)
        .where(
          and(
            eq(podcastJobs.libraryId, libraryId),
            eq(podcastJobs.type, 'download'),
            eq(podcastJobs.requestedByUserId, userId),
            inArray(podcastJobs.status, ['queued', 'processing', 'failed']),
          ),
        )
        .groupBy(podcastJobs.status),
      this.db
        .select({ total: countDistinct(podcastJobs.downloadBatchId) })
        .from(podcastJobs)
        .where(
          and(
            eq(podcastJobs.libraryId, libraryId),
            eq(podcastJobs.type, 'download'),
            eq(podcastJobs.requestedByUserId, userId),
            isNotNull(podcastJobs.downloadBatchId),
            inArray(podcastJobs.status, ['queued', 'processing', 'failed']),
          ),
        ),
    ]);
    const result = { batches: Number(batches[0]?.total ?? 0), queued: 0, downloading: 0, failed: 0 };
    for (const row of rows) {
      if (row.status === 'queued') result.queued = Number(row.count);
      else if (row.status === 'processing') result.downloading = Number(row.count);
      else if (row.status === 'failed') result.failed = Number(row.count);
    }
    return result;
  }

  async listActiveDownloadBatchJobs(userId: number, libraryIds: number[], limit = 5) {
    if (libraryIds.length === 0 || limit <= 0) return [];
    const activeBatches = await this.db
      .select({ batchId: podcastJobs.downloadBatchId, createdAt: max(podcastJobs.createdAt) })
      .from(podcastJobs)
      .where(
        and(
          eq(podcastJobs.type, 'download'),
          eq(podcastJobs.requestedByUserId, userId),
          inArray(podcastJobs.libraryId, libraryIds),
          isNotNull(podcastJobs.downloadBatchId),
          inArray(podcastJobs.status, ['queued', 'processing', 'failed']),
        ),
      )
      .groupBy(podcastJobs.downloadBatchId)
      .orderBy(desc(max(podcastJobs.createdAt)))
      .limit(Math.min(limit, 10));
    const batchIds = activeBatches.flatMap((row) => (row.batchId ? [row.batchId] : []));
    if (batchIds.length === 0) return [];
    return this.findDownloadBatchJobs(userId, libraryIds, batchIds);
  }

  async findDownloadBatchJobs(userId: number, libraryIds: number[], batchIds: string[]) {
    if (libraryIds.length === 0 || batchIds.length === 0) return [];
    return this.db
      .select({
        batchId: podcastJobs.downloadBatchId,
        libraryId: podcastJobs.libraryId,
        podcastId: podcastJobs.podcastId,
        podcastTitle: podcasts.title,
        episodeId: podcastJobs.episodeId,
        episodeTitle: podcastEpisodes.title,
        status: podcastJobs.status,
        progressCurrent: podcastJobs.progressCurrent,
        progressTotal: podcastJobs.progressTotal,
        createdAt: podcastJobs.createdAt,
        updatedAt: podcastJobs.updatedAt,
      })
      .from(podcastJobs)
      .leftJoin(podcasts, eq(podcastJobs.podcastId, podcasts.id))
      .leftJoin(podcastEpisodes, eq(podcastJobs.episodeId, podcastEpisodes.id))
      .where(
        and(
          eq(podcastJobs.type, 'download'),
          eq(podcastJobs.requestedByUserId, userId),
          inArray(podcastJobs.libraryId, libraryIds),
          inArray(podcastJobs.downloadBatchId, batchIds),
        ),
      )
      .orderBy(desc(podcastJobs.createdAt), desc(podcastJobs.id));
  }

  async deleteExpiredTerminal(completedBefore: Date, failedBefore: Date, limit = 1000): Promise<number> {
    const rows = await this.db
      .select({ id: podcastJobs.id })
      .from(podcastJobs)
      .where(
        or(
          and(sql`${podcastJobs.status} in ('completed', 'cancelled')`, lt(podcastJobs.updatedAt, completedBefore)),
          and(eq(podcastJobs.status, 'failed'), lt(podcastJobs.updatedAt, failedBefore)),
        ),
      )
      .orderBy(asc(podcastJobs.updatedAt), asc(podcastJobs.id))
      .limit(limit);
    if (rows.length === 0) return 0;
    await this.db.delete(podcastJobs).where(
      inArray(
        podcastJobs.id,
        rows.map((row) => row.id),
      ),
    );
    return rows.length;
  }
}
