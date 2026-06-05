import { execFile } from 'child_process';
import { mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { KepubifyBinaryService } from './kepubify-binary.service';

const execFileAsync = promisify(execFile);
const KEPUBIFY_TIMEOUT_MS = 60_000;

interface KepubConversionInput {
  sourcePath: string;
  fileHash?: string | null;
  bookId: number;
  hyphenate: boolean;
}

@Injectable()
export class KepubConversionService {
  private readonly kepubCachePath: string;

  constructor(
    private readonly config: ConfigService,
    private readonly kepubifyBinaryService: KepubifyBinaryService,
  ) {
    this.kepubCachePath = join(this.config.get<string>('storage.appDataPath')!, '.kepub-cache');
  }

  async getKepubPath(input: KepubConversionInput): Promise<string> {
    const cacheDir = join(this.kepubCachePath, String(input.bookId));
    const fileHash = input.fileHash ?? 'nohash';
    const cacheKey = input.hyphenate ? `${fileHash}-hyph` : fileHash;
    const cachedPath = join(cacheDir, `${cacheKey}.kepub.epub`);

    try {
      await stat(cachedPath);
      return cachedPath;
    } catch {
      // Cache miss.
    }

    const binaryPath = await this.kepubifyBinaryService.getBinaryPath();
    await mkdir(cacheDir, { recursive: true });
    const args = input.hyphenate ? ['--hyphenate', '--output', cachedPath, input.sourcePath] : ['--output', cachedPath, input.sourcePath];
    await execFileAsync(binaryPath, args, { timeout: KEPUBIFY_TIMEOUT_MS });
    return cachedPath;
  }
}
