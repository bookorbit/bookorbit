import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookMetadata } from '../../db/schema';
import { coverDirPath, generateThumbnail, imageExt } from '../metadata/lib/cover';
import { BookRepository } from '../book/book.repository';
import { LibraryService } from '../library/library.service';
import type { RequestUser } from '../../common/types/request-user';
import { DuckDuckGoCoverProvider } from './providers/duckduckgo-cover-provider';
import { CoverSearchParams } from './providers/cover-provider';
import { CoverSearchResult } from '@projectx/types';

type Db = NodePgDatabase<typeof schema>;

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

@Injectable()
export class CoverService {
  private readonly logger = new Logger(CoverService.name);
  private readonly booksPath: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bookRepo: BookRepository,
    private readonly libraryService: LibraryService,
    private readonly config: ConfigService,
    private readonly ddgProvider: DuckDuckGoCoverProvider,
  ) {
    this.booksPath = this.config.get<string>('storage.booksPath')!;
  }

  async searchCovers(params: CoverSearchParams): Promise<CoverSearchResult[]> {
    // Currently only DDG provider, but could be multiple
    const results = await this.ddgProvider.search(params);
    return results.map((r) => ({
      ...r,
      // Encode URL for proxying
      previewUrl: `/api/v1/books/cover/proxy?url=${encodeURIComponent(r.previewUrl)}`,
    }));
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
    const libraryId = await this.bookRepo.findLibraryIdByBookId(bookId);
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
