import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createHash } from 'crypto';
import { constants } from 'fs';
import { mkdir, open, realpath, rename, rm, stat, statfs } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import { dirname, extname, isAbsolute, join, relative } from 'path';
import { pathToFileURL } from 'url';

import { PODCAST_ERROR_CODES } from '@bookorbit/types';
import type { PodcastOrigin } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { podcastConfig } from '../../config/config';
import { PodcastGateway } from './podcast.gateway';
import { PodcastCatalogRepository } from './podcast-catalog.repository';
import { PodcastEpisodeRepository } from './podcast-episode.repository';
import { PodcastSecretService } from './podcast-secret.service';
import { PodcastTagReaderService } from './podcast-tag-reader.service';
import { parsePodcastUrl, PodcastUrlSecurityService } from './podcast-url-security.service';

export const AUDIO_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.m4b', '.mp3', '.oga', '.ogg', '.opus', '.wav']);
const CAPACITY_RESERVATION_BYTES = 16 * 1024 * 1024;
const RETENTION_BATCH_SIZE = 250;

interface DownloadReservation {
  libraryId: number;
  reservedBytes: number;
  writtenBytes: number;
}

@Injectable()
export class PodcastMediaStorageService {
  private readonly logger = new Logger(PodcastMediaStorageService.name);
  private readonly maxEpisodeBytes: number;
  private readonly timeoutMs: number;
  private readonly maxDownloadDurationMs: number;
  private readonly downloadReservations = new Map<number, DownloadReservation>();
  private readonly storageLocks = new Map<number, Promise<void>>();

  constructor(
    @Inject(podcastConfig.KEY) config: ConfigType<typeof podcastConfig>,
    private readonly catalog: PodcastCatalogRepository,
    private readonly episodes: PodcastEpisodeRepository,
    private readonly secrets: PodcastSecretService,
    private readonly urlSecurity: PodcastUrlSecurityService,
    private readonly gateway: PodcastGateway,
    private readonly tagReader: PodcastTagReaderService,
  ) {
    this.maxEpisodeBytes = config.maxEpisodeBytes;
    this.timeoutMs = config.requestTimeoutMs;
    this.maxDownloadDurationMs = config.maxDownloadDurationMs;
  }

  async downloadEpisode(episodeId: number, onProgress?: (current: number, total: number | null) => Promise<void>): Promise<void> {
    const event = 'podcast.download_episode';
    const startedAt = Date.now();
    const context = await this.episodes.findEpisodeMediaContext(episodeId);
    if (!context) throw new NotFoundException('Podcast episode not found');
    if (context.media?.status === 'local' && context.media.localPath) {
      try {
        const owningRoot = await selectOwningRoot(context.libraryRoots, context.media.localPath);
        if (!owningRoot) throw new NotFoundException('Podcast media file not found');
        await resolveRegularFileWithinRoot(owningRoot, context.media.localPath);
        return;
      } catch (error) {
        if (!(error instanceof NotFoundException) && !(error instanceof BadRequestException)) throw error;
        await this.markMediaGone(episodeId, context.episode.origin);
      }
    }
    if (context.episode.origin === 'local' || !context.episode.enclosureUrlEncrypted) {
      throw new BadRequestException({ message: 'This episode has no feed enclosure to download', errorCode: PODCAST_ERROR_CODES.localNoDownload });
    }
    const sourceUrl = this.secrets.decrypt(context.episode.enclosureUrlEncrypted);
    const redactedUrl = this.secrets.redactUrl(sourceUrl);
    this.logger.log(`[${event}] [start] episodeId=${episodeId} url="${sanitizeLogValue(redactedUrl)}" - episode download started`);
    await this.episodes.updateMedia(episodeId, { status: 'downloading', lastError: null });

    const controller = new AbortController();
    let timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const absoluteTimeout = setTimeout(() => controller.abort(), this.maxDownloadDurationMs);
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    };
    let tempPath: string | null = null;
    let renamedPath: string | null = null;
    let responseReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const { response, finalUrl } = await this.urlSecurity.fetch(parsePodcastUrl(sourceUrl), {
        signal: controller.signal,
        headers: { 'User-Agent': 'BookOrbit Podcast/1.0', Accept: 'audio/*, application/octet-stream;q=0.8' },
      });
      resetTimeout();
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new BadGatewayException(`Episode media returned HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      responseReader = reader;
      const declaredSize = numericHeader(response.headers.get('content-length'));
      if (declaredSize !== null && declaredSize > this.maxEpisodeBytes)
        throw new PayloadTooLargeException('Episode exceeds the configured size limit');
      const declaredContentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || null;
      const mediaType = resolveAudioMediaType(finalUrl, declaredContentType);
      if (!mediaType) throw new BadRequestException('Episode enclosure is not a supported audio format');
      const expectedSize = declaredSize ?? context.episode.enclosureSizeBytes ?? 0;
      if (expectedSize > this.maxEpisodeBytes) throw new PayloadTooLargeException('Episode exceeds the configured size limit');
      let reservedBytes = Math.min(this.maxEpisodeBytes, expectedSize > 0 ? expectedSize : CAPACITY_RESERVATION_BYTES);
      clearTimeout(timeout);
      await this.reserveDownloadCapacity(episodeId, context.podcast.libraryId, reservedBytes, 0);
      resetTimeout();

      const libraryRoot = await realpath(context.libraryFolderPath);
      const showDirectory = join(libraryRoot, `${sanitizePathSegment(context.podcast.title, 120)} [${context.podcast.id}]`);
      await mkdir(showDirectory, { recursive: true });
      const resolvedShowDirectory = await realpath(showDirectory);
      assertPathInside(libraryRoot, resolvedShowDirectory);
      const published = context.episode.publishedAt?.toISOString().slice(0, 10) ?? 'undated';
      const fileName = `${published} - ${sanitizePathSegment(context.episode.title, 160)} [${episodeId}]${mediaType.extension}`;
      const finalPath = join(resolvedShowDirectory, fileName);
      assertPathInside(libraryRoot, finalPath);
      tempPath = `${finalPath}.part`;
      await rm(tempPath, { force: true });

      const handle = await open(tempPath, 'wx');
      const hash = createHash('sha256');
      let written = 0;
      let lastProgress = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          resetTimeout();
          const projectedSize = written + value.byteLength;
          if (projectedSize > this.maxEpisodeBytes) {
            await reader.cancel();
            throw new PayloadTooLargeException('Episode exceeds the configured size limit');
          }
          if (projectedSize > reservedBytes) {
            reservedBytes = Math.min(this.maxEpisodeBytes, Math.max(projectedSize, reservedBytes + CAPACITY_RESERVATION_BYTES));
            clearTimeout(timeout);
            await this.reserveDownloadCapacity(episodeId, context.podcast.libraryId, reservedBytes, written);
            resetTimeout();
          }
          written = projectedSize;
          this.updateDownloadReservation(episodeId, written);
          hash.update(value);
          await writeAll(handle, value);
          if (onProgress && written - lastProgress >= 1024 * 1024) {
            lastProgress = written;
            await onProgress(written, declaredSize);
          }
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (onProgress) await onProgress(written, declaredSize);
      await rename(tempPath, finalPath);
      tempPath = null;
      renamedPath = finalPath;
      await this.episodes.updateMedia(episodeId, {
        status: 'local',
        localPath: finalPath,
        fileName,
        format: mediaType.extension.slice(1),
        mimeType: mediaType.contentType,
        sizeBytes: written,
        checksum: hash.digest('hex'),
        downloadedAt: new Date(),
        lastRemoteValidatedAt: new Date(),
        lastError: null,
      });
      renamedPath = null;
      await this.reconcileDeclaredDuration(episodeId, finalPath, context.episode.durationSeconds);
      this.logger.log(
        `[${event}] [end] episodeId=${episodeId} durationMs=${Date.now() - startedAt} sizeBytes=${written} - episode download completed`,
      );
    } catch (error) {
      await responseReader?.cancel().catch(() => undefined);
      if (tempPath) await rm(tempPath, { force: true }).catch(() => undefined);
      if (renamedPath) await rm(renamedPath, { force: true }).catch(() => undefined);
      const errorClass = error instanceof Error ? error.name : 'Error';
      const message = error instanceof Error ? error.message : String(error);
      await this.episodes.updateMedia(episodeId, { status: 'failed', lastError: message.slice(0, 2000) }).catch(() => undefined);
      this.logger.warn(
        `[${event}] [fail] episodeId=${episodeId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - episode download failed`,
      );
      throw error;
    } finally {
      clearTimeout(timeout);
      clearTimeout(absoluteTimeout);
      this.downloadReservations.delete(episodeId);
    }
  }

  /**
   * Proxies the episode's origin. A local-origin episode has no origin to reach: reaching here at
   * all means its only copy is gone from disk, which is a 410 rather than a fetch.
   */
  async openRemoteMedia(episodeId: number, range?: string): Promise<Response> {
    const context = await this.episodes.findEpisodeMediaContext(episodeId);
    if (!context) throw new NotFoundException('Podcast episode not found');
    if (context.episode.origin === 'local' || !context.episode.enclosureUrlEncrypted) {
      await this.markMediaGone(episodeId, 'local');
      throw new HttpException(
        { message: 'The only copy of this episode is no longer on disk', errorCode: PODCAST_ERROR_CODES.localMediaMissing },
        HttpStatus.GONE,
      );
    }
    const sourceUrl = this.secrets.decrypt(context.episode.enclosureUrlEncrypted);
    const headers = new Headers({ 'User-Agent': 'BookOrbit Podcast/1.0', Accept: 'audio/*, application/octet-stream;q=0.8' });
    if (range) headers.set('Range', range);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const { response, finalUrl } = await this.urlSecurity.fetch(parsePodcastUrl(sourceUrl), { headers, signal: controller.signal });
      if (!response.ok && response.status !== 206 && response.status !== 416) {
        await response.body?.cancel().catch(() => undefined);
        throw new BadGatewayException(`Episode media returned HTTP ${response.status}`);
      }
      const declaredContentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || null;
      const mediaType = resolveAudioMediaType(finalUrl, declaredContentType);
      if (!mediaType) {
        await response.body?.cancel().catch(() => undefined);
        throw new BadGatewayException('Episode enclosure is not a supported audio format');
      }
      const timedResponse = withReadTimeout(response, controller, this.timeoutMs);
      const safeHeaders = new Headers(timedResponse.headers);
      safeHeaders.set('content-type', mediaType.contentType);
      safeHeaders.set('x-content-type-options', 'nosniff');
      return new Response(timedResponse.body, {
        status: timedResponse.status,
        statusText: timedResponse.statusText,
        headers: safeHeaders,
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('Episode media request failed');
    } finally {
      clearTimeout(timeout);
    }
  }

  async findAvailableLocalMedia(
    episodeId: number,
  ): Promise<{ handle: FileHandle; size: number; mimeType: string; fileName: string | null; checksum: string | null } | null> {
    const context = await this.episodes.findEpisodeMediaContext(episodeId);
    if (context?.media?.status !== 'local' || !context.media.localPath) return null;
    try {
      // An adopted episode's file sits in whichever root the user keeps it in, so the check has to
      // run against that root. Judging it against the downloads root would call every local
      // episode missing, and the catch below would then erase a media row that was perfectly fine.
      const owningRoot = await selectOwningRoot(context.libraryRoots, context.media.localPath);
      if (!owningRoot) throw new NotFoundException('Podcast media file not found');
      const localFile = await openRegularFileWithinRoot(owningRoot, context.media.localPath);
      const mediaType = resolveAudioMediaType(pathToFileURL(context.media.localPath), context.media.mimeType);
      if (!mediaType) {
        await localFile.handle.close();
        throw new BadRequestException('Downloaded episode is not a supported audio format');
      }
      return {
        handle: localFile.handle,
        size: localFile.size,
        mimeType: mediaType.contentType,
        fileName: context.media.fileName,
        // Recorded when the file was cached. Only published for a whole-file response, where it
        // describes exactly the bytes being sent.
        checksum: context.media.checksum ?? null,
      };
    } catch (error) {
      if (!(error instanceof NotFoundException) && !(error instanceof BadRequestException)) throw error;
      await this.markMediaGone(episodeId, context.episode.origin);
      return null;
    }
  }

  /**
   * Drops the episode's file. For a feed episode this is cache eviction and the media returns to
   * `remote`; for a local one it is deletion of the only copy, so the media becomes `unavailable`.
   * The episode row survives either way: its metadata, progress, and bookmarks are not the file.
   */
  async removeEpisodeDownload(episodeId: number): Promise<boolean> {
    const event = 'podcast.remove_episode_download';
    const startedAt = Date.now();
    const context = await this.episodes.findEpisodeMediaContext(episodeId);
    if (!context) throw new NotFoundException('Podcast episode not found');
    const origin = context.episode.origin;
    this.logger.log(`[${event}] [start] episodeId=${episodeId} origin=${origin} - podcast episode download removal started`);
    try {
      if (!context.media?.localPath) {
        await this.markMediaGone(episodeId, origin);
        this.logger.log(
          `[${event}] [end] episodeId=${episodeId} durationMs=${Date.now() - startedAt} removed=false - podcast episode download removal completed`,
        );
        return false;
      }
      const root = await selectOwningRoot(context.libraryRoots, context.media.localPath);
      const target = root ? await resolveExistingRegularFileWithinRoot(root, context.media.localPath) : null;
      if (target) await rm(target, { force: true });
      await this.markMediaGone(episodeId, origin);
      if (target) await rm(dirname(target), { recursive: false }).catch(() => undefined);
      this.logger.log(
        `[${event}] [end] episodeId=${episodeId} durationMs=${Date.now() - startedAt} removed=${target !== null} - podcast episode download removal completed`,
      );
      return target !== null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[${event}] [fail] episodeId=${episodeId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - podcast episode download removal failed`,
      );
      throw error;
    }
  }

  async purgePodcastFiles(podcastId: number): Promise<{ files: number; bytes: number }> {
    const podcast = await this.catalog.findPodcast(podcastId);
    if (!podcast) return { files: 0, bytes: 0 };
    const rootPath = await this.catalog.findPrimaryLibraryFolder(podcast.libraryId);
    if (!rootPath) throw new NotFoundException('Podcast library storage folder not found');
    const root = await realpath(rootPath);
    let removed = 0;
    let bytes = 0;
    let afterEpisodeId = 0;
    let firstPath: string | null = null;
    for (;;) {
      const files = await this.episodes.findPodcastMediaFiles(podcastId, afterEpisodeId, 200);
      if (files.length === 0) break;
      for (const file of files) {
        afterEpisodeId = file.episodeId;
        if (!file.localPath) continue;
        const target = await resolveExistingRegularFileWithinRoot(root, file.localPath);
        if (!target) continue;
        firstPath ??= target;
        await rm(target, { force: true });
        removed++;
        bytes += file.sizeBytes ?? 0;
      }
      if (files.length < 200) break;
    }
    if (firstPath) await rm(dirname(firstPath), { recursive: false }).catch(() => undefined);
    return { files: removed, bytes };
  }

  async removeOrphanedFile(libraryId: number, path: string): Promise<void> {
    const rootPath = await this.catalog.findPrimaryLibraryFolder(libraryId);
    if (!rootPath) throw new NotFoundException('Podcast library storage folder not found');
    const root = await realpath(rootPath);
    const target = await resolveExistingRegularFileWithinRoot(root, path);
    if (!target) return;
    await rm(target, { force: true });
    await rm(dirname(target), { recursive: false }).catch(() => undefined);
  }

  async runRetention(libraryId: number): Promise<{ evicted: number; bytes: number; cleaned: number; capacityAvailable: boolean }> {
    return this.withStorageLock(libraryId, async () => {
      // Cleanup goes first so an episode the listeners are done with is what gives up its space,
      // rather than pressure evicting something they still mean to play.
      const { cleaned } = await this.runFinishedCleanup(libraryId);
      const incoming = this.reservedCapacity(libraryId);
      const pressure = await this.runRetentionUnlocked(libraryId, incoming.quotaBytes, incoming.diskBytes);
      return { ...pressure, cleaned };
    });
  }

  /**
   * Post-listen cleanup for shows configured with `after_finished`.
   *
   * A row that claims a local file which is already gone is still reset. That is repair rather than
   * deletion, and a row pointing at nothing is worse than one honestly marked remote.
   */
  private async runFinishedCleanup(libraryId: number): Promise<{ cleaned: number; bytes: number }> {
    const event = 'podcast.run_cleanup';
    const startedAt = Date.now();
    let cleaned = 0;
    let bytes = 0;
    try {
      const rootPath = await this.catalog.findPrimaryLibraryFolder(libraryId);
      if (!rootPath) throw new NotFoundException('Podcast library storage folder not found');
      const root = await realpath(rootPath);
      for (;;) {
        const candidates = await this.episodes.findFinishedCleanupCandidates(libraryId, RETENTION_BATCH_SIZE);
        if (candidates.length === 0) break;
        for (const candidate of candidates) {
          const target = candidate.localPath ? await resolveExistingRegularFileWithinRoot(root, candidate.localPath) : null;
          if (target) {
            await rm(target, { force: true });
            bytes += candidate.sizeBytes ?? 0;
          }
          await this.markMediaGone(candidate.episodeId, 'feed');
          cleaned++;
          this.gateway.emitRetentionEvicted({
            libraryId,
            podcastId: candidate.podcastId,
            episodeId: candidate.episodeId,
            reason: 'played',
          });
        }
        if (candidates.length < RETENTION_BATCH_SIZE) break;
      }
      if (cleaned > 0) {
        this.logger.log(
          `[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} cleaned=${cleaned} bytes=${bytes} - podcast post-listen cleanup completed`,
        );
      }
      return { cleaned, bytes };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} durationMs=${Date.now() - startedAt} cleaned=${cleaned} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - podcast post-listen cleanup failed`,
      );
      throw error;
    }
  }

  private async runRetentionUnlocked(
    libraryId: number,
    incomingBytes: bigint,
    diskIncomingBytes: bigint,
  ): Promise<{ evicted: number; bytes: number; capacityAvailable: boolean }> {
    const event = 'podcast.run_retention';
    const startedAt = Date.now();
    let evicted = 0;
    let bytes = 0;
    this.logger.log(`[${event}] [start] libraryId=${libraryId} - podcast retention started`);
    try {
      const settings = await this.catalog.getLibrarySettings(libraryId);
      const library = await this.catalog.findPodcastLibrary(libraryId);
      if (!library) throw new NotFoundException('Podcast Library not found');
      const rootPath = await this.catalog.findPrimaryLibraryFolder(libraryId);
      if (!rootPath) throw new NotFoundException('Podcast library storage folder not found');
      const root = await realpath(rootPath);
      let used = settings.usedStorageBytes;
      let free = await this.getFreeBytesForLibrary(libraryId);
      while (used + incomingBytes > settings.storageQuotaBytes || free < settings.minimumFreeSpaceBytes + diskIncomingBytes) {
        const candidates = await this.episodes.findRetentionCandidates(libraryId, RETENTION_BATCH_SIZE);
        if (candidates.length === 0) break;
        for (const candidate of candidates) {
          if (used + incomingBytes <= settings.storageQuotaBytes && free >= settings.minimumFreeSpaceBytes + diskIncomingBytes) break;
          if (!candidate.localPath) continue;
          const target = await resolveExistingRegularFileWithinRoot(root, candidate.localPath);
          if (target) await rm(target, { force: true });
          const size = BigInt(candidate.sizeBytes ?? 0);
          used = used > size ? used - size : 0n;
          free += size;
          evicted++;
          bytes += Number(size);
          await this.markMediaGone(candidate.episodeId, 'feed');
          this.gateway.emitRetentionEvicted({
            libraryId,
            podcastId: candidate.podcastId,
            episodeId: candidate.episodeId,
            reason: 'space',
          });
        }
      }
      if (evicted > 0) free = await this.getFreeBytesForLibrary(libraryId);
      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} durationMs=${Date.now() - startedAt} evicted=${evicted} bytes=${bytes} - podcast retention completed`,
      );
      return {
        evicted,
        bytes,
        capacityAvailable: used + incomingBytes <= settings.storageQuotaBytes && free >= settings.minimumFreeSpaceBytes + diskIncomingBytes,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[${event}] [fail] libraryId=${libraryId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(message)}" - podcast retention failed`,
      );
      throw error;
    }
  }

  private async getFreeBytesForLibrary(libraryId: number): Promise<bigint> {
    const path = await this.catalog.findPrimaryLibraryFolder(libraryId);
    if (!path) return 0n;
    const info = await statfs(path);
    return BigInt(info.bavail) * BigInt(info.bsize);
  }

  private async reserveDownloadCapacity(episodeId: number, libraryId: number, reservedBytes: number, writtenBytes: number): Promise<void> {
    await this.withStorageLock(libraryId, async () => {
      const reservation: DownloadReservation = { libraryId, reservedBytes, writtenBytes };
      const incoming = this.reservedCapacity(libraryId, episodeId, reservation);
      const capacity = await this.runRetentionUnlocked(libraryId, incoming.quotaBytes, incoming.diskBytes);
      if (!capacity.capacityAvailable) {
        // Local-origin files occupy the library but can never be evicted, so a library dominated by
        // them can sit above quota with nothing left for retention to free. Say which case this is.
        const pinnedBytes = await this.episodes.getUnevictableLocalBytes(libraryId);
        throw new HttpException(
          {
            message:
              pinnedBytes > 0n
                ? `Podcast library does not have enough storage for this episode. ${pinnedBytes} bytes belong to local shows, which are never removed to free space.`
                : 'Podcast library does not have enough storage for this episode',
            errorCode: PODCAST_ERROR_CODES.storageFull,
          },
          HttpStatus.INSUFFICIENT_STORAGE,
        );
      }
      this.downloadReservations.set(episodeId, reservation);
    });
  }

  private updateDownloadReservation(episodeId: number, writtenBytes: number): void {
    const reservation = this.downloadReservations.get(episodeId);
    if (reservation) reservation.writtenBytes = writtenBytes;
  }

  private reservedCapacity(
    libraryId: number,
    replacedEpisodeId?: number,
    replacement?: DownloadReservation,
  ): { quotaBytes: bigint; diskBytes: bigint } {
    let quotaBytes = 0n;
    let diskBytes = 0n;
    for (const [episodeId, reservation] of this.downloadReservations) {
      if (episodeId === replacedEpisodeId || reservation.libraryId !== libraryId) continue;
      quotaBytes += BigInt(reservation.reservedBytes);
      diskBytes += BigInt(Math.max(0, reservation.reservedBytes - reservation.writtenBytes));
    }
    if (replacement) {
      quotaBytes += BigInt(replacement.reservedBytes);
      diskBytes += BigInt(Math.max(0, replacement.reservedBytes - replacement.writtenBytes));
    }
    return { quotaBytes, diskBytes };
  }

  private async withStorageLock<T>(libraryId: number, operation: () => Promise<T>): Promise<T> {
    const previous = this.storageLocks.get(libraryId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const queued = previous.then(() => gate);
    this.storageLocks.set(libraryId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.storageLocks.get(libraryId) === queued) this.storageLocks.delete(libraryId);
    }
  }

  /**
   * Corrects the stored runtime once the server holds the audio, because the feed's figure is a
   * claim and the file is the fact.
   *
   * Publishers under-declare constantly, mostly because dynamic ad insertion lengthens what the CDN
   * actually serves. Left alone, every list keeps deriving "time left" and progress from the short
   * figure while the player reads the real asset, so the same episode reports two different
   * remaining times, and its last stretch renders as already complete.
   *
   * Deliberately best-effort: a probe failure, a missing ffprobe, or a locked field leaves the
   * declared value alone and never fails a download that has already succeeded.
   */
  private async reconcileDeclaredDuration(episodeId: number, absolutePath: string, declaredSeconds: number | null): Promise<void> {
    try {
      const tags = await this.tagReader.read(absolutePath);
      const decoded = tags?.durationSeconds ?? null;
      if (decoded === null || !Number.isFinite(decoded) || decoded <= 0) return;
      const rounded = Math.round(decoded);
      // A second either way is rounding between the container and the feed, not a correction worth
      // a write or a changed `updatedAt`.
      if (declaredSeconds !== null && Math.abs(rounded - declaredSeconds) <= 1) return;
      const applied = await this.episodes.reconcileDurationFromMedia(episodeId, rounded);
      if (!applied) return;
      this.logger.log(
        `[podcast.reconcile_duration] [end] episodeId=${episodeId} declaredSeconds=${declaredSeconds ?? 'null'} decodedSeconds=${rounded} - stored runtime corrected from the downloaded file`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `[podcast.reconcile_duration] [fail] episodeId=${episodeId} error="${sanitizeLogValue(message)}" - runtime left as the feed declared it`,
      );
    }
  }

  /**
   * Clears a media row whose file is no longer there. `remote` is only honest for a feed episode,
   * which can always be fetched again; a local episode has nowhere to fetch from, so it lands on
   * `unavailable` instead of advertising a download that would immediately fail.
   */
  private async markMediaGone(episodeId: number, origin: PodcastOrigin): Promise<void> {
    await this.episodes.updateMedia(episodeId, {
      status: origin === 'local' ? 'unavailable' : 'remote',
      localPath: null,
      fileName: null,
      format: null,
      mimeType: null,
      sizeBytes: null,
      checksum: null,
      downloadedAt: null,
    });
  }
}

function numericHeader(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function withReadTimeout(response: Response, controller: AbortController, timeoutMs: number): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  let closed = false;
  const closeReader = () => {
    if (closed) return;
    closed = true;
    reader.releaseLock();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const { done, value } = await reader.read();
        if (done) {
          streamController.close();
          closeReader();
        } else streamController.enqueue(value);
      } catch (error) {
        streamController.error(error);
        closeReader();
      } finally {
        clearTimeout(timeout);
      }
    },
    async cancel(reason) {
      controller.abort();
      await reader.cancel(reason).catch(() => undefined);
      closeReader();
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export function resolveAudioMediaType(url: URL, contentType: string | null): { extension: string; contentType: string } | null {
  const byType: Record<string, { extension: string; contentType: string }> = {
    'audio/aac': { extension: '.aac', contentType: 'audio/aac' },
    'audio/flac': { extension: '.flac', contentType: 'audio/flac' },
    'audio/mp4': { extension: '.m4a', contentType: 'audio/mp4' },
    'audio/mpeg': { extension: '.mp3', contentType: 'audio/mpeg' },
    'audio/ogg': { extension: '.ogg', contentType: 'audio/ogg' },
    'audio/opus': { extension: '.opus', contentType: 'audio/opus' },
    'audio/wav': { extension: '.wav', contentType: 'audio/wav' },
    'audio/x-m4a': { extension: '.m4a', contentType: 'audio/mp4' },
  };
  if (contentType && byType[contentType]) return byType[contentType];
  const extension = extname(url.pathname).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(extension)) return null;
  const byExtension: Record<string, string> = {
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.m4b': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.oga': 'audio/ogg',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/opus',
    '.wav': 'audio/wav',
  };
  return { extension, contentType: byExtension[extension]! };
}

function sanitizePathSegment(value: string, maxLength: number): string {
  const sanitized = [...value.normalize('NFKC')]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? ' ' : character;
    })
    .join('')
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return (
    truncateUtf8(sanitized || 'Untitled', maxLength)
      .replace(/^\.+|\.+$/g, '')
      .trim() || 'Untitled'
  );
}

async function writeAll(handle: FileHandle, value: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < value.byteLength) {
    const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset);
    if (bytesWritten <= 0) throw new InternalServerErrorException('Episode file write made no progress');
    offset += bytesWritten;
  }
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let result = '';
  for (const character of value) {
    if (Buffer.byteLength(result) + Buffer.byteLength(character) > maxBytes) break;
    result += character;
  }
  return result;
}

/** Shared with the importer so every podcast path check applies the same containment rule. */
export function assertPodcastPathInsideRoot(root: string, target: string): void {
  assertPathInside(root, target);
}

/** The same containment rule as an answer rather than an error, for sweeps that skip instead of fail. */
export function isPodcastPathInsideRoot(root: string, target: string): boolean {
  try {
    assertPathInside(root, target);
    return true;
  } catch {
    return false;
  }
}

function assertPathInside(root: string, target: string): void {
  const relativePath = relative(root, target);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(relativePath)
  ) {
    throw new BadRequestException('Resolved podcast path is outside its library');
  }
}

async function resolveRegularFileWithinRoot(rootPath: string, filePath: string): Promise<string> {
  const root = await realpath(rootPath);
  const target = await resolveExistingRegularFileWithinRoot(root, filePath);
  if (!target) throw new NotFoundException('Podcast media file not found');
  return target;
}

/**
 * The library root a file already on disk belongs to, or null when it belongs to none of them.
 *
 * A podcast library has more than one root and they never overlap, so at most one can own a given
 * file. Picking it first lets every containment check stay a single-root check, which is the shape
 * the guarantees below are written against.
 */
export async function selectOwningRoot(rootPaths: string[], filePath: string): Promise<string | null> {
  for (const rootPath of rootPaths) {
    const root = await realpath(rootPath).catch(() => null);
    if (root && isPodcastPathInsideRoot(root, filePath)) return root;
  }
  return null;
}

export async function openRegularFileWithinRoot(rootPath: string, filePath: string): Promise<{ handle: FileHandle; size: number }> {
  const root = await realpath(rootPath);
  const target = await resolveExistingRegularFileWithinRoot(root, filePath);
  if (!target) throw new NotFoundException('Podcast media file not found');
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new BadRequestException('Podcast media path is not a regular file');
    const openedPath = await realpath(target);
    assertPathInside(root, openedPath);
    const currentInfo = await stat(openedPath);
    if (currentInfo.dev !== info.dev || currentInfo.ino !== info.ino) {
      throw new BadRequestException('Podcast media path changed while it was being opened');
    }
    return { handle, size: info.size };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function resolveExistingRegularFileWithinRoot(root: string, filePath: string): Promise<string | null> {
  let target: string;
  try {
    target = await realpath(filePath);
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return null;
    throw error;
  }
  assertPathInside(root, target);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(target);
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return null;
    throw error;
  }
  if (!info.isFile()) throw new BadRequestException('Podcast media path is not a regular file');
  return target;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof (error as { code?: unknown }).code === 'string' ? ((error as { code: string }).code ?? undefined) : undefined;
}
