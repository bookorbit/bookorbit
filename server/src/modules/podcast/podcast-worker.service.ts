import { BadRequestException, HttpException, Inject, Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';

import { NotificationType } from '@bookorbit/types';
import type { PodcastImportKind, PodcastMediaStatus } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { podcastConfig } from '../../config/config';
import { NotificationService } from '../notification/notification.service';
import { PodcastFileImportService } from './podcast-file-import.service';
import { PodcastJobRepository } from './podcast-job.repository';
import { PodcastLocalShowImportService } from './podcast-local-show-import.service';
import { PodcastLocalWatcherService } from './podcast-local-watcher.service';
import { PodcastMediaStorageService } from './podcast-media-storage.service';
import { PodcastGateway } from './podcast.gateway';
import { PodcastCatalogRepository } from './podcast-catalog.repository';
import { PodcastEpisodeRepository } from './podcast-episode.repository';
import { PodcastOperationsService } from './podcast-operations.service';

const GENERAL_JOB_TYPES = [
  'refresh',
  'reparse',
  'retention',
  'purge',
  'opml_import',
  'import_scan',
  'local_import',
  'merge',
  'digest',
  'file_cleanup',
] as const;
const GENERAL_JOB_CONCURRENCY = 2;
const IMPORT_JOB_KINDS: Record<string, PodcastImportKind> = { opml_import: 'opml', import_scan: 'local_files', local_import: 'local_files' };
/**
 * The reliability floor under the local-folder watcher: filesystem events do not fire for changes
 * made on another machine against a network mount, so every enabled library's local shows are also
 * re-checked on this interval regardless of what the watcher saw.
 */
const LOCAL_DISCOVERY_INTERVAL_MS = 30 * 60_000;
/** How often the running folder watchers are matched against the current podcast libraries. */
const WATCHER_RECONCILE_INTERVAL_MS = 60_000;
/** How often a running import republishes its file counters while it works. */
const IMPORT_PROGRESS_INTERVAL_MS = 1_000;

@Injectable()
export class PodcastWorkerService implements OnModuleInit {
  private readonly logger = new Logger(PodcastWorkerService.name);
  private readonly maxConcurrent: number;
  private activeDownloads = 0;
  private activeGeneralJobs = 0;
  private dispatching = false;
  private scheduling = false;
  private lastRetentionSchedule = 0;
  private lastDigestSchedule = 0;
  private lastJobCleanup = 0;
  private lastLocalDiscoverySchedule = 0;
  private lastWatcherReconcile = 0;

  constructor(
    @Inject(podcastConfig.KEY) config: ConfigType<typeof podcastConfig>,
    private readonly jobs: PodcastJobRepository,
    private readonly catalog: PodcastCatalogRepository,
    private readonly episodes: PodcastEpisodeRepository,
    private readonly operations: PodcastOperationsService,
    private readonly storage: PodcastMediaStorageService,
    private readonly fileImports: PodcastFileImportService,
    private readonly localShowImports: PodcastLocalShowImportService,
    private readonly notifications: NotificationService,
    private readonly gateway: PodcastGateway,
    private readonly localWatcher: PodcastLocalWatcherService,
  ) {
    this.maxConcurrent = config.maxConcurrentDownloads;
  }

  async onModuleInit(): Promise<void> {
    const recovered = await this.jobs.recoverExpiredLeases();
    if (recovered > 0) this.logger.warn(`[podcast.jobs_recover] [end] durationMs=0 recovered=${recovered} - expired podcast jobs recovered`);
    await this.scheduleDueWork();
  }

  @Interval(5_000)
  async tick(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      await this.scheduleDueWork();
      while (this.activeGeneralJobs < GENERAL_JOB_CONCURRENCY) {
        const job = await this.jobs.claimNext(GENERAL_JOB_TYPES);
        if (!job) break;
        this.activeGeneralJobs++;
        void this.process(job).finally(() => {
          this.activeGeneralJobs--;
        });
      }
      while (this.activeDownloads < this.maxConcurrent) {
        const job = await this.jobs.claimNext(['download']);
        if (!job) break;
        this.activeDownloads++;
        void this.process(job).finally(() => {
          this.activeDownloads--;
        });
      }
    } finally {
      this.dispatching = false;
    }
  }

  @Interval(60_000)
  async recoverLeases(): Promise<void> {
    await this.jobs.recoverExpiredLeases();
  }

  async scheduleDueWork(): Promise<void> {
    if (this.scheduling) return;
    this.scheduling = true;
    try {
      const due = await this.catalog.findDuePodcasts(100);
      for (const podcast of due) {
        await this.jobs.enqueue({
          type: 'refresh',
          dedupeKey: `refresh:${podcast.id}`,
          libraryId: podcast.libraryId,
          podcastId: podcast.id,
          payload: {},
        });
      }
      if (Date.now() - this.lastRetentionSchedule >= 60 * 60_000) {
        let afterLibraryId = 0;
        for (;;) {
          const libraries = await this.catalog.findPodcastLibraryIds(afterLibraryId, 100);
          for (const library of libraries) {
            await this.jobs.enqueue({ type: 'retention', dedupeKey: `retention:${library.id}`, libraryId: library.id, payload: {} });
          }
          if (libraries.length < 100) break;
          afterLibraryId = libraries[libraries.length - 1]!.id;
        }
        this.lastRetentionSchedule = Date.now();
      }
      if (Date.now() - this.lastWatcherReconcile >= WATCHER_RECONCILE_INTERVAL_MS) {
        try {
          const libraryIds: number[] = [];
          let afterLibraryId = 0;
          for (;;) {
            const libraries = await this.catalog.findWatchedPodcastLibraryIds(afterLibraryId, 100);
            libraryIds.push(...libraries.map((library) => library.id));
            if (libraries.length < 100) break;
            afterLibraryId = libraries[libraries.length - 1]!.id;
          }
          await this.localWatcher.reconcile(libraryIds);
        } catch (error) {
          this.logger.warn(
            `[podcast.watcher.reconcile] [fail] errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - podcast watcher reconcile failed`,
          );
        }
        this.lastWatcherReconcile = Date.now();
      }
      if (Date.now() - this.lastLocalDiscoverySchedule >= LOCAL_DISCOVERY_INTERVAL_MS) {
        let afterLibraryId = 0;
        for (;;) {
          const libraries = await this.catalog.findWatchedPodcastLibraryIds(afterLibraryId, 100);
          for (const library of libraries) {
            try {
              await this.localShowImports.runLocalShowDiscovery(library.id);
            } catch (error) {
              this.logger.warn(
                `[podcast.local_discovery] [fail] libraryId=${library.id} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - local show discovery failed`,
              );
            }
          }
          if (libraries.length < 100) break;
          afterLibraryId = libraries[libraries.length - 1]!.id;
        }
        this.lastLocalDiscoverySchedule = Date.now();
      }
      if (Date.now() - this.lastDigestSchedule >= 15 * 60_000) {
        const follows = await this.catalog.findDueDigestFollows(100);
        for (const follow of follows) {
          await this.jobs.enqueue({
            type: 'digest',
            dedupeKey: `digest:${follow.userId}:${follow.podcastId}`,
            libraryId: follow.libraryId,
            podcastId: follow.podcastId,
            requestedByUserId: follow.userId,
            payload: {},
          });
        }
        if (follows.length < 100) this.lastDigestSchedule = Date.now();
      }
      if (Date.now() - this.lastJobCleanup >= 60 * 60_000) {
        const startedAt = Date.now();
        let deleted = 0;
        for (;;) {
          const count = await this.jobs.deleteExpiredTerminal(
            new Date(Date.now() - 7 * 24 * 60 * 60_000),
            new Date(Date.now() - 30 * 24 * 60 * 60_000),
          );
          deleted += count;
          if (count < 1000) break;
        }
        if (deleted > 0) {
          this.logger.log(`[podcast.jobs_cleanup] [end] durationMs=${Date.now() - startedAt} deleted=${deleted} - expired podcast jobs deleted`);
        }
        this.lastJobCleanup = Date.now();
      }
    } finally {
      this.scheduling = false;
    }
  }

  private async process(job: Awaited<ReturnType<PodcastJobRepository['claimNext']>> & {}): Promise<void> {
    if (!job) return;
    const event = 'podcast.process_job';
    const startedAt = Date.now();
    const leaseHeartbeat = setInterval(() => void this.jobs.renewLease(job.id).catch(() => undefined), 60_000);
    // An import writes its file counters as it goes but has no way to announce them. Reading them
    // on a tick is what turns a job that is merely "processing" into a bar that moves.
    const progressHeartbeat = IMPORT_JOB_KINDS[job.type]
      ? setInterval(() => void this.emitImportProgressForType(job.type, job.libraryId).catch(() => undefined), IMPORT_PROGRESS_INTERVAL_MS)
      : null;
    this.logger.log(
      `[${event}] [start] jobId=${job.id} libraryId=${job.libraryId} type=${job.type} attempt=${job.attemptCount} - podcast job started`,
    );
    let refreshNewEpisodes: number | null = null;
    try {
      await this.emitImportProgressForType(job.type, job.libraryId);
      if (await this.jobs.isCancellationRequested(job.id)) {
        await this.jobs.complete(job.id);
        this.logger.log(
          `[${event}] [end] jobId=${job.id} durationMs=${Date.now() - startedAt} type=${job.type} cancelled=true - podcast job completed`,
        );
        return;
      }
      switch (job.type) {
        case 'refresh':
          if (!job.podcastId) throw new BadRequestException('Podcast refresh job is missing podcastId');
          refreshNewEpisodes = await this.operations.processRefresh(job.podcastId);
          break;
        case 'reparse':
          if (!job.podcastId) throw new BadRequestException('Podcast reparse job is missing podcastId');
          await this.operations.processReparse(job.podcastId);
          break;
        case 'download':
          if (!job.episodeId) throw new BadRequestException('Podcast download job is missing episodeId');
          this.gateway.emitDownloadProgress({
            libraryId: job.libraryId,
            podcastId: job.podcastId ?? 0,
            episodeId: job.episodeId,
            batchId: job.downloadBatchId,
            status: 'downloading',
            receivedBytes: 0,
            totalBytes: null,
          });
          await this.storage.downloadEpisode(job.episodeId, async (current, total) => {
            if (await this.jobs.isCancellationRequested(job.id)) throw new InternalServerErrorException('Podcast download was cancelled');
            await this.jobs.updateProgress(job.id, current, total);
            this.gateway.emitDownloadProgress({
              libraryId: job.libraryId,
              podcastId: job.podcastId ?? 0,
              episodeId: job.episodeId!,
              batchId: job.downloadBatchId,
              status: 'downloading',
              receivedBytes: current,
              totalBytes: total,
            });
          });
          await this.jobs.enqueue({ type: 'retention', dedupeKey: `retention:${job.libraryId}`, libraryId: job.libraryId, payload: {} });
          break;
        case 'retention':
          await this.storage.runRetention(job.libraryId);
          break;
        case 'purge':
          if (!job.podcastId) throw new BadRequestException('Podcast purge job is missing podcastId');
          await this.operations.processPurge(job.podcastId);
          break;
        case 'opml_import':
          await this.operations.processOpmlImport(job.libraryId, job.payload);
          break;
        case 'import_scan':
          // An applied, library-wide scan is the user asking the library to match the disk, so the
          // folder sweep runs first: it adopts a folder added while nothing was watching and flags
          // one that left, and the file import that follows can then see the shows it created.
          // A dry run is excluded because a scan the user has not applied must not write.
          if (!job.podcastId && job.payload.dryRun === false) await this.localShowImports.runLocalShowDiscovery(job.libraryId);
          await this.fileImports.processImportScan(job);
          break;
        case 'local_import':
          await this.localShowImports.processLocalImport(job);
          break;
        case 'merge':
          if (!job.podcastId) throw new BadRequestException('Podcast merge job is missing podcastId');
          await this.operations.processMerge(job.podcastId, job.payload);
          break;
        case 'digest':
          if (!job.podcastId || !job.requestedByUserId) throw new BadRequestException('Podcast digest job is missing required IDs');
          await this.operations.processDigest(job.podcastId, job.requestedByUserId);
          break;
        case 'file_cleanup': {
          const path = job.payload.path;
          if (typeof path !== 'string' || path.length === 0 || path.length > 4096) {
            throw new BadRequestException('Podcast file cleanup job has an invalid path');
          }
          await this.storage.removeOrphanedFile(job.libraryId, path);
          break;
        }
        default:
          throw new BadRequestException(`Unsupported podcast job type: ${job.type}`);
      }
      await this.jobs.complete(job.id);
      if (job.type === 'download' && job.episodeId) {
        const context = await this.episodes.findEpisodeMediaContext(job.episodeId);
        this.gateway.emitDownloadComplete({
          libraryId: job.libraryId,
          podcastId: job.podcastId ?? context?.podcast.id ?? 0,
          episodeId: job.episodeId,
          batchId: job.downloadBatchId,
          jobStatus: 'completed',
          mediaStatus: (context?.media?.status ?? 'local') as PodcastMediaStatus,
          localSizeBytes: context?.media?.sizeBytes ?? null,
        });
      } else if (job.type === 'refresh' && job.podcastId) {
        const podcast = await this.catalog.findPodcast(job.podcastId);
        this.gateway.emitRefreshComplete({
          libraryId: job.libraryId,
          podcastId: job.podcastId,
          newEpisodes: refreshNewEpisodes ?? 0,
          consecutiveFailures: podcast?.consecutiveFailures ?? 0,
          lastError: podcast?.lastError ?? null,
        });
      } else {
        await this.emitImportProgressForType(job.type, job.libraryId);
      }
      this.logger.log(`[${event}] [end] jobId=${job.id} durationMs=${Date.now() - startedAt} type=${job.type} - podcast job completed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = await this.jobs.isCancellationRequested(job.id);
      const retryAt =
        !cancelled && shouldRetry(error) && job.attemptCount < 5
          ? new Date(Date.now() + Math.min(60 * 60_000, 30_000 * 2 ** (job.attemptCount - 1)))
          : null;
      const jobStatus = await this.jobs.fail(job.id, message, retryAt);
      if (job.type === 'download' && job.episodeId) {
        const context = await this.episodes.findEpisodeMediaContext(job.episodeId);
        this.gateway.emitDownloadComplete({
          libraryId: job.libraryId,
          podcastId: job.podcastId ?? context?.podcast.id ?? 0,
          episodeId: job.episodeId,
          batchId: job.downloadBatchId,
          jobStatus,
          mediaStatus: (context?.media?.status ?? 'failed') as PodcastMediaStatus,
          localSizeBytes: context?.media?.sizeBytes ?? null,
        });
      } else if (job.type === 'refresh' && job.podcastId) {
        const podcast = await this.catalog.findPodcast(job.podcastId);
        this.gateway.emitRefreshComplete({
          libraryId: job.libraryId,
          podcastId: job.podcastId,
          newEpisodes: 0,
          consecutiveFailures: podcast?.consecutiveFailures ?? 1,
          lastError: podcast?.lastError ?? message,
        });
      } else {
        await this.emitImportProgressForType(job.type, job.libraryId);
      }
      if (cancelled) {
        if (job.type === 'download' && job.episodeId) {
          await this.storage.removeEpisodeDownload(job.episodeId).catch(() => undefined);
        }
        this.logger.log(
          `[${event}] [end] jobId=${job.id} durationMs=${Date.now() - startedAt} type=${job.type} cancelled=true - podcast job completed`,
        );
        return;
      }
      if (job.type === 'download' && job.episodeId && !retryAt && !cancelled) {
        await this.notifications
          .notify({
            type: NotificationType.PodcastDownloadFailed,
            title: 'Podcast episode download failed',
            message: 'BookOrbit could not download this episode after multiple attempts.',
            actionUrl: `/listen/podcast/${job.episodeId}`,
            scope: job.requestedByUserId ? { kind: 'user', userId: job.requestedByUserId } : { kind: 'library', libraryId: job.libraryId },
          })
          .catch(() => undefined);
      }
      this.logger.warn(
        `[${event}] [fail] jobId=${job.id} durationMs=${Date.now() - startedAt} type=${job.type} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - podcast job failed`,
      );
    } finally {
      clearInterval(leaseHeartbeat);
      if (progressHeartbeat) clearInterval(progressHeartbeat);
    }
  }

  /** Both import lanes share one channel, so the event names which lane its counts describe. */
  private async emitImportProgressForType(type: string, libraryId: number): Promise<void> {
    const kind = IMPORT_JOB_KINDS[type];
    if (!kind) return;
    const summary = await this.jobs.summaryByType(libraryId, type);
    this.gateway.emitImportProgress({ libraryId, kind, ...summary });
  }
}

function shouldRetry(error: unknown): boolean {
  return !(error instanceof HttpException) || error.getStatus() >= 500;
}
