import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { mkdir, mkdtemp, rename, rm, stat, opendir, lstat, realpath } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';

import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { storageConfig } from '../../../config/config';

import { KepubifyBinaryService } from './kepubify-binary.service';

const execFileAsync = promisify(execFile);
const KEPUBIFY_TIMEOUT_MS = 60_000;
const AUDIOLESS_EPUB_CACHE_VERSION = 1;

interface KepubConversionInput {
  sourcePath: string;
  fileHash?: string | null;
  bookId: number;
  hyphenate: boolean;
  /**
   * The source was rebuilt without its narration. It carries the original file's hash, so it needs
   * its own cache entry to avoid being served in place of a conversion of the full archive.
   */
  audioless?: boolean;
  sourceRevision?: string;
}

@Injectable()
export class KepubConversionService {
  private readonly kepubCachePath: string;
  private readonly appDataPath: string;
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  private readonly leases = new Map<string, number>();
  private publication: Promise<void> = Promise.resolve();
  private readonly conversions = new Map<string, Promise<string>>();

  constructor(
    @Inject(storageConfig.KEY) storage: ConfigType<typeof storageConfig>,
    private readonly kepubifyBinaryService: KepubifyBinaryService,
  ) {
    this.appDataPath = storage.appDataPath;
    this.kepubCachePath = join(storage.appDataPath, '.kepub-cache');
  }

  async acquireKepub(input: KepubConversionInput): Promise<{ path: string; release: () => Promise<void> }> {
    const path = await this.getKepubPath(input);
    this.leases.set(path, (this.leases.get(path) ?? 0) + 1);
    let released = false;
    return {
      path,
      release: () => {
        if (released) return Promise.resolve();
        released = true;
        const count = (this.leases.get(path) ?? 1) - 1;
        if (count) this.leases.set(path, count);
        else this.leases.delete(path);
        return Promise.resolve();
      },
    };
  }

  async getKepubPath(input: KepubConversionInput): Promise<string> {
    const cacheDir = join(this.kepubCachePath, String(input.bookId));
    const fileHash = input.fileHash ?? 'nohash';
    // Keep the original two key shapes byte for byte so existing cache entries still hit.
    const legacyKey = `${fileHash}${input.audioless ? `-noaudio-v${AUDIOLESS_EPUB_CACHE_VERSION}` : ''}${input.hyphenate ? '-hyph' : ''}`;
    const cacheKey = input.sourceRevision
      ? createHash('sha256')
          .update(`${input.sourceRevision}:${await this.kepubifyBinaryService.getVersion()}:${input.hyphenate}`)
          .digest('hex')
      : legacyKey;
    const cachedPath = join(cacheDir, `${cacheKey}.kepub.epub`);
    const pending = this.conversions.get(cachedPath);
    if (pending) return pending;

    try {
      if (input.sourceRevision && ((await lstat(cacheDir)).isSymbolicLink() || (await lstat(cachedPath)).isSymbolicLink()))
        throw new BadRequestException({ code: 'UNSAFE_DELIVERY_CACHE' });
      await stat(cachedPath);
      return cachedPath;
    } catch {
      // Cache miss.
    }

    const concurrent = this.conversions.get(cachedPath);
    if (concurrent) return concurrent;
    const conversion = this.convertToCache(input, cacheDir, cachedPath);
    this.conversions.set(cachedPath, conversion);
    try {
      return await conversion;
    } finally {
      this.conversions.delete(cachedPath);
    }
  }

  private async convertToCache(input: KepubConversionInput, cacheDir: string, cachedPath: string): Promise<string> {
    if (this.active >= 2) {
      if (this.waiters.length >= 32) throw new BadRequestException({ code: 'DELIVERY_BUSY' });
      await new Promise<void>((resolve, reject) => {
        const grant = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          const index = this.waiters.indexOf(grant);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new BadRequestException({ code: 'DELIVERY_BUSY' }));
        }, 60_000);
        this.waiters.push(grant);
      });
    } else this.active++;
    try {
      const binaryPath = await this.kepubifyBinaryService.getBinaryPath();
      await mkdir(cacheDir, { recursive: true });
      if (
        input.sourceRevision &&
        ((await realpath(this.kepubCachePath)) !== join(await realpath(this.appDataPath), '.kepub-cache') || (await lstat(cacheDir)).isSymbolicLink())
      )
        throw new BadRequestException({ code: 'UNSAFE_DELIVERY_CACHE' });
      const tempDir = await mkdtemp(join(cacheDir, '.conversion-'));
      const outputPath = join(tempDir, 'book.kepub.epub');
      try {
        const args = input.hyphenate ? ['--hyphenate', '--output', outputPath, input.sourcePath] : ['--output', outputPath, input.sourcePath];
        await execFileAsync(binaryPath, args, { timeout: KEPUBIFY_TIMEOUT_MS });
        // Readers and the cache recovery pass must never see a partially written conversion.
        const publication = this.publication.then(async () => {
          if (input.sourceRevision) await this.evict(cachedPath, (await stat(outputPath)).size);
          await rename(outputPath, cachedPath);
        });
        this.publication = publication.catch(() => {});
        await publication;
        return cachedPath;
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
  private async evict(publishingPath: string, requiredBytes: number): Promise<void> {
    let total = requiredBytes;
    let count = 1;
    const candidates: { path: string; size: number; mtime: number }[] = [];
    for await (const directory of await opendir(this.kepubCachePath)) {
      if (!directory.isDirectory() || !/^[1-9]\d*$/.test(directory.name)) continue;
      const bookDirectory = join(this.kepubCachePath, directory.name);
      for await (const entry of await opendir(bookDirectory)) {
        const path = join(bookDirectory, entry.name);
        if (entry.isDirectory() && entry.name.startsWith('.conversion-')) {
          const info = await stat(path);
          if (Date.now() - info.mtimeMs > 20 * 60_000) await rm(path, { recursive: true, force: true });
          continue;
        }
        if (!entry.isFile() || !/^[a-f0-9]{32,64}(?:-noaudio-v\d+)?(?:-hyph)?\.kepub\.epub$/.test(entry.name)) continue;
        const info = await stat(path);
        total += info.size;
        count++;
        if (path === publishingPath || this.leases.has(path) || this.conversions.has(path)) continue;
        candidates.push({ path, size: info.size, mtime: info.mtimeMs });
        if (candidates.length > 1000) {
          candidates.sort((a, b) => a.mtime - b.mtime);
          candidates.pop();
        }
      }
    }
    for (const candidate of candidates.sort((a, b) => a.mtime - b.mtime)) {
      if (total <= 8 * 1024 * 1024 * 1024 && count <= 1000) return;
      if (this.leases.has(candidate.path) || this.conversions.has(candidate.path)) continue;
      await rm(candidate.path, { force: true });
      total -= candidate.size;
      count--;
    }
    if (total > 8 * 1024 * 1024 * 1024 || count > 1000) throw new BadRequestException({ code: 'DELIVERY_CACHE_FULL' });
  }
}
