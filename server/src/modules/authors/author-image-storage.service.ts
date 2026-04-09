import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lookup } from 'dns/promises';
import { access, mkdir, readdir, stat, unlink, writeFile } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { isIP } from 'net';
import { join } from 'path';

import { generateThumbnail, imageExt } from '../metadata/lib/cover';

const FETCH_TIMEOUT_MS = 12_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export class AuthorImageStorageError extends Error {
  readonly transient: boolean;
  readonly httpStatus: number | null;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    options?: {
      transient?: boolean;
      httpStatus?: number | null;
      retryAfterMs?: number | null;
    },
  ) {
    super(message);
    this.name = 'AuthorImageStorageError';
    this.transient = options?.transient ?? false;
    this.httpStatus = options?.httpStatus ?? null;
    this.retryAfterMs = options?.retryAfterMs ?? null;
  }
}

@Injectable()
export class AuthorImageStorageService {
  private readonly logger = new Logger(AuthorImageStorageService.name);
  private readonly appDataPath: string;

  constructor(private readonly config: ConfigService) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  async saveFromUrl(authorId: number, rawUrl: string): Promise<boolean> {
    const url = await this.normalizeUrl(rawUrl);
    if (!url) return false;

    const bytes = await this.fetchImageFromUrl(url);
    if (!bytes || bytes.length === 0) return false;

    const dir = this.authorDir(authorId);
    await mkdir(dir, { recursive: true });

    const existing = await readdir(dir).catch(() => [] as string[]);
    for (const file of existing.filter((entry) => entry.startsWith('photo.'))) {
      await unlink(join(dir, file)).catch((error: unknown) => {
        const errorClass = error instanceof Error ? error.name : 'Error';
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `[author.image.cleanup] [fail] authorId=${authorId} file=${file} errorClass=${errorClass} error="${message.replace(/"/g, '\\"')}" - author image cleanup failed`,
        );
      });
    }

    try {
      const ext = imageExt(bytes);
      await writeFile(join(dir, `photo.${ext}`), bytes);
      const thumb = await generateThumbnail(bytes);
      await writeFile(join(dir, 'thumbnail.jpg'), thumb);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AuthorImageStorageError(`Failed to persist author image: ${message}`, { transient: true });
    }
  }

  async getThumbnailPath(authorId: number): Promise<string | null> {
    const path = join(this.authorDir(authorId), 'thumbnail.jpg');
    return (await this.isReadable(path)) ? path : null;
  }

  async getImagePath(authorId: number): Promise<string | null> {
    const dir = this.authorDir(authorId);
    const files = await readdir(dir).catch(() => [] as string[]);
    const candidate = files.find((entry) => entry.startsWith('photo.'));
    if (!candidate) return null;

    const path = join(dir, candidate);
    return (await this.isReadable(path)) ? path : null;
  }

  async getThumbnailUrlIfExists(authorId: number): Promise<string | null> {
    const path = await this.getThumbnailPath(authorId);
    if (!path) return null;
    try {
      const { mtimeMs } = await stat(path);
      return `/api/v1/authors/${authorId}/thumbnail?t=${Math.floor(mtimeMs)}`;
    } catch {
      return `/api/v1/authors/${authorId}/thumbnail`;
    }
  }

  async getImageUrlIfExists(authorId: number): Promise<string | null> {
    const path = await this.getImagePath(authorId);
    if (!path) return null;
    try {
      const { mtimeMs } = await stat(path);
      return `/api/v1/authors/${authorId}/image?t=${Math.floor(mtimeMs)}`;
    } catch {
      return `/api/v1/authors/${authorId}/image`;
    }
  }

  private authorDir(authorId: number): string {
    return join(this.appDataPath, 'authors', String(authorId));
  }

  private async isReadable(path: string): Promise<boolean> {
    try {
      await access(path, fsConstants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async normalizeUrl(rawUrl: string): Promise<string | null> {
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    const candidate = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;

    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      return null;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    if (!(await this.isSafeRemoteHost(parsed.hostname))) {
      return null;
    }

    return parsed.toString();
  }

  private async isSafeRemoteHost(hostname: string): Promise<boolean> {
    const normalizedHost = hostname.trim().toLowerCase();
    if (!normalizedHost) return false;
    if (normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost') || normalizedHost.endsWith('.local')) {
      return false;
    }

    if (isIP(normalizedHost) > 0) {
      return !isPrivateOrLocalAddress(normalizedHost);
    }

    try {
      const resolved = await lookup(normalizedHost, { all: true, verbatim: true });
      if (resolved.length === 0) return false;
      return resolved.every((entry) => !isPrivateOrLocalAddress(entry.address));
    } catch {
      return false;
    }
  }

  private async fetchImageFromUrl(url: string, redirectCount = 0): Promise<Buffer | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ProjectX/1.0; +https://projectx.local)',
          Accept: 'image/*',
        },
      });
      if (isRedirectStatus(res.status)) {
        if (redirectCount >= MAX_REDIRECTS) {
          throw new AuthorImageStorageError('Too many image redirects', { transient: false });
        }
        const location = res.headers.get('location');
        if (!location) return null;
        const nextUrl = await this.resolveRedirectUrl(url, location);
        if (!nextUrl) return null;
        return this.fetchImageFromUrl(nextUrl, redirectCount + 1);
      }
      if (res.status === 429 || res.status >= 500) {
        throw new AuthorImageStorageError(`Image fetch failed with status ${res.status}`, {
          transient: true,
          httpStatus: res.status,
          retryAfterMs: parseRetryAfterMs(res.headers.get('retry-after')),
        });
      }
      if (!res.ok) return null;

      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
      if (!contentType.startsWith('image/')) return null;
      if (!res.body) return null;

      const chunks: Uint8Array[] = [];
      let total = 0;

      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.length;
        if (total > MAX_IMAGE_BYTES) return null;
        chunks.push(chunk);
      }

      return Buffer.concat(chunks);
    } catch (error) {
      if (error instanceof AuthorImageStorageError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new AuthorImageStorageError(`Image fetch failed: ${message}`, { transient: true });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async resolveRedirectUrl(currentUrl: string, location: string): Promise<string | null> {
    let resolved: URL;
    try {
      resolved = new URL(location, currentUrl);
    } catch {
      return null;
    }
    return this.normalizeUrl(resolved.toString());
  }
}

function isPrivateOrLocalAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const mappedV4Prefix = '::ffff:';
  const maybeV4 = normalized.startsWith(mappedV4Prefix) ? normalized.slice(mappedV4Prefix.length) : normalized;
  const family = isIP(maybeV4);

  if (family === 4) {
    return isPrivateOrLocalV4(maybeV4);
  }

  if (family === 6) {
    return (
      maybeV4 === '::1' ||
      maybeV4 === '::' ||
      maybeV4.startsWith('fc') ||
      maybeV4.startsWith('fd') ||
      maybeV4.startsWith('fe8') ||
      maybeV4.startsWith('fe9') ||
      maybeV4.startsWith('fea') ||
      maybeV4.startsWith('feb')
    );
  }

  return true;
}

function isPrivateOrLocalV4(address: string): boolean {
  const octets = address.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
    return true;
  }

  const [a, b] = octets;
  if (a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;

  return false;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const dateMs = new Date(value).getTime();
  if (!Number.isFinite(dateMs)) return null;
  const delta = dateMs - Date.now();
  return delta > 0 ? delta : null;
}
