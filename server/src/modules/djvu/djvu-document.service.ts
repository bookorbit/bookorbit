import {
  Inject,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createHash } from 'crypto';
import { constants, createWriteStream, type Stats } from 'fs';
import { mkdtemp, open, realpath, rm, stat, type FileHandle } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import sharp from 'sharp';
import { djvuConfig } from '../../config/config';
import { PathPolicyService } from '../path/path-policy.service';
import { DJVU_LIMITS, validateDjvuContainer } from './djvu-container';
import { DjvuProcess } from './djvu-process';

interface Source {
  directory: string;
  path: string;
  pageCount: number;
}
interface SourceEntry {
  bytes: number;
  users: number;
  source: Promise<Source>;
}
interface OpenedSource {
  handle: FileHandle;
  stats: Stats;
  key: string;
}
interface Waiter {
  resolve: () => void;
  reject: (error: ServiceUnavailableException) => void;
  timer?: ReturnType<typeof setTimeout>;
}
interface SourceWork<T> {
  /** Answers from caches without a decoder slot or source snapshot; undefined falls through to `use`. */
  cached?: (key: string) => T | undefined;
  use: (source: Source, key: string) => Promise<T>;
}

/**
 * Reader requests are interactive: they are served first, and a full queue answers 503 so the
 * reader can retry. Imports and cover work are background: they wait for a free decoder instead of
 * failing, because their callers already bound how many run at once.
 */
type Priority = 'interactive' | 'background';

export type DjvuPageResult = { etag: string; notModified: true } | { etag: string; notModified: false; buffer: Buffer };

const RENDER_SIZES = [1280, 1920, 2560];
const RENDER_VERSION = 'webp-q85-v2';

function stamp(stats: Stats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
}

function assertPage(pageIndex: number, pageCount: number): void {
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) throw new NotFoundException('DjVu page does not exist');
}

@Injectable()
export class DjvuDocumentService implements OnModuleDestroy {
  private readonly sources = new Map<string, SourceEntry>();
  private sourceBytes = 0;
  private sourceLock: Promise<unknown> = Promise.resolve();
  private readonly pageCounts = new Map<string, number>();
  private readonly pages = new Map<string, Buffer>();
  private pageBytes = 0;
  private readonly pendingPages = new Map<string, Promise<Buffer>>();
  private readonly waiters: Waiter[] = [];
  private readonly backgroundWaiters: Waiter[] = [];
  private readonly operations = new Set<Promise<unknown>>();
  private active = 0;
  private stopped = false;

  constructor(
    private readonly pathPolicy: PathPolicyService,
    private readonly decoder: DjvuProcess,
    @Inject(djvuConfig.KEY) private readonly config: ConfigType<typeof djvuConfig>,
  ) {}

  async getPageCount(absolutePath: string, authorizedRoot: string): Promise<number> {
    return this.withSource(absolutePath, authorizedRoot, 'interactive', {
      cached: (key) => this.knownPageCount(key),
      use: (source) => Promise.resolve(source.pageCount),
    });
  }

  async getPage(absolutePath: string, authorizedRoot: string, pageIndex: number, size: number, ifNoneMatch?: string): Promise<DjvuPageResult> {
    if (!RENDER_SIZES.includes(size)) throw new UnprocessableEntityException('Unsupported DjVu render size');
    return this.withSource(absolutePath, authorizedRoot, 'interactive', {
      cached: (key) => {
        const pageCount = this.knownPageCount(key);
        return pageCount === undefined ? undefined : this.cachedPage(key, pageIndex, size, pageCount, ifNoneMatch);
      },
      use: async (source, key) => {
        const hit = this.cachedPage(key, pageIndex, size, source.pageCount, ifNoneMatch);
        if (hit) return hit;
        const { renderKey, etag } = this.renderIdentity(key, pageIndex, size);
        let pending = this.pendingPages.get(renderKey);
        if (!pending) {
          pending = this.render(source, pageIndex, size)
            .then((buffer) => {
              this.cachePage(renderKey, buffer);
              return buffer;
            })
            .finally(() => this.pendingPages.delete(renderKey));
          this.pendingPages.set(renderKey, pending);
        }
        return { etag, notModified: false, buffer: await pending };
      },
    });
  }

  async getPageText(absolutePath: string, authorizedRoot: string, pageIndex: number): Promise<{ text: string }> {
    return this.withSource(absolutePath, authorizedRoot, 'interactive', {
      cached: (key) => {
        const pageCount = this.knownPageCount(key);
        if (pageCount !== undefined) assertPage(pageIndex, pageCount);
        return undefined;
      },
      use: async (source) => {
        assertPage(pageIndex, source.pageCount);
        const text = await this.decoder.run('djvused', [source.path, '-u', '-e', `select ${pageIndex + 1}; print-pure-txt`], source.directory);
        return {
          text: [...text]
            .filter((character) => {
              const code = character.charCodeAt(0);
              return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
            })
            .join('')
            .trim(),
        };
      },
    });
  }

  /** Page count without decoding a page, for a trusted path an internal caller already authorized. */
  async readPageCount(absolutePath: string): Promise<number> {
    return this.withTrustedSource(absolutePath, 'interactive', {
      cached: (key) => this.knownPageCount(key),
      use: (source) => Promise.resolve(source.pageCount),
    });
  }

  /** Import-time page count and first-page cover, for a trusted path an internal caller already authorized. */
  async extractMetadata(absolutePath: string): Promise<{ pageCount: number; cover: Buffer }> {
    return this.withTrustedSource(absolutePath, 'background', {
      use: async (source) => ({ pageCount: source.pageCount, cover: await this.render(source, 0, DJVU_LIMITS.coverRenderSize) }),
    });
  }

  async extractCover(absolutePath: string): Promise<Buffer> {
    return (await this.extractMetadata(absolutePath)).cover;
  }

  // Internal callers pass paths they discovered under a library root. The file's own resolved
  // folder is the root here, so a library entry that is a symlink still decodes.
  private async withTrustedSource<T>(absolutePath: string, priority: Priority, work: SourceWork<T>): Promise<T> {
    const path = await realpath(absolutePath).catch(() => {
      throw new NotFoundException('DjVu file is missing');
    });
    return this.withSource(path, dirname(path), priority, work);
  }

  private async withSource<T>(absolutePath: string, authorizedRoot: string, priority: Priority, work: SourceWork<T>): Promise<T> {
    const operation = (async () => {
      if (this.stopped) throw new ServiceUnavailableException('DjVu reader is stopping');
      const opened = await this.openSource(absolutePath, authorizedRoot);
      try {
        const hit = work.cached?.(opened.key);
        if (hit !== undefined) return hit;
        return await this.run(priority, () => this.useSource(opened, work.use));
      } finally {
        await opened.handle.close();
      }
    })();
    this.operations.add(operation);
    try {
      return await operation;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: 'DJVU_STORAGE_UNAVAILABLE', message: 'DjVu source storage is unavailable' });
    } finally {
      this.operations.delete(operation);
    }
  }

  private async openSource(absolutePath: string, authorizedRoot: string): Promise<OpenedSource> {
    await this.pathPolicy.assertWithinRoot(absolutePath, authorizedRoot);
    const path = await realpath(absolutePath).catch(() => {
      throw new NotFoundException('DjVu file is missing');
    });
    const root = await realpath(authorizedRoot);
    await this.pathPolicy.assertWithinRoot(path, root);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      await this.pathPolicy.assertWithinRoot(await realpath(path), root);
      const stats = await handle.stat();
      if (!stats.isFile() || !stats.size || stats.size > this.config.maxSourceBytes) {
        throw new UnprocessableEntityException({ code: 'DJVU_SOURCE_LIMIT', message: 'DjVu source exceeds the supported file size' });
      }
      if (stamp(stats) !== stamp(await stat(path))) throw new UnprocessableEntityException('DjVu source changed while opening');
      const key = createHash('sha256')
        .update(`${path}:${stamp(stats)}`)
        .digest('hex');
      return { handle, stats, key };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  private async useSource<T>({ handle, stats, key }: OpenedSource, use: (source: Source, key: string) => Promise<T>): Promise<T> {
    let entry: SourceEntry | undefined;
    try {
      const allocation = this.sourceLock.then(async () => {
        let allocated = this.sources.get(key);
        if (!allocated) {
          await this.makeSourceRoom(stats.size);
          allocated = { bytes: stats.size, users: 0, source: this.snapshot(handle, stats.size, stamp(stats)) };
          this.sources.set(key, allocated);
          this.sourceBytes += stats.size;
        }
        allocated.users++;
        this.sources.delete(key);
        this.sources.set(key, allocated);
        return allocated;
      });
      this.sourceLock = allocation.catch(() => undefined);
      entry = await allocation;
      let source: Source;
      try {
        source = await entry.source;
      } catch (error) {
        if (this.sources.get(key) === entry) {
          this.sources.delete(key);
          this.sourceBytes -= entry.bytes;
        }
        throw error;
      }
      this.rememberPageCount(key, source.pageCount);
      return await use(source, key);
    } finally {
      if (entry) entry.users--;
    }
  }

  private renderIdentity(key: string, pageIndex: number, size: number): { renderKey: string; etag: string } {
    const renderKey = `${key}:${pageIndex}:${size}:${RENDER_VERSION}`;
    return { renderKey, etag: `"${createHash('sha256').update(renderKey).digest('base64url')}"` };
  }

  private cachedPage(key: string, pageIndex: number, size: number, pageCount: number, ifNoneMatch?: string): DjvuPageResult | undefined {
    assertPage(pageIndex, pageCount);
    const { renderKey, etag } = this.renderIdentity(key, pageIndex, size);
    if (ifNoneMatch?.split(',').some((value) => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag))
      return { etag, notModified: true };
    const cached = this.pages.get(renderKey);
    if (!cached) return undefined;
    this.pages.delete(renderKey);
    this.pages.set(renderKey, cached);
    return { etag, notModified: false, buffer: cached };
  }

  private knownPageCount(key: string): number | undefined {
    const count = this.pageCounts.get(key);
    if (count !== undefined) {
      this.pageCounts.delete(key);
      this.pageCounts.set(key, count);
    }
    return count;
  }

  private rememberPageCount(key: string, count: number): void {
    this.pageCounts.delete(key);
    this.pageCounts.set(key, count);
    if (this.pageCounts.size > DJVU_LIMITS.maxKnownPageCounts) this.pageCounts.delete(this.pageCounts.keys().next().value!);
  }

  private async snapshot(handle: FileHandle, size: number, originalStamp: string): Promise<Source> {
    const directory = await mkdtemp(join(tmpdir(), 'bookorbit-djvu-'));
    const path = join(directory, 'document.djvu');
    try {
      let copied = 0;
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          copied += chunk.length;
          callback(copied > size ? new UnprocessableEntityException('DjVu source changed while copying') : null, chunk);
        },
      });
      await pipeline(handle.createReadStream({ autoClose: false, start: 0 }), limit, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      if (copied !== size || stamp(await handle.stat()) !== originalStamp)
        throw new UnprocessableEntityException('DjVu source changed while copying');
      const snapshot = await open(path, 'r');
      let validatedPages: number;
      try {
        validatedPages = await validateDjvuContainer(snapshot, size);
      } finally {
        await snapshot.close();
      }
      const count = (await this.decoder.run('djvused', [path, '-e', 'n'], directory)).trim();
      if (!/^\d+$/.test(count) || Number(count) !== validatedPages) throw new UnprocessableEntityException('Invalid DjVu page directory');
      return { directory, path, pageCount: Number(count) };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private async makeSourceRoom(bytes: number): Promise<void> {
    for (const [key, entry] of this.sources) {
      if (this.sourceBytes + bytes <= DJVU_LIMITS.maxSourceCacheBytes && this.sources.size < DJVU_LIMITS.maxDocuments) break;
      if (entry.users) continue;
      this.sources.delete(key);
      this.sourceBytes -= entry.bytes;
      const source = await entry.source;
      await rm(source.directory, { recursive: true, force: true });
    }
    if (this.sourceBytes + bytes > DJVU_LIMITS.maxSourceCacheBytes || this.sources.size >= DJVU_LIMITS.maxDocuments) {
      throw new ServiceUnavailableException({ code: 'DJVU_BUSY', message: 'DjVu reader is busy; retry shortly' });
    }
  }

  private async render(source: Source, pageIndex: number, size: number): Promise<Buffer> {
    const directory = await mkdtemp(join(source.directory, 'render-'));
    const output = join(directory, 'page.tiff');
    try {
      await this.decoder.run('ddjvu', [`-page=${pageIndex + 1}`, `-size=${size}x${size}`, '-format=tiff', source.path, output], directory);
      const stats = await stat(output);
      if (stats.size > DJVU_LIMITS.maxOutputBytes) throw new UnprocessableEntityException('DjVu output exceeds the supported size');
      return await sharp(output, { limitInputPixels: DJVU_LIMITS.maxRenderSize ** 2 })
        .timeout({ seconds: 15 })
        .webp({ quality: 85 })
        .toBuffer();
    } catch (error) {
      if (error instanceof UnprocessableEntityException || error instanceof ServiceUnavailableException) throw error;
      throw new UnprocessableEntityException({ code: 'DJVU_DECODE_FAILED', message: 'DjVu page could not be decoded' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private cachePage(key: string, buffer: Buffer): void {
    if (buffer.length > this.config.cacheBytes) return;
    for (const [oldKey, value] of this.pages) {
      if (this.pageBytes + buffer.length <= this.config.cacheBytes && this.pages.size < DJVU_LIMITS.maxPageCacheEntries) break;
      this.pages.delete(oldKey);
      this.pageBytes -= value.length;
    }
    this.pages.set(key, buffer);
    this.pageBytes += buffer.length;
  }

  private async run<T>(priority: Priority, work: () => Promise<T>): Promise<T> {
    if (this.stopped) throw new ServiceUnavailableException('DjVu reader is stopping');
    if (this.active >= this.config.maxConcurrent) {
      if (priority === 'interactive' && this.waiters.length >= DJVU_LIMITS.maxQueuedRequests) {
        throw new ServiceUnavailableException({ code: 'DJVU_BUSY', message: 'DjVu reader is busy; retry shortly' });
      }
      await new Promise<void>((resolve, reject) => {
        const waiter: Waiter = { resolve, reject };
        if (priority === 'interactive') {
          waiter.timer = setTimeout(() => {
            const index = this.waiters.indexOf(waiter);
            if (index !== -1) this.waiters.splice(index, 1);
            reject(new ServiceUnavailableException('DjVu reader queue timed out'));
          }, this.config.timeoutMs);
          this.waiters.push(waiter);
        } else this.backgroundWaiters.push(waiter);
      });
    } else this.active++;
    try {
      return await work();
    } finally {
      const next = this.waiters.shift() ?? this.backgroundWaiters.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve();
      } else this.active--;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.decoder.onModuleDestroy();
    for (const waiter of [...this.waiters.splice(0), ...this.backgroundWaiters.splice(0)]) {
      clearTimeout(waiter.timer);
      waiter.reject(new ServiceUnavailableException('DjVu reader is stopping'));
    }
    await Promise.allSettled(this.operations);
    for (const entry of this.sources.values()) {
      const source = await entry.source.catch(() => null);
      if (source) await rm(source.directory, { recursive: true, force: true });
    }
    this.sources.clear();
    this.pageCounts.clear();
    this.pages.clear();
  }
}
