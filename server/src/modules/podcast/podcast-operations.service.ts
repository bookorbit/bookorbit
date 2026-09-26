import { Injectable, BadRequestException, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NotificationType, Permission, PODCAST_ERROR_CODES } from '@bookorbit/types';
import type {
  PodcastAcquisitionPolicy,
  PodcastBulkActionResult,
  PodcastBulkPurgePreview,
  PodcastBulkDownloadResult,
  PodcastDownloadBatch,
  PodcastDownloadBatchItemStatus,
  PodcastImportReport,
  PodcastImportScanJob,
  PodcastImportScanStatus,
  PodcastJobSummary,
  PodcastJobState,
  PodcastLibraryActivity,
  PodcastCreateResult,
} from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { LibraryService } from '../library/library.service';
import { NotificationService } from '../notification/notification.service';
import type { DownloadLatestPodcastEpisodesDto, PodcastImportScanDto, PodcastOpmlImportDto } from './dto/podcast.dto';
import { PodcastAccessService } from './podcast-access.service';
import { PodcastArtworkService } from './podcast-artwork.service';
import { PodcastCatalogRepository } from './podcast-catalog.repository';
import { PodcastEpisodeRepository } from './podcast-episode.repository';
import { PodcastFeedClientService } from './podcast-feed-client.service';
import { PodcastFeedParserService } from './podcast-feed-parser.service';
import { PodcastFeedSnapshotService } from './podcast-feed-snapshot.service';
import { PodcastGateway } from './podcast.gateway';
import { PodcastJobRepository } from './podcast-job.repository';
import { PodcastLocalShowImportService } from './podcast-local-show-import.service';
import { PodcastMediaStorageService } from './podcast-media-storage.service';
import { PodcastOpmlService } from './podcast-opml.service';
import { PodcastSecretService } from './podcast-secret.service';
import { validatePodcastAcquisitionPolicy } from './podcast-acquisition-rules';

@Injectable()
export class PodcastOperationsService {
  private readonly logger = new Logger(PodcastOperationsService.name);

  constructor(
    private readonly catalog: PodcastCatalogRepository,
    private readonly episodes: PodcastEpisodeRepository,
    private readonly jobs: PodcastJobRepository,
    private readonly feeds: PodcastFeedClientService,
    private readonly secrets: PodcastSecretService,
    private readonly imports: PodcastLocalShowImportService,
    private readonly opml: PodcastOpmlService,
    private readonly artwork: PodcastArtworkService,
    private readonly storage: PodcastMediaStorageService,
    private readonly snapshots: PodcastFeedSnapshotService,
    private readonly parser: PodcastFeedParserService,
    private readonly notifications: NotificationService,
    private readonly gateway: PodcastGateway,
    private readonly access: PodcastAccessService,
    private readonly libraries: LibraryService,
  ) {}

  async enqueueRefresh(podcastId: number, user: RequestUser): Promise<{ jobId: number | null }> {
    const podcast = await this.access.requirePodcastAccess(podcastId, user, 'editor');
    assertFeedOrigin(podcast.origin);
    if (podcast.archivedAt) throw new BadRequestException('Restore the podcast before refreshing it');
    const jobId = await this.jobs.enqueue({
      type: 'refresh',
      dedupeKey: `refresh:${podcastId}`,
      libraryId: podcast.libraryId,
      podcastId,
      requestedByUserId: user.id,
      payload: {},
    });
    return { jobId };
  }

  async enqueueReparse(podcastId: number, user: RequestUser): Promise<{ jobId: number | null }> {
    const podcast = await this.access.requirePodcastAccess(podcastId, user, 'editor');
    assertFeedOrigin(podcast.origin);
    if (podcast.archivedAt) throw new BadRequestException('Restore the podcast before reparsing its feed');
    if (!podcast.feedSnapshotAt) throw new NotFoundException('No stored feed copy exists for this podcast yet');
    const jobId = await this.jobs.enqueue({
      type: 'reparse',
      dedupeKey: `reparse:${podcastId}`,
      libraryId: podcast.libraryId,
      podcastId,
      requestedByUserId: user.id,
      payload: {},
    });
    return { jobId };
  }

  /**
   * Editor, not viewer, on every download path. A download writes into the shared library folder,
   * draws down the library's quota, and can evict someone else's file under retention, so it is a
   * write to the library rather than a personal action. `PodcastDownload` is a role permission and
   * says nothing about which libraries the caller may write to.
   */
  async enqueueDownload(episodeId: number, user: RequestUser): Promise<{ jobId: number | null }> {
    const context = await this.access.requireEpisodeAccess(episodeId, user, 'editor');
    if (context.episode.origin === 'local') {
      throw new BadRequestException({
        message: 'This episode has no feed enclosure to download; its file is already the only copy',
        errorCode: PODCAST_ERROR_CODES.localNoDownload,
      });
    }
    if (context.podcast.archivedAt) throw new BadRequestException('Restore the podcast before downloading episodes');
    const jobId = await this.jobs.enqueue({
      type: 'download',
      dedupeKey: `download:${episodeId}`,
      libraryId: context.podcast.libraryId,
      podcastId: context.podcast.id,
      episodeId,
      requestedByUserId: user.id,
      payload: {},
    });
    if (jobId) await this.episodes.markMediaQueued([episodeId]);
    if (jobId) {
      this.gateway.emitDownloadProgress({
        libraryId: context.podcast.libraryId,
        podcastId: context.podcast.id,
        episodeId,
        batchId: null,
        status: 'queued',
        receivedBytes: 0,
        totalBytes: context.episode.enclosureSizeBytes,
      });
    }
    return { jobId };
  }

  /**
   * Drops an episode's cached file and sends the episode back to `remote`.
   *
   * A local episode is refused outright. Its file is not a cache of anything: it is the user's own,
   * adopted where they keep it, and BookOrbit promises never to delete inside a local folder. The
   * only copy of an episode is not something a per-episode menu action gets to destroy.
   */

  async removeDownload(episodeId: number, user: RequestUser): Promise<void> {
    const context = await this.access.requireEpisodeAccess(episodeId, user, 'editor');
    if (context.episode.origin === 'local') {
      throw new BadRequestException({
        message: 'This episode is one of your own files, so BookOrbit will not delete it. Remove it from the folder yourself.',
        errorCode: PODCAST_ERROR_CODES.localFileNotRemovable,
      });
    }
    const cancellation = await this.jobs.cancelEpisodeDownload(episodeId);
    if (cancellation.processing > 0) throw new ConflictException('Podcast download is still stopping. Retry removal shortly.');
    await this.storage.removeEpisodeDownload(episodeId);
    const batchId = cancellation.cancelledBatchIds[0] ?? null;
    this.gateway.emitDownloadComplete({
      libraryId: context.podcast.libraryId,
      podcastId: context.podcast.id,
      episodeId,
      batchId,
      jobStatus: batchId ? 'cancelled' : null,
      mediaStatus: 'remote',
      localSizeBytes: null,
    });
  }

  async downloadLatestPodcastEpisodes(
    podcastId: number,
    dto: DownloadLatestPodcastEpisodesDto,
    user: RequestUser,
  ): Promise<PodcastBulkDownloadResult> {
    const podcast = await this.access.requirePodcastAccess(podcastId, user, 'editor');
    if (podcast.archivedAt) throw new BadRequestException('Restore the podcast before downloading episodes');
    const requestedIds = (await this.episodes.findNewestEpisodeIds(podcastId, dto.count)).map((episode) => episode.id);
    const episodeIds = await this.episodes.filterDownloadableEpisodeIds(requestedIds);
    const batchId = randomUUID();
    const inserted = await this.jobs.enqueueMany(
      episodeIds.map((episodeId) => ({
        type: 'download',
        dedupeKey: `download:${episodeId}`,
        libraryId: podcast.libraryId,
        podcastId,
        episodeId,
        requestedByUserId: user.id,
        downloadBatchId: batchId,
        payload: {},
      })),
    );
    const queuedIds = inserted.flatMap((job) => (job.episodeId === null ? [] : [job.episodeId]));
    await this.episodes.markMediaQueued(queuedIds);
    for (const episodeId of queuedIds) {
      this.gateway.emitDownloadProgress({
        libraryId: podcast.libraryId,
        podcastId,
        episodeId,
        batchId,
        status: 'queued',
        receivedBytes: 0,
        totalBytes: null,
      });
    }
    return {
      completed: queuedIds.length,
      failed: 0,
      skipped: requestedIds.length - queuedIds.length,
      batchId: queuedIds.length > 0 ? batchId : null,
    };
  }

  async listActiveDownloadBatches(user: RequestUser): Promise<PodcastDownloadBatch[]> {
    const libraryIds = await this.libraries.findAccessibleLibraryIds(user);
    const rows = await this.jobs.listActiveDownloadBatchJobs(user.id, libraryIds);
    return this.toDownloadBatches(rows);
  }

  async findDownloadBatch(batchId: string, user: RequestUser): Promise<PodcastDownloadBatch> {
    const libraryIds = await this.libraries.findAccessibleLibraryIds(user);
    const rows = await this.jobs.findDownloadBatchJobs(user.id, libraryIds, [batchId]);
    const batch = this.toDownloadBatches(rows)[0];
    if (!batch) throw new NotFoundException('Podcast download batch not found');
    return batch;
  }

  private toDownloadBatches(rows: Awaited<ReturnType<PodcastJobRepository['findDownloadBatchJobs']>>): PodcastDownloadBatch[] {
    const batches = new Map<string, PodcastDownloadBatch>();
    for (const row of rows) {
      if (!row.batchId) continue;
      const status = (row.status === 'processing' ? 'downloading' : row.status) as PodcastDownloadBatchItemStatus;
      let batch = batches.get(row.batchId);
      if (!batch) {
        batch = {
          id: row.batchId,
          libraryId: row.libraryId,
          podcastId: row.podcastId,
          podcastTitle: row.podcastTitle,
          total: 0,
          queued: 0,
          downloading: 0,
          completed: 0,
          failed: 0,
          cancelled: 0,
          receivedBytes: 0,
          totalBytes: 0,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          items: [],
        };
        batches.set(row.batchId, batch);
      }
      batch.total++;
      batch[status]++;
      batch.receivedBytes += row.progressCurrent;
      batch.totalBytes = batch.totalBytes === null || row.progressTotal === null ? null : batch.totalBytes + row.progressTotal;
      if (row.createdAt < new Date(batch.createdAt)) batch.createdAt = row.createdAt.toISOString();
      if (row.updatedAt > new Date(batch.updatedAt)) batch.updatedAt = row.updatedAt.toISOString();
      batch.items.push({
        episodeId: row.episodeId,
        title: row.episodeTitle,
        status,
        receivedBytes: row.progressCurrent,
        totalBytes: row.progressTotal,
      });
    }
    return [...batches.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  /**
   * Clears every cached copy this show holds. Local-origin episodes are reported as skipped rather
   * than removed: a bulk "free some space" action must never be the thing that deletes the only
   * copy of an episode.
   */

  async removeAllPodcastDownloads(podcastId: number, user: RequestUser): Promise<PodcastBulkActionResult> {
    const podcast = await this.access.requirePodcastAccess(podcastId, user, 'editor');
    const skipped = await this.episodes.countLocalOriginDownloads(podcastId);
    let completed = 0;
    let failed = 0;
    let afterEpisodeId = 0;
    for (;;) {
      const episodes = await this.episodes.findLocalPodcastEpisodeIds(podcastId, afterEpisodeId, 200);
      if (episodes.length === 0) break;
      afterEpisodeId = episodes[episodes.length - 1]!.id;
      for (let offset = 0; offset < episodes.length; offset += 4) {
        const chunk = episodes.slice(offset, offset + 4);
        const results = await Promise.allSettled(chunk.map((episode) => this.storage.removeEpisodeDownload(episode.id)));
        for (let index = 0; index < results.length; index++) {
          const episodeId = chunk[index]!.id;
          if (results[index]!.status === 'fulfilled') {
            completed++;
            this.gateway.emitDownloadComplete({
              libraryId: podcast.libraryId,
              podcastId,
              episodeId,
              batchId: null,
              jobStatus: null,
              mediaStatus: 'remote',
              localSizeBytes: null,
            });
          } else {
            failed++;
          }
        }
      }
      if (episodes.length < 200) break;
    }
    return { completed, failed, skipped };
  }

  /**
   * One poll for the whole library status strip, in place of separate job, import, download and
   * health requests. Counters only: the payload must not grow with the library, so the report,
   * batch rows and per-feed errors each stay on the endpoint a user opens deliberately.
   */
  /**
   * Outstanding work in the library, or in one job type when `type` is given.
   *
   * The unfiltered count is right for a status strip and wrong for a client waiting on work it
   * started: an OPML import's readout followed every job in the library, so an unrelated refresh or
   * cache batch kept it claiming the import was still running. An import enqueues one job per feed
   * rather than a single job, so the thing a client can actually ask about is the type, not an id.
   */
  async getJobSummary(libraryId: number, type?: string): Promise<PodcastJobSummary> {
    await this.access.requirePodcastLibrary(libraryId);
    if (!type) return this.jobs.summary(libraryId);
    const byType = await this.jobs.summaryByType(libraryId, type);
    return { queued: byType.queued, processing: byType.processing, failed: byType.failed };
  }

  /**
   * One job by the id its enqueueing route returned. The summary above counts the whole library,
   * which is the right answer for a status strip and the wrong one for a client waiting on the work
   * it just started: an unrelated refresh or cache batch made an OPML import look like it was still
   * running for as long as the client kept asking.
   */
  async getJobState(libraryId: number, jobId: number): Promise<PodcastJobState> {
    await this.access.requirePodcastLibrary(libraryId);
    const job = await this.jobs.findByIdInLibrary(libraryId, jobId);
    if (!job) throw new NotFoundException('Job not found');
    return {
      id: job.id,
      type: job.type,
      status: job.status as PodcastJobState['status'],
      lastError: job.lastError ?? null,
      progressCurrent: job.progressCurrent ?? null,
      progressTotal: job.progressTotal ?? null,
    };
  }

  async getLibraryActivity(libraryId: number, user: RequestUser): Promise<PodcastLibraryActivity> {
    await this.access.requirePodcastLibrary(libraryId);
    const [jobs, importJob, downloads, failingFeeds] = await Promise.all([
      this.jobs.summary(libraryId),
      this.jobs.findLatestByType(libraryId, 'import_scan'),
      this.jobs.downloadSummary(libraryId, user.id),
      this.catalog.countFailingFeeds(libraryId),
    ]);
    return {
      jobs,
      importScan: importJob ? toImportScanJob(importJob) : null,
      downloads,
      failingFeeds,
    };
  }

  async importOpml(libraryId: number, dto: PodcastOpmlImportDto, user: RequestUser) {
    await this.access.requirePodcastLibrary(libraryId);
    const acquisitionPolicy = dto.acquisitionPolicy ?? 'remote_only';
    validatePodcastAcquisitionPolicy(acquisitionPolicy, dto.autoDownloadLimit, dto.autoDownloadWindowDays);
    const urls = this.opml.parse(dto.opml);
    const inserted = await this.jobs.enqueueMany(
      urls.map((url) => ({
        type: 'opml_import',
        dedupeKey: `opml:${libraryId}:${this.secrets.hashUrl(url)}`,
        libraryId,
        requestedByUserId: user.id,
        payload: {
          feedUrlEncrypted: this.secrets.encrypt(url),
          acquisitionPolicy,
          autoDownloadLimit: dto.autoDownloadLimit,
          autoDownloadWindowDays: dto.autoDownloadWindowDays,
        },
      })),
    );
    return { total: urls.length, queued: inserted.length };
  }

  /**
   * Queues a walk of the library folder that matches loose audio files to episodes their feeds
   * already published. One scan per library at a time: two walks would race for the same episodes
   * and neither report would describe what actually happened.
   */

  async enqueueImportScan(libraryId: number, dto: PodcastImportScanDto, user: RequestUser): Promise<{ jobId: number }> {
    await this.access.requirePodcastLibrary(libraryId);
    if (dto.podcastId !== undefined) {
      const podcast = await this.catalog.findPodcast(dto.podcastId);
      if (!podcast || podcast.libraryId !== libraryId) throw new NotFoundException('Podcast not found');
    }
    const jobId = await this.jobs.enqueue({
      type: 'import_scan',
      dedupeKey: `import_scan:${libraryId}`,
      libraryId,
      podcastId: dto.podcastId ?? null,
      requestedByUserId: user.id,
      payload: {
        dryRun: dto.dryRun,
        ...(dto.podcastId === undefined ? {} : { podcastId: dto.podcastId }),
        ...(dto.resolutions?.length ? { resolutions: dto.resolutions.map((entry) => ({ ...entry })) } : {}),
      },
    });
    if (!jobId) throw new ConflictException('A local file import is already running for this library.');
    return { jobId };
  }

  /**
   * Turns a folder of loose audio into a show of its own, for content no living feed publishes.
   *
   * The row is created here so the caller gets an id straight away; the files behind it become
   * episodes in a job, because a folder can hold thousands and each one has to be probed and
   * hashed. Re-running on the same folder resolves to the same show and only adds what appeared
   * since, which is the closest thing a feed-less show has to a refresh.
   */

  async createLocalPodcast(libraryId: number, folderPath: string, user: RequestUser): Promise<PodcastCreateResult> {
    await this.access.requirePodcastLibrary(libraryId);
    const folder = await this.imports.resolveLocalShowFolder(libraryId, folderPath);
    const existing = await this.catalog.findLocalPodcastByFolder(libraryId, folder.absolutePath);
    const { podcast, created } = existing
      ? { podcast: existing, created: false }
      : await this.catalog.createLocalPodcast(libraryId, folder.absolutePath, folder.metadata);
    const jobId = await this.jobs.enqueue({
      type: 'local_import',
      dedupeKey: `local_import:${podcast.id}`,
      libraryId,
      podcastId: podcast.id,
      requestedByUserId: user.id,
      payload: { folderPath: folder.absolutePath, applyShowMetadata: created },
    });
    this.logger.log(
      `[podcast.create_local_show] [end] libraryId=${libraryId} podcastId=${podcast.id} userId=${user.id} created=${created} jobId=${jobId ?? 'none'} - local podcast show resolved`,
    );
    return { id: podcast.id, title: podcast.title, created, jobId };
  }

  /** The last scan and, once it finished, the report it produced. Both are null before a first run. */

  async getLatestImportScan(libraryId: number): Promise<PodcastImportScanStatus> {
    await this.access.requirePodcastLibrary(libraryId);
    const job = await this.jobs.findLatestByType(libraryId, 'import_scan');
    if (!job) return { job: null, report: null };
    return {
      job: toImportScanJob(job),
      report: (job.payload.report as PodcastImportReport | undefined) ?? null,
    };
  }

  /**
   * OPML describes subscriptions, so local shows cannot be represented in it at all. The count of
   * what was left out travels with the response rather than the export quietly being short.
   */

  async getPurgePreview(podcastId: number, user: RequestUser) {
    await this.access.requirePodcastAccess(podcastId, user, 'owner');
    return this.episodes.getPodcastMediaStats(podcastId);
  }

  async enqueuePurge(podcastId: number, user: RequestUser) {
    const podcast = await this.access.requirePodcastAccess(podcastId, user, 'owner');
    if (!podcast.archivedAt) throw new BadRequestException('Archive the podcast before purging it');
    const activeJobs = await this.jobs.cancelPodcastWork([podcastId]);
    if (activeJobs > 0) throw new ConflictException('Podcast jobs are still stopping. Retry the purge shortly.');
    const jobId = await this.jobs.enqueueDestructive(
      {
        type: 'purge',
        dedupeKey: `purge:${podcastId}`,
        libraryId: podcast.libraryId,
        podcastId,
        requestedByUserId: user.id,
        payload: {},
      },
      [podcastId],
    );
    if (!jobId) throw new ConflictException('Podcast purge or merge work is already queued for this podcast.');
    return { jobId };
  }

  /**
   * The shows a selection names that this library actually holds, deduplicated. Ids it does not
   * hold are dropped rather than refused: a selection is made against a list that may have moved on
   * since, and one stale id should not cost the user the whole action.
   */
  private async resolveBulkDeleteShows(libraryId: number, podcastIds: number[], user: RequestUser) {
    await this.access.requirePodcastLibraryAccess(libraryId, user, 'owner');
    return this.catalog.findPodcastsInLibrary(libraryId, [...new Set(podcastIds)]);
  }

  async getBulkPurgePreview(libraryId: number, podcastIds: number[], user: RequestUser): Promise<PodcastBulkPurgePreview> {
    const shows = await this.resolveBulkDeleteShows(libraryId, podcastIds, user);
    let files = 0;
    let bytes = 0;
    for (const show of shows) {
      const stats = await this.episodes.getPodcastMediaStats(show.id);
      files += stats.files;
      bytes += stats.bytes;
    }
    return { shows: shows.length, files, bytes };
  }

  /**
   * Deletes a selection of shows, each down the same archive-then-purge path a single delete takes,
   * so there is one destructive code path rather than two that can drift apart.
   *
   * A show that fails is counted, not thrown: one show whose jobs are still stopping must not strand
   * the rest of the selection. `skipped` is the ids this library does not hold.
   */
  async bulkDeleteShows(libraryId: number, podcastIds: number[], user: RequestUser): Promise<PodcastBulkActionResult> {
    const event = 'podcast.bulk_delete';
    const startedAt = Date.now();
    const requested = new Set(podcastIds).size;
    const shows = await this.resolveBulkDeleteShows(libraryId, podcastIds, user);
    this.logger.log(`[${event}] [start] libraryId=${libraryId} requested=${requested} resolved=${shows.length} - bulk podcast delete started`);

    let completed = 0;
    let failed = 0;
    for (const show of shows) {
      try {
        if (!show.archivedAt) await this.catalog.archivePodcast(show.id, true);
        await this.enqueuePurge(show.id, user);
        completed++;
      } catch (error) {
        failed++;
        this.logger.warn(
          `[${event}] [fail] libraryId=${libraryId} podcastId=${show.id} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - show could not be queued for delete`,
        );
      }
    }

    const skipped = requested - shows.length;
    this.logger.log(
      `[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} completed=${completed} failed=${failed} skipped=${skipped} - bulk podcast delete completed`,
    );
    return { completed, failed, skipped };
  }

  async enqueueMerge(targetPodcastId: number, sourcePodcastId: number, user: RequestUser) {
    const target = await this.access.requirePodcastAccess(targetPodcastId, user, 'owner');
    const source = await this.access.requirePodcastAccess(sourcePodcastId, user, 'owner');
    if (target.libraryId !== source.libraryId || target.id === source.id)
      throw new BadRequestException('Podcasts must be distinct and in the same library');
    if (!target.archivedAt || !source.archivedAt) throw new BadRequestException('Archive both podcasts before merging them');
    const activeJobs = await this.jobs.cancelPodcastWork([target.id, source.id]);
    if (activeJobs > 0) throw new ConflictException('Podcast jobs are still stopping. Retry the merge shortly.');
    const jobId = await this.jobs.enqueueDestructive(
      {
        type: 'merge',
        dedupeKey: `merge:${Math.min(source.id, target.id)}:${Math.max(source.id, target.id)}`,
        libraryId: target.libraryId,
        podcastId: target.id,
        requestedByUserId: user.id,
        payload: { sourcePodcastId: source.id },
      },
      [target.id, source.id],
    );
    if (!jobId) throw new ConflictException('Podcast purge or merge work is already queued for one of these podcasts.');
    return { jobId };
  }

  async processRefresh(podcastId: number): Promise<number> {
    const podcast = await this.catalog.findPodcast(podcastId);
    // A show that became local while a refresh job sat in the queue simply has nothing to fetch.
    if (!podcast || podcast.archivedAt || podcast.origin === 'local' || !podcast.feedUrlEncrypted) return 0;
    const event = 'podcast.refresh_feed';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] podcastId=${podcastId} libraryId=${podcast.libraryId} - feed refresh started`);
    try {
      const feedUrl = this.secrets.decrypt(podcast.feedUrlEncrypted);
      const result = podcast.imageUrlEncrypted
        ? await this.feeds.fetchFeed(feedUrl, { etag: podcast.etag, lastModified: podcast.lastModified })
        : await this.feeds.fetchFeed(feedUrl);
      if (result.notModified) {
        await this.catalog.markRefreshNotModified(podcastId, result.status, result.etag ?? podcast.etag, result.lastModified ?? podcast.lastModified);
        this.logger.log(
          `[${event}] [end] podcastId=${podcastId} durationMs=${Date.now() - startedAt} notModified=true newEpisodes=0 - feed refresh completed`,
        );
        return 0;
      }
      if (!result.feed) throw new BadRequestException('Podcast feed returned no metadata');
      const canonicalPodcast = await this.catalog.findPodcastByFeedHash(podcast.libraryId, this.secrets.hashUrl(result.finalUrl));
      if (canonicalPodcast && canonicalPodcast.id !== podcastId) {
        throw new ConflictException('Podcast feed redirects to another podcast already in this library');
      }
      const snapshotAt = result.xml === null ? null : await this.snapshots.write(podcastId, result.xml);
      const synced = await this.catalog.syncPodcastFeed(podcastId, result.feed, { ...result, snapshotAt });
      await this.enqueueAcquisition(podcastId, podcast.libraryId, synced.insertedEpisodeIds, false);
      await this.notifyNewEpisodes(podcastId, podcast.title, synced.insertedEpisodeIds.length);
      this.logger.log(
        `[${event}] [end] podcastId=${podcastId} durationMs=${Date.now() - startedAt} notModified=false newEpisodes=${synced.insertedEpisodeIds.length} - feed refresh completed`,
      );
      return synced.insertedEpisodeIds.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = typeof (error as { status?: unknown }).status === 'number' ? ((error as { status: number }).status ?? null) : null;
      const failures = await this.catalog.markRefreshFailed(podcastId, message, status);
      if (failures === 3) {
        await this.notifications.notify({
          type: NotificationType.PodcastFeedUnhealthy,
          title: 'Podcast feed needs attention',
          message: `${podcast.title} has failed to refresh three times.`,
          actionUrl: `/podcasts/library/${podcast.libraryId}?view=health`,
          scope: { kind: 'library_permission', libraryId: podcast.libraryId, permission: Permission.PodcastManageFeeds },
        });
      }
      this.logger.warn(
        `[${event}] [fail] podcastId=${podcastId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - feed refresh failed`,
      );
      throw error;
    }
  }

  /**
   * Re-runs the parser over the stored feed copy. Followers are not notified: an episode the parser
   * only now understands was published long before this run, so it is not news to anyone.
   */

  async processReparse(podcastId: number): Promise<number> {
    const podcast = await this.catalog.findPodcast(podcastId);
    if (!podcast || podcast.archivedAt || podcast.origin === 'local') return 0;
    const event = 'podcast.reparse_feed';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] podcastId=${podcastId} libraryId=${podcast.libraryId} - feed reparse started`);
    try {
      const xml = await this.snapshots.read(podcastId);
      if (xml === null) throw new NotFoundException('No stored feed copy exists for this podcast yet');
      const synced = await this.catalog.reparsePodcastFeed(podcastId, this.parser.parse(xml));
      await this.enqueueAcquisition(podcastId, podcast.libraryId, synced.insertedEpisodeIds, false);
      this.logger.log(
        `[${event}] [end] podcastId=${podcastId} durationMs=${Date.now() - startedAt} episodes=${synced.episodeCount} newEpisodes=${synced.insertedEpisodeIds.length} - feed reparse completed`,
      );
      return synced.insertedEpisodeIds.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[${event}] [fail] podcastId=${podcastId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - feed reparse failed`,
      );
      throw error;
    }
  }

  async createPodcastFromUrl(
    libraryId: number,
    feedUrl: string,
    options: {
      acquisitionPolicy: PodcastAcquisitionPolicy;
      autoDownloadLimit?: number | null;
      autoDownloadWindowDays?: number | null;
      refreshIntervalMinutes?: number;
    },
  ) {
    const settings = await this.catalog.getLibrarySettings(libraryId);
    const originalHash = this.secrets.hashUrl(feedUrl);
    const existing = await this.catalog.findPodcastByFeedHash(libraryId, originalHash);
    // Adding a feed already in the library is a no-op that returns the show, so the caller is told
    // which happened rather than being left to assume every answer is a new subscription.
    if (existing) return { podcast: existing, created: false };
    const result = await this.feeds.fetchFeed(feedUrl);
    if (!result.feed) throw new BadRequestException('Podcast feed returned no metadata');
    const finalExisting = await this.catalog.findPodcastByFeedHash(libraryId, this.secrets.hashUrl(result.finalUrl));
    if (finalExisting) return { podcast: finalExisting, created: false };
    const refreshIntervalMinutes = options.refreshIntervalMinutes ?? settings.defaultRefreshIntervalMinutes;
    validatePodcastAcquisitionPolicy(options.acquisitionPolicy, options.autoDownloadLimit, options.autoDownloadWindowDays);
    let podcast: Awaited<ReturnType<PodcastCatalogRepository['createPodcast']>>;
    try {
      podcast = await this.catalog.createPodcast(libraryId, result.finalUrl, result.feed, {
        acquisitionPolicy: options.acquisitionPolicy,
        autoDownloadLimit: options.autoDownloadLimit,
        autoDownloadWindowDays: options.autoDownloadWindowDays,
        refreshIntervalMinutes,
        etag: result.etag,
        lastModified: result.lastModified,
      });
    } catch (error) {
      if (podcastDatabaseErrorCode(error) !== '23505') throw error;
      const concurrent = await this.catalog.findPodcastByFeedHash(libraryId, this.secrets.hashUrl(result.finalUrl));
      if (!concurrent) throw error;
      return { podcast: concurrent, created: false };
    }
    await this.enqueueAcquisition(
      podcast.id,
      libraryId,
      result.feed.episodes.map((_, index) => index),
      true,
    );
    return { podcast, created: true };
  }

  async processOpmlImport(libraryId: number, payload: Record<string, unknown>): Promise<void> {
    const encrypted = typeof payload.feedUrlEncrypted === 'string' ? payload.feedUrlEncrypted : null;
    const acquisitionPolicy = typeof payload.acquisitionPolicy === 'string' ? payload.acquisitionPolicy : 'remote_only';
    if (!encrypted || !['remote_only', 'manual', 'newest', 'window'].includes(acquisitionPolicy))
      throw new BadRequestException('Invalid OPML import job');
    const autoDownloadLimit = optionalPodcastJobInteger(payload.autoDownloadLimit, 1, 10_000);
    const autoDownloadWindowDays = optionalPodcastJobInteger(payload.autoDownloadWindowDays, 1, 3650);
    validatePodcastAcquisitionPolicy(acquisitionPolicy as PodcastAcquisitionPolicy, autoDownloadLimit, autoDownloadWindowDays);
    await this.createPodcastFromUrl(libraryId, this.secrets.decrypt(encrypted), {
      acquisitionPolicy: acquisitionPolicy as PodcastAcquisitionPolicy,
      autoDownloadLimit,
      autoDownloadWindowDays,
    });
  }

  async processPurge(podcastId: number): Promise<void> {
    const event = 'podcast.purge';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] podcastId=${podcastId} - podcast purge started`);
    try {
      const podcast = await this.catalog.findPodcast(podcastId);
      if (!podcast) {
        this.logger.log(`[${event}] [end] podcastId=${podcastId} durationMs=${Date.now() - startedAt} alreadyRemoved=true - podcast purge completed`);
        return;
      }
      if (!podcast.archivedAt) throw new BadRequestException('Podcast must remain archived until its purge finishes');
      await this.artwork.purgeCustomArtwork(podcastId);
      await this.snapshots.remove(podcastId);
      const removed = await this.storage.purgePodcastFiles(podcastId);
      await this.catalog.deletePodcast(podcastId);
      this.logger.log(
        `[${event}] [end] podcastId=${podcastId} durationMs=${Date.now() - startedAt} files=${removed.files} bytes=${removed.bytes} - podcast purge completed`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[${event}] [fail] podcastId=${podcastId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - podcast purge failed`,
      );
      throw error;
    }
  }

  async processMerge(targetPodcastId: number, payload: Record<string, unknown>): Promise<void> {
    const sourcePodcastId = Number(payload.sourcePodcastId);
    if (!Number.isInteger(sourcePodcastId) || sourcePodcastId <= 0) throw new BadRequestException('Invalid podcast merge job');
    const event = 'podcast.merge';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] podcastId=${targetPodcastId} sourcePodcastId=${sourcePodcastId} - podcast merge started`);
    try {
      const [target, source] = await Promise.all([this.catalog.findPodcast(targetPodcastId), this.catalog.findPodcast(sourcePodcastId)]);
      if (!target) {
        throw new BadRequestException('Podcast merge targets are no longer valid');
      }
      if (!source) {
        this.logger.log(
          `[${event}] [end] podcastId=${targetPodcastId} sourcePodcastId=${sourcePodcastId} durationMs=${Date.now() - startedAt} alreadyMerged=true cleanupFiles=0 - podcast merge completed`,
        );
        return;
      }
      if (target.libraryId !== source.libraryId || target.id === source.id)
        throw new BadRequestException('Podcast merge targets are no longer valid');
      if (!target.archivedAt || !source.archivedAt) throw new BadRequestException('Podcasts must remain archived until their merge finishes');
      const cleanupFiles = await this.catalog.mergePodcastInto(sourcePodcastId, targetPodcastId, target.libraryId);
      await this.artwork.purgeCustomArtwork(sourcePodcastId);
      await this.snapshots.remove(sourcePodcastId);
      this.logger.log(
        `[${event}] [end] podcastId=${targetPodcastId} sourcePodcastId=${sourcePodcastId} durationMs=${Date.now() - startedAt} cleanupFiles=${cleanupFiles} - podcast merge completed`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[${event}] [fail] podcastId=${targetPodcastId} sourcePodcastId=${sourcePodcastId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - podcast merge failed`,
      );
      throw error;
    }
  }

  async processDigest(podcastId: number, userId: number): Promise<void> {
    const [follow, podcast] = await Promise.all([this.catalog.findFollow(userId, podcastId), this.catalog.findPodcast(podcastId)]);
    if (!follow || !podcast || !['daily', 'weekly'].includes(follow.notificationMode)) return;
    const count = await this.catalog.countEpisodesCreatedSince(podcastId, follow.lastNotifiedAt);
    if (count > 0) {
      await this.notifications.notify({
        type: NotificationType.PodcastEpisodePublished,
        title: count === 1 ? `New episode of ${podcast.title}` : `${count} new episodes of ${podcast.title}`,
        actionUrl: `/podcasts/${podcastId}`,
        scope: { kind: 'user', userId },
      });
    }
    await this.catalog.markFollowNotified(userId, podcastId);
  }

  async enqueueAcquisition(podcastId: number, libraryId: number, episodeIdsOrIndexes: number[], initial: boolean): Promise<void> {
    const podcast = await this.catalog.findPodcast(podcastId);
    if (!podcast || podcast.origin === 'local') return;
    if (podcast.acquisitionPolicy === 'remote_only' || podcast.acquisitionPolicy === 'manual') return;
    let ids: number[];
    if (initial) {
      const limit = podcast.acquisitionPolicy === 'newest' ? (podcast.autoDownloadLimit ?? 3) : 10_000;
      ids = (await this.episodes.findNewestEpisodeIds(podcastId, limit))
        .filter(
          (episode) =>
            podcast.acquisitionPolicy !== 'window' ||
            (episode.publishedAt !== null && episode.publishedAt >= new Date(Date.now() - (podcast.autoDownloadWindowDays ?? 30) * 86_400_000)),
        )
        .map((episode) => episode.id);
    } else {
      const episodes = await this.episodes.findEpisodesByIds(episodeIdsOrIndexes);
      ids = episodes
        .filter(
          (episode) =>
            podcast.acquisitionPolicy !== 'window' ||
            (episode.publishedAt !== null && episode.publishedAt >= new Date(Date.now() - (podcast.autoDownloadWindowDays ?? 30) * 86_400_000)),
        )
        .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
        .slice(0, podcast.acquisitionPolicy === 'newest' ? (podcast.autoDownloadLimit ?? 3) : undefined)
        .map((episode) => episode.id);
    }
    ids = await this.episodes.filterDownloadableEpisodeIds(ids);
    const inserted = await this.jobs.enqueueMany(
      ids.map((episodeId) => ({
        type: 'download',
        dedupeKey: `download:${episodeId}`,
        libraryId,
        podcastId,
        episodeId,
        payload: { automatic: true },
      })),
    );
    await this.episodes.markMediaQueued(inserted.flatMap((job) => (job.episodeId === null ? [] : [job.episodeId])));
  }

  private async notifyNewEpisodes(podcastId: number, title: string, count: number): Promise<void> {
    if (count === 0) return;
    let afterUserId = 0;
    for (;;) {
      const users = await this.catalog.listFollowedUsers(podcastId, 'immediate', afterUserId, 200);
      if (users.length === 0) break;
      const userIds = users.map(({ userId }) => userId);
      const startedAt = Date.now();
      try {
        await this.notifications.notify({
          type: NotificationType.PodcastEpisodePublished,
          title: count === 1 ? `New episode of ${title}` : `${count} new episodes of ${title}`,
          actionUrl: `/podcasts/${podcastId}`,
          scope: { kind: 'users', userIds },
        });
        await this.catalog.markFollowsNotified(userIds, podcastId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[podcast.notify_new_episodes] [fail] podcastId=${podcastId} afterUserId=${afterUserId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - immediate podcast notifications failed`,
        );
        return;
      }
      if (users.length < 200) break;
      afterUserId = users[users.length - 1]!.userId;
    }
  }
}

function assertFeedOrigin(origin: 'feed' | 'local'): void {
  if (origin === 'feed') return;
  throw new BadRequestException({
    message: 'This show has no feed, so there is nothing to refresh',
    errorCode: PODCAST_ERROR_CODES.localNoRefresh,
  });
}

function optionalPodcastJobInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new BadRequestException('Invalid podcast import job options');
  }
  return value as number;
}

function podcastDatabaseErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function toImportScanJob(job: {
  id: number;
  status: string;
  payload: { dryRun?: unknown };
  progressCurrent: number;
  progressTotal: number | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PodcastImportScanJob {
  return {
    id: job.id,
    status: job.status,
    dryRun: job.payload.dryRun !== false,
    progressCurrent: job.progressCurrent,
    progressTotal: job.progressTotal,
    lastError: job.lastError,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
