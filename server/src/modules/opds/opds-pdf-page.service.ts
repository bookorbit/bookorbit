import { execFile } from 'child_process';
import { mkdir, rm, stat } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const execFileAsync = promisify(execFile);

/**
 * Rasterizes a single PDF page to JPEG via `pdftoppm` (poppler-utils, already
 * a runtime dependency — see `metadata/lib/pdf-cover.ts`), cached to disk per
 * page. Presence is checked per-page-file rather than per-directory: a cache
 * dir that exists but is missing a given page (e.g. an interrupted previous
 * run) is repaired by re-rendering just that page, instead of silently
 * serving nothing (see Kavita#3477 for the bug this avoids).
 */
@Injectable()
export class OpdsPdfPageService {
  private readonly cacheRoot: string;
  // Keyed by fileId:pageNumber so concurrent requests for the same page await
  // the same render instead of both shelling out to pdftoppm and racing to
  // write the same cache file (which can interleave into a corrupt JPEG).
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(config: ConfigService) {
    this.cacheRoot = join(config.get<string>('storage.appDataPath')!, 'pse-cache');
  }

  private cacheDir(fileId: number): string {
    return join(this.cacheRoot, String(fileId));
  }

  async ensurePage(fileId: number, absolutePath: string, pageNumber: number): Promise<string> {
    const key = `${fileId}:${pageNumber}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.renderPage(fileId, absolutePath, pageNumber).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private async renderPage(fileId: number, absolutePath: string, pageNumber: number): Promise<string> {
    const dir = this.cacheDir(fileId);
    const pagePath = join(dir, `${pageNumber}.jpg`);
    if (await this.exists(pagePath)) return pagePath;

    await mkdir(dir, { recursive: true });
    const pdfPageNumber = pageNumber + 1; // pdftoppm pages are 1-based; PSE pageNumber is 0-based
    const outPrefix = join(dir, String(pageNumber));
    await execFileAsync('pdftoppm', [
      '-jpeg',
      '-singlefile',
      '-r',
      '150',
      '-f',
      String(pdfPageNumber),
      '-l',
      String(pdfPageNumber),
      absolutePath,
      outPrefix,
    ]);
    return pagePath;
  }

  async invalidate(fileId: number): Promise<void> {
    await rm(this.cacheDir(fileId), { recursive: true, force: true });
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }
}
