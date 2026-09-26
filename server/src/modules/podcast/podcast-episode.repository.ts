import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { PodcastEpisodeListItem, PodcastEpisodePage, PodcastEpisodeSummary } from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  podcastEpisodeMedia,
  podcastEpisodes,
  podcastFeedAliases,
  podcasts,
  userPodcastEpisodeState,
  userPodcastFollows,
  userPodcastQueue,
} from '../../db/schema';
import { buildEpisodeRuleClauses, episodeOrderBy } from './podcast-episode-query';
import type { PodcastEpisodeRuleQuery } from './podcast-episode-query';
import { PodcastSecretService } from './podcast-secret.service';
import { toEpisodeListItem, toEpisodeSummary } from './podcast-row-mappers';

type Db = NodePgDatabase<typeof schema>;

const EPISODE_BATCH_SIZE = 500;

@Injectable()
export class PodcastEpisodeRepository {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly secrets: PodcastSecretService,
  ) {}

  async insertLocalEpisode(
    podcastId: number,
    episode: Omit<typeof podcastEpisodes.$inferInsert, 'podcastId' | 'origin'>,
    media: Omit<typeof podcastEpisodeMedia.$inferInsert, 'episodeId'>,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(podcastEpisodes)
        .values({ ...episode, podcastId, origin: 'local' })
        .onConflictDoNothing({ target: [podcastEpisodes.podcastId, podcastEpisodes.identityHash] })
        .returning({ id: podcastEpisodes.id });
      if (!inserted) return false;
      await tx
        .insert(podcastEpisodeMedia)
        .values({ episodeId: inserted.id, ...media })
        .onConflictDoNothing();
      return true;
    });
  }

  async listEpisodes(
    libraryId: number,
    userId: number,
    query: PodcastEpisodeRuleQuery & { page: number; size: number },
  ): Promise<PodcastEpisodePage> {
    const where = and(...buildEpisodeRuleClauses(libraryId, query));
    const offset = query.page * query.size;
    const joinBase = () =>
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
        })
        .from(podcastEpisodes)
        .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
        .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
        .leftJoin(userPodcastEpisodeState, and(eq(userPodcastEpisodeState.episodeId, podcastEpisodes.id), eq(userPodcastEpisodeState.userId, userId)))
        .leftJoin(userPodcastQueue, and(eq(userPodcastQueue.episodeId, podcastEpisodes.id), eq(userPodcastQueue.userId, userId)))
        .leftJoin(userPodcastFollows, and(eq(userPodcastFollows.podcastId, podcasts.id), eq(userPodcastFollows.userId, userId)));
    const [rows, totalRows] = await Promise.all([
      joinBase()
        .where(where)
        .orderBy(...episodeOrderBy(query.sort))
        .limit(query.size)
        .offset(offset),
      this.db
        .select({ count: count(), totalDurationSeconds: sql<string>`coalesce(sum(${podcastEpisodes.durationSeconds}), 0)::bigint` })
        .from(podcastEpisodes)
        .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
        .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
        .leftJoin(userPodcastEpisodeState, and(eq(userPodcastEpisodeState.episodeId, podcastEpisodes.id), eq(userPodcastEpisodeState.userId, userId)))
        .leftJoin(userPodcastFollows, and(eq(userPodcastFollows.podcastId, podcasts.id), eq(userPodcastFollows.userId, userId)))
        .where(where),
    ]);
    return {
      items: rows.map((row) => toEpisodeListItem(row)),
      total: Number(totalRows[0]?.count ?? 0),
      totalDurationSeconds: Number(totalRows[0]?.totalDurationSeconds ?? 0),
      page: query.page,
      size: query.size,
    };
  }

  /**
   * How many episodes a rule set matches, without paging any rows back. Uses the same clauses as
   * listEpisodes so a scope's badge can never disagree with the list it opens.
   */
  async countEpisodes(libraryId: number, userId: number, query: PodcastEpisodeRuleQuery): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(podcastEpisodes)
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
      .leftJoin(userPodcastEpisodeState, and(eq(userPodcastEpisodeState.episodeId, podcastEpisodes.id), eq(userPodcastEpisodeState.userId, userId)))
      .leftJoin(userPodcastFollows, and(eq(userPodcastFollows.podcastId, podcasts.id), eq(userPodcastFollows.userId, userId)))
      .where(and(...buildEpisodeRuleClauses(libraryId, query)));
    return Number(row?.count ?? 0);
  }

  /**
   * Queues the episodes a playlist matches in one statement, newest position last, honouring the queue cap.
   * Candidates are resolved with the same clauses the list uses, so what the user sees is what gets queued.
   */

  async findEpisodeForUser(episodeId: number, userId: number) {
    const [row] = await this.db
      .select({
        episode: podcastEpisodes,
        podcast: podcasts,
        media: podcastEpisodeMedia,
        state: userPodcastEpisodeState,
        queuedEpisodeId: userPodcastQueue.episodeId,
      })
      .from(podcastEpisodes)
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
      .leftJoin(userPodcastEpisodeState, and(eq(userPodcastEpisodeState.episodeId, podcastEpisodes.id), eq(userPodcastEpisodeState.userId, userId)))
      .leftJoin(userPodcastQueue, and(eq(userPodcastQueue.episodeId, podcastEpisodes.id), eq(userPodcastQueue.userId, userId)))
      .where(eq(podcastEpisodes.id, episodeId))
      .limit(1);
    return row ?? null;
  }

  async findEpisodeSummary(episodeId: number, userId: number): Promise<PodcastEpisodeSummary | null> {
    const [row] = await this.db
      .select({
        episode: podcastEpisodes,
        podcastLibraryId: podcasts.libraryId,
        podcastTitle: podcasts.title,
        podcastImageUrl: podcasts.imageUrlEncrypted,
        podcastCustomArtworkAt: podcasts.customArtworkAt,
        media: podcastEpisodeMedia,
        state: userPodcastEpisodeState,
        queuedEpisodeId: userPodcastQueue.episodeId,
      })
      .from(podcastEpisodes)
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
      .leftJoin(userPodcastEpisodeState, and(eq(userPodcastEpisodeState.episodeId, podcastEpisodes.id), eq(userPodcastEpisodeState.userId, userId)))
      .leftJoin(userPodcastQueue, and(eq(userPodcastQueue.episodeId, podcastEpisodes.id), eq(userPodcastQueue.userId, userId)))
      .where(eq(podcastEpisodes.id, episodeId))
      .limit(1);
    return row ? toEpisodeSummary(row, (encryptedUrl) => this.secrets.decrypt(encryptedUrl)) : null;
  }

  /**
   * Writes the edited fields and the resulting lock set together, so a refresh landing between the
   * two can never overwrite a value whose lock has not been stored yet.
   */

  async updateEpisodeMetadata(episodeId: number, values: Partial<typeof podcastEpisodes.$inferInsert>, lockedFields: string[]) {
    const [row] = await this.db
      .update(podcastEpisodes)
      .set({ ...values, lockedFields, updatedAt: new Date() })
      .where(eq(podcastEpisodes.id, episodeId))
      .returning();
    return row ?? null;
  }

  async findAdjacentEpisodeSummaries(
    episode: Pick<typeof podcastEpisodes.$inferSelect, 'id' | 'podcastId' | 'publishedAt' | 'createdAt'>,
    userId: number,
  ): Promise<{ previous: PodcastEpisodeListItem | null; next: PodcastEpisodeListItem | null }> {
    const selectSummary = () =>
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
        })
        .from(podcastEpisodes)
        .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
        .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
        .leftJoin(userPodcastEpisodeState, and(eq(userPodcastEpisodeState.episodeId, podcastEpisodes.id), eq(userPodcastEpisodeState.userId, userId)))
        .leftJoin(userPodcastQueue, and(eq(userPodcastQueue.episodeId, podcastEpisodes.id), eq(userPodcastQueue.userId, userId)));
    const older = episode.publishedAt
      ? or(
          isNull(podcastEpisodes.publishedAt),
          and(
            isNotNull(podcastEpisodes.publishedAt),
            or(
              lt(podcastEpisodes.publishedAt, episode.publishedAt),
              and(eq(podcastEpisodes.publishedAt, episode.publishedAt), lt(podcastEpisodes.id, episode.id)),
            ),
          ),
        )
      : and(isNull(podcastEpisodes.publishedAt), lt(podcastEpisodes.id, episode.id));
    const newer = episode.publishedAt
      ? and(
          isNotNull(podcastEpisodes.publishedAt),
          or(
            gt(podcastEpisodes.publishedAt, episode.publishedAt),
            and(eq(podcastEpisodes.publishedAt, episode.publishedAt), gt(podcastEpisodes.id, episode.id)),
          ),
        )
      : or(isNotNull(podcastEpisodes.publishedAt), and(isNull(podcastEpisodes.publishedAt), gt(podcastEpisodes.id, episode.id)));
    const [previousRows, nextRows] = await Promise.all([
      selectSummary()
        .where(and(eq(podcastEpisodes.podcastId, episode.podcastId), older))
        .orderBy(sql`${podcastEpisodes.publishedAt} desc nulls last`, desc(podcastEpisodes.id))
        .limit(1),
      selectSummary()
        .where(and(eq(podcastEpisodes.podcastId, episode.podcastId), newer))
        .orderBy(desc(sql`${podcastEpisodes.publishedAt} is null`), asc(podcastEpisodes.publishedAt), asc(podcastEpisodes.id))
        .limit(1),
    ]);
    return {
      previous: previousRows[0] ? toEpisodeListItem(previousRows[0]) : null,
      next: nextRows[0] ? toEpisodeListItem(nextRows[0]) : null,
    };
  }

  /**
   * The episode with its media and the roots its library is allowed to touch.
   *
   * Both roots are returned because they answer different questions: a download is written under
   * `libraryFolderPath`, which is BookOrbit's own, while a file that already exists may sit under
   * any of `libraryRoots` - an adopted local episode lives wherever the user keeps it. Checking a
   * read against the downloads root alone would judge every local file to be missing.
   */

  async findEpisodeMediaContext(episodeId: number) {
    const rows = await this.db
      .select({
        episode: podcastEpisodes,
        podcast: podcasts,
        media: podcastEpisodeMedia,
        folderPath: schema.libraryFolders.path,
        folderRole: schema.libraryFolders.role,
      })
      .from(podcastEpisodes)
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
      .innerJoin(schema.libraryFolders, eq(schema.libraryFolders.libraryId, podcasts.libraryId))
      .where(eq(podcastEpisodes.id, episodeId))
      .orderBy(asc(schema.libraryFolders.id));
    const first = rows[0];
    if (!first) return null;
    const downloadsRoot = rows.find((row) => row.folderRole === 'downloads')?.folderPath ?? first.folderPath;
    return {
      episode: first.episode,
      podcast: first.podcast,
      media: first.media,
      libraryFolderPath: downloadsRoot,
      libraryRoots: rows.map((row) => row.folderPath),
    };
  }

  findEpisodesByIds(episodeIds: number[]) {
    if (episodeIds.length === 0) return Promise.resolve([]);
    return this.db.select().from(podcastEpisodes).where(inArray(podcastEpisodes.id, episodeIds));
  }

  findNewestEpisodeIds(podcastId: number, limit: number) {
    return this.db
      .select({ id: podcastEpisodes.id, publishedAt: podcastEpisodes.publishedAt })
      .from(podcastEpisodes)
      .where(eq(podcastEpisodes.podcastId, podcastId))
      .orderBy(sql`${podcastEpisodes.publishedAt} desc nulls last`, desc(podcastEpisodes.id))
      .limit(limit);
  }

  /** A local-origin episode has no enclosure to fetch, so it is never downloadable no matter its media status. */

  async filterDownloadableEpisodeIds(episodeIds: number[]): Promise<number[]> {
    const downloadable = new Set<number>();
    for (let offset = 0; offset < episodeIds.length; offset += EPISODE_BATCH_SIZE) {
      const chunk = episodeIds.slice(offset, offset + EPISODE_BATCH_SIZE);
      if (chunk.length === 0) continue;
      const rows = await this.db
        .select({ episodeId: podcastEpisodeMedia.episodeId })
        .from(podcastEpisodeMedia)
        .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, podcastEpisodeMedia.episodeId))
        .where(
          and(
            inArray(podcastEpisodeMedia.episodeId, chunk),
            eq(podcastEpisodes.origin, 'feed'),
            sql`${podcastEpisodeMedia.status} not in ('local', 'queued', 'downloading')`,
          ),
        );
      for (const row of rows) downloadable.add(row.episodeId);
    }
    return episodeIds.filter((episodeId) => downloadable.has(episodeId));
  }

  async findPodcastMediaFiles(podcastId: number, afterEpisodeId = 0, limit = 200) {
    return this.db
      .select({ episodeId: podcastEpisodes.id, localPath: podcastEpisodeMedia.localPath, sizeBytes: podcastEpisodeMedia.sizeBytes })
      .from(podcastEpisodes)
      .innerJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
      .where(
        and(
          eq(podcastEpisodes.podcastId, podcastId),
          gt(podcastEpisodes.id, afterEpisodeId),
          eq(podcastEpisodeMedia.status, 'local'),
          isNotNull(podcastEpisodeMedia.localPath),
        ),
      )
      .orderBy(asc(podcastEpisodes.id))
      .limit(limit);
  }

  /** Files a bulk download removal has to leave alone, because removing them would be deletion. */

  async countLocalOriginDownloads(podcastId: number): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(podcastEpisodes)
      .innerJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
      .where(and(eq(podcastEpisodes.podcastId, podcastId), eq(podcastEpisodes.origin, 'local'), eq(podcastEpisodeMedia.status, 'local')));
    return Number(row?.count ?? 0);
  }

  /** Bytes that count against the quota but that retention is not allowed to reclaim. */

  async getUnevictableLocalBytes(libraryId: number): Promise<bigint> {
    const [row] = await this.db
      .select({ bytes: sql<string>`coalesce(sum(${podcastEpisodeMedia.sizeBytes}), 0)::bigint` })
      .from(podcastEpisodeMedia)
      .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, podcastEpisodeMedia.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .where(and(eq(podcasts.libraryId, libraryId), eq(podcastEpisodes.origin, 'local'), eq(podcastEpisodeMedia.status, 'local')));
    return BigInt(row?.bytes ?? 0);
  }

  async getPodcastMediaStats(podcastId: number): Promise<{ files: number; bytes: number }> {
    const [row] = await this.db
      .select({
        files: sql<number>`count(*)::int`,
        bytes: sql<number>`coalesce(sum(${podcastEpisodeMedia.sizeBytes}), 0)::bigint`,
      })
      .from(podcastEpisodes)
      .innerJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
      .where(and(eq(podcastEpisodes.podcastId, podcastId), eq(podcastEpisodeMedia.status, 'local'), isNotNull(podcastEpisodeMedia.localPath)));
    return { files: Number(row?.files ?? 0), bytes: Number(row?.bytes ?? 0) };
  }

  /**
   * Replaces a feed-declared runtime with the one decoded from the file the server now holds.
   *
   * Feeds routinely under-declare: dynamic ad insertion lengthens the delivered audio, so the
   * duration a publisher wrote can be minutes short of what a listener actually hears. Every
   * surface deriving "time left" or a progress fraction from the declared figure is then wrong for
   * the whole tail of the episode, and a player reading the real asset disagrees with the lists
   * around it.
   *
   * Skipped when a user has locked the field, matching the feed upsert, so an explicit edit still
   * outranks anything derived automatically.
   */
  async reconcileDurationFromMedia(episodeId: number, durationSeconds: number): Promise<boolean> {
    const [row] = await this.db
      .update(podcastEpisodes)
      .set({ durationSeconds, updatedAt: new Date() })
      .where(and(eq(podcastEpisodes.id, episodeId), sql`not (${podcastEpisodes.lockedFields} ? 'durationSeconds')`))
      .returning({ id: podcastEpisodes.id });
    return row !== undefined;
  }

  async updateMedia(episodeId: number, values: Partial<typeof podcastEpisodeMedia.$inferInsert>) {
    const [row] = await this.db
      .insert(podcastEpisodeMedia)
      .values({ episodeId, ...values })
      .onConflictDoUpdate({ target: podcastEpisodeMedia.episodeId, set: { ...values, updatedAt: new Date() } })
      .returning();
    return row!;
  }

  async markMediaQueued(episodeIds: number[]): Promise<void> {
    for (let offset = 0; offset < episodeIds.length; offset += EPISODE_BATCH_SIZE) {
      const chunk = episodeIds.slice(offset, offset + EPISODE_BATCH_SIZE);
      if (chunk.length === 0) continue;
      await this.db
        .update(podcastEpisodeMedia)
        .set({ status: 'queued', lastError: null, updatedAt: new Date() })
        .where(and(inArray(podcastEpisodeMedia.episodeId, chunk), sql`${podcastEpisodeMedia.status} not in ('local', 'downloading')`));
    }
  }

  findLocalPodcastEpisodeIds(podcastId: number, afterEpisodeId = 0, limit = 200) {
    return this.db
      .select({ id: podcastEpisodes.id })
      .from(podcastEpisodes)
      .innerJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
      .where(
        and(
          eq(podcastEpisodes.podcastId, podcastId),
          gt(podcastEpisodes.id, afterEpisodeId),
          eq(podcastEpisodes.origin, 'feed'),
          eq(podcastEpisodeMedia.status, 'local'),
        ),
      )
      .orderBy(asc(podcastEpisodes.id))
      .limit(limit);
  }

  async listAdoptedMediaPaths(libraryId: number, afterEpisodeId: number, limit: number) {
    return this.db
      .select({ episodeId: podcastEpisodes.id, localPath: podcastEpisodeMedia.localPath })
      .from(podcastEpisodeMedia)
      .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, podcastEpisodeMedia.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .where(and(eq(podcasts.libraryId, libraryId), gt(podcastEpisodes.id, afterEpisodeId), isNotNull(podcastEpisodeMedia.localPath)))
      .orderBy(asc(podcastEpisodes.id))
      .limit(limit);
  }

  /** Paths one show's media rows already claim, so a local re-import only hashes files it has not seen. */
  /** Local episodes of one show with the file each points at, for writing the folder's sidecar. */

  listLocalEpisodesForSidecar(podcastId: number, afterEpisodeId: number, limit: number) {
    return this.db
      .select({
        episodeId: podcastEpisodes.id,
        title: podcastEpisodes.title,
        description: podcastEpisodes.description,
        publishedAt: podcastEpisodes.publishedAt,
        season: podcastEpisodes.season,
        episode: podcastEpisodes.episode,
        durationSeconds: podcastEpisodes.durationSeconds,
        localPath: podcastEpisodeMedia.localPath,
      })
      .from(podcastEpisodes)
      .innerJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
      .where(
        and(
          eq(podcastEpisodes.podcastId, podcastId),
          eq(podcastEpisodes.origin, 'local'),
          gt(podcastEpisodes.id, afterEpisodeId),
          isNotNull(podcastEpisodeMedia.localPath),
        ),
      )
      .orderBy(asc(podcastEpisodes.id))
      .limit(limit);
  }

  async listPodcastMediaPaths(podcastId: number, afterEpisodeId: number, limit: number) {
    return this.db
      .select({ episodeId: podcastEpisodes.id, localPath: podcastEpisodeMedia.localPath })
      .from(podcastEpisodeMedia)
      .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, podcastEpisodeMedia.episodeId))
      .where(and(eq(podcastEpisodes.podcastId, podcastId), gt(podcastEpisodes.id, afterEpisodeId), isNotNull(podcastEpisodeMedia.localPath)))
      .orderBy(asc(podcastEpisodes.id))
      .limit(limit);
  }

  /**
   * Points a local episode back at bytes that reappeared. Deliberately narrow: it only ever writes
   * over media that is not holding a file, so a second copy of an identical episode cannot steal
   * the media row from the copy that is already playing.
   */

  async restoreLocalEpisodeMedia(
    podcastId: number,
    identityHash: string,
    values: Partial<typeof podcastEpisodeMedia.$inferInsert>,
  ): Promise<boolean> {
    const rows = await this.db
      .update(podcastEpisodeMedia)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          sql`${podcastEpisodeMedia.status} <> 'local'`,
          inArray(
            podcastEpisodeMedia.episodeId,
            this.db
              .select({ id: podcastEpisodes.id })
              .from(podcastEpisodes)
              .where(and(eq(podcastEpisodes.podcastId, podcastId), eq(podcastEpisodes.identityHash, identityHash))),
          ),
        ),
      )
      .returning({ episodeId: podcastEpisodeMedia.episodeId });
    return rows.length > 0;
  }

  /**
   * Every show a file could belong to, with the feed hashes a `WFED`/`purl` tag or a sidecar is
   * matched against.
   *
   * Feed shows only. The scan exists to tie a loose file to an episode a feed already published,
   * and a local show has no feed: its episodes already own their files by construction, so letting
   * one resolve here could only ever produce a dead end - a file "matching" a show that has no
   * episode to give it, or a second file offered to an episode that is that file.
   */

  async listPodcastsForImport(libraryId: number) {
    const [shows, aliases] = await Promise.all([
      this.db
        .select({ id: podcasts.id, title: podcasts.title, author: podcasts.author, feedUrlHash: podcasts.feedUrlHash })
        .from(podcasts)
        .where(and(eq(podcasts.libraryId, libraryId), isNull(podcasts.archivedAt), eq(podcasts.origin, 'feed')))
        .orderBy(asc(podcasts.id)),
      this.db
        .select({ podcastId: podcastFeedAliases.podcastId, urlHash: podcastFeedAliases.urlHash })
        .from(podcastFeedAliases)
        .innerJoin(podcasts, eq(podcasts.id, podcastFeedAliases.podcastId))
        .where(and(eq(podcasts.libraryId, libraryId), isNull(podcasts.archivedAt))),
    ]);
    return { shows, aliases };
  }

  /** Library-wide identity lookup: the only episode signal strong enough to trust without a resolved show. */

  findImportEpisodesByIdentityHashes(libraryId: number, identityHashes: string[]) {
    if (identityHashes.length === 0) return Promise.resolve([]);
    return this.selectImportEpisodes(and(eq(podcasts.libraryId, libraryId), inArray(podcastEpisodes.identityHash, identityHashes)));
  }

  /** Resolves the ids a `[<episodeId>]` file name suffix or a manual review decision named. */

  findImportEpisodesByIds(libraryId: number, episodeIds: number[]) {
    if (episodeIds.length === 0) return Promise.resolve([]);
    return this.selectImportEpisodes(and(eq(podcasts.libraryId, libraryId), inArray(podcastEpisodes.id, episodeIds)));
  }

  /** One page of a show's episodes, ordered by id so the importer can build its index without a cursor of its own. */

  listImportEpisodesForPodcast(podcastId: number, afterEpisodeId: number, limit: number) {
    return this.selectImportEpisodes(and(eq(podcastEpisodes.podcastId, podcastId), gt(podcastEpisodes.id, afterEpisodeId)), limit);
  }

  private selectImportEpisodes(where: SQL | undefined, limit?: number) {
    const query = this.db
      .select({
        episodeId: podcastEpisodes.id,
        podcastId: podcastEpisodes.podcastId,
        podcastTitle: podcasts.title,
        identityHash: podcastEpisodes.identityHash,
        title: podcastEpisodes.title,
        publishedAt: podcastEpisodes.publishedAt,
        durationSeconds: podcastEpisodes.durationSeconds,
        enclosureUrlEncrypted: podcastEpisodes.enclosureUrlEncrypted,
        mediaStatus: podcastEpisodeMedia.status,
        checksum: podcastEpisodeMedia.checksum,
        localSizeBytes: podcastEpisodeMedia.sizeBytes,
      })
      .from(podcastEpisodes)
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
      // Feed episodes only, for the same reason the show list is: a local episode is already the
      // file, so it can neither be missing one nor be the answer to a loose one.
      .where(and(where, eq(podcastEpisodes.origin, 'feed')))
      .orderBy(asc(podcastEpisodes.id));
    return limit === undefined ? query : query.limit(limit);
  }

  /**
   * Adopts one file, and only when nothing else owns the episode's media.
   *
   * The status test lives inside the UPDATE rather than in a read before it, so a download that
   * finished while the scan was running wins the race outright: this write either applies to a row
   * that is still remote or it applies to nothing. The insert can only create a missing row.
   */

  async attachImportedMedia(episodeId: number, values: Partial<typeof podcastEpisodeMedia.$inferInsert>): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(podcastEpisodeMedia)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(podcastEpisodeMedia.episodeId, episodeId), sql`${podcastEpisodeMedia.status} in ('remote', 'failed', 'unavailable')`))
        .returning({ episodeId: podcastEpisodeMedia.episodeId });
      if (updated.length > 0) return true;
      const inserted = await tx
        .insert(podcastEpisodeMedia)
        .values({ episodeId, ...values })
        .onConflictDoNothing()
        .returning({ episodeId: podcastEpisodeMedia.episodeId });
      return inserted.length > 0;
    });
  }

  /**
   * Downloads storage pressure may evict. Local-origin media is excluded outright: its file is the
   * only copy, so evicting it is deletion rather than eviction. Those bytes still count as used, so
   * a library dominated by local content can sit above quota with nothing left to free - the
   * download that then fails says so rather than pretending retention has more to give.
   */

  async findRetentionCandidates(libraryId: number, limit: number) {
    return this.db
      .select({
        episodeId: podcastEpisodes.id,
        podcastId: podcastEpisodes.podcastId,
        localPath: podcastEpisodeMedia.localPath,
        sizeBytes: podcastEpisodeMedia.sizeBytes,
      })
      .from(podcastEpisodeMedia)
      .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, podcastEpisodeMedia.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .where(
        and(
          eq(podcasts.libraryId, libraryId),
          eq(podcastEpisodes.origin, 'feed'),
          eq(podcastEpisodeMedia.status, 'local'),
          isNotNull(podcastEpisodeMedia.localPath),
          sql`not exists (
            select 1 from ${userPodcastEpisodeState} s
            where s.episode_id = ${podcastEpisodes.id} and (s.pinned = true or (s.position_seconds > 0 and s.finished = false))
          )`,
        ),
      )
      .orderBy(desc(sql`${podcastEpisodes.unavailableAt} is not null`), asc(podcastEpisodeMedia.downloadedAt), asc(podcastEpisodes.id))
      .limit(limit);
  }

  /**
   * Downloads that the per-show post-listen rule may remove.
   *
   * The state table is the whole test, and it is read across every user: an episode nobody holds a
   * row for was never played, so "finished" is undefined for it and it never qualifies. One
   * unfinished, pinned, or queued listener keeps the file for everyone, which is also what makes
   * the delay window undoable: marking an episode unplayed, pinning it, or re-queueing it drops it
   * straight back out of this set. A row that says finished without a `finished_at` leaves the
   * window unmeasurable, and an unmeasurable window is not an expired one.
   */

  async findFinishedCleanupCandidates(libraryId: number, limit: number) {
    return this.db
      .select({
        episodeId: podcastEpisodes.id,
        podcastId: podcastEpisodes.podcastId,
        localPath: podcastEpisodeMedia.localPath,
        sizeBytes: podcastEpisodeMedia.sizeBytes,
      })
      .from(podcastEpisodeMedia)
      .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, podcastEpisodeMedia.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .where(
        and(
          eq(podcasts.libraryId, libraryId),
          eq(podcasts.downloadCleanup, 'after_finished'),
          // Deleting the only copy of an episode because somebody finished it is data loss, not cleanup.
          eq(podcastEpisodes.origin, 'feed'),
          eq(podcastEpisodeMedia.status, 'local'),
          isNotNull(podcastEpisodeMedia.localPath),
          sql`not exists (select 1 from ${userPodcastQueue} q where q.episode_id = ${podcastEpisodes.id})`,
          sql`exists (
            select 1 from ${userPodcastEpisodeState} s
            where s.episode_id = ${podcastEpisodes.id}
            group by s.episode_id
            having bool_and(s.finished)
              and not bool_or(s.pinned)
              and max(s.finished_at) <= now() - (${podcasts.downloadCleanupDelayHours} * interval '1 hour')
          )`,
        ),
      )
      .orderBy(asc(podcastEpisodeMedia.downloadedAt), asc(podcastEpisodes.id))
      .limit(limit);
  }
}
