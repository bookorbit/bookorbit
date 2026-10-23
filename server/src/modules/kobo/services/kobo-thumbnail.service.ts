import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { stat } from 'fs/promises';
import { createReadStream } from 'fs';
import type { FastifyReply } from 'fastify';
import sharp from 'sharp';
import { imageContentTypeFromPath } from '../../../common/image-content-type';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { KoboBookAccessService } from './kobo-book-access.service';
import { KoboSettingsService } from './kobo-settings.service';
import { BookCoverStore } from '../../book-cover-store/book-cover-store.service';

/** The box and JPEG quality a Kobo asks a cover to be served at, from its image URL template. */
export interface KoboCoverRequest {
  width: number;
  height: number;
  quality: number;
  greyscale: boolean;
}

const MAX_COVER_EDGE = 2400;
const SMALLEST_KOBO_SCREEN = { width: 600, height: 800 };
const FULL_SCREEN_BOX = { width: 1440, height: 1920 };
const DEFAULT_COVER_QUALITY = 85;
const MAX_INPUT_PIXELS = 100_000_000;
const RENDER_CONCURRENCY = 2;

export function parseKoboCoverRequest(width: string, height: string, quality?: string, greyscale?: string): KoboCoverRequest | null {
  const parsedWidth = parseEdge(width);
  const parsedHeight = parseEdge(height);
  if (parsedWidth === null || parsedHeight === null) return null;
  const parsedQuality = quality && /^\d{1,3}$/.test(quality) ? Number(quality) : NaN;
  return {
    width: parsedWidth,
    height: parsedHeight,
    quality: parsedQuality >= 1 && parsedQuality <= 100 ? parsedQuality : DEFAULT_COVER_QUALITY,
    greyscale: greyscale?.toLowerCase() === 'true',
  };
}

/**
 * A Kobo fetching a changed cover asks only for its home-screen tile, and its sleep screen then
 * stretches that tile. A box smaller than any Kobo screen is served at a size that fills every one.
 */
function coverBox(request: KoboCoverRequest): KoboCoverRequest {
  if (request.width >= SMALLEST_KOBO_SCREEN.width || request.height >= SMALLEST_KOBO_SCREEN.height) return request;
  return { ...request, ...FULL_SCREEN_BOX };
}

function parseEdge(value: string): number | null {
  if (!/^\d{1,5}$/.test(value)) return null;
  const edge = Number(value);
  return edge > 0 ? Math.min(edge, MAX_COVER_EDGE) : null;
}

@Injectable()
export class KoboThumbnailService {
  private readonly logger = new Logger(KoboThumbnailService.name);
  private activeRenders = 0;
  private readonly waitingRenders: Array<() => void> = [];

  constructor(
    private readonly bookAccessService: KoboBookAccessService,
    private readonly coverStore: BookCoverStore,
    private readonly settingsService: KoboSettingsService,
  ) {}

  async serveThumbnail(userId: number, bookId: number, request: KoboCoverRequest | null, ifNoneMatch: string | undefined, reply: FastifyReply) {
    await this.bookAccessService.assertBookAccessible(userId, bookId);

    if (request && (await this.settingsService.getSettings(userId)).fullSizeCovers) {
      if (await this.serveSizedCover(bookId, request, ifNoneMatch, reply)) return;
    }

    const thumbnailPath = await this.coverStore.resolve(bookId, { medium: 'ebook', variant: 'thumbnail' });
    try {
      if (!thumbnailPath) throw new NotFoundException('No thumbnail');
      const { mtimeMs } = await stat(thumbnailPath);
      const etag = `"${Math.floor(mtimeMs)}"`;
      if (ifNoneMatch === etag) {
        reply.status(304).send();
        return;
      }
      reply.header('Cache-Control', 'max-age=86400');
      reply.header('ETag', etag);
      reply.type('image/jpeg');
      reply.send(createReadStream(thumbnailPath));
    } catch {
      await this.serveCover(bookId, ifNoneMatch, reply);
    }
  }

  async serveCover(bookId: number, ifNoneMatch: string | undefined, reply: FastifyReply) {
    try {
      const coverPath = await this.coverStore.resolve(bookId, { medium: 'ebook', variant: 'cover' });
      if (!coverPath) throw new NotFoundException('No cover');
      const { mtimeMs } = await stat(coverPath);
      const etag = `"${Math.floor(mtimeMs)}"`;
      if (ifNoneMatch === etag) {
        reply.status(304).send();
        return;
      }
      reply.header('Cache-Control', 'max-age=86400');
      reply.header('ETag', etag);
      reply.type(imageContentTypeFromPath(coverPath));
      reply.send(createReadStream(coverPath));
    } catch {
      throw new NotFoundException('No cover image');
    }
  }

  /**
   * Serves the full cover scaled to fit the box the Kobo asked for, its screen size, so a sleep
   * screen or full-screen cover is not the grid thumbnail stretched. Resolves false when there is
   * no cover to scale, leaving the thumbnail to answer.
   */
  private async serveSizedCover(bookId: number, requested: KoboCoverRequest, ifNoneMatch: string | undefined, reply: FastifyReply): Promise<boolean> {
    const request = coverBox(requested);
    const coverPath = await this.coverStore.resolve(bookId, { medium: 'ebook', variant: 'cover' });
    if (!coverPath) return false;
    let mtimeMs: number;
    try {
      ({ mtimeMs } = await stat(coverPath));
    } catch {
      return false;
    }
    const etag = `"${Math.floor(mtimeMs)}-${request.width}x${request.height}-q${request.quality}${request.greyscale ? '-g' : ''}"`;
    if (ifNoneMatch === etag) {
      reply.status(304).send();
      return true;
    }

    const startedAt = Date.now();
    let image: Buffer;
    try {
      image = await this.renderCover(coverPath, request);
    } catch (error) {
      this.logger.warn(
        `[kobo-cover-render] [fail] bookId=${bookId} width=${request.width} height=${request.height} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Unknown'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - serving the thumbnail instead`,
      );
      return false;
    }
    reply.header('Cache-Control', 'max-age=86400');
    reply.header('ETag', etag);
    reply.type('image/jpeg');
    reply.send(image);
    return true;
  }

  private async renderCover(coverPath: string, request: KoboCoverRequest): Promise<Buffer> {
    await this.acquireRenderSlot();
    try {
      const image = sharp(coverPath, { limitInputPixels: MAX_INPUT_PIXELS }).resize(request.width, request.height, {
        fit: 'inside',
        withoutEnlargement: true,
      });
      if (request.greyscale) image.greyscale();
      return await image.jpeg({ quality: request.quality }).toBuffer();
    } finally {
      this.releaseRenderSlot();
    }
  }

  private async acquireRenderSlot(): Promise<void> {
    if (this.activeRenders < RENDER_CONCURRENCY) {
      this.activeRenders++;
      return;
    }
    await new Promise<void>((resolve) => this.waitingRenders.push(resolve));
  }

  private releaseRenderSlot(): void {
    const next = this.waitingRenders.shift();
    if (next) next();
    else this.activeRenders--;
  }
}
