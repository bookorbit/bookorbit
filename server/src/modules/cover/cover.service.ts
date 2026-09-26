import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CoverSearchResult, type CoverMedium } from '@bookorbit/types';
import type { BookCoverSource } from '../book-cover-store/book-cover-store.repository';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { ensureSafeRemoteHost } from '../../common/utils/ssrf.utils';
import { BookReadService } from '../book/book-read.service';
import { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import { BookMetadataLockService } from '../book-metadata-lock/book-metadata-lock.service';
import { FileWriteService } from '../file-write/file-write.service';
import { LibraryService } from '../library/library.service';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { COVER_PROXY_MAX_IMAGE_BYTES, COVER_PROXY_MAX_REDIRECTS, COVER_PROXY_TIMEOUT_MS, COVER_PROXY_USER_AGENT } from './constants';
import { CoverProviderRegistry } from './provider-registry';
import {
  COVER_PROVIDER_ALL_KEY,
  type CoverProviderKey,
  type CoverSearchParams,
  DUCKDUCKGO_PROVIDER_KEY,
  ITUNES_PROVIDER_KEY,
} from './providers/cover-provider';

const SAFE_REMOTE_PROTOCOLS = new Set(['http:', 'https:']);
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const ITUNES_INTERLEAVE_LIMIT = 5;

@Injectable()
export class CoverService {
  private readonly logger = new Logger(CoverService.name);

  constructor(
    private readonly bookReadService: BookReadService,
    private readonly bookMetadataLockService: BookMetadataLockService,
    private readonly fileWriteService: FileWriteService,
    private readonly libraryService: LibraryService,
    private readonly providerRegistry: CoverProviderRegistry,
    private readonly metadataScoreService: MetadataScoreService,
    private readonly coverStore: BookCoverStore,
  ) {}

  async searchCovers(params: CoverSearchParams & { provider?: string }): Promise<CoverSearchResult[]> {
    const { provider, ...searchParams } = params;
    const providers = this.providerRegistry.select(provider);
    const resultsByProvider = new Map<CoverProviderKey, CoverSearchResult[]>();

    for (const coverProvider of providers) {
      let results: CoverSearchResult[] = [];
      try {
        const providerSearchParams =
          provider === ITUNES_PROVIDER_KEY && coverProvider.key === ITUNES_PROVIDER_KEY
            ? { ...searchParams, ignoreProviderEnabled: true }
            : searchParams;
        results = await coverProvider.search(providerSearchParams);
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

  async uploadCover(bookId: number, buffer: Buffer, mimeType: string, user: RequestUser, requestedMedium?: CoverMedium): Promise<void> {
    const startedAt = Date.now();
    this.logger.log(`[cover.upload] [start] bookId=${bookId} userId=${user.id} - custom cover upload started`);

    try {
      if (!mimeType.startsWith('image/')) throw new BadRequestException('File must be an image');
      await this.verifyAccess(bookId, user);
      const medium = requestedMedium ?? (await this.unspecifiedWriteMedium(bookId));
      await this.bookMetadataLockService.assertFieldsUnlocked(bookId, [this.lockField(medium)]);
      await this.coverStore.saveCustom(bookId, medium, buffer);
      await this.metadataScoreService.calculateAndSave(bookId);
      this.fileWriteService.scheduleWrite(bookId, 'auto', user.id);
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

  async uploadCoverFromUrl(bookId: number, url: string, user: RequestUser, requestedMedium?: CoverMedium): Promise<void> {
    const startedAt = Date.now();
    this.logger.log(
      `[cover.upload_from_url] [start] bookId=${bookId} userId=${user.id} urlHost=${hostForLog(url)} - custom cover upload from URL started`,
    );

    try {
      await this.verifyAccess(bookId, user);
      const medium = requestedMedium ?? (await this.unspecifiedWriteMedium(bookId));
      await this.bookMetadataLockService.assertFieldsUnlocked(bookId, [this.lockField(medium)]);
      const { buffer } = await this.fetchRemoteImage(url);
      await this.coverStore.saveCustom(bookId, medium, buffer);
      await this.metadataScoreService.calculateAndSave(bookId);
      this.fileWriteService.scheduleWrite(bookId, 'auto', user.id);
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

  async deleteCover(bookId: number, user: RequestUser, requestedMedium?: CoverMedium): Promise<BookCoverSource | null> {
    const startedAt = Date.now();
    this.logger.log(`[cover.delete] [start] bookId=${bookId} userId=${user.id} - cover deletion started`);

    try {
      await this.verifyAccess(bookId, user);
      const medium = requestedMedium ?? (await this.coverStore.faceMediumFor(bookId));
      await this.bookMetadataLockService.assertFieldsUnlocked(bookId, [this.lockField(medium)]);
      const coverSource = await this.coverStore.revert(bookId, medium);
      await this.metadataScoreService.calculateAndSave(bookId);
      if (coverSource) this.fileWriteService.scheduleWrite(bookId, 'auto', user.id);
      this.logger.log(
        `[cover.delete] [end] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} coverSource=${coverSource ?? 'null'} - cover deletion completed`,
      );
      return coverSource;
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

  private async verifyAccess(bookId: number, user: RequestUser): Promise<void> {
    const libraryId = await this.bookReadService.findLibraryIdByBookId(bookId);
    if (libraryId === null) throw new NotFoundException(`Book ${bookId} not found`);
    await this.libraryService.verifyUserAccess(user.id, libraryId, user.isSuperuser);
  }

  /**
   * A write that names no slot comes from a client that shows one cover per book, the face, such as
   * an iOS build from before cover slots. It lands in the slot the face shows, not in the slot its
   * shape suits, or a square image picked for a 2:3 library would change nothing that client sees.
   */
  private unspecifiedWriteMedium(bookId: number): Promise<CoverMedium> {
    return this.coverStore.chooseWriteMedium(bookId);
  }

  private lockField(medium: CoverMedium): 'cover' | 'audioCover' {
    return medium === 'ebook' ? 'cover' : 'audioCover';
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

    await ensureSafeRemoteHost(parsedUrl.hostname);
    return parsedUrl;
  }

  private async fetchRemoteImageWithRedirects(url: URL, redirectCount = 0): Promise<{ buffer: Buffer; contentType: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COVER_PROXY_TIMEOUT_MS);

    try {
      // codeql[js/request-forgery] - URL is validated by ensureSafeRemoteHost before reaching this method
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

    await ensureSafeRemoteHost(redirectUrl.hostname);
    return redirectUrl;
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

function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeLogValue(message);
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}
