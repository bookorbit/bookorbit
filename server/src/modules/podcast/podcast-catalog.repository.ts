import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type {
  PodcastFeedHealth,
  PodcastListItem,
  PodcastNotificationMode,
  PodcastPage,
  PodcastPlaybackRecommendation,
  PodcastSort,
  PodcastSummary,
} from '@bookorbit/types';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  libraries,
  podcastBookmarks,
  podcastEpisodeMedia,
  podcastEpisodes,
  podcastFeedAliases,
  podcastJobs,
  podcastLibrarySettings,
  podcastListeningSessions,
  podcasts,
  userLibraryAccess,
  userPodcastEpisodeState,
  userPodcastFollows,
  userPodcastQueue,
  users,
} from '../../db/schema';
import type { ParsedPodcastEpisode, ParsedPodcastFeed } from './podcast.types';
import { PodcastFeedParserService } from './podcast-feed-parser.service';
import { PodcastSecretService } from './podcast-secret.service';
import { toPodcastListItem, toPodcastSummary } from './podcast-row-mappers';

type Db = NodePgDatabase<typeof schema>;
type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

const EPISODE_BATCH_SIZE = 500;

/**
 * The row filter behind the shows list, named so the rules are readable in one place and testable
 * without standing up the whole paged query.
 *
 * `archived` is a mode: it swaps which side of the archive line the list shows. `missing` is not;
 * it narrows whatever that mode selected, so leaving it off keeps missing shows in the default view
 * rather than hiding them.
 */
export function podcastListFilter(
  libraryId: number,
  query: { q?: string; archived: boolean; missing?: boolean; podcastIds?: number[] },
): SQL | undefined {
  return and(
    eq(podcasts.libraryId, libraryId),
    query.archived ? isNotNull(podcasts.archivedAt) : isNull(podcasts.archivedAt),
    query.missing ? isNotNull(podcasts.missingAt) : undefined,
    query.q ? or(ilike(podcasts.title, `%${query.q}%`), ilike(podcasts.author, `%${query.q}%`)) : undefined,
    query.podcastIds?.length ? inArray(podcasts.id, query.podcastIds) : undefined,
  );
}

@Injectable()
export class PodcastCatalogRepository {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly secrets: PodcastSecretService,
    private readonly parser: PodcastFeedParserService,
  ) {}

  async findPodcastLibrary(libraryId: number) {
    const [row] = await this.db
      .select()
      .from(libraries)
      .where(and(eq(libraries.id, libraryId), eq(libraries.type, 'podcasts')))
      .limit(1);
    return row ?? null;
  }

  /** The root BookOrbit downloads into. A podcast library is constrained to exactly one. */

  async findPrimaryLibraryFolder(libraryId: number): Promise<string | null> {
    const [row] = await this.db
      .select({ path: schema.libraryFolders.path })
      .from(schema.libraryFolders)
      .where(and(eq(schema.libraryFolders.libraryId, libraryId), eq(schema.libraryFolders.role, 'downloads')))
      .orderBy(asc(schema.libraryFolders.id))
      .limit(1);
    return row?.path ?? null;
  }

  /** The roots holding folders the user brought. Adopted in place, never written to, never evicted. */

  async findLocalLibraryFolders(libraryId: number): Promise<string[]> {
    const rows = await this.db
      .select({ path: schema.libraryFolders.path })
      .from(schema.libraryFolders)
      .where(and(eq(schema.libraryFolders.libraryId, libraryId), eq(schema.libraryFolders.role, 'local')))
      .orderBy(asc(schema.libraryFolders.id));
    return rows.map((row) => row.path);
  }

  /**
   * Whether the user can add a feed anywhere. Directory search is library-agnostic, so it is
   * gated on holding editor rights over at least one podcast library rather than on one id.
   */

  async hasManageablePodcastLibrary(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: libraries.id })
      .from(libraries)
      .innerJoin(userLibraryAccess, eq(userLibraryAccess.libraryId, libraries.id))
      .where(and(eq(libraries.type, 'podcasts'), eq(userLibraryAccess.userId, userId), inArray(userLibraryAccess.accessLevel, ['editor', 'owner'])))
      .limit(1);
    return Boolean(row);
  }

  findPodcastLibraryIds(afterId: number, limit: number) {
    return this.db
      .select({ id: libraries.id })
      .from(libraries)
      .where(and(eq(libraries.type, 'podcasts'), gt(libraries.id, afterId)))
      .orderBy(asc(libraries.id))
      .limit(limit);
  }

  findWatchedPodcastLibraryIds(afterId: number, limit: number) {
    return this.db
      .select({ id: libraries.id })
      .from(libraries)
      .where(and(eq(libraries.type, 'podcasts'), eq(libraries.watchLocalFolders, true), gt(libraries.id, afterId)))
      .orderBy(asc(libraries.id))
      .limit(limit);
  }

  async createPodcast(
    libraryId: number,
    feedUrl: string,
    feed: ParsedPodcastFeed,
    options: {
      acquisitionPolicy: typeof podcasts.$inferInsert.acquisitionPolicy;
      autoDownloadLimit?: number | null;
      autoDownloadWindowDays?: number | null;
      refreshIntervalMinutes: number;
      etag?: string | null;
      lastModified?: string | null;
    },
  ) {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [podcast] = await tx
        .insert(podcasts)
        .values({
          libraryId,
          title: feed.title,
          author: feed.author,
          description: feed.description,
          feedUrlEncrypted: this.secrets.encrypt(feedUrl),
          feedUrlHash: this.secrets.hashUrl(feedUrl),
          imageUrlEncrypted: feed.imageUrl ? this.secrets.encrypt(feed.imageUrl) : null,
          siteUrl: feed.siteUrl,
          language: feed.language,
          podcastType: feed.podcastType,
          explicit: feed.explicit,
          categories: feed.categories,
          acquisitionPolicy: options.acquisitionPolicy,
          autoDownloadLimit: options.autoDownloadLimit,
          autoDownloadWindowDays: options.autoDownloadWindowDays,
          refreshIntervalMinutes: options.refreshIntervalMinutes,
          nextRefreshAt: new Date(now.getTime() + options.refreshIntervalMinutes * 60_000),
          lastRefreshAt: now,
          lastRefreshSuccessAt: now,
          etag: truncateNullable(options.etag, 1000),
          lastModified: truncateNullable(options.lastModified, 1000),
        })
        .returning();
      await this.syncEpisodesTx(tx, podcast!.id, feed.episodes, now);
      return podcast!;
    });
  }

  /**
   * Creates the show a folder of loose audio becomes, or returns the one that folder already is.
   *
   * The folder path is the identity: re-importing the same folder has to reach the same row, and
   * the partial unique index makes two concurrent creations resolve to one show rather than two.
   */

  async createLocalPodcast(libraryId: number, folderPath: string, values: { title: string; author: string | null; description: string | null }) {
    const existing = await this.findLocalPodcastByFolder(libraryId, folderPath);
    if (existing) return { podcast: existing, created: false };
    const [inserted] = await this.db
      .insert(podcasts)
      .values({
        libraryId,
        origin: 'local',
        localFolderPath: folderPath,
        title: values.title,
        author: values.author,
        description: values.description,
        // A local show is never fetched, so the acquisition and refresh columns exist only to keep
        // the row shape uniform. Nothing reads them while `origin` is `local`.
        acquisitionPolicy: 'manual',
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return { podcast: inserted, created: true };
    const concurrent = await this.findLocalPodcastByFolder(libraryId, folderPath);
    if (!concurrent) throw new Error('Local podcast could not be created');
    return { podcast: concurrent, created: false };
  }

  async findLocalPodcastByFolder(libraryId: number, folderPath: string) {
    const [row] = await this.db
      .select()
      .from(podcasts)
      .where(and(eq(podcasts.libraryId, libraryId), eq(podcasts.origin, 'local'), eq(podcasts.localFolderPath, folderPath)))
      .limit(1);
    return row ?? null;
  }

  /** Unarchived local shows in one library, paged by id for the periodic folder rescan. */

  findActiveLocalPodcasts(libraryId: number, afterId: number, limit: number) {
    return this.db
      .select({ id: podcasts.id, localFolderPath: podcasts.localFolderPath, missingAt: podcasts.missingAt })
      .from(podcasts)
      .where(and(eq(podcasts.libraryId, libraryId), eq(podcasts.origin, 'local'), isNull(podcasts.archivedAt), gt(podcasts.id, afterId)))
      .orderBy(asc(podcasts.id))
      .limit(limit);
  }

  /**
   * The named shows this library actually holds. One query rather than a lookup per id, so a bulk
   * action stays a fixed cost; `archivedAt` rides along because deleting one skips the archive write
   * a show has already had.
   */
  async findPodcastsInLibrary(libraryId: number, podcastIds: number[]): Promise<Array<{ id: number; archivedAt: Date | null }>> {
    if (podcastIds.length === 0) return [];
    return this.db
      .select({ id: podcasts.id, archivedAt: podcasts.archivedAt })
      .from(podcasts)
      .where(and(eq(podcasts.libraryId, libraryId), inArray(podcasts.id, podcastIds)));
  }

  /** Folder paths in this library that are already local shows, so a report can offer the right action. */

  async findLocalPodcastIdsByFolders(libraryId: number, folderPaths: string[]): Promise<Map<string, number>> {
    if (folderPaths.length === 0) return new Map();
    const rows = await this.db
      .select({ id: podcasts.id, localFolderPath: podcasts.localFolderPath })
      .from(podcasts)
      .where(and(eq(podcasts.libraryId, libraryId), eq(podcasts.origin, 'local'), inArray(podcasts.localFolderPath, folderPaths)));
    return new Map(rows.flatMap((row) => (row.localFolderPath === null ? [] : [[row.localFolderPath, row.id] as const])));
  }

  /**
   * Adds one file as an episode of a local show, together with the media row that points at it.
   *
   * The identity is derived from the file's own bytes, so re-running over an unchanged folder
   * writes nothing: the conflict is taken, and `false` says the episode was already there.
   */

  async syncPodcastFeed(
    podcastId: number,
    feed: ParsedPodcastFeed,
    fetchMeta: { finalUrl: string; etag: string | null; lastModified: string | null; status: number; snapshotAt?: Date | null },
  ): Promise<{ insertedEpisodeIds: number[]; episodeCount: number }> {
    return this.db.transaction(async (tx) => {
      const [podcast] = await tx.select().from(podcasts).where(eq(podcasts.id, podcastId)).limit(1);
      if (!podcast || podcast.origin !== 'feed') return { insertedEpisodeIds: [], episodeCount: 0 };
      const now = new Date();
      const canonicalHash = this.secrets.hashUrl(fetchMeta.finalUrl);
      if (canonicalHash !== podcast.feedUrlHash && podcast.feedUrlHash && podcast.feedUrlEncrypted) {
        await tx
          .insert(podcastFeedAliases)
          .values({ podcastId, urlHash: podcast.feedUrlHash, urlEncrypted: podcast.feedUrlEncrypted })
          .onConflictDoNothing();
      }
      const insertedEpisodeIds = await this.syncEpisodesTx(tx, podcastId, feed.episodes, now);
      await tx
        .update(podcasts)
        .set({
          ...this.feedMetadataUpdate(podcast, feed),
          feedUrlEncrypted: this.secrets.encrypt(fetchMeta.finalUrl),
          feedUrlHash: canonicalHash,
          etag: truncateNullable(fetchMeta.etag, 1000),
          lastModified: truncateNullable(fetchMeta.lastModified, 1000),
          lastRefreshAt: now,
          lastRefreshSuccessAt: now,
          consecutiveFailures: 0,
          lastError: null,
          lastHttpStatus: fetchMeta.status,
          nextRefreshAt: new Date(now.getTime() + podcast.refreshIntervalMinutes * 60_000),
          ...(fetchMeta.snapshotAt ? { feedSnapshotAt: fetchMeta.snapshotAt } : {}),
          updatedAt: now,
        })
        .where(eq(podcasts.id, podcastId));
      return { insertedEpisodeIds, episodeCount: feed.episodes.length };
    });
  }

  /**
   * Applies a feed parsed from the stored snapshot. Deliberately leaves the HTTP cache validators,
   * refresh schedule, and failure counters alone: no request was made, so nothing about the feed's
   * reachability was learned.
   */

  async reparsePodcastFeed(podcastId: number, feed: ParsedPodcastFeed): Promise<{ insertedEpisodeIds: number[]; episodeCount: number }> {
    return this.db.transaction(async (tx) => {
      const [podcast] = await tx.select().from(podcasts).where(eq(podcasts.id, podcastId)).limit(1);
      if (!podcast || podcast.origin !== 'feed') return { insertedEpisodeIds: [], episodeCount: 0 };
      const now = new Date();
      const insertedEpisodeIds = await this.syncEpisodesTx(tx, podcastId, feed.episodes, now);
      await tx
        .update(podcasts)
        .set({ ...this.feedMetadataUpdate(podcast, feed), updatedAt: now })
        .where(eq(podcasts.id, podcastId));
      return { insertedEpisodeIds, episodeCount: feed.episodes.length };
    });
  }

  private feedMetadataUpdate(podcast: typeof podcasts.$inferSelect, feed: ParsedPodcastFeed): Partial<typeof podcasts.$inferInsert> {
    const locked = new Set(podcast.lockedFields ?? []);
    return {
      title: locked.has('title') ? podcast.title : feed.title,
      author: locked.has('author') ? podcast.author : feed.author,
      description: locked.has('description') ? podcast.description : feed.description,
      imageUrlEncrypted: locked.has('imageUrl') ? podcast.imageUrlEncrypted : feed.imageUrl ? this.secrets.encrypt(feed.imageUrl) : null,
      siteUrl: locked.has('siteUrl') ? podcast.siteUrl : feed.siteUrl,
      language: locked.has('language') ? podcast.language : feed.language,
      podcastType: locked.has('podcastType') ? podcast.podcastType : feed.podcastType,
      explicit: locked.has('explicit') ? podcast.explicit : feed.explicit,
      categories: locked.has('categories') ? podcast.categories : feed.categories,
    };
  }

  async markRefreshNotModified(podcastId: number, status: number, etag: string | null, lastModified: string | null): Promise<void> {
    const [podcast] = await this.db
      .select({ refreshIntervalMinutes: podcasts.refreshIntervalMinutes })
      .from(podcasts)
      .where(eq(podcasts.id, podcastId))
      .limit(1);
    if (!podcast) return;
    const now = new Date();
    await this.db
      .update(podcasts)
      .set({
        lastRefreshAt: now,
        lastRefreshSuccessAt: now,
        consecutiveFailures: 0,
        lastError: null,
        lastHttpStatus: status,
        etag: truncateNullable(etag, 1000),
        lastModified: truncateNullable(lastModified, 1000),
        nextRefreshAt: new Date(now.getTime() + podcast.refreshIntervalMinutes * 60_000),
        updatedAt: now,
      })
      .where(eq(podcasts.id, podcastId));
  }

  async markRefreshFailed(podcastId: number, error: string, httpStatus: number | null): Promise<number> {
    const [current] = await this.db
      .select({ consecutiveFailures: podcasts.consecutiveFailures, refreshIntervalMinutes: podcasts.refreshIntervalMinutes })
      .from(podcasts)
      .where(eq(podcasts.id, podcastId))
      .limit(1);
    if (!current) return 0;
    const failures = current.consecutiveFailures + 1;
    const baseMinutes = Math.max(5, current.refreshIntervalMinutes);
    const backoffMinutes = Math.min(24 * 60, baseMinutes * 2 ** Math.min(failures - 1, 6));
    const now = new Date();
    await this.db
      .update(podcasts)
      .set({
        lastRefreshAt: now,
        consecutiveFailures: failures,
        lastError: error.slice(0, 2000),
        lastHttpStatus: httpStatus,
        nextRefreshAt: new Date(now.getTime() + backoffMinutes * 60_000),
        updatedAt: now,
      })
      .where(eq(podcasts.id, podcastId));
    return failures;
  }

  private async syncEpisodesTx(tx: DbTransaction, podcastId: number, episodes: ParsedPodcastEpisode[], now: Date): Promise<number[]> {
    await tx
      .update(podcastEpisodes)
      .set({ inFeed: false, unavailableAt: sql`coalesce(${podcastEpisodes.unavailableAt}, ${now})`, updatedAt: now })
      .where(eq(podcastEpisodes.podcastId, podcastId));
    const newlyInsertedIds: number[] = [];
    for (let offset = 0; offset < episodes.length; offset += EPISODE_BATCH_SIZE) {
      const chunk = episodes.slice(offset, offset + EPISODE_BATCH_SIZE);
      const identityHashes = chunk.map((episode) => this.parser.identityHash(episode.identity));
      const existing = await tx
        .select({ id: podcastEpisodes.id, identityHash: podcastEpisodes.identityHash })
        .from(podcastEpisodes)
        .where(and(eq(podcastEpisodes.podcastId, podcastId), inArray(podcastEpisodes.identityHash, identityHashes)));
      const existingHashes = new Set(existing.map((row) => row.identityHash));
      const returned = await tx
        .insert(podcastEpisodes)
        .values(chunk.map((episode) => this.episodeInsert(podcastId, episode, now)))
        .onConflictDoUpdate({
          target: [podcastEpisodes.podcastId, podcastEpisodes.identityHash],
          set: {
            guid: sql`excluded.guid`,
            title: sql`case when ${podcastEpisodes.lockedFields} ? 'title' then ${podcastEpisodes.title} else excluded.title end`,
            subtitle: sql`case when ${podcastEpisodes.lockedFields} ? 'subtitle' then ${podcastEpisodes.subtitle} else excluded.subtitle end`,
            description: sql`case when ${podcastEpisodes.lockedFields} ? 'description' then ${podcastEpisodes.description} else excluded.description end`,
            publishedAt: sql`case when ${podcastEpisodes.lockedFields} ? 'publishedAt' then ${podcastEpisodes.publishedAt} else excluded.published_at end`,
            season: sql`case when ${podcastEpisodes.lockedFields} ? 'season' then ${podcastEpisodes.season} else excluded.season end`,
            episode: sql`case when ${podcastEpisodes.lockedFields} ? 'episode' then ${podcastEpisodes.episode} else excluded.episode end`,
            episodeType: sql`case when ${podcastEpisodes.lockedFields} ? 'episodeType' then ${podcastEpisodes.episodeType} else excluded.episode_type end`,
            durationSeconds: sql`case when ${podcastEpisodes.lockedFields} ? 'durationSeconds' then ${podcastEpisodes.durationSeconds} else excluded.duration_seconds end`,
            explicit: sql`case when ${podcastEpisodes.lockedFields} ? 'explicit' then ${podcastEpisodes.explicit} else excluded.explicit end`,
            enclosureUrlEncrypted: sql`excluded.enclosure_url_encrypted`,
            enclosureUrlHash: sql`excluded.enclosure_url_hash`,
            enclosureType: sql`excluded.enclosure_type`,
            enclosureSizeBytes: sql`excluded.enclosure_size_bytes`,
            chapters: sql`case when ${podcastEpisodes.lockedFields} ? 'chapters' then ${podcastEpisodes.chapters} else excluded.chapters end`,
            transcripts: sql`excluded.transcripts`,
            inFeed: true,
            lastSeenAt: now,
            unavailableAt: null,
            updatedAt: now,
          },
        })
        .returning({ id: podcastEpisodes.id, identityHash: podcastEpisodes.identityHash });
      for (const row of returned) {
        if (!existingHashes.has(row.identityHash)) newlyInsertedIds.push(row.id);
      }
      if (returned.length > 0) {
        await tx
          .insert(podcastEpisodeMedia)
          .values(returned.map((row) => ({ episodeId: row.id, status: 'remote' })))
          .onConflictDoNothing();
      }
    }
    return newlyInsertedIds;
  }

  private episodeInsert(podcastId: number, episode: ParsedPodcastEpisode, now: Date): typeof podcastEpisodes.$inferInsert {
    return {
      podcastId,
      identityHash: this.parser.identityHash(episode.identity),
      guid: episode.guid,
      title: episode.title,
      subtitle: episode.subtitle,
      description: episode.description,
      publishedAt: episode.publishedAt,
      season: episode.season,
      episode: episode.episode,
      episodeType: episode.episodeType,
      durationSeconds: episode.durationSeconds,
      explicit: episode.explicit,
      enclosureUrlEncrypted: this.secrets.encrypt(episode.enclosureUrl),
      enclosureUrlHash: this.secrets.hashUrl(episode.enclosureUrl),
      enclosureType: episode.enclosureType,
      enclosureSizeBytes: episode.enclosureSizeBytes,
      chapters: episode.chapters,
      transcripts: episode.transcripts,
      inFeed: true,
      lastSeenAt: now,
    };
  }

  async listPodcasts(
    libraryId: number,
    userId: number,
    query: { page: number; size: number; q?: string; archived: boolean; missing?: boolean; sort?: PodcastSort; podcastIds?: number[] },
  ): Promise<PodcastPage<PodcastListItem>> {
    const where = podcastListFilter(libraryId, query);
    const offset = query.page * query.size;
    const order =
      query.sort === 'recent'
        ? [sql`max(${podcastEpisodes.publishedAt}) desc nulls last`, asc(podcasts.title), asc(podcasts.id)]
        : query.sort === 'unplayed'
          ? [
              sql`count(${podcastEpisodes.id}) filter (where coalesce(${userPodcastEpisodeState.finished}, false) = false) desc`,
              asc(podcasts.title),
              asc(podcasts.id),
            ]
          : [asc(podcasts.title), asc(podcasts.id)];
    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          podcast: {
            id: podcasts.id,
            libraryId: podcasts.libraryId,
            origin: podcasts.origin,
            title: podcasts.title,
            author: podcasts.author,
            imageUrlEncrypted: podcasts.imageUrlEncrypted,
            customArtworkAt: podcasts.customArtworkAt,
            archivedAt: podcasts.archivedAt,
            missingAt: podcasts.missingAt,
            consecutiveFailures: podcasts.consecutiveFailures,
          },
          episodeCount: sql<number>`count(${podcastEpisodes.id})::int`,
          unplayedCount: sql<number>`count(${podcastEpisodes.id}) filter (
            where coalesce(${userPodcastEpisodeState.finished}, false) = false
          )::int`,
          downloadedCount: sql<number>`count(${podcastEpisodes.id}) filter (
            where ${podcastEpisodeMedia.status} = 'local'
          )::int`,
          latestPublishedAt: sql<Date | string | null>`max(${podcastEpisodes.publishedAt})`,
          followedUserId: userPodcastFollows.userId,
          notificationMode: userPodcastFollows.notificationMode,
        })
        .from(podcasts)
        .leftJoin(podcastEpisodes, eq(podcastEpisodes.podcastId, podcasts.id))
        .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
        .leftJoin(userPodcastEpisodeState, and(eq(userPodcastEpisodeState.episodeId, podcastEpisodes.id), eq(userPodcastEpisodeState.userId, userId)))
        .leftJoin(userPodcastFollows, and(eq(userPodcastFollows.podcastId, podcasts.id), eq(userPodcastFollows.userId, userId)))
        .where(where)
        .groupBy(podcasts.id, userPodcastFollows.userId, userPodcastFollows.notificationMode)
        .orderBy(...order)
        .limit(query.size)
        .offset(offset),
      this.db.select({ count: count() }).from(podcasts).where(where),
    ]);
    const recommendations = await this.findPlaybackRecommendations(
      userId,
      rows.map((row) => row.podcast.id),
    );
    return {
      items: rows.map((row) =>
        toPodcastListItem(
          row.podcast,
          {
            episodeCount: row.episodeCount,
            unplayedCount: row.unplayedCount,
            downloadedCount: row.downloadedCount,
            latestPublishedAt: row.latestPublishedAt,
          },
          recommendations.get(row.podcast.id) ?? null,
          row.followedUserId !== null,
          row.notificationMode ?? 'off',
        ),
      ),
      total: Number(totalRows[0]?.count ?? 0),
      page: query.page,
      size: query.size,
    };
  }

  async findPodcast(podcastId: number) {
    const [row] = await this.db.select().from(podcasts).where(eq(podcasts.id, podcastId)).limit(1);
    return row ?? null;
  }

  async findPodcastSummary(podcastId: number, userId: number): Promise<PodcastSummary | null> {
    const [row] = await this.db
      .select({
        podcast: podcasts,
        episodeCount: sql<number>`count(${podcastEpisodes.id})::int`,
        unplayedCount: sql<number>`count(${podcastEpisodes.id}) filter (
          where coalesce(${userPodcastEpisodeState.finished}, false) = false
        )::int`,
        downloadedCount: sql<number>`count(${podcastEpisodes.id}) filter (
          where ${podcastEpisodeMedia.status} = 'local'
        )::int`,
        followedUserId: userPodcastFollows.userId,
        notificationMode: userPodcastFollows.notificationMode,
      })
      .from(podcasts)
      .leftJoin(podcastEpisodes, eq(podcastEpisodes.podcastId, podcasts.id))
      .leftJoin(podcastEpisodeMedia, eq(podcastEpisodeMedia.episodeId, podcastEpisodes.id))
      .leftJoin(userPodcastEpisodeState, and(eq(userPodcastEpisodeState.episodeId, podcastEpisodes.id), eq(userPodcastEpisodeState.userId, userId)))
      .leftJoin(userPodcastFollows, and(eq(userPodcastFollows.podcastId, podcasts.id), eq(userPodcastFollows.userId, userId)))
      .where(eq(podcasts.id, podcastId))
      .groupBy(podcasts.id, userPodcastFollows.userId, userPodcastFollows.notificationMode)
      .limit(1);
    if (!row) return null;
    const recommendation = (await this.findPlaybackRecommendations(userId, [podcastId])).get(podcastId) ?? null;
    return toPodcastSummary(
      row.podcast,
      {
        episodeCount: row.episodeCount,
        unplayedCount: row.unplayedCount,
        downloadedCount: row.downloadedCount,
      },
      recommendation,
      row.followedUserId !== null,
      row.notificationMode ?? 'off',
    );
  }

  async findPodcastInLibrary(podcastId: number, libraryId: number) {
    const [row] = await this.db
      .select()
      .from(podcasts)
      .where(and(eq(podcasts.id, podcastId), eq(podcasts.libraryId, libraryId)))
      .limit(1);
    return row ?? null;
  }

  /** Feed shows only: OPML carries one `xmlUrl` per outline, and a local show has no address to write. */

  listPodcastSecrets(libraryId: number, includeArchived: boolean, afterId: number, limit: number) {
    return this.db
      .select({ id: podcasts.id, title: podcasts.title, feedUrlEncrypted: podcasts.feedUrlEncrypted })
      .from(podcasts)
      .where(and(this.opmlExportScope(libraryId, includeArchived), eq(podcasts.origin, 'feed'), gt(podcasts.id, afterId)))
      .orderBy(asc(podcasts.id))
      .limit(limit);
  }

  /** How many shows the export leaves behind, so the omission is reported rather than silent. */

  async countLocalPodcasts(libraryId: number, includeArchived: boolean): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(podcasts)
      .where(and(this.opmlExportScope(libraryId, includeArchived), eq(podcasts.origin, 'local')));
    return Number(row?.count ?? 0);
  }

  /** Live feeds currently in a failing state, matching the scope `listFeedHealth` reports on. */
  async countFailingFeeds(libraryId: number): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(podcasts)
      .where(and(eq(podcasts.libraryId, libraryId), eq(podcasts.origin, 'feed'), isNull(podcasts.archivedAt), gt(podcasts.consecutiveFailures, 0)));
    return Number(row?.count ?? 0);
  }

  private opmlExportScope(libraryId: number, includeArchived: boolean): SQL | undefined {
    return and(eq(podcasts.libraryId, libraryId), includeArchived ? undefined : isNull(podcasts.archivedAt));
  }

  async findPodcastByFeedHash(libraryId: number, feedHash: string) {
    const [direct] = await this.db
      .select()
      .from(podcasts)
      .where(and(eq(podcasts.libraryId, libraryId), eq(podcasts.feedUrlHash, feedHash)))
      .limit(1);
    if (direct) return direct;
    const [alias] = await this.db
      .select({ podcast: podcasts })
      .from(podcastFeedAliases)
      .innerJoin(podcasts, eq(podcasts.id, podcastFeedAliases.podcastId))
      .where(and(eq(podcasts.libraryId, libraryId), eq(podcastFeedAliases.urlHash, feedHash)))
      .limit(1);
    return alias?.podcast ?? null;
  }

  /**
   * Resolves feed hashes to the shows they already belong to, in one round trip per source table.
   * `accessibleLibraryIds` is undefined only for a superuser; an empty list means the caller can
   * see nothing, which is a valid answer rather than an unfiltered query.
   */

  async findPodcastIdsByFeedHashes(
    feedHashes: string[],
    accessibleLibraryIds?: number[],
  ): Promise<Array<{ feedHash: string; podcastId: number; libraryId: number }>> {
    if (feedHashes.length === 0 || accessibleLibraryIds?.length === 0) return [];
    const scope = accessibleLibraryIds ? inArray(podcasts.libraryId, accessibleLibraryIds) : undefined;
    const [direct, aliased] = await Promise.all([
      this.db
        .select({ feedHash: podcasts.feedUrlHash, podcastId: podcasts.id, libraryId: podcasts.libraryId })
        .from(podcasts)
        .where(and(inArray(podcasts.feedUrlHash, feedHashes), scope)),
      this.db
        .select({ feedHash: podcastFeedAliases.urlHash, podcastId: podcasts.id, libraryId: podcasts.libraryId })
        .from(podcastFeedAliases)
        .innerJoin(podcasts, eq(podcasts.id, podcastFeedAliases.podcastId))
        .where(and(inArray(podcastFeedAliases.urlHash, feedHashes), scope)),
    ]);
    // A hash-equality filter never matches a null column, so the direct rows always carry a hash.
    return [...direct.flatMap((row) => (row.feedHash === null ? [] : [{ ...row, feedHash: row.feedHash }])), ...aliased];
  }

  async updatePodcast(podcastId: number, values: Partial<typeof podcasts.$inferInsert>) {
    const [row] = await this.db
      .update(podcasts)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(podcasts.id, podcastId))
      .returning();
    return row ?? null;
  }

  async archivePodcast(podcastId: number, archived: boolean) {
    const now = new Date();
    const [row] = await this.db
      .update(podcasts)
      .set({ archivedAt: archived ? now : null, nextRefreshAt: now, updatedAt: now })
      .where(eq(podcasts.id, podcastId))
      .returning();
    return row ?? null;
  }

  async deletePodcast(podcastId: number): Promise<void> {
    await this.db.delete(podcasts).where(eq(podcasts.id, podcastId));
  }

  /**
   * Flags a local show whose folder is gone from disk, or clears the flag once it is back. The
   * predicate makes the write a real transition, so a sweep over an unchanged library writes
   * nothing and only genuine appearances and disappearances are counted and logged.
   */
  async setLocalPodcastMissing(podcastId: number, missing: boolean): Promise<boolean> {
    const now = new Date();
    const [row] = await this.db
      .update(podcasts)
      .set({ missingAt: missing ? now : null, updatedAt: now })
      .where(and(eq(podcasts.id, podcastId), missing ? isNull(podcasts.missingAt) : isNotNull(podcasts.missingAt)))
      .returning({ id: podcasts.id });
    return row !== undefined;
  }

  /** Local shows have no feed, so they are never due: the origin test matches the scheduler's index. */

  findDuePodcasts(limit: number) {
    return this.db
      .select({ id: podcasts.id, libraryId: podcasts.libraryId })
      .from(podcasts)
      .where(
        and(
          isNull(podcasts.archivedAt),
          eq(podcasts.origin, 'feed'),
          sql`${podcasts.nextRefreshAt} <= now()`,
          sql`not exists (
            select 1 from ${podcastJobs} j
            where j.podcast_id = ${podcasts.id}
              and j.type = 'refresh'
              and j.status in ('queued', 'processing')
          )`,
        ),
      )
      .orderBy(asc(podcasts.nextRefreshAt), asc(podcasts.id))
      .limit(limit);
  }

  /** Shared by the episode list and by bulk queueing, so both resolve a playlist to exactly the same rows. */

  async upsertFollow(userId: number, podcastId: number, notificationMode: PodcastNotificationMode) {
    const now = new Date();
    const [row] = await this.db
      .insert(userPodcastFollows)
      .values({ userId, podcastId, notificationMode, lastNotifiedAt: now })
      .onConflictDoUpdate({
        target: [userPodcastFollows.userId, userPodcastFollows.podcastId],
        set: { notificationMode, lastNotifiedAt: now },
      })
      .returning();
    return row!;
  }

  unfollow(userId: number, podcastId: number) {
    return this.db.delete(userPodcastFollows).where(and(eq(userPodcastFollows.userId, userId), eq(userPodcastFollows.podcastId, podcastId)));
  }

  /**
   * `notOlderThan` makes the conflict update conditional on the stored row not being newer, so a
   * late write from a device draining an offline queue is skipped rather than clobbering the row.
   * A skipped update returns no row from RETURNING, so the stored row is read back instead.
   *
   * A write that finishes the episode also removes it from the user's queue, in the same
   * transaction, so every client converges without issuing its own queue delete: an offline
   * device cannot, and its queued finished-state write dequeues for it on reconnect.
   */

  async getLibrarySettings(libraryId: number) {
    await this.db.insert(podcastLibrarySettings).values({ libraryId }).onConflictDoNothing();
    const [row] = await this.db.select().from(podcastLibrarySettings).where(eq(podcastLibrarySettings.libraryId, libraryId)).limit(1);
    const [used] = await this.db
      .select({ bytes: sql<bigint>`coalesce(sum(${podcastEpisodeMedia.sizeBytes}), 0)::bigint` })
      .from(podcastEpisodeMedia)
      .innerJoin(podcastEpisodes, eq(podcastEpisodes.id, podcastEpisodeMedia.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, podcastEpisodes.podcastId))
      .where(and(eq(podcasts.libraryId, libraryId), eq(podcastEpisodeMedia.status, 'local')));
    return { ...row!, usedStorageBytes: BigInt(used?.bytes ?? 0) };
  }

  async updateLibrarySettings(libraryId: number, values: Partial<typeof podcastLibrarySettings.$inferInsert>) {
    const [row] = await this.db
      .insert(podcastLibrarySettings)
      .values({ libraryId, ...values })
      .onConflictDoUpdate({ target: podcastLibrarySettings.libraryId, set: { ...values, updatedAt: new Date() } })
      .returning();
    return row!;
  }

  /**
   * Local-file import reads.
   *
   * Every one of these is keyed on the library, batched, and returns only the columns the matcher
   * compares on. A library holds tens of thousands of episodes, so nothing here loads a whole
   * library into memory: the import service pages through one show at a time.
   */

  /** Absolute paths a media row already claims, so the walk can skip files it adopted on an earlier run. */

  /** A local show has no feed, so it has no feed health to report and nothing a retry could fix. */

  async listFeedHealth(libraryId: number, query: { page: number; size: number; q?: string }): Promise<PodcastPage<PodcastFeedHealth>> {
    const where = and(
      eq(podcasts.libraryId, libraryId),
      eq(podcasts.origin, 'feed'),
      isNull(podcasts.archivedAt),
      query.q ? ilike(podcasts.title, `%${query.q}%`) : undefined,
    );
    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          podcastId: podcasts.id,
          title: podcasts.title,
          lastRefreshAt: podcasts.lastRefreshAt,
          lastRefreshSuccessAt: podcasts.lastRefreshSuccessAt,
          consecutiveFailures: podcasts.consecutiveFailures,
          nextRefreshAt: podcasts.nextRefreshAt,
          lastError: podcasts.lastError,
          lastHttpStatus: podcasts.lastHttpStatus,
        })
        .from(podcasts)
        .where(where)
        .orderBy(desc(podcasts.consecutiveFailures), asc(podcasts.title), asc(podcasts.id))
        .limit(query.size)
        .offset(query.page * query.size),
      this.db.select({ count: count() }).from(podcasts).where(where),
    ]);
    return {
      items: rows.map((row) => ({
        ...row,
        lastRefreshAt: row.lastRefreshAt?.toISOString() ?? null,
        lastRefreshSuccessAt: row.lastRefreshSuccessAt?.toISOString() ?? null,
        nextRefreshAt: row.nextRefreshAt.toISOString(),
      })),
      total: Number(totalRows[0]?.count ?? 0),
      page: query.page,
      size: query.size,
    };
  }

  async mergePodcastInto(sourcePodcastId: number, targetPodcastId: number, libraryId: number): Promise<number> {
    let cleanupFiles = 0;
    for (;;) {
      const sourceEpisodes = await this.db
        .select({ id: podcastEpisodes.id, identityHash: podcastEpisodes.identityHash })
        .from(podcastEpisodes)
        .where(eq(podcastEpisodes.podcastId, sourcePodcastId))
        .orderBy(asc(podcastEpisodes.id))
        .limit(200);
      if (sourceEpisodes.length === 0) break;
      for (const source of sourceEpisodes) {
        const scheduledCleanupFiles = await this.db.transaction(async (tx) => {
          const [target] = await tx
            .select({ id: podcastEpisodes.id })
            .from(podcastEpisodes)
            .where(and(eq(podcastEpisodes.podcastId, targetPodcastId), eq(podcastEpisodes.identityHash, source.identityHash)))
            .limit(1);
          if (!target) {
            await tx.update(podcastEpisodes).set({ podcastId: targetPodcastId, updatedAt: new Date() }).where(eq(podcastEpisodes.id, source.id));
            return 0;
          }
          let scheduled = 0;
          await tx.execute(sql`
            insert into ${userPodcastEpisodeState} (user_id, episode_id, position_seconds, progress_percent, finished, finished_at, pinned, last_listened_at, updated_at)
            select user_id, ${target.id}, position_seconds, progress_percent, finished, finished_at, pinned, last_listened_at, updated_at
            from ${userPodcastEpisodeState} where episode_id = ${source.id}
            on conflict (user_id, episode_id) do update set
              position_seconds = greatest(${userPodcastEpisodeState.positionSeconds}, excluded.position_seconds),
              progress_percent = greatest(${userPodcastEpisodeState.progressPercent}, excluded.progress_percent),
              finished = ${userPodcastEpisodeState.finished} or excluded.finished,
              finished_at = coalesce(${userPodcastEpisodeState.finishedAt}, excluded.finished_at),
              pinned = ${userPodcastEpisodeState.pinned} or excluded.pinned,
              last_listened_at = greatest(${userPodcastEpisodeState.lastListenedAt}, excluded.last_listened_at),
              updated_at = greatest(${userPodcastEpisodeState.updatedAt}, excluded.updated_at)
          `);
          await tx.delete(userPodcastEpisodeState).where(eq(userPodcastEpisodeState.episodeId, source.id));
          await tx.execute(
            sql`delete from ${userPodcastQueue} q where q.episode_id = ${source.id} and exists (select 1 from ${userPodcastQueue} t where t.user_id = q.user_id and t.episode_id = ${target.id})`,
          );
          await tx.update(userPodcastQueue).set({ episodeId: target.id }).where(eq(userPodcastQueue.episodeId, source.id));
          await tx.execute(
            sql`delete from ${podcastBookmarks} b where b.episode_id = ${source.id} and exists (
              select 1 from ${podcastBookmarks} t
              where t.user_id = b.user_id
                and t.episode_id = ${target.id}
                and t.position_seconds = b.position_seconds
                and t.title = b.title
                and t.note is not distinct from b.note
            )`,
          );
          await tx.update(podcastBookmarks).set({ episodeId: target.id }).where(eq(podcastBookmarks.episodeId, source.id));
          await tx.update(podcastListeningSessions).set({ episodeId: target.id }).where(eq(podcastListeningSessions.episodeId, source.id));
          const [sourceMedia] = await tx.select().from(podcastEpisodeMedia).where(eq(podcastEpisodeMedia.episodeId, source.id)).limit(1);
          const [targetMedia] = await tx.select().from(podcastEpisodeMedia).where(eq(podcastEpisodeMedia.episodeId, target.id)).limit(1);
          if (sourceMedia?.status === 'local' && sourceMedia.localPath && targetMedia?.status !== 'local') {
            if (targetMedia?.localPath && targetMedia.localPath !== sourceMedia.localPath) {
              const rows = await tx
                .insert(podcastJobs)
                .values({
                  type: 'file_cleanup',
                  dedupeKey: `file_cleanup:merge:target:${source.id}`,
                  libraryId,
                  status: 'queued',
                  payload: { path: targetMedia.localPath },
                })
                .onConflictDoNothing()
                .returning({ id: podcastJobs.id });
              scheduled += rows.length;
            }
            await tx
              .insert(podcastEpisodeMedia)
              .values({
                episodeId: target.id,
                status: sourceMedia.status,
                localPath: sourceMedia.localPath,
                fileName: sourceMedia.fileName,
                format: sourceMedia.format,
                mimeType: sourceMedia.mimeType,
                sizeBytes: sourceMedia.sizeBytes,
                checksum: sourceMedia.checksum,
                downloadedAt: sourceMedia.downloadedAt,
                lastRemoteValidatedAt: sourceMedia.lastRemoteValidatedAt,
                lastError: sourceMedia.lastError,
              })
              .onConflictDoUpdate({
                target: podcastEpisodeMedia.episodeId,
                set: {
                  status: sourceMedia.status,
                  localPath: sourceMedia.localPath,
                  fileName: sourceMedia.fileName,
                  format: sourceMedia.format,
                  mimeType: sourceMedia.mimeType,
                  sizeBytes: sourceMedia.sizeBytes,
                  checksum: sourceMedia.checksum,
                  downloadedAt: sourceMedia.downloadedAt,
                  lastRemoteValidatedAt: sourceMedia.lastRemoteValidatedAt,
                  lastError: sourceMedia.lastError,
                  updatedAt: new Date(),
                },
              });
          } else if (sourceMedia?.localPath) {
            const rows = await tx
              .insert(podcastJobs)
              .values({
                type: 'file_cleanup',
                dedupeKey: `file_cleanup:merge:${source.id}`,
                libraryId,
                status: 'queued',
                payload: { path: sourceMedia.localPath },
              })
              .onConflictDoNothing()
              .returning({ id: podcastJobs.id });
            scheduled += rows.length;
          }
          await tx.delete(podcastEpisodes).where(eq(podcastEpisodes.id, source.id));
          return scheduled;
        });
        cleanupFiles += scheduledCleanupFiles;
      }
    }
    await this.db.transaction(async (tx) => {
      // A local source carries no feed address, so there is no alias to inherit from it.
      await tx.execute(sql`
        insert into ${podcastFeedAliases} (podcast_id, url_hash, url_encrypted)
        select ${targetPodcastId}, feed_url_hash, feed_url_encrypted
        from ${podcasts}
        where id = ${sourcePodcastId} and feed_url_hash is not null and feed_url_encrypted is not null
        on conflict (podcast_id, url_hash) do nothing
      `);
      await tx.execute(sql`
        insert into ${podcastFeedAliases} (podcast_id, url_hash, url_encrypted, created_at)
        select ${targetPodcastId}, url_hash, url_encrypted, created_at
        from ${podcastFeedAliases}
        where podcast_id = ${sourcePodcastId}
        on conflict (podcast_id, url_hash) do nothing
      `);
      await tx.execute(sql`
        insert into ${userPodcastFollows} (user_id, podcast_id, notification_mode, last_notified_at, created_at)
        select user_id, ${targetPodcastId}, notification_mode, last_notified_at, created_at
        from ${userPodcastFollows}
        where podcast_id = ${sourcePodcastId}
        on conflict (user_id, podcast_id) do nothing
      `);
      await tx.delete(podcasts).where(eq(podcasts.id, sourcePodcastId));
    });
    return cleanupFiles;
  }

  async listFollowedUsers(podcastId: number, mode: PodcastNotificationMode, afterUserId = 0, limit = 200) {
    return this.db
      .select({ userId: userPodcastFollows.userId })
      .from(userPodcastFollows)
      .innerJoin(podcasts, eq(podcasts.id, userPodcastFollows.podcastId))
      .innerJoin(users, eq(users.id, userPodcastFollows.userId))
      .leftJoin(userLibraryAccess, and(eq(userLibraryAccess.userId, userPodcastFollows.userId), eq(userLibraryAccess.libraryId, podcasts.libraryId)))
      .where(
        and(
          eq(userPodcastFollows.podcastId, podcastId),
          eq(userPodcastFollows.notificationMode, mode),
          gt(userPodcastFollows.userId, afterUserId),
          eq(users.active, true),
          or(eq(users.isSuperuser, true), isNotNull(userLibraryAccess.userId)),
        ),
      )
      .orderBy(asc(userPodcastFollows.userId))
      .limit(limit);
  }

  findDueDigestFollows(limit: number) {
    return this.db
      .select({
        userId: userPodcastFollows.userId,
        podcastId: userPodcastFollows.podcastId,
        libraryId: podcasts.libraryId,
      })
      .from(userPodcastFollows)
      .innerJoin(podcasts, eq(podcasts.id, userPodcastFollows.podcastId))
      .innerJoin(users, eq(users.id, userPodcastFollows.userId))
      .leftJoin(userLibraryAccess, and(eq(userLibraryAccess.userId, userPodcastFollows.userId), eq(userLibraryAccess.libraryId, podcasts.libraryId)))
      .where(
        and(
          isNull(podcasts.archivedAt),
          eq(users.active, true),
          or(eq(users.isSuperuser, true), isNotNull(userLibraryAccess.userId)),
          or(
            and(eq(userPodcastFollows.notificationMode, 'daily'), sql`${userPodcastFollows.lastNotifiedAt} <= now() - interval '1 day'`),
            and(eq(userPodcastFollows.notificationMode, 'weekly'), sql`${userPodcastFollows.lastNotifiedAt} <= now() - interval '7 days'`),
          ),
          sql`not exists (
            select 1 from ${podcastJobs} j
            where j.podcast_id = ${userPodcastFollows.podcastId}
              and j.requested_by_user_id = ${userPodcastFollows.userId}
              and j.type = 'digest'
              and j.status in ('queued', 'processing')
          )`,
        ),
      )
      .orderBy(asc(userPodcastFollows.lastNotifiedAt), asc(userPodcastFollows.userId), asc(userPodcastFollows.podcastId))
      .limit(limit);
  }

  async findFollow(userId: number, podcastId: number) {
    const [row] = await this.db
      .select({ follow: userPodcastFollows })
      .from(userPodcastFollows)
      .innerJoin(podcasts, eq(podcasts.id, userPodcastFollows.podcastId))
      .innerJoin(users, eq(users.id, userPodcastFollows.userId))
      .leftJoin(userLibraryAccess, and(eq(userLibraryAccess.userId, userPodcastFollows.userId), eq(userLibraryAccess.libraryId, podcasts.libraryId)))
      .where(
        and(
          eq(userPodcastFollows.userId, userId),
          eq(userPodcastFollows.podcastId, podcastId),
          eq(users.active, true),
          or(eq(users.isSuperuser, true), isNotNull(userLibraryAccess.userId)),
        ),
      )
      .limit(1);
    return row?.follow ?? null;
  }

  async countEpisodesCreatedSince(podcastId: number, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(podcastEpisodes)
      .where(and(eq(podcastEpisodes.podcastId, podcastId), gt(podcastEpisodes.createdAt, since)));
    return Number(row?.count ?? 0);
  }

  async markFollowNotified(userId: number, podcastId: number, notifiedAt = new Date()): Promise<void> {
    await this.db
      .update(userPodcastFollows)
      .set({ lastNotifiedAt: notifiedAt })
      .where(and(eq(userPodcastFollows.userId, userId), eq(userPodcastFollows.podcastId, podcastId)));
  }

  async markFollowsNotified(userIds: number[], podcastId: number, notifiedAt = new Date()): Promise<void> {
    if (userIds.length === 0) return;
    await this.db
      .update(userPodcastFollows)
      .set({ lastNotifiedAt: notifiedAt })
      .where(and(eq(userPodcastFollows.podcastId, podcastId), inArray(userPodcastFollows.userId, userIds)));
  }

  private async findPlaybackRecommendations(userId: number, podcastIds: number[]): Promise<Map<number, PodcastPlaybackRecommendation>> {
    if (podcastIds.length === 0) return new Map();
    const [resumeRows, latestRows] = await Promise.all([
      this.db
        .selectDistinctOn([podcastEpisodes.podcastId], {
          podcastId: podcastEpisodes.podcastId,
          episodeId: podcastEpisodes.id,
          title: podcastEpisodes.title,
          positionSeconds: userPodcastEpisodeState.positionSeconds,
          durationSeconds: podcastEpisodes.durationSeconds,
        })
        .from(podcastEpisodes)
        .innerJoin(
          userPodcastEpisodeState,
          and(eq(userPodcastEpisodeState.episodeId, podcastEpisodes.id), eq(userPodcastEpisodeState.userId, userId)),
        )
        .where(
          and(
            inArray(podcastEpisodes.podcastId, podcastIds),
            eq(userPodcastEpisodeState.finished, false),
            gt(userPodcastEpisodeState.positionSeconds, 0),
          ),
        )
        .orderBy(
          podcastEpisodes.podcastId,
          desc(userPodcastEpisodeState.lastListenedAt),
          desc(userPodcastEpisodeState.updatedAt),
          desc(podcastEpisodes.id),
        ),
      this.db
        .selectDistinctOn([podcastEpisodes.podcastId], {
          podcastId: podcastEpisodes.podcastId,
          episodeId: podcastEpisodes.id,
          title: podcastEpisodes.title,
          durationSeconds: podcastEpisodes.durationSeconds,
        })
        .from(podcastEpisodes)
        .leftJoin(userPodcastEpisodeState, and(eq(userPodcastEpisodeState.episodeId, podcastEpisodes.id), eq(userPodcastEpisodeState.userId, userId)))
        .where(
          and(
            inArray(podcastEpisodes.podcastId, podcastIds),
            eq(podcastEpisodes.inFeed, true),
            isNull(podcastEpisodes.unavailableAt),
            or(isNull(userPodcastEpisodeState.userId), eq(userPodcastEpisodeState.finished, false)),
          ),
        )
        .orderBy(podcastEpisodes.podcastId, sql`${podcastEpisodes.publishedAt} desc nulls last`, desc(podcastEpisodes.id)),
    ]);
    const recommendations = new Map<number, PodcastPlaybackRecommendation>();
    for (const row of resumeRows) {
      recommendations.set(row.podcastId, {
        episodeId: row.episodeId,
        title: row.title,
        positionSeconds: row.positionSeconds,
        durationSeconds: row.durationSeconds,
        kind: 'resume',
      });
    }
    for (const row of latestRows) {
      if (recommendations.has(row.podcastId)) continue;
      recommendations.set(row.podcastId, {
        episodeId: row.episodeId,
        title: row.title,
        positionSeconds: 0,
        durationSeconds: row.durationSeconds,
        kind: 'latest',
      });
    }
    return recommendations;
  }
}

function truncateNullable(value: string | null | undefined, maxLength: number): string | null | undefined {
  if (value === null || value === undefined) return value;
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}
