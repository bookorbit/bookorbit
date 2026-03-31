import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata } from '../../db/schema';
import { coverDirPath, generateThumbnail, imageExt } from '../metadata/lib/cover';
import { BookReadService } from '../book/book-read.service';
import { LibraryService } from '../library/library.service';
import type { RequestUser } from '../../common/types/request-user';
import { CoverSearchParams } from './providers/cover-provider';
import { CoverSearchResult } from '@projectx/types';
import { CoverProviderRegistry } from './provider-registry';

type Db = NodePgDatabase<typeof schema>;

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

@Injectable()
export class CoverService {
  private readonly logger = new Logger(CoverService.name);
  private readonly booksPath: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bookReadService: BookReadService,
    private readonly libraryService: LibraryService,
    private readonly config: ConfigService,
    private readonly providerRegistry: CoverProviderRegistry,
  ) {
    this.booksPath = this.config.get<string>('storage.booksPath')!;
  }

  async searchCovers(params: CoverSearchParams & { provider?: string }): Promise<CoverSearchResult[]> {
    const { provider, ...searchParams } = params;
    const providers = this.providerRegistry.select(provider);
    const resultsByProvider = new Map<string, CoverSearchResult[]>();
    for (const coverProvider of providers) {
      let results: CoverSearchResult[] = [];
      try {
        results = await coverProvider.search(searchParams);
      } catch (error) {
        this.logger.warn(`Cover provider "${coverProvider.key}" failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      resultsByProvider.set(coverProvider.key, results);
    }

    const ordered =
      provider === 'all'
        ? this.orderAllProviderResults(
            providers.map((providerEntry) => providerEntry.key),
            resultsByProvider,
          )
        : providers.flatMap((providerEntry) => resultsByProvider.get(providerEntry.key) ?? []);

    return this.dedupeAndProxy(ordered);
  }

  private orderAllProviderResults(keys: string[], resultsByProvider: Map<string, CoverSearchResult[]>): CoverSearchResult[] {
    const ddgResults = resultsByProvider.get('duckduckgo') ?? [];
    const itunesResults = resultsByProvider.get('itunes') ?? [];
    const interleaved = this.interleaveITunesWithDuckDuckGo(ddgResults, itunesResults, 5);

    const remaining = keys.filter((key) => key !== 'duckduckgo' && key !== 'itunes').flatMap((key) => resultsByProvider.get(key) ?? []);

    return [...interleaved, ...remaining];
  }

  private interleaveITunesWithDuckDuckGo(ddgResults: CoverSearchResult[], itunesResults: CoverSearchResult[], firstN: number): CoverSearchResult[] {
    const leadingITunes = itunesResults.slice(0, firstN);
    const trailingITunes = itunesResults.slice(firstN);
    const mixed: CoverSearchResult[] = [];
    const rounds = Math.max(ddgResults.length, leadingITunes.length);

    for (let i = 0; i < rounds; i += 1) {
      const ddg = ddgResults[i];
      if (ddg) mixed.push(ddg);
      const itunes = leadingITunes[i];
      if (itunes) mixed.push(itunes);
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

  async proxyImage(url: string): Promise<{ buffer: Buffer; contentType: string }> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      });
      if (!response.ok) throw new Error(`Proxy failed: ${response.status}`);
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const buffer = Buffer.from(await response.arrayBuffer());
      return { buffer, contentType };
    } catch (error) {
      this.logger.error(`Proxy error for ${url}: ${error.message}`);
      throw new BadRequestException('Failed to proxy image');
    }
  }

  async uploadCover(bookId: number, buffer: Buffer, mimeType: string, user: RequestUser): Promise<void> {
    if (!mimeType.startsWith('image/')) throw new BadRequestException('File must be an image');
    await this.verifyAccess(bookId, user);
    await this.saveCustomCover(bookId, buffer);
    await this.setCoverSource(bookId, 'custom');
  }

  async uploadCoverFromUrl(bookId: number, url: string, user: RequestUser): Promise<void> {
    await this.verifyAccess(bookId, user);
    const buffer = await this.fetchImageFromUrl(url);
    await this.saveCustomCover(bookId, buffer);
    await this.setCoverSource(bookId, 'custom');
  }

  async deleteCover(bookId: number, user: RequestUser): Promise<'extracted' | null> {
    await this.verifyAccess(bookId, user);
    const dir = coverDirPath(this.booksPath, bookId);

    const files = await readdir(dir).catch(() => [] as string[]);
    for (const f of files.filter((f) => f.startsWith('cover_custom.'))) {
      await unlink(join(dir, f)).catch(() => {});
    }

    const extractedPath = await this.findExtractedCover(bookId);
    if (extractedPath) {
      const bytes = await readFile(extractedPath);
      const thumb = await generateThumbnail(bytes);
      await writeFile(join(dir, 'thumbnail.jpg'), thumb);
      await this.setCoverSource(bookId, 'extracted');
      return 'extracted';
    } else {
      await unlink(join(dir, 'thumbnail.jpg')).catch(() => {});
      await this.setCoverSource(bookId, null);
      return null;
    }
  }

  private async saveCustomCover(bookId: number, buffer: Buffer): Promise<void> {
    const dir = coverDirPath(this.booksPath, bookId);
    await mkdir(dir, { recursive: true });

    const existing = await readdir(dir).catch(() => [] as string[]);
    for (const f of existing.filter((f) => f.startsWith('cover_custom.'))) {
      await unlink(join(dir, f)).catch(() => {});
    }

    const ext = imageExt(buffer);
    await writeFile(join(dir, `cover_custom.${ext}`), buffer);
    const thumb = await generateThumbnail(buffer);
    await writeFile(join(dir, 'thumbnail.jpg'), thumb);
  }

  private async findExtractedCover(bookId: number): Promise<string | null> {
    const dir = coverDirPath(this.booksPath, bookId);
    try {
      const files = await readdir(dir);
      const found = files.find((f) => f.startsWith('cover_extracted.'));
      return found ? join(dir, found) : null;
    } catch {
      return null;
    }
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

  private async fetchImageFromUrl(url: string): Promise<Buffer> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new BadRequestException('URL must use http or https');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new BadRequestException(`Failed to fetch image: HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) throw new BadRequestException('URL does not point to an image');

      if (!res.body) throw new BadRequestException('Empty response body');
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.length;
        if (total > MAX_IMAGE_BYTES) throw new BadRequestException('Image exceeds 20 MB limit');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Failed to fetch image from URL');
    } finally {
      clearTimeout(timeout);
    }
  }
}
