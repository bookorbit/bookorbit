import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { PodcastEpisodeListItem, PodcastQueuePlacement, PodcastQueuePage, PodcastQueueItem, PodcastQueueClearResult } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  podcastBookmarks,
  podcastEpisodeMedia,
  podcastEpisodes,
  podcastListeningSessions,
  podcasts,
  userPodcastEpisodeState,
  userPodcastFollows,
  userPodcastQueue,
} from '../../db/schema';
import { buildEpisodeRuleClauses, episodeOrderBy } from './podcast-episode-query';
import type { PodcastEpisodeRuleQuery } from './podcast-episode-query';
import { toEpisodeListItem } from './podcast-row-mappers';

type Db = NodePgDatabase<typeof schema>;
type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

const PODCAST_QUEUE_LIMIT = 1000;

/**
 * Which episode a "play all" should actually start on. `firstEpisodeId` exists only to be played, and
 * an episode whose media is gone cannot be: starting there strands the player on a load error the
 * mini player then carries to every route, with a Retry that can never succeed. Anything else,
 * including a remote episode with no download and a failed one, still has a source to stream.
 *
 * If nothing in reach is playable the first match is returned anyway, so the player reports the
 * honest failure rather than the action doing nothing at all.
 */
function firstPlayableEpisodeId(rows: { id: number; mediaStatus: string | null }[]): number | undefined {
  return (rows.find((row) => row.mediaStatus !== 'unavailable') ?? rows[0])?.id;
}

@Injectable()
export class PodcastPlaybackRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async addQueryEpisodesToQueue(
    userId: number,
    libraryId: number,
    query: PodcastEpisodeRuleQuery,
    limit: number,
  ): Promise<{ added: number; skipped: number; firstEpisodeId?: number }> {
    const where = and(...buildEpisodeRuleClauses(libraryId, query));
    const orderBy = episodeOrderBy(query.sort);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(188635121, ${userId})`);
      const selectMatchedIds = () =>
        tx
          .select({ id: podcastEpisodes.id, mediaStatus: podcastEpisodeMedia.status })
          .from(podcastEpisodes)
          .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
          .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
          .leftJoin(
            userPodcastEpisodeState,
            and(eq(userPodcastEpisodeState.episodeId, podcastEpisodes.id), eq(userPodcastEpisodeState.userId, userId)),
          )
          .leftJoin(userPodcastFollows, and(eq(userPodcastFollows.podcastId, podcasts.id), eq(userPodcastFollows.userId, userId)))
          .leftJoin(userPodcastQueue, and(eq(userPodcastQueue.episodeId, podcastEpisodes.id), eq(userPodcastQueue.userId, userId)));
      const [queueState, matchedRows, firstMatch] = await Promise.all([
        tx
          .select({ count: sql<number>`count(*)::int`, max: sql<number>`coalesce(max(${userPodcastQueue.position}), -1)::int` })
          .from(userPodcastQueue)
          .where(eq(userPodcastQueue.userId, userId)),
        tx
          .select({ count: count() })
          .from(podcastEpisodes)
          .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
          .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
          .leftJoin(
            userPodcastEpisodeState,
            and(eq(userPodcastEpisodeState.episodeId, podcastEpisodes.id), eq(userPodcastEpisodeState.userId, userId)),
          )
          .leftJoin(userPodcastFollows, and(eq(userPodcastFollows.podcastId, podcasts.id), eq(userPodcastFollows.userId, userId)))
          .where(where),
        selectMatchedIds()
          .where(where)
          .orderBy(...orderBy)
          .limit(1),
      ]);
      const available = Math.max(0, PODCAST_QUEUE_LIMIT - Number(queueState[0]?.count ?? 0));
      const candidates =
        available === 0
          ? []
          : await selectMatchedIds()
              .where(and(where, isNull(userPodcastQueue.episodeId)))
              .orderBy(...orderBy)
              .limit(Math.min(limit, available));
      const maxPosition = Number(queueState[0]?.max ?? -1);
      if (candidates.length > 0) {
        await tx
          .insert(userPodcastQueue)
          .values(candidates.map((episode, index) => ({ userId, episodeId: episode.id, position: maxPosition + index + 1 })));
      }
      const matched = Number(matchedRows[0]?.count ?? 0);
      const firstEpisodeId = firstPlayableEpisodeId(candidates.length > 0 ? candidates : firstMatch);
      return {
        added: candidates.length,
        skipped: Math.max(0, matched - candidates.length),
        ...(firstEpisodeId ? { firstEpisodeId } : {}),
      };
    });
  }

  async upsertEpisodeState(userId: number, episodeId: number, values: Partial<typeof userPodcastEpisodeState.$inferInsert>, notOlderThan?: Date) {
    if (values.finished !== true) {
      return this.writeEpisodeState(this.db, userId, episodeId, values, notOlderThan);
    }
    return this.db.transaction(async (tx) => {
      const row = await this.writeEpisodeState(tx, userId, episodeId, values, notOlderThan);
      // A stale write that the guard skipped leaves the stored row in charge: dequeue only when
      // the row that actually stands is finished.
      if (row?.finished) await this.deleteQueueItem(tx, userId, episodeId);
      return row;
    });
  }

  private async writeEpisodeState(
    executor: Db | DbTransaction,
    userId: number,
    episodeId: number,
    values: Partial<typeof userPodcastEpisodeState.$inferInsert>,
    notOlderThan?: Date,
  ) {
    const [row] = await executor
      .insert(userPodcastEpisodeState)
      .values({ userId, episodeId, ...values })
      .onConflictDoUpdate({
        target: [userPodcastEpisodeState.userId, userPodcastEpisodeState.episodeId],
        set: { ...values, updatedAt: new Date() },
        ...(notOlderThan ? { setWhere: lte(userPodcastEpisodeState.updatedAt, notOlderThan) } : {}),
      })
      .returning();
    if (row) return row;
    const stored = await this.selectEpisodeState(executor, userId, episodeId);
    return stored!;
  }

  async findEpisodeState(userId: number, episodeId: number) {
    return this.selectEpisodeState(this.db, userId, episodeId);
  }

  private async selectEpisodeState(executor: Db | DbTransaction, userId: number, episodeId: number) {
    const [row] = await executor
      .select()
      .from(userPodcastEpisodeState)
      .where(and(eq(userPodcastEpisodeState.userId, userId), eq(userPodcastEpisodeState.episodeId, episodeId)))
      .limit(1);
    return row;
  }

  /** Episode states for the given ids, filtered to episodes in libraries the user can reach. */

  async listEpisodeStates(userId: number, episodeIds: number[], accessibleLibraryIds?: number[]) {
    if (episodeIds.length === 0) return [];
    if (accessibleLibraryIds?.length === 0) return [];
    return this.db
      .select({
        episodeId: userPodcastEpisodeState.episodeId,
        positionSeconds: userPodcastEpisodeState.positionSeconds,
        progressPercent: userPodcastEpisodeState.progressPercent,
        finished: userPodcastEpisodeState.finished,
        finishedAt: userPodcastEpisodeState.finishedAt,
        pinned: userPodcastEpisodeState.pinned,
        lastListenedAt: userPodcastEpisodeState.lastListenedAt,
        updatedAt: userPodcastEpisodeState.updatedAt,
      })
      .from(userPodcastEpisodeState)
      .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, userPodcastEpisodeState.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .where(
        and(
          eq(userPodcastEpisodeState.userId, userId),
          inArray(userPodcastEpisodeState.episodeId, episodeIds),
          accessibleLibraryIds ? inArray(podcasts.libraryId, accessibleLibraryIds) : undefined,
        ),
      );
  }

  async addQueueItem(
    userId: number,
    episodeId: number,
    placement: PodcastQueuePlacement = 'end',
    afterEpisodeId?: number,
  ): Promise<'queued' | 'full' | 'missing_anchor'> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(188635121, ${userId})`);
      const [existing] = await tx
        .select({ position: userPodcastQueue.position })
        .from(userPodcastQueue)
        .where(and(eq(userPodcastQueue.userId, userId), eq(userPodcastQueue.episodeId, episodeId)))
        .limit(1);
      const [queueState] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          max: sql<number>`coalesce(max(${userPodcastQueue.position}), -1)::int`,
        })
        .from(userPodcastQueue)
        .where(eq(userPodcastQueue.userId, userId));
      const queueSize = Number(queueState?.count ?? 0);
      const maxPosition = Number(queueState?.max ?? -1);
      if (!existing && queueSize >= 1000) return 'full';

      let targetPosition = existing ? maxPosition : maxPosition + 1;
      if (placement === 'next') {
        if (afterEpisodeId) {
          const [anchor] = await tx
            .select({ position: userPodcastQueue.position })
            .from(userPodcastQueue)
            .where(and(eq(userPodcastQueue.userId, userId), eq(userPodcastQueue.episodeId, afterEpisodeId)))
            .limit(1);
          if (!anchor) return 'missing_anchor';
          targetPosition = anchor.position + 1;
          if (existing && existing.position < targetPosition) targetPosition--;
        } else {
          targetPosition = 0;
        }
      }

      const shiftPositions = (where: SQL | undefined, delta: 1 | -1) => this.shiftQueuePositions(tx, userId, where, delta);

      if (!existing) {
        if (targetPosition < queueSize) await shiftPositions(gte(userPodcastQueue.position, targetPosition), 1);
        await tx.insert(userPodcastQueue).values({ userId, episodeId, position: targetPosition });
        return 'queued';
      }

      if (existing.position === targetPosition) return 'queued';
      const temporaryPosition = 2_000_000 + existing.position;
      await tx
        .update(userPodcastQueue)
        .set({ position: temporaryPosition })
        .where(and(eq(userPodcastQueue.userId, userId), eq(userPodcastQueue.episodeId, episodeId)));
      if (targetPosition < existing.position) {
        await shiftPositions(and(gte(userPodcastQueue.position, targetPosition), lt(userPodcastQueue.position, existing.position)), 1);
      } else {
        await shiftPositions(and(gt(userPodcastQueue.position, existing.position), lt(userPodcastQueue.position, targetPosition + 1)), -1);
      }
      await tx
        .update(userPodcastQueue)
        .set({ position: targetPosition })
        .where(and(eq(userPodcastQueue.userId, userId), eq(userPodcastQueue.episodeId, episodeId), eq(userPodcastQueue.position, temporaryPosition)));
      return 'queued';
    });
  }

  async addPodcastEpisodesToQueue(userId: number, podcastId: number): Promise<{ added: number; skipped: number; firstEpisodeId?: number }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(188635121, ${userId})`);
      const [queueState, podcastState] = await Promise.all([
        tx
          .select({
            count: sql<number>`count(*)::int`,
            max: sql<number>`coalesce(max(${userPodcastQueue.position}), -1)::int`,
          })
          .from(userPodcastQueue)
          .where(eq(userPodcastQueue.userId, userId)),
        tx.select({ count: count() }).from(podcastEpisodes).where(eq(podcastEpisodes.podcastId, podcastId)),
      ]);
      const available = Math.max(0, PODCAST_QUEUE_LIMIT - Number(queueState[0]?.count ?? 0));
      const [firstEpisode] = await tx
        .select({ id: podcastEpisodes.id })
        .from(podcastEpisodes)
        .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
        .where(eq(podcastEpisodes.podcastId, podcastId))
        // Newest first, but never an episode whose media is gone while a playable one exists: that
        // one cannot start, and the player would be left on an error no retry can clear.
        .orderBy(
          asc(sql`(${podcastEpisodeMedia.status} = 'unavailable')`),
          sql`${podcastEpisodes.publishedAt} desc nulls last`,
          desc(podcastEpisodes.id),
        )
        .limit(1);
      const candidates = await tx
        .select({ id: podcastEpisodes.id })
        .from(podcastEpisodes)
        .leftJoin(userPodcastQueue, and(eq(userPodcastQueue.userId, userId), eq(userPodcastQueue.episodeId, podcastEpisodes.id)))
        .where(and(eq(podcastEpisodes.podcastId, podcastId), isNull(userPodcastQueue.episodeId)))
        .orderBy(sql`${podcastEpisodes.publishedAt} desc nulls last`, desc(podcastEpisodes.id))
        .limit(available);
      const maxPosition = Number(queueState[0]?.max ?? -1);
      if (candidates.length > 0) {
        await tx.insert(userPodcastQueue).values(
          candidates.map((episode, index) => ({
            userId,
            episodeId: episode.id,
            position: maxPosition + index + 1,
          })),
        );
      }
      const total = Number(podcastState[0]?.count ?? 0);
      return {
        added: candidates.length,
        skipped: Math.max(0, total - candidates.length),
        ...(firstEpisode ? { firstEpisodeId: firstEpisode.id } : {}),
      };
    });
  }

  async markPodcastEpisodesFinished(userId: number, podcastId: number): Promise<number> {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
      insert into ${userPodcastEpisodeState} (
        user_id,
        episode_id,
        position_seconds,
        progress_percent,
        finished,
        finished_at,
        updated_at
      )
      select
        ${userId},
        episode.id,
        coalesce(episode.duration_seconds, 0),
        100,
        true,
        now(),
        now()
      from ${podcastEpisodes} episode
      where episode.podcast_id = ${podcastId}
      on conflict (user_id, episode_id) do update set
        position_seconds = excluded.position_seconds,
        progress_percent = 100,
        finished = true,
        finished_at = now(),
        updated_at = now()
    `);
      // Marking one episode played dequeues it in the same write; doing it for a whole show has to
      // as well, or the queue fills with episodes the user just declared finished. Positions are
      // repacked once at the end rather than per row, which is why this does not reuse
      // deleteQueueItem.
      await tx.execute(sql`select pg_advisory_xact_lock(188635121, ${userId})`);
      await tx.execute(sql`
        delete from ${userPodcastQueue}
        where user_id = ${userId}
          and episode_id in (select id from ${podcastEpisodes} where podcast_id = ${podcastId})
      `);
      await tx.execute(sql`
        update ${userPodcastQueue} as q
        set position = ranked.new_position
        from (
          select episode_id, row_number() over (order by position) - 1 as new_position
          from ${userPodcastQueue}
          where user_id = ${userId}
        ) as ranked
        where q.user_id = ${userId} and q.episode_id = ranked.episode_id and q.position <> ranked.new_position
      `);
      return result.rowCount ?? 0;
    });
  }

  /**
   * Episodes holding a cached copy that "remove downloads" may clear. Local-origin episodes are not
   * downloads, so the bulk action never reaches them: their file is removed one at a time, through
   * the explicit permanent flag.
   */

  async removeQueueItem(userId: number, episodeId: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.deleteQueueItem(tx, userId, episodeId);
    });
  }

  /**
   * Removes one entry and re-compacts the positions behind it. Callers hold the per-user advisory
   * lock, so this is also the dequeue path a finishing state write takes inside its own
   * transaction.
   */

  private async deleteQueueItem(tx: DbTransaction, userId: number, episodeId: number): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(188635121, ${userId})`);
    const [existing] = await tx
      .select({ position: userPodcastQueue.position })
      .from(userPodcastQueue)
      .where(and(eq(userPodcastQueue.userId, userId), eq(userPodcastQueue.episodeId, episodeId)))
      .limit(1);
    if (!existing) return;
    await tx.delete(userPodcastQueue).where(and(eq(userPodcastQueue.userId, userId), eq(userPodcastQueue.episodeId, episodeId)));
    const offset = 1_000_000;
    await tx
      .update(userPodcastQueue)
      .set({ position: sql`${userPodcastQueue.position} + ${offset}` })
      .where(and(eq(userPodcastQueue.userId, userId), gt(userPodcastQueue.position, existing.position)));
    await tx
      .update(userPodcastQueue)
      .set({ position: sql`${userPodcastQueue.position} - ${offset + 1}` })
      .where(and(eq(userPodcastQueue.userId, userId), gte(userPodcastQueue.position, offset), lt(userPodcastQueue.position, offset * 2)));
  }

  /**
   * Moves one entry to `position` (0-based, clamped) among the entries the user can see, then
   * re-compacts. A single-row drag uses this instead of the full-set reorder, so a phone cannot
   * lose a race against another device's concurrent edit: the current order is read inside the
   * transaction rather than uploaded from a client snapshot.
   *
   * Returns false when the episode is not in the queue or is not visible to this user.
   */

  async moveQueueItem(userId: number, episodeId: number, position: number, accessibleLibraryIds?: number[]): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(188635121, ${userId})`);
      const existing = await tx
        .select({ episodeId: userPodcastQueue.episodeId, libraryId: podcasts.libraryId, position: userPodcastQueue.position })
        .from(userPodcastQueue)
        .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, userPodcastQueue.episodeId))
        .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
        .where(eq(userPodcastQueue.userId, userId))
        .orderBy(asc(userPodcastQueue.position));
      const accessibleLibrarySet = accessibleLibraryIds === undefined ? null : new Set(accessibleLibraryIds);
      const visible = accessibleLibrarySet === null ? existing : existing.filter((row) => accessibleLibrarySet.has(row.libraryId));
      const currentIndex = visible.findIndex((row) => row.episodeId === episodeId);
      if (currentIndex === -1) return false;
      const targetIndex = Math.min(Math.max(0, Math.trunc(position)), visible.length - 1);
      if (targetIndex === currentIndex) return true;

      // Positions are gap-free per user, so rotating the closed interval between the two slots
      // keeps entries the user cannot see in their existing relative places.
      const from = visible[currentIndex]!.position;
      const to = visible[targetIndex]!.position;
      const parked = 2_000_000 + from;
      await tx
        .update(userPodcastQueue)
        .set({ position: parked })
        .where(and(eq(userPodcastQueue.userId, userId), eq(userPodcastQueue.episodeId, episodeId)));
      if (to < from) {
        await this.shiftQueuePositions(tx, userId, and(gte(userPodcastQueue.position, to), lt(userPodcastQueue.position, from)), 1);
      } else {
        await this.shiftQueuePositions(tx, userId, and(gt(userPodcastQueue.position, from), lte(userPodcastQueue.position, to)), -1);
      }
      await tx
        .update(userPodcastQueue)
        .set({ position: to })
        .where(and(eq(userPodcastQueue.userId, userId), eq(userPodcastQueue.episodeId, episodeId), eq(userPodcastQueue.position, parked)));
      return true;
    });
  }

  /**
   * Shifts a contiguous run of positions by one slot. The two-step offset hop keeps every
   * intermediate value clear of the `(user_id, position)` unique index.
   */

  private async shiftQueuePositions(tx: DbTransaction, userId: number, where: SQL | undefined, delta: 1 | -1): Promise<void> {
    const offset = 1_000_000;
    await tx
      .update(userPodcastQueue)
      .set({ position: sql`${userPodcastQueue.position} + ${offset}` })
      .where(and(eq(userPodcastQueue.userId, userId), where));
    await tx
      .update(userPodcastQueue)
      .set({ position: sql`${userPodcastQueue.position} - ${offset - delta}` })
      .where(and(eq(userPodcastQueue.userId, userId), gte(userPodcastQueue.position, offset), lt(userPodcastQueue.position, offset * 2)));
  }

  async reorderQueue(userId: number, episodeIds: number[], accessibleLibraryIds?: number[]): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(188635121, ${userId})`);
      const existing = await tx
        .select({ episodeId: userPodcastQueue.episodeId, libraryId: podcasts.libraryId, position: userPodcastQueue.position })
        .from(userPodcastQueue)
        .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, userPodcastQueue.episodeId))
        .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
        .where(eq(userPodcastQueue.userId, userId))
        .orderBy(asc(userPodcastQueue.position));
      const accessibleLibrarySet = accessibleLibraryIds === undefined ? null : new Set(accessibleLibraryIds);
      const visible = accessibleLibrarySet === null ? existing : existing.filter((row) => accessibleLibrarySet.has(row.libraryId));
      const visibleIds = new Set(visible.map((row) => row.episodeId));
      if (episodeIds.some((id) => !visibleIds.has(id)) || new Set(episodeIds).size !== episodeIds.length) {
        return false;
      }
      if (episodeIds.length === 0) return true;
      const positions = visible.filter((row) => episodeIds.includes(row.episodeId)).map((row) => row.position);
      await tx
        .update(userPodcastQueue)
        .set({ position: sql`${userPodcastQueue.position} + 1000000` })
        .where(and(eq(userPodcastQueue.userId, userId), inArray(userPodcastQueue.episodeId, episodeIds)));
      for (let index = 0; index < episodeIds.length; index++) {
        await tx
          .update(userPodcastQueue)
          .set({ position: positions[index]! })
          .where(and(eq(userPodcastQueue.userId, userId), eq(userPodcastQueue.episodeId, episodeIds[index]!)));
      }
      return true;
    });
  }

  /**
   * The cross-library resume feed: started but unfinished episodes, most recently listened first.
   * Library scoping matches the queue's, so an episode in a library the user lost access to drops
   * out of the row rather than resurfacing on a home screen.
   */

  async listContinueListening(userId: number, size: number, accessibleLibraryIds?: number[]): Promise<PodcastEpisodeListItem[]> {
    if (accessibleLibraryIds?.length === 0) return [];
    const rows = await this.db
      .select({
        episode: {
          id: podcastEpisodes.id,
          podcastId: podcastEpisodes.podcastId,
          title: podcastEpisodes.title,
          season: podcastEpisodes.season,
          episode: podcastEpisodes.episode,
          explicit: podcastEpisodes.explicit,
          origin: podcastEpisodes.origin,
          inFeed: podcastEpisodes.inFeed,
          publishedAt: podcastEpisodes.publishedAt,
          durationSeconds: podcastEpisodes.durationSeconds,
          enclosureType: podcastEpisodes.enclosureType,
        },
        podcastLibraryId: podcasts.libraryId,
        podcastTitle: podcasts.title,
        podcastImageUrl: podcasts.imageUrlEncrypted,
        podcastCustomArtworkAt: podcasts.customArtworkAt,
        media: {
          status: podcastEpisodeMedia.status,
          sizeBytes: podcastEpisodeMedia.sizeBytes,
          format: podcastEpisodeMedia.format,
          checksum: podcastEpisodeMedia.checksum,
        },
        state: {
          positionSeconds: userPodcastEpisodeState.positionSeconds,
          progressPercent: userPodcastEpisodeState.progressPercent,
          finished: userPodcastEpisodeState.finished,
          pinned: userPodcastEpisodeState.pinned,
          lastListenedAt: userPodcastEpisodeState.lastListenedAt,
        },
        queuedEpisodeId: userPodcastQueue.episodeId,
      })
      .from(userPodcastEpisodeState)
      .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, userPodcastEpisodeState.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
      .leftJoin(userPodcastQueue, and(eq(userPodcastQueue.episodeId, podcastEpisodes.id), eq(userPodcastQueue.userId, userId)))
      .where(
        and(
          eq(userPodcastEpisodeState.userId, userId),
          eq(userPodcastEpisodeState.finished, false),
          gt(userPodcastEpisodeState.positionSeconds, 0),
          accessibleLibraryIds === undefined ? undefined : inArray(podcasts.libraryId, accessibleLibraryIds),
        ),
      )
      .orderBy(sql`${userPodcastEpisodeState.lastListenedAt} desc nulls last`, desc(podcastEpisodes.id))
      .limit(size);
    return rows.map((row) => toEpisodeListItem(row));
  }

  async listQueue(userId: number, query: { page: number; size: number; q?: string }, accessibleLibraryIds?: number[]): Promise<PodcastQueuePage> {
    const libraryScope =
      accessibleLibraryIds === undefined
        ? undefined
        : accessibleLibraryIds.length > 0
          ? inArray(podcasts.libraryId, accessibleLibraryIds)
          : sql`false`;
    const searchScope = query.q ? or(ilike(podcastEpisodes.title, `%${query.q}%`), ilike(podcasts.title, `%${query.q}%`)) : undefined;
    const where = and(eq(userPodcastQueue.userId, userId), libraryScope, searchScope);
    const [rows, totalRows, durationRows] = await Promise.all([
      this.db
        .select({
          episode: {
            id: podcastEpisodes.id,
            podcastId: podcastEpisodes.podcastId,
            title: podcastEpisodes.title,
            season: podcastEpisodes.season,
            episode: podcastEpisodes.episode,
            explicit: podcastEpisodes.explicit,
            origin: podcastEpisodes.origin,
            inFeed: podcastEpisodes.inFeed,
            publishedAt: podcastEpisodes.publishedAt,
            durationSeconds: podcastEpisodes.durationSeconds,
            enclosureType: podcastEpisodes.enclosureType,
          },
          podcastLibraryId: podcasts.libraryId,
          podcastTitle: podcasts.title,
          podcastImageUrl: podcasts.imageUrlEncrypted,
          podcastCustomArtworkAt: podcasts.customArtworkAt,
          media: {
            status: podcastEpisodeMedia.status,
            sizeBytes: podcastEpisodeMedia.sizeBytes,
            format: podcastEpisodeMedia.format,
            checksum: podcastEpisodeMedia.checksum,
          },
          state: {
            positionSeconds: userPodcastEpisodeState.positionSeconds,
            progressPercent: userPodcastEpisodeState.progressPercent,
            finished: userPodcastEpisodeState.finished,
            pinned: userPodcastEpisodeState.pinned,
            lastListenedAt: userPodcastEpisodeState.lastListenedAt,
          },
          queuedEpisodeId: userPodcastQueue.episodeId,
          queuePosition: userPodcastQueue.position,
        })
        .from(userPodcastQueue)
        .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, userPodcastQueue.episodeId))
        .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
        .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
        .leftJoin(userPodcastEpisodeState, and(eq(userPodcastEpisodeState.episodeId, podcastEpisodes.id), eq(userPodcastEpisodeState.userId, userId)))
        .where(where)
        .orderBy(asc(userPodcastQueue.position))
        .limit(query.size)
        .offset(query.page * query.size),
      this.db
        .select({ count: count() })
        .from(userPodcastQueue)
        .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, userPodcastQueue.episodeId))
        .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
        .where(where),
      this.db
        .select({ totalDurationSeconds: sql<string>`coalesce(sum(${podcastEpisodes.durationSeconds}), 0)::bigint` })
        .from(userPodcastQueue)
        .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, userPodcastQueue.episodeId))
        .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
        .where(where),
    ]);
    return {
      items: rows.map((row, index) => ({
        ...toEpisodeListItem(row),
        queuePosition: query.page * query.size + index,
      })),
      total: Number(totalRows[0]?.count ?? 0),
      page: query.page,
      size: query.size,
      totalDurationSeconds: Number(durationRows[0]?.totalDurationSeconds ?? 0),
    };
  }

  async clearQueue(userId: number): Promise<PodcastQueueClearResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(188635121, ${userId})`);
      const previousEpisodeIds = await this.selectQueueOrder(tx, userId);
      const removed = await tx
        .delete(userPodcastQueue)
        .where(eq(userPodcastQueue.userId, userId))
        .returning({ episodeId: userPodcastQueue.episodeId });
      return { removed: removed.length, previousEpisodeIds };
    });
  }

  async clearFinishedQueue(userId: number): Promise<PodcastQueueClearResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(188635121, ${userId})`);
      const previousEpisodeIds = await this.selectQueueOrder(tx, userId);
      const removed = await tx
        .delete(userPodcastQueue)
        .where(
          and(
            eq(userPodcastQueue.userId, userId),
            sql`exists (
            select 1 from ${userPodcastEpisodeState}
            where ${userPodcastEpisodeState.userId} = ${userId}
              and ${userPodcastEpisodeState.episodeId} = ${userPodcastQueue.episodeId}
              and ${userPodcastEpisodeState.finished} = true
          )`,
          ),
        )
        .returning({ episodeId: userPodcastQueue.episodeId });
      return { removed: removed.length, previousEpisodeIds };
    });
  }

  /**
   * Replaces the queue with `episodeIds`, dropping ids the user can no longer reach and appending anything
   * queued since the snapshot so an undo never discards a newer addition.
   */

  async restoreQueue(userId: number, episodeIds: number[], accessibleLibraryIds?: number[]): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(188635121, ${userId})`);
      const unique = [...new Set(episodeIds)];
      const reachable =
        unique.length === 0
          ? []
          : await tx
              .select({ episodeId: podcastEpisodes.id })
              .from(podcastEpisodes)
              .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
              .where(
                and(
                  inArray(podcastEpisodes.id, unique),
                  accessibleLibraryIds === undefined
                    ? undefined
                    : accessibleLibraryIds.length > 0
                      ? inArray(podcasts.libraryId, accessibleLibraryIds)
                      : sql`false`,
                ),
              );
      const reachableIds = new Set(reachable.map((row) => row.episodeId));
      const restored = unique.filter((episodeId) => reachableIds.has(episodeId));
      const current = await this.selectQueueOrder(tx, userId);
      const restoredIds = new Set(restored);
      const order = [...restored, ...current.filter((episodeId) => !restoredIds.has(episodeId))].slice(0, 1000);
      await tx.delete(userPodcastQueue).where(eq(userPodcastQueue.userId, userId));
      if (order.length > 0) {
        await tx.insert(userPodcastQueue).values(order.map((episodeId, position) => ({ userId, episodeId, position })));
      }
      return restored.length;
    });
  }

  private async selectQueueOrder(tx: DbTransaction, userId: number): Promise<number[]> {
    const rows = await tx
      .select({ episodeId: userPodcastQueue.episodeId })
      .from(userPodcastQueue)
      .where(eq(userPodcastQueue.userId, userId))
      .orderBy(asc(userPodcastQueue.position));
    return rows.map((row) => row.episodeId);
  }

  async findQueuePlaybackContext(
    userId: number,
    episodeId: number,
    accessibleLibraryIds?: number[],
    upcomingLimit = 5,
  ): Promise<{ position: number | null; total: number; previous: PodcastQueueItem | null; upcoming: PodcastQueueItem[] }> {
    const libraryScope =
      accessibleLibraryIds === undefined
        ? undefined
        : accessibleLibraryIds.length > 0
          ? inArray(podcasts.libraryId, accessibleLibraryIds)
          : sql`false`;
    const where = and(eq(userPodcastQueue.userId, userId), libraryScope);
    const selectQueueItems = () =>
      this.db
        .select({
          episode: {
            id: podcastEpisodes.id,
            podcastId: podcastEpisodes.podcastId,
            title: podcastEpisodes.title,
            season: podcastEpisodes.season,
            episode: podcastEpisodes.episode,
            explicit: podcastEpisodes.explicit,
            origin: podcastEpisodes.origin,
            inFeed: podcastEpisodes.inFeed,
            publishedAt: podcastEpisodes.publishedAt,
            durationSeconds: podcastEpisodes.durationSeconds,
            enclosureType: podcastEpisodes.enclosureType,
          },
          podcastLibraryId: podcasts.libraryId,
          podcastTitle: podcasts.title,
          podcastImageUrl: podcasts.imageUrlEncrypted,
          podcastCustomArtworkAt: podcasts.customArtworkAt,
          media: {
            status: podcastEpisodeMedia.status,
            sizeBytes: podcastEpisodeMedia.sizeBytes,
            format: podcastEpisodeMedia.format,
            checksum: podcastEpisodeMedia.checksum,
          },
          state: {
            positionSeconds: userPodcastEpisodeState.positionSeconds,
            progressPercent: userPodcastEpisodeState.progressPercent,
            finished: userPodcastEpisodeState.finished,
            pinned: userPodcastEpisodeState.pinned,
            lastListenedAt: userPodcastEpisodeState.lastListenedAt,
          },
          queuedEpisodeId: userPodcastQueue.episodeId,
          queuePosition: userPodcastQueue.position,
        })
        .from(userPodcastQueue)
        .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, userPodcastQueue.episodeId))
        .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
        .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
        .leftJoin(
          userPodcastEpisodeState,
          and(eq(userPodcastEpisodeState.episodeId, podcastEpisodes.id), eq(userPodcastEpisodeState.userId, userId)),
        );
    const [currentRows, totalRows] = await Promise.all([
      this.db
        .select({ position: userPodcastQueue.position })
        .from(userPodcastQueue)
        .where(and(eq(userPodcastQueue.userId, userId), eq(userPodcastQueue.episodeId, episodeId)))
        .limit(1),
      this.db
        .select({ count: count() })
        .from(userPodcastQueue)
        .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, userPodcastQueue.episodeId))
        .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
        .where(where),
    ]);
    const storedPosition = currentRows[0]?.position ?? null;
    const [previousRows, upcomingRows, precedingRows] = await Promise.all([
      storedPosition === null
        ? Promise.resolve([])
        : selectQueueItems()
            .where(and(where, lt(userPodcastQueue.position, storedPosition)))
            .orderBy(desc(userPodcastQueue.position))
            .limit(1),
      selectQueueItems()
        .where(and(where, storedPosition === null ? undefined : gt(userPodcastQueue.position, storedPosition)))
        .orderBy(asc(userPodcastQueue.position))
        .limit(upcomingLimit),
      storedPosition === null
        ? Promise.resolve([{ count: 0 }])
        : this.db
            .select({ count: count() })
            .from(userPodcastQueue)
            .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, userPodcastQueue.episodeId))
            .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
            .where(and(where, lt(userPodcastQueue.position, storedPosition))),
    ]);
    const position = storedPosition === null ? null : Number(precedingRows[0]?.count ?? 0);
    return {
      position,
      total: Number(totalRows[0]?.count ?? 0),
      previous: previousRows[0] ? { ...toEpisodeListItem(previousRows[0]), queuePosition: Math.max(0, (position ?? 0) - 1) } : null,
      upcoming: upcomingRows.map((row, index) => ({
        ...toEpisodeListItem(row),
        queuePosition: position === null ? index : position + index + 1,
      })),
    };
  }

  async createBookmark(userId: number, episodeId: number, positionSeconds: number, title: string, note: string | null) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(188635122, ${userId})`);
      const [total] = await tx
        .select({ count: count() })
        .from(podcastBookmarks)
        .where(and(eq(podcastBookmarks.userId, userId), eq(podcastBookmarks.episodeId, episodeId)));
      if (Number(total?.count ?? 0) >= 1000) return null;
      const [row] = await tx.insert(podcastBookmarks).values({ userId, episodeId, positionSeconds, title, note }).returning();
      return row!;
    });
  }

  listBookmarks(userId: number, episodeId: number) {
    return this.db
      .select()
      .from(podcastBookmarks)
      .where(and(eq(podcastBookmarks.userId, userId), eq(podcastBookmarks.episodeId, episodeId)))
      .orderBy(asc(podcastBookmarks.positionSeconds), asc(podcastBookmarks.id))
      .limit(1000);
  }

  async findBookmarkAccess(userId: number, bookmarkId: number) {
    const [row] = await this.db
      .select({ libraryId: podcasts.libraryId })
      .from(podcastBookmarks)
      .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, podcastBookmarks.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .where(and(eq(podcastBookmarks.id, bookmarkId), eq(podcastBookmarks.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  deleteBookmark(userId: number, bookmarkId: number) {
    return this.db.delete(podcastBookmarks).where(and(eq(podcastBookmarks.id, bookmarkId), eq(podcastBookmarks.userId, userId)));
  }

  async updateBookmark(userId: number, bookmarkId: number, values: { title?: string; note?: string | null }) {
    const [row] = await this.db
      .update(podcastBookmarks)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(podcastBookmarks.id, bookmarkId), eq(podcastBookmarks.userId, userId)))
      .returning();
    return row ?? null;
  }

  async createListeningSession(userId: number, episodeId: number, sessionId: string, startedAt: Date, endedAt: Date, endPositionSeconds: number) {
    const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
    await this.db
      .insert(podcastListeningSessions)
      .values({ userId, episodeId, sessionId, startedAt, endedAt, durationSeconds, endPositionSeconds })
      .onConflictDoNothing();
  }
}
