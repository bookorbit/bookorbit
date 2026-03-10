import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { access, mkdir, readdir, stat, unlink, writeFile } from 'fs/promises';
import { constants as fsConstants } from 'fs';
import { join } from 'path';

import { generateThumbnail, imageExt } from '../metadata/lib/cover';

const FETCH_TIMEOUT_MS = 12_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

@Injectable()
export class AuthorImageStorageService {
  private readonly logger = new Logger(AuthorImageStorageService.name);
  private readonly booksPath: string;

  constructor(private readonly config: ConfigService) {
    this.booksPath = this.config.get<string>('storage.booksPath')!;
  }

  async saveFromUrl(authorId: number, rawUrl: string): Promise<boolean> {
    const url = this.normalizeUrl(rawUrl);
    if (!url) return false;

    try {
      const bytes = await this.fetchImageFromUrl(url);
      if (!bytes || bytes.length === 0) return false;

      const dir = this.authorDir(authorId);
      await mkdir(dir, { recursive: true });

      const existing = await readdir(dir).catch(() => [] as string[]);
      for (const file of existing.filter((entry) => entry.startsWith('photo.'))) {
        await unlink(join(dir, file)).catch(() => {});
      }

      const ext = imageExt(bytes);
      await writeFile(join(dir, `photo.${ext}`), bytes);
      const thumb = await generateThumbnail(bytes);
      await writeFile(join(dir, 'thumbnail.jpg'), thumb);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`author image save failed for authorId=${authorId}: ${message}`);
      return false;
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
    return join(this.booksPath, 'authors', String(authorId));
  }

  private async isReadable(path: string): Promise<boolean> {
    try {
      await access(path, fsConstants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private normalizeUrl(rawUrl: string): string | null {
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

    return parsed.toString();
  }

  private async fetchImageFromUrl(url: string): Promise<Buffer | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ProjectX/1.0; +https://projectx.local)',
          Accept: 'image/*',
        },
      });
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
    } finally {
      clearTimeout(timeout);
    }
  }
}
