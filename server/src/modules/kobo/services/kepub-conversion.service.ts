import { execFile } from 'child_process';
import { mkdir, mkdtemp, rename, rm, stat } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';

import { Inject, Injectable } from '@nestjs/common';
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
}

@Injectable()
export class KepubConversionService {
  private readonly kepubCachePath: string;
  private readonly conversions = new Map<string, Promise<string>>();

  constructor(
    @Inject(storageConfig.KEY) storage: ConfigType<typeof storageConfig>,
    private readonly kepubifyBinaryService: KepubifyBinaryService,
  ) {
    this.kepubCachePath = join(storage.appDataPath, '.kepub-cache');
  }

  async getKepubPath(input: KepubConversionInput): Promise<string> {
    const cacheDir = join(this.kepubCachePath, String(input.bookId));
    const fileHash = input.fileHash ?? 'nohash';
    // Keep the original two key shapes byte for byte so existing cache entries still hit.
    const cacheKey = `${fileHash}${input.audioless ? `-noaudio-v${AUDIOLESS_EPUB_CACHE_VERSION}` : ''}${input.hyphenate ? '-hyph' : ''}`;
    const cachedPath = join(cacheDir, `${cacheKey}.kepub.epub`);
    const pending = this.conversions.get(cachedPath);
    if (pending) return pending;

    try {
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
    const binaryPath = await this.kepubifyBinaryService.getBinaryPath();
    await mkdir(cacheDir, { recursive: true });
    const tempDir = await mkdtemp(join(cacheDir, '.conversion-'));
    const outputPath = join(tempDir, 'book.kepub.epub');
    try {
      const args = input.hyphenate ? ['--hyphenate', '--output', outputPath, input.sourcePath] : ['--output', outputPath, input.sourcePath];
      await execFileAsync(binaryPath, args, { timeout: KEPUBIFY_TIMEOUT_MS });
      // Readers and the cache recovery pass must never see a partially written conversion.
      await rename(outputPath, cachedPath);
      return cachedPath;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
