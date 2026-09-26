import { BadGatewayException, BadRequestException, Inject, Injectable, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import sharp from 'sharp';

import {
  findCustomPodcastArtworkFileName,
  isCustomPodcastArtworkFileName,
  podcastArtworkDirPath,
  podcastArtworkFileName,
  podcastArtworkThumbnailPath,
} from '../../common/podcast-artwork-storage';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { podcastConfig } from '../../config/config';
import { PodcastCatalogRepository } from './podcast-catalog.repository';
import { PodcastSecretService } from './podcast-secret.service';
import { parsePodcastUrl, PodcastUrlSecurityService } from './podcast-url-security.service';

const ARTWORK_FORMAT_CONTENT_TYPES = new Map([
  ['avif', 'image/avif'],
  ['gif', 'image/gif'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
]);
const ARTWORK_FORMAT_EXTENSIONS = new Map([
  ['avif', 'avif'],
  ['gif', 'gif'],
  ['jpeg', 'jpg'],
  ['png', 'png'],
  ['webp', 'webp'],
]);
const ARTWORK_EXTENSION_CONTENT_TYPES = new Map(
  [...ARTWORK_FORMAT_EXTENSIONS].map(([format, extension]) => [extension, ARTWORK_FORMAT_CONTENT_TYPES.get(format)!]),
);
const ARTWORK_MAX_BYTES = 10 * 1024 * 1024;
const ARTWORK_THUMBNAIL_SIZE = 512;
const ARTWORK_CACHE_TTL_MS = 60 * 60_000;
const ARTWORK_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const ARTWORK_CACHE_MAX_ENTRIES = 500;

interface ArtworkCacheEntry {
  sourceUrl: string;
  data: Buffer;
  contentType: string;
  expiresAt: number;
}

@Injectable()
export class PodcastArtworkService {
  private readonly logger = new Logger(PodcastArtworkService.name);
  private readonly artworkCache = new Map<number, ArtworkCacheEntry>();
  private readonly artworkRequests = new Map<number, { sourceUrl: string; promise: Promise<{ data: Buffer; contentType: string }> }>();
  private readonly appDataPath: string;
  private readonly timeoutMs: number;
  private artworkCacheBytes = 0;

  constructor(
    @Inject(podcastConfig.KEY) config: ConfigType<typeof podcastConfig>,
    private readonly catalog: PodcastCatalogRepository,
    private readonly secrets: PodcastSecretService,
    private readonly urlSecurity: PodcastUrlSecurityService,
    appConfig: ConfigService,
  ) {
    this.appDataPath = appConfig.getOrThrow<string>('storage.appDataPath');
    this.timeoutMs = config.requestTimeoutMs;
  }

  /**
   * Artwork plus its validator, answering a revalidation from the podcast row alone.
   *
   * The point of the early return is that a matching `If-None-Match` costs one indexed row read:
   * no file opened, no remote CDN fetch, no bytes on the wire. A library grid scrolling past
   * thousands of shows revalidates constantly, and without this every expiry re-fetches the image.
   */
  async resolveArtwork(podcastId: number, ifNoneMatch?: string): Promise<PodcastArtworkResponse> {
    const podcast = await this.catalog.findPodcast(podcastId);
    if (!podcast) throw new NotFoundException('Podcast artwork not found');
    if (!podcast.customArtworkAt && !podcast.imageUrlEncrypted) throw new NotFoundException('Podcast artwork not found');

    const etag = podcast.customArtworkAt
      ? `"custom-${podcast.customArtworkAt.getTime()}"`
      : `"feed-${this.secrets.hashUrl(this.secrets.decrypt(podcast.imageUrlEncrypted!)).slice(0, 32)}"`;
    if (ifNoneMatch && matchesETag(ifNoneMatch, etag)) return { notModified: true, etag };

    const artwork = await this.fetchArtwork(podcastId);
    return { notModified: false, etag, ...artwork };
  }

  /** Custom artwork wins over the remote feed image and bypasses the remote-image LRU. */
  async fetchArtwork(podcastId: number): Promise<{ data: Buffer; contentType: string }> {
    const podcast = await this.catalog.findPodcast(podcastId);
    if (!podcast) throw new NotFoundException('Podcast artwork not found');
    if (podcast.customArtworkAt) {
      const custom = await this.readCustomArtwork(podcastId);
      if (custom) return custom;
    }
    if (!podcast.imageUrlEncrypted) throw new NotFoundException('Podcast artwork not found');
    const sourceUrl = this.secrets.decrypt(podcast.imageUrlEncrypted);
    const cached = this.getCachedArtwork(podcastId, sourceUrl);
    if (cached) return cached;
    const pending = this.artworkRequests.get(podcastId);
    if (pending?.sourceUrl === sourceUrl) return pending.promise;

    const promise = this.fetchArtworkSource(sourceUrl).then((artwork) => {
      if (this.artworkRequests.get(podcastId)?.sourceUrl === sourceUrl) this.cacheArtwork(podcastId, sourceUrl, artwork);
      return artwork;
    });
    this.artworkRequests.set(podcastId, { sourceUrl, promise });
    try {
      return await promise;
    } finally {
      if (this.artworkRequests.get(podcastId)?.promise === promise) this.artworkRequests.delete(podcastId);
    }
  }

  /** Fetches through the same SSRF-guarded path as feed artwork. */
  async fetchArtworkFromUrl(sourceUrl: string): Promise<Buffer> {
    const { data } = await this.fetchArtworkSource(sourceUrl);
    return data;
  }

  async saveCustomArtwork(podcastId: number, data: Buffer): Promise<{ format: string; bytes: number }> {
    const event = 'podcast.save_artwork';
    const startedAt = Date.now();
    if (data.byteLength === 0) throw new BadRequestException('Podcast artwork file is empty');
    if (data.byteLength > ARTWORK_MAX_BYTES) throw new PayloadTooLargeException('Podcast artwork exceeds the size limit');
    const format = await detectArtworkFormat(data);
    const extension = ARTWORK_FORMAT_EXTENSIONS.get(format)!;
    let thumbnail: Buffer;
    try {
      thumbnail = await sharp(data, { limitInputPixels: 100_000_000 })
        .resize(ARTWORK_THUMBNAIL_SIZE, ARTWORK_THUMBNAIL_SIZE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Podcast artwork could not be processed');
    }

    const directory = podcastArtworkDirPath(this.appDataPath, podcastId);
    await mkdir(directory, { recursive: true });
    const artworkPath = join(directory, podcastArtworkFileName(extension));
    const thumbnailPath = podcastArtworkThumbnailPath(this.appDataPath, podcastId);
    const temporaryId = randomUUID();
    const temporaryArtworkPath = join(directory, `.artwork-upload-${temporaryId}.${extension}.tmp`);
    const temporaryThumbnailPath = join(directory, `.artwork-upload-${temporaryId}.thumbnail.tmp`);
    try {
      await writeFile(temporaryArtworkPath, data);
      await writeFile(temporaryThumbnailPath, thumbnail);
      await rename(temporaryThumbnailPath, thumbnailPath);
      await rename(temporaryArtworkPath, artworkPath);
      await this.removeCustomArtworkFiles(directory, podcastArtworkFileName(extension));
    } finally {
      await Promise.all(
        [temporaryArtworkPath, temporaryThumbnailPath].map((path) =>
          rm(path, { force: true }).catch((error: unknown) =>
            this.logger.warn(
              `[podcast.save_artwork_cleanup] [fail] podcastId=${podcastId} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - temporary podcast artwork cleanup failed`,
            ),
          ),
        ),
      );
    }
    this.deleteCachedArtwork(podcastId);
    this.logger.log(
      `[${event}] [end] podcastId=${podcastId} durationMs=${Date.now() - startedAt} format=${format} bytes=${data.byteLength} - custom podcast artwork stored`,
    );
    return { format, bytes: data.byteLength };
  }

  async removeCustomArtwork(podcastId: number): Promise<boolean> {
    const directory = podcastArtworkDirPath(this.appDataPath, podcastId);
    const files = await this.readArtworkDirectory(directory);
    if (files.length === 0) return false;
    await this.removeCustomArtworkFiles(directory);
    await removeFileIfPresent(podcastArtworkThumbnailPath(this.appDataPath, podcastId));
    this.deleteCachedArtwork(podcastId);
    return true;
  }

  async purgeCustomArtwork(podcastId: number): Promise<void> {
    await rm(podcastArtworkDirPath(this.appDataPath, podcastId), { recursive: true, force: true });
    this.deleteCachedArtwork(podcastId);
  }

  private async readCustomArtwork(podcastId: number): Promise<{ data: Buffer; contentType: string } | null> {
    const directory = podcastArtworkDirPath(this.appDataPath, podcastId);
    const fileName = findCustomPodcastArtworkFileName(await this.readArtworkDirectory(directory));
    if (!fileName) return null;
    const contentType = ARTWORK_EXTENSION_CONTENT_TYPES.get(extname(fileName).slice(1).toLowerCase());
    if (!contentType) return null;
    try {
      return { data: await readFile(join(directory, fileName)), contentType };
    } catch (error) {
      if (getErrorCode(error) === 'ENOENT') return null;
      throw error;
    }
  }

  private async removeCustomArtworkFiles(directory: string, exceptFileName?: string): Promise<void> {
    for (const fileName of await this.readArtworkDirectory(directory)) {
      if (!isCustomPodcastArtworkFileName(fileName) || fileName === exceptFileName) continue;
      await removeFileIfPresent(join(directory, fileName));
    }
  }

  private async readArtworkDirectory(directory: string): Promise<string[]> {
    try {
      return await readdir(directory);
    } catch (error) {
      if (getErrorCode(error) === 'ENOENT') return [];
      throw error;
    }
  }

  private async fetchArtworkSource(sourceUrl: string): Promise<{ data: Buffer; contentType: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const { response } = await this.urlSecurity.fetch(parsePodcastUrl(sourceUrl), {
        signal: controller.signal,
        headers: { 'User-Agent': 'BookOrbit Podcast/1.0', Accept: 'image/*, application/octet-stream;q=0.8' },
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new BadGatewayException(`Podcast artwork returned HTTP ${response.status}`);
      }
      const data = await readBoundedBuffer(response, ARTWORK_MAX_BYTES, 'Podcast artwork exceeds the size limit');
      let format: string | undefined;
      try {
        format = (await sharp(data, { limitInputPixels: 100_000_000 }).metadata()).format;
      } catch {
        throw new BadGatewayException('Podcast artwork is not a valid raster image');
      }
      const detectedContentType = format ? ARTWORK_FORMAT_CONTENT_TYPES.get(format) : undefined;
      if (!detectedContentType) throw new BadGatewayException('Podcast artwork is not a supported raster image');
      return { data, contentType: detectedContentType };
    } finally {
      clearTimeout(timeout);
    }
  }

  private getCachedArtwork(podcastId: number, sourceUrl: string): { data: Buffer; contentType: string } | null {
    const entry = this.artworkCache.get(podcastId);
    if (!entry) return null;
    if (entry.sourceUrl !== sourceUrl || entry.expiresAt <= Date.now()) {
      this.deleteCachedArtwork(podcastId);
      return null;
    }
    this.artworkCache.delete(podcastId);
    this.artworkCache.set(podcastId, entry);
    return { data: entry.data, contentType: entry.contentType };
  }

  private cacheArtwork(podcastId: number, sourceUrl: string, artwork: { data: Buffer; contentType: string }): void {
    this.deleteCachedArtwork(podcastId);
    if (artwork.data.byteLength > ARTWORK_CACHE_MAX_BYTES) return;
    this.artworkCache.set(podcastId, { ...artwork, sourceUrl, expiresAt: Date.now() + ARTWORK_CACHE_TTL_MS });
    this.artworkCacheBytes += artwork.data.byteLength;
    while (this.artworkCache.size > ARTWORK_CACHE_MAX_ENTRIES || this.artworkCacheBytes > ARTWORK_CACHE_MAX_BYTES) {
      const oldestPodcastId = this.artworkCache.keys().next().value as number | undefined;
      if (oldestPodcastId === undefined) break;
      this.deleteCachedArtwork(oldestPodcastId);
    }
  }

  private deleteCachedArtwork(podcastId: number): void {
    const existing = this.artworkCache.get(podcastId);
    if (!existing) return;
    this.artworkCacheBytes -= existing.data.byteLength;
    this.artworkCache.delete(podcastId);
  }
}

async function detectArtworkFormat(data: Buffer): Promise<string> {
  const sniffed = sniffRasterFormat(data);
  if (!sniffed) throw new BadRequestException('Podcast artwork must be an AVIF, GIF, JPEG, PNG, or WebP image');
  let decoded: string | undefined;
  try {
    decoded = (await sharp(data, { limitInputPixels: 100_000_000 }).metadata()).format;
  } catch {
    throw new BadRequestException('Podcast artwork is not a valid raster image');
  }
  const matches = decoded === sniffed || (sniffed === 'avif' && decoded === 'heif');
  if (!matches) throw new BadRequestException('Podcast artwork content does not match its image format');
  return sniffed;
}

function sniffRasterFormat(data: Buffer): string | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (data.length >= 6 && (data.subarray(0, 6).toString('latin1') === 'GIF87a' || data.subarray(0, 6).toString('latin1') === 'GIF89a')) return 'gif';
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return sniffAvifBrands(data);
}

function sniffAvifBrands(data: Buffer): string | null {
  if (data.length < 12 || data.subarray(4, 8).toString('latin1') !== 'ftyp') return null;
  const declaredSize = data.readUInt32BE(0);
  const boxEnd = Math.min(declaredSize > 8 ? declaredSize : data.length, data.length);
  const brands = [data.subarray(8, 12).toString('latin1')];
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4) brands.push(data.subarray(offset, offset + 4).toString('latin1'));
  return brands.some((brand) => brand === 'avif' || brand === 'avis') ? 'avif' : null;
}

async function removeFileIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return;
    throw error;
  }
}

function numericHeader(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function readBoundedBuffer(response: Response, limit: number, errorMessage: string): Promise<Buffer> {
  const declaredSize = numericHeader(response.headers.get('content-length'));
  if (declaredSize !== null && declaredSize > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new PayloadTooLargeException(errorMessage);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new PayloadTooLargeException(errorMessage);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof (error as { code?: unknown }).code === 'string' ? ((error as { code: string }).code ?? undefined) : undefined;
}

export type PodcastArtworkResponse = { notModified: true; etag: string } | { notModified: false; etag: string; data: Buffer; contentType: string };

/** `If-None-Match` is a list, and a cache may weaken any entry it replays. */
function matchesETag(header: string, etag: string): boolean {
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, ''))
    .includes(etag);
}
