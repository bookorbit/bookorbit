import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { PODCAST_ERROR_CODES, PODCAST_LOCKED_FIELDS } from '@bookorbit/types';
import type { PodcastArtworkResult, PodcastDirectoryResult, PodcastFeedPreview, PodcastMetadataUpdateResult } from '@bookorbit/types';
import type {
  PodcastArchiveResult,
  PodcastCreateResult,
  PodcastEpisodePage,
  PodcastFeedHealth,
  PodcastFollowState,
  PodcastLibrarySettings,
  PodcastListItem,
  PodcastPage,
  PodcastSummary,
} from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { assertOffsetWithinLimit } from '../../common/constants/pagination.constants';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { LibraryService } from '../library/library.service';
import type {
  CreatePodcastDto,
  FollowPodcastDto,
  ListPodcastEpisodesDto,
  ListPodcastShowsDto,
  PodcastPageQueryDto,
  SearchPodcastDirectoryDto,
  UpdatePodcastConfigDto,
  UpdatePodcastMetadataDto,
  UpdatePodcastLibrarySettingsDto,
} from './dto/podcast.dto';
import { assertPodcastCreateSource } from './dto/podcast.dto';
import { sanitizePodcastHtml } from './podcast-html-sanitizer';
import { PodcastAccessService } from './podcast-access.service';
import { PodcastArtworkService } from './podcast-artwork.service';
import { PodcastCatalogRepository } from './podcast-catalog.repository';
import { PodcastDirectoryService } from './podcast-directory.service';
import type { PodcastDirectoryEntry } from './podcast-directory.service';
import { PodcastEpisodeRepository } from './podcast-episode.repository';
import { PodcastFeedClientService } from './podcast-feed-client.service';
import { PodcastGateway } from './podcast.gateway';
import { PodcastJobRepository } from './podcast-job.repository';
import { PodcastOperationsService } from './podcast-operations.service';
import { PodcastOpmlService } from './podcast-opml.service';
import { podcastArtworkUrl } from './podcast-row-mappers';
import { PodcastSecretService } from './podcast-secret.service';
import { validatePodcastAcquisitionPolicy } from './podcast-acquisition-rules';
import { mergePodcastLockedFields, normalizePodcastCategories } from './podcast-metadata-rules';

@Injectable()
export class PodcastCatalogService {
  private readonly logger = new Logger(PodcastCatalogService.name);

  constructor(
    private readonly catalog: PodcastCatalogRepository,
    private readonly episodes: PodcastEpisodeRepository,
    private readonly feeds: PodcastFeedClientService,
    private readonly directory: PodcastDirectoryService,
    private readonly secrets: PodcastSecretService,
    private readonly opml: PodcastOpmlService,
    private readonly artwork: PodcastArtworkService,
    private readonly gateway: PodcastGateway,
    private readonly access: PodcastAccessService,
    private readonly operations: PodcastOperationsService,
    private readonly libraries: LibraryService,
    private readonly jobs: PodcastJobRepository,
  ) {}

  async searchDirectory(user: RequestUser, dto: SearchPodcastDirectoryDto): Promise<PodcastDirectoryResult[]> {
    if (!user.isSuperuser && !(await this.catalog.hasManageablePodcastLibrary(user.id))) {
      throw new ForbiddenException('No podcast library access');
    }
    const results = await this.directory.search(dto.q, dto.limit);
    return this.annotateSubscribedResults(user, results);
  }

  /**
   * Marks the directory rows the caller already follows. Runs on every request instead of inside
   * the directory cache, because the answer is per caller and the cached rows are shared.
   */

  private async annotateSubscribedResults(user: RequestUser, results: PodcastDirectoryEntry[]): Promise<PodcastDirectoryResult[]> {
    if (results.length === 0) return [];
    const hashes = new Map<string, string>();
    for (const result of results) {
      try {
        hashes.set(result.feedUrl, this.secrets.hashUrl(result.feedUrl));
      } catch {
        // A row the directory published with an unparseable feed URL simply carries no annotation.
      }
    }
    const accessibleLibraryIds = user.isSuperuser ? undefined : await this.libraries.findAccessibleLibraryIds(user);
    const matches = await this.catalog.findPodcastIdsByFeedHashes([...new Set(hashes.values())], accessibleLibraryIds);
    const byHash = new Map(matches.map((match) => [match.feedHash, match]));
    return results.map((result) => {
      const hash = hashes.get(result.feedUrl);
      const match = hash ? byHash.get(hash) : undefined;
      return { ...result, existingPodcastId: match?.podcastId ?? null, existingLibraryId: match?.libraryId ?? null };
    });
  }

  async previewFeed(libraryId: number, feedUrl: string): Promise<PodcastFeedPreview> {
    await this.access.requirePodcastLibrary(libraryId);
    const result = await this.feeds.fetchFeed(feedUrl);
    if (!result.feed) throw new BadRequestException('Podcast feed returned no metadata');
    const duplicate = await this.catalog.findPodcastByFeedHash(libraryId, this.secrets.hashUrl(result.finalUrl));
    // Carries the id as well as the message. A client offering to open the show it already has was
    // otherwise reduced to reading the title back out of this sentence and searching for it, which
    // made the prose load-bearing and lost the link whenever the title did not rank in the search.
    // The message keeps its exact wording, so anything already showing it is unaffected.
    if (duplicate) {
      throw new ConflictException({
        message: `Podcast already exists as "${duplicate.title}"`,
        errorCode: PODCAST_ERROR_CODES.duplicateFeed,
        podcastId: duplicate.id,
      });
    }
    return {
      feedUrl: this.secrets.redactUrl(result.finalUrl),
      title: result.feed.title,
      author: result.feed.author,
      description: result.feed.description,
      imageUrl: result.feed.imageUrl,
      language: result.feed.language,
      podcastType: result.feed.podcastType,
      explicit: result.feed.explicit,
      categories: result.feed.categories,
      episodeCount: result.feed.episodes.length,
    };
  }

  async createPodcast(libraryId: number, dto: CreatePodcastDto, user: RequestUser): Promise<PodcastCreateResult> {
    assertPodcastCreateSource(dto);
    await this.access.requirePodcastLibrary(libraryId);
    if (dto.source === 'folder') return this.operations.createLocalPodcast(libraryId, dto.folderPath!, user);
    const { podcast, created } = await this.operations.createPodcastFromUrl(libraryId, dto.feedUrl!, {
      acquisitionPolicy: dto.acquisitionPolicy ?? 'remote_only',
      autoDownloadLimit: dto.autoDownloadLimit,
      autoDownloadWindowDays: dto.autoDownloadWindowDays,
      refreshIntervalMinutes: dto.refreshIntervalMinutes,
    });
    // A feed's episodes arrive with the first refresh rather than with this call.
    return { id: podcast.id, title: podcast.title, created, jobId: null };
  }

  async listPodcasts(libraryId: number, userId: number, query: ListPodcastShowsDto): Promise<PodcastPage<PodcastListItem>> {
    assertOffsetWithinLimit(query.page, query.size);
    await this.access.requirePodcastLibrary(libraryId);
    return this.catalog.listPodcasts(libraryId, userId, query);
  }

  async listEpisodes(libraryId: number, userId: number, query: ListPodcastEpisodesDto): Promise<PodcastEpisodePage> {
    assertOffsetWithinLimit(query.page, query.size);
    await this.access.requirePodcastLibrary(libraryId);
    return this.episodes.listEpisodes(libraryId, userId, query);
  }

  async listFeedHealth(libraryId: number, query: PodcastPageQueryDto): Promise<PodcastPage<PodcastFeedHealth>> {
    assertOffsetWithinLimit(query.page, query.size);
    await this.access.requirePodcastLibrary(libraryId);
    return this.catalog.listFeedHealth(libraryId, query);
  }

  async getPodcast(podcastId: number, user: RequestUser): Promise<PodcastSummary> {
    await this.access.requirePodcastAccess(podcastId, user);
    const summary = await this.catalog.findPodcastSummary(podcastId, user.id);
    if (!summary) throw new NotFoundException('Podcast not found');
    return summary;
  }

  async updatePodcastConfig(podcastId: number, dto: UpdatePodcastConfigDto, user: RequestUser) {
    if (Object.values(dto).every((value) => value === undefined)) throw new BadRequestException('Podcast configuration update is empty');
    const podcast = await this.access.requirePodcastAccess(podcastId, user, 'editor');
    // Nothing fetches a local show, so accepting a refresh cadence or an acquisition policy for one
    // would only store a setting that can never take effect.
    if (
      podcast.origin === 'local' &&
      (dto.acquisitionPolicy !== undefined ||
        dto.autoDownloadLimit !== undefined ||
        dto.autoDownloadWindowDays !== undefined ||
        dto.refreshIntervalMinutes !== undefined)
    ) {
      throw new BadRequestException({
        message: 'A local show has no feed, so it has no refresh or download settings',
        errorCode: PODCAST_ERROR_CODES.localNoRefresh,
      });
    }
    validatePodcastAcquisitionPolicy(
      dto.acquisitionPolicy ?? podcast.acquisitionPolicy,
      dto.autoDownloadLimit === undefined ? podcast.autoDownloadLimit : dto.autoDownloadLimit,
      dto.autoDownloadWindowDays === undefined ? podcast.autoDownloadWindowDays : dto.autoDownloadWindowDays,
    );
    const nextRefreshAt = pulledInRefreshSchedule(podcast, dto.refreshIntervalMinutes);
    const updated = await this.catalog.updatePodcast(podcastId, { ...dto, ...(nextRefreshAt ? { nextRefreshAt } : {}) });
    if (!updated) throw new NotFoundException('Podcast not found');
    if (
      updated.acquisitionPolicy !== 'remote_only' &&
      updated.acquisitionPolicy !== 'manual' &&
      (dto.acquisitionPolicy !== undefined || dto.autoDownloadLimit !== undefined || dto.autoDownloadWindowDays !== undefined)
    ) {
      await this.operations.enqueueAcquisition(updated.id, updated.libraryId, [], true);
    }
    return podcastConfigResult(updated);
  }

  /**
   * Sparse metadata write. Every edited field is locked on the way out: podcasts refresh on a timer,
   * so an unlocked edit is silently overwritten by the feed within the hour, and auto-locking is the
   * only behaviour that matches what a user editing a field means. An explicit `lockedFields` is the
   * final set before that union, which is how a field gets unlocked without also being edited.
   */

  async updatePodcastMetadata(podcastId: number, dto: UpdatePodcastMetadataDto, user: RequestUser): Promise<PodcastMetadataUpdateResult> {
    if (Object.values(dto).every((value) => value === undefined)) throw new BadRequestException('Podcast metadata update is empty');
    const title = dto.title?.trim();
    if (dto.title !== undefined && !title) throw new BadRequestException('Podcast title cannot be empty');
    const podcast = await this.access.requirePodcastAccess(podcastId, user, 'editor');
    const values = {
      ...(dto.title === undefined ? {} : { title }),
      ...(dto.author === undefined ? {} : { author: dto.author?.trim() || null }),
      ...(dto.description === undefined ? {} : { description: sanitizePodcastHtml(dto.description) }),
      ...(dto.siteUrl === undefined ? {} : { siteUrl: dto.siteUrl?.trim() || null }),
      ...(dto.language === undefined ? {} : { language: dto.language?.trim() || null }),
      ...(dto.explicit === undefined ? {} : { explicit: dto.explicit }),
      ...(dto.categories === undefined ? {} : { categories: normalizePodcastCategories(dto.categories) }),
    };
    const updated = await this.catalog.updatePodcast(podcastId, {
      ...values,
      lockedFields: mergePodcastLockedFields(PODCAST_LOCKED_FIELDS, podcast.lockedFields, dto.lockedFields, Object.keys(values)),
    });
    if (!updated) throw new NotFoundException('Podcast not found');
    return {
      id: updated.id,
      title: updated.title,
      author: updated.author,
      description: updated.description,
      siteUrl: updated.siteUrl,
      language: updated.language,
      explicit: updated.explicit,
      categories: updated.categories,
      lockedFields: updated.lockedFields,
    };
  }

  async uploadPodcastArtwork(podcastId: number, data: Buffer, user: RequestUser): Promise<PodcastArtworkResult> {
    const event = 'podcast.upload_artwork';
    const startedAt = Date.now();
    await this.access.requirePodcastAccess(podcastId, user, 'editor');
    this.logger.log(`[${event}] [start] podcastId=${podcastId} userId=${user.id} bytes=${data.byteLength} - custom artwork upload started`);
    try {
      const result = await this.storeCustomArtwork(podcastId, data);
      this.logger.log(
        `[${event}] [end] podcastId=${podcastId} userId=${user.id} durationMs=${Date.now() - startedAt} - custom artwork upload completed`,
      );
      return result;
    } catch (error) {
      this.logArtworkFailure(event, podcastId, user.id, startedAt, error);
      throw error;
    }
  }

  async uploadPodcastArtworkFromUrl(podcastId: number, url: string, user: RequestUser): Promise<PodcastArtworkResult> {
    const event = 'podcast.upload_artwork_from_url';
    const startedAt = Date.now();
    await this.access.requirePodcastAccess(podcastId, user, 'editor');
    this.logger.log(
      `[${event}] [start] podcastId=${podcastId} userId=${user.id} url="${sanitizeLogValue(this.secrets.redactUrl(url))}" - custom artwork download started`,
    );
    try {
      const data = await this.artwork.fetchArtworkFromUrl(url);
      const result = await this.storeCustomArtwork(podcastId, data);
      this.logger.log(
        `[${event}] [end] podcastId=${podcastId} userId=${user.id} durationMs=${Date.now() - startedAt} bytes=${data.byteLength} - custom artwork download completed`,
      );
      return result;
    } catch (error) {
      this.logArtworkFailure(event, podcastId, user.id, startedAt, error);
      throw error;
    }
  }

  async deletePodcastArtwork(podcastId: number, user: RequestUser): Promise<PodcastArtworkResult> {
    await this.access.requirePodcastAccess(podcastId, user, 'editor');
    await this.artwork.removeCustomArtwork(podcastId);
    const updated = await this.catalog.updatePodcast(podcastId, { customArtworkAt: null });
    if (!updated) throw new NotFoundException('Podcast not found');
    return { id: updated.id, imageUrl: podcastArtworkUrl(updated.id, updated.imageUrlEncrypted, null), artworkUpdatedAt: null };
  }

  private async storeCustomArtwork(podcastId: number, data: Buffer): Promise<PodcastArtworkResult> {
    await this.artwork.saveCustomArtwork(podcastId, data);
    const customArtworkAt = new Date();
    const updated = await this.catalog.updatePodcast(podcastId, { customArtworkAt });
    if (!updated) throw new NotFoundException('Podcast not found');
    return {
      id: updated.id,
      imageUrl: podcastArtworkUrl(updated.id, updated.imageUrlEncrypted, updated.customArtworkAt),
      artworkUpdatedAt: updated.customArtworkAt?.toISOString() ?? customArtworkAt.toISOString(),
    };
  }

  private logArtworkFailure(event: string, podcastId: number, userId: number, startedAt: number, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `[${event}] [fail] podcastId=${podcastId} userId=${userId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - custom artwork write failed`,
    );
  }

  async archivePodcast(podcastId: number, user: RequestUser, archived: boolean): Promise<PodcastArchiveResult> {
    await this.access.requirePodcastAccess(podcastId, user, 'editor');
    if (!archived && (await this.jobs.hasActiveDestructiveWork(podcastId))) {
      throw new ConflictException('Wait for the queued podcast purge or merge to finish before restoring this podcast.');
    }
    const updated = await this.catalog.archivePodcast(podcastId, archived);
    if (!updated) throw new NotFoundException('Podcast not found');
    return { id: updated.id, archivedAt: updated.archivedAt?.toISOString() ?? null };
  }

  async followPodcast(podcastId: number, user: RequestUser, dto: FollowPodcastDto): Promise<PodcastFollowState> {
    await this.access.requirePodcastAccess(podcastId, user);
    const follow = await this.catalog.upsertFollow(user.id, podcastId, dto.notificationMode);
    return {
      userId: follow.userId,
      podcastId: follow.podcastId,
      notificationMode: follow.notificationMode,
      lastNotifiedAt: follow.lastNotifiedAt.toISOString(),
      createdAt: follow.createdAt.toISOString(),
    };
  }

  async unfollowPodcast(podcastId: number, user: RequestUser) {
    await this.access.requirePodcastAccess(podcastId, user);
    await this.catalog.unfollow(user.id, podcastId);
  }

  async getLibrarySettings(libraryId: number): Promise<PodcastLibrarySettings> {
    await this.access.requirePodcastLibrary(libraryId);
    const settings = await this.catalog.getLibrarySettings(libraryId);
    return {
      ...settings,
      storageQuotaBytes: settings.storageQuotaBytes.toString(),
      minimumFreeSpaceBytes: settings.minimumFreeSpaceBytes.toString(),
      usedStorageBytes: settings.usedStorageBytes.toString(),
    };
  }

  async updateLibrarySettings(libraryId: number, dto: UpdatePodcastLibrarySettingsDto) {
    if (Object.values(dto).every((value) => value === undefined)) throw new BadRequestException('Podcast library settings update is empty');
    await this.access.requirePodcastLibrary(libraryId);
    const storageQuotaBytes = dto.storageQuotaBytes === undefined ? undefined : this.parseBytes(dto.storageQuotaBytes, 'storageQuotaBytes');
    const minimumFreeSpaceBytes =
      dto.minimumFreeSpaceBytes === undefined ? undefined : this.parseBytes(dto.minimumFreeSpaceBytes, 'minimumFreeSpaceBytes');
    await this.catalog.updateLibrarySettings(libraryId, { ...dto, storageQuotaBytes, minimumFreeSpaceBytes });
    await this.jobs.enqueue({ type: 'retention', dedupeKey: `retention:${libraryId}`, libraryId, payload: {} });
    return this.getLibrarySettings(libraryId);
  }

  async exportOpml(
    libraryId: number,
    includePrivate: boolean,
    includeArchived: boolean,
  ): Promise<{ content: AsyncGenerator<string>; omittedLocalShows: number }> {
    const library = await this.access.requirePodcastLibrary(libraryId);
    return {
      content: this.streamOpml(libraryId, `${library.name} podcasts`, includePrivate, includeArchived),
      omittedLocalShows: await this.catalog.countLocalPodcasts(libraryId, includeArchived),
    };
  }

  private parseBytes(value: string, field: string): bigint {
    if (!/^\d+$/.test(value)) throw new BadRequestException(`${field} must be a nonnegative integer string`);
    const parsed = BigInt(value);
    if (parsed > 9_007_199_254_740_991n * 1024n) throw new BadRequestException(`${field} is too large`);
    return parsed;
  }

  private async *streamOpml(libraryId: number, title: string, includePrivate: boolean, includeArchived: boolean): AsyncGenerator<string> {
    yield this.opml.generateStart(title);
    let afterId = 0;
    for (;;) {
      const rows = await this.catalog.listPodcastSecrets(libraryId, includeArchived, afterId, 500);
      for (const row of rows) {
        afterId = row.id;
        if (!row.feedUrlEncrypted) continue;
        const feedUrl = this.secrets.decrypt(row.feedUrlEncrypted);
        const url = new URL(feedUrl);
        if (!includePrivate && (url.search || /token|auth|key|secret/i.test(feedUrl))) continue;
        yield this.opml.generateOutline({ title: row.title, feedUrl });
      }
      if (rows.length < 500) break;
    }
    yield this.opml.generateEnd();
  }
}

/**
 * A shortened cadence has to pull the pending sweep in, or it does not apply until one more refresh
 * has run at the old interval: an hourly show moved to five minutes would wait up to an hour first.
 * Never earlier than now, so saving a setting is not itself a fetch.
 */
export function pulledInRefreshSchedule(
  podcast: { refreshIntervalMinutes: number; lastRefreshAt: Date | null; nextRefreshAt: Date },
  minutes: number | undefined,
): Date | undefined {
  if (minutes === undefined || minutes === podcast.refreshIntervalMinutes) return undefined;
  const now = new Date();
  const target = new Date((podcast.lastRefreshAt ?? now).getTime() + minutes * 60_000);
  if (target >= podcast.nextRefreshAt) return undefined;
  return target > now ? target : now;
}

function podcastConfigResult(podcast: NonNullable<Awaited<ReturnType<PodcastCatalogRepository['updatePodcast']>>>) {
  return {
    id: podcast.id,
    acquisitionPolicy: podcast.acquisitionPolicy,
    autoDownloadLimit: podcast.autoDownloadLimit,
    autoDownloadWindowDays: podcast.autoDownloadWindowDays,
    downloadCleanup: podcast.downloadCleanup,
    downloadCleanupDelayHours: podcast.downloadCleanupDelayHours,
    refreshIntervalMinutes: podcast.refreshIntervalMinutes,
  };
}
