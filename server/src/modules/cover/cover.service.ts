import { lookup } from 'dns/promises';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CoverSearchResult } from '@projectx/types';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { isIP } from 'net';
import { join } from 'path';

import { bookCoverDirPath, bookThumbnailPath, findExtractedBookCoverFileName } from '../../common/book-cover-storage';
import type { RequestUser } from '../../common/types/request-user';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata } from '../../db/schema';
import { BookReadService } from '../book/book-read.service';
import { BookMetadataLockService } from '../book-metadata-lock/book-metadata-lock.service';
import { LibraryService } from '../library/library.service';
import { generateThumbnail, imageExt } from '../metadata/lib/cover';
import {
  COVER_CUSTOM_FILE_PREFIX,
  COVER_PROXY_MAX_IMAGE_BYTES,
  COVER_PROXY_MAX_REDIRECTS,
  COVER_PROXY_TIMEOUT_MS,
  COVER_PROXY_USER_AGENT,
} from './constants';
import { CoverProviderRegistry } from './provider-registry';
import {
  COVER_PROVIDER_ALL_KEY,
  type CoverProviderKey,
  type CoverSearchParams,
  DUCKDUCKGO_PROVIDER_KEY,
  ITUNES_PROVIDER_KEY,
} from './providers/cover-provider';

type Db = NodePgDatabase<typeof schema>;

const SAFE_REMOTE_PROTOCOLS = new Set(['http:', 'https:']);
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const ITUNES_INTERLEAVE_LIMIT = 5;

@Injectable()
export class CoverService {
  private readonly logger = new Logger(CoverService.name);
  private readonly appDataPath: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bookReadService: BookReadService,
    private readonly bookMetadataLockService: BookMetadataLockService,
    private readonly libraryService: LibraryService,
    private readonly config: ConfigService,
    private readonly providerRegistry: CoverProviderRegistry,
  ) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  async searchCovers(params: CoverSearchParams & { provider?: string }): Promise<CoverSearchResult[]> {
    const { provider, ...searchParams } = params;
    const providers = this.providerRegistry.select(provider);
    const resultsByProvider = new Map<CoverProviderKey, CoverSearchResult[]>();

    for (const coverProvider of providers) {
      let results: CoverSearchResult[] = [];
      try {
        results = await coverProvider.search(searchParams);
      } catch (error) {
        this.logger.warn(
          `[cover.search_provider] [fail] provider=${coverProvider.key} errorClass=${errorClass(error)} error="${sanitizeErrorMessage(error)}" - cover provider search failed`,
        );
      }
      resultsByProvider.set(coverProvider.key, results);
    }

    const ordered =
      provider === COVER_PROVIDER_ALL_KEY
        ? this.orderAllProviderResults(
            providers.map((providerEntry) => providerEntry.key),
            resultsByProvider,
          )
        : providers.flatMap((providerEntry) => resultsByProvider.get(providerEntry.key) ?? []);

    return this.dedupeAndProxy(ordered);
  }

  async proxyImage(url: string): Promise<{ buffer: Buffer; contentType: string }> {
    const startedAt = Date.now();
    this.logger.debug(`[cover.proxy_image] [start] urlHost=${hostForLog(url)} - cover image proxy started`);

    try {
      const image = await this.fetchRemoteImage(url);
      this.logger.debug(
        `[cover.proxy_image] [end] urlHost=${hostForLog(url)} durationMs=${Date.now() - startedAt} bytes=${image.buffer.length} contentType=${image.contentType} - cover image proxy completed`,
      );
      return image;
    } catch (error) {
      this.logger.warn(
        `[cover.proxy_image] [fail] urlHost=${hostForLog(url)} durationMs=${Date.now() - startedAt} errorClass=${errorClass(error)} error="${sanitizeErrorMessage(error)}" - cover image proxy failed`,
      );
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Failed to proxy image');
    }
  }

  async uploadCover(bookId: number, buffer: Buffer, mimeType: string, user: RequestUser): Promise<void> {
    const startedAt = Date.now();
    this.logger.log(`[cover.upload] [start] bookId=${bookId} userId=${user.id} - custom cover upload started`);

    try {
      if (!mimeType.startsWith('image/')) throw new BadRequestException('File must be an image');
      await this.verifyAccess(bookId, user);
      await this.bookMetadataLockService.assertFieldsUnlocked(bookId, ['cover']);
      await this.saveCustomCover(bookId, buffer);
      await this.setCoverSource(bookId, 'custom');
      this.logger.log(
        `[cover.upload] [end] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} coverSource=custom - custom cover upload completed`,
      );
    } catch (error) {
      this.logger.warn(
        `[cover.upload] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass(error)} error="${sanitizeErrorMessage(error)}" - custom cover upload failed`,
      );
      throw error;
    }
  }

  async uploadCoverFromUrl(bookId: number, url: string, user: RequestUser): Promise<void> {
    const startedAt = Date.now();
    this.logger.log(
      `[cover.upload_from_url] [start] bookId=${bookId} userId=${user.id} urlHost=${hostForLog(url)} - custom cover upload from URL started`,
    );

    try {
      await this.verifyAccess(bookId, user);
      await this.bookMetadataLockService.assertFieldsUnlocked(bookId, ['cover']);
      const { buffer } = await this.fetchRemoteImage(url);
      await this.saveCustomCover(bookId, buffer);
      await this.setCoverSource(bookId, 'custom');
      this.logger.log(
        `[cover.upload_from_url] [end] bookId=${bookId} userId=${user.id} urlHost=${hostForLog(url)} durationMs=${Date.now() - startedAt} coverSource=custom - custom cover upload from URL completed`,
      );
    } catch (error) {
      this.logger.warn(
        `[cover.upload_from_url] [fail] bookId=${bookId} userId=${user.id} urlHost=${hostForLog(url)} durationMs=${Date.now() - startedAt} errorClass=${errorClass(error)} error="${sanitizeErrorMessage(error)}" - custom cover upload from URL failed`,
      );
      throw error;
    }
  }

  async deleteCover(bookId: number, user: RequestUser): Promise<'extracted' | null> {
    const startedAt = Date.now();
    this.logger.log(`[cover.delete] [start] bookId=${bookId} userId=${user.id} - cover deletion started`);

    try {
      await this.verifyAccess(bookId, user);
      await this.bookMetadataLockService.assertFieldsUnlocked(bookId, ['cover']);
      const dir = bookCoverDirPath(this.appDataPath, bookId);
      await this.deleteFilesByPrefix(dir, COVER_CUSTOM_FILE_PREFIX);

      const extractedPath = await this.findExtractedCover(bookId);
      if (!extractedPath) {
        await this.removeFileIfPresent(bookThumbnailPath(this.appDataPath, bookId));
        await this.setCoverSource(bookId, null);
        this.logger.log(
          `[cover.delete] [end] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} coverSource=null - cover deletion completed`,
        );
        return null;
      }

      const bytes = await readFile(extractedPath);
      const thumb = await generateThumbnail(bytes);
      await writeFile(bookThumbnailPath(this.appDataPath, bookId), thumb);
      await this.setCoverSource(bookId, 'extracted');
      this.logger.log(
        `[cover.delete] [end] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} coverSource=extracted - cover deletion completed`,
      );
      return 'extracted';
    } catch (error) {
      this.logger.warn(
        `[cover.delete] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass(error)} error="${sanitizeErrorMessage(error)}" - cover deletion failed`,
      );
      throw error;
    }
  }

  private orderAllProviderResults(keys: CoverProviderKey[], resultsByProvider: Map<CoverProviderKey, CoverSearchResult[]>): CoverSearchResult[] {
    const duckDuckGoResults = resultsByProvider.get(DUCKDUCKGO_PROVIDER_KEY) ?? [];
    const iTunesResults = resultsByProvider.get(ITUNES_PROVIDER_KEY) ?? [];
    const interleaved = this.interleaveITunesWithDuckDuckGo(duckDuckGoResults, iTunesResults, ITUNES_INTERLEAVE_LIMIT);

    const remaining = keys
      .filter((key) => key !== DUCKDUCKGO_PROVIDER_KEY && key !== ITUNES_PROVIDER_KEY)
      .flatMap((key) => resultsByProvider.get(key) ?? []);

    return [...interleaved, ...remaining];
  }

  private interleaveITunesWithDuckDuckGo(
    duckDuckGoResults: CoverSearchResult[],
    iTunesResults: CoverSearchResult[],
    firstN: number,
  ): CoverSearchResult[] {
    const leadingITunes = iTunesResults.slice(0, firstN);
    const trailingITunes = iTunesResults.slice(firstN);
    const mixed: CoverSearchResult[] = [];
    const rounds = Math.max(duckDuckGoResults.length, leadingITunes.length);

    for (let i = 0; i < rounds; i += 1) {
      const duckDuckGo = duckDuckGoResults[i];
      if (duckDuckGo) mixed.push(duckDuckGo);
      const iTunes = leadingITunes[i];
      if (iTunes) mixed.push(iTunes);
    }

    mixed.push(...trailingITunes);
    return mixed;
  }

  private dedupeAndProxy(results: CoverSearchResult[]): CoverSearchResult[] {
    const deduped: CoverSearchResult[] = [];
    const seen = new Set<string>();
    for (const result of results) {
      const dedupeKey = `${result.sourceUrl}|${String(result.url)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      deduped.push({
        ...result,
        previewUrl: `/api/v1/books/cover/proxy?url=${encodeURIComponent(result.previewUrl)}`,
      });
    }
    return deduped;
  }

  private async saveCustomCover(bookId: number, buffer: Buffer): Promise<void> {
    const dir = bookCoverDirPath(this.appDataPath, bookId);
    await mkdir(dir, { recursive: true });
    await this.deleteFilesByPrefix(dir, COVER_CUSTOM_FILE_PREFIX);

    const ext = imageExt(buffer);
    await writeFile(join(dir, `${COVER_CUSTOM_FILE_PREFIX}${ext}`), buffer);
    const thumb = await generateThumbnail(buffer);
    await writeFile(bookThumbnailPath(this.appDataPath, bookId), thumb);
  }

  private async findExtractedCover(bookId: number): Promise<string | null> {
    const dir = bookCoverDirPath(this.appDataPath, bookId);
    const files = await this.readDirIfExists(dir);
    const found = findExtractedBookCoverFileName(files);
    return found ? join(dir, found) : null;
  }

  private async verifyAccess(bookId: number, user: RequestUser): Promise<void> {
    const libraryId = await this.bookReadService.findLibraryIdByBookId(bookId);
    if (libraryId === null) throw new NotFoundException(`Book ${bookId} not found`);
    await this.libraryService.verifyUserAccess(user.id, libraryId, user.isSuperuser);
  }

  private async setCoverSource(bookId: number, source: 'extracted' | 'custom' | null): Promise<void> {
    const now = new Date();
    await this.db
      .insert(bookMetadata)
      .values({ bookId, coverSource: source, updatedAt: now })
      .onConflictDoUpdate({ target: bookMetadata.bookId, set: { coverSource: source, updatedAt: now } });
  }

  private async fetchRemoteImage(rawUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    const parsedUrl = await this.parseRemoteImageUrl(rawUrl);
    return this.fetchRemoteImageWithRedirects(parsedUrl);
  }

  private async parseRemoteImageUrl(rawUrl: string): Promise<URL> {
    const candidate = rawUrl.trim();
    if (!candidate) throw new BadRequestException('Invalid URL');

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(candidate);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    if (!SAFE_REMOTE_PROTOCOLS.has(parsedUrl.protocol)) {
      throw new BadRequestException('URL must use http or https');
    }

    await this.ensureSafeRemoteHost(parsedUrl.hostname);
    return parsedUrl;
  }

  private async fetchRemoteImageWithRedirects(url: URL, redirectCount = 0): Promise<{ buffer: Buffer; contentType: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COVER_PROXY_TIMEOUT_MS);

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': COVER_PROXY_USER_AGENT,
          Accept: 'image/*',
        },
      });

      if (this.isRedirectStatus(response.status)) {
        if (redirectCount >= COVER_PROXY_MAX_REDIRECTS) {
          throw new BadRequestException('Too many image redirects');
        }

        const location = response.headers.get('location');
        if (!location) throw new BadRequestException('Image redirect is missing location');

        const redirectUrl = await this.resolveRedirectUrl(url, location);
        return this.fetchRemoteImageWithRedirects(redirectUrl, redirectCount + 1);
      }

      if (!response.ok) throw new BadRequestException(`Failed to fetch image: HTTP ${response.status}`);

      const contentType = this.extractImageContentType(response);
      const buffer = await this.readImageBuffer(response);
      return { buffer, contentType };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BadRequestException('Image request timed out');
      }
      throw new BadRequestException('Failed to fetch image from URL');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async resolveRedirectUrl(currentUrl: URL, location: string): Promise<URL> {
    let redirectUrl: URL;
    try {
      redirectUrl = new URL(location, currentUrl);
    } catch {
      throw new BadRequestException('Image redirect URL is invalid');
    }

    if (!SAFE_REMOTE_PROTOCOLS.has(redirectUrl.protocol)) {
      throw new BadRequestException('URL must use http or https');
    }

    await this.ensureSafeRemoteHost(redirectUrl.hostname);
    return redirectUrl;
  }

  private async ensureSafeRemoteHost(hostname: string): Promise<void> {
    const normalizedHost = hostname.trim().toLowerCase();
    if (!normalizedHost) throw new BadRequestException('URL host is required');

    if (normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost') || normalizedHost.endsWith('.local')) {
      throw new BadRequestException('URL host is not allowed');
    }

    // URL.hostname wraps IPv6 in brackets (e.g. [::1]); strip them for isIP/range checks
    const bareHost = normalizedHost.startsWith('[') && normalizedHost.endsWith(']') ? normalizedHost.slice(1, -1) : normalizedHost;

    const ipFamily = isIP(bareHost);
    if (ipFamily > 0) {
      if (isPrivateOrLocalAddress(bareHost)) {
        throw new BadRequestException('URL host is not allowed');
      }
      return;
    }

    let resolved;
    try {
      resolved = await lookup(normalizedHost, { all: true, verbatim: true });
    } catch {
      throw new BadRequestException('Unable to resolve URL host');
    }

    if (resolved.length === 0) throw new BadRequestException('Unable to resolve URL host');
    if (resolved.some((entry) => isPrivateOrLocalAddress(entry.address))) {
      throw new BadRequestException('URL host is not allowed');
    }
  }

  private extractImageContentType(response: Response): string {
    const headerValue = response.headers.get('content-type') ?? '';
    const contentType = headerValue.split(';')[0]?.trim().toLowerCase();
    if (!contentType?.startsWith('image/')) {
      throw new BadRequestException('URL does not point to an image');
    }
    return contentType;
  }

  private async readImageBuffer(response: Response): Promise<Buffer> {
    if (!response.body) throw new BadRequestException('Empty response body');

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > COVER_PROXY_MAX_IMAGE_BYTES) {
        throw new BadRequestException('Image exceeds 20 MB limit');
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks);
  }

  private async readDirIfExists(path: string): Promise<string[]> {
    try {
      return await readdir(path);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return [];
      throw error;
    }
  }

  private async deleteFilesByPrefix(path: string, prefix: string): Promise<void> {
    const files = await this.readDirIfExists(path);
    for (const fileName of files) {
      if (!fileName.startsWith(prefix)) continue;
      await this.removeFileIfPresent(join(path, fileName));
    }
  }

  private async removeFileIfPresent(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return;
      throw error;
    }
  }

  private isRedirectStatus(status: number): boolean {
    return REDIRECT_STATUS_CODES.has(status);
  }
}

function hostForLog(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname || 'invalid';
  } catch {
    return 'invalid';
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === code);
}

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/"/g, '\\"');
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
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
  const octets = address.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  if (octets[0] === 10) return true;
  if (octets[0] === 127) return true;
  if (octets[0] === 0) return true;
  if (octets[0] === 169 && octets[1] === 254) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
  if (octets[0] >= 224) return true;

  return false;
}
