import { Injectable, NotFoundException, OnModuleDestroy, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { createExtractorFromFile, UnrarError } from 'node-unrar-js';
import { imageContentTypeFromPath } from '../../../common/image-content-type';
import { detectComicContainerFormat } from '../../../common/comic-format-detect';
import { createCbzZipEntryReadStream, readCbzZipIndex, type CbzZipEntry } from '../../../common/cbz-zip-reader';
import { compareArchiveEntryNames } from '../../../common/archive-entry-sort';
import { cb7PagePath, extractCb7ToDisk, removeCb7Extraction } from './cb7-disk-extraction';

import type { RequestUser } from '../../../common/types/request-user';
import { BookService } from '../../book/book.service';

// ── Shared helpers ─────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);

function isImage(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot !== -1 && IMAGE_EXTS.has(name.substring(dot).toLowerCase());
}

function isHidden(name: string): boolean {
  return name.split('/').some((p) => p.startsWith('.'));
}

function mimeForExt(name: string): string {
  return imageContentTypeFromPath(name);
}

// ── CBR: node-unrar-js ─────────────────────────────────────────────────────────

function isUnrarError(err: unknown): err is Error {
  if (typeof UnrarError === 'function' && err instanceof UnrarError) return true;
  if (!(err instanceof Error)) return false;
  const reason = (err as Error & { reason?: unknown }).reason;
  return typeof reason === 'string' && reason.startsWith('ERAR_');
}

function unreadableCbrArchive(err: Error): UnprocessableEntityException {
  return new UnprocessableEntityException(`CBR archive is unreadable: ${err.message}`);
}

function unreadableCbrPage(err: Error): UnprocessableEntityException {
  return new UnprocessableEntityException(`CBR page is unreadable: ${err.message}`);
}

// ── Freshness ──────────────────────────────────────────────────────────────────

/** Bump when page listing or ordering changes, so a revalidation cannot keep a page from the old order. */
const PAGE_ETAG_VERSION = 2;

type ComicFormat = 'cbz' | 'cbr' | 'cb7';

function isComicFormat(format: string | null): format is ComicFormat {
  return format === 'cbz' || format === 'cbr' || format === 'cb7';
}

/** Which version of a file a cache entry was built from. The metadata writer replaces files in place. */
interface FileStamp {
  mtimeMs: number;
  size: number;
}

interface Stamped<T> {
  stamp: FileStamp;
  value: T;
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function pageEtag(fileId: number, stamp: FileStamp, pageIndex: number): string {
  const digest = createHash('sha1').update(`${PAGE_ETAG_VERSION}:${fileId}:${stamp.mtimeMs}:${stamp.size}:${pageIndex}`).digest('base64url');
  return `"${digest}"`;
}

/** RFC 9110 weak comparison, which is what If-None-Match uses. */
export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === etag);
}

// ── Service ────────────────────────────────────────────────────────────────────

interface RarCache {
  pages: string[];
}

interface SevenZipPages {
  /** This extraction's private folder on temporary disk storage. */
  dir: string;
  /** Paths relative to `dir`, in reading order. */
  pages: string[];
  sizeBytes: number;
  activeReaders: number;
  evicted: boolean;
}

const SEVEN_Z_CACHE_MAX_BYTES = 512 * 1024 * 1024;

export type ComicPageResult =
  { notModified: true; etag: string } | { notModified: false; etag: string; stream: NodeJS.ReadableStream; mimeType: string };

interface OpenedComic {
  absolutePath: string;
  format: ComicFormat;
  stamp: FileStamp;
}

@Injectable()
export class CbzService implements OnModuleDestroy {
  // CBZ: byte-offset index per fileId
  private readonly zipIndex = new Map<number, Stamped<CbzZipEntry[]>>();
  // CBR: sorted page names per fileId; archive and extracted page bytes stay on disk
  private readonly rarCache = new Map<number, Stamped<RarCache>>();
  // CB7: byte-bounded extracted folders on temporary disk storage
  private readonly sevenZPages = new Map<number, Stamped<SevenZipPages>>();
  private sevenZCacheBytes = 0;
  private readonly rarTempDirs = new Set<string>();
  // Resolved actual format per fileId (magic bytes override stored extension)
  private readonly resolvedFormat = new Map<number, Stamped<ComicFormat>>();

  constructor(private readonly bookService: BookService) {}

  async onModuleDestroy(): Promise<void> {
    const rarDirs = [...this.rarTempDirs];
    const sevenZipEntries = [...this.sevenZPages.values()];
    this.rarTempDirs.clear();
    this.sevenZPages.clear();
    this.sevenZCacheBytes = 0;
    await Promise.all([
      ...rarDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})),
      ...sevenZipEntries.map((entry) => removeCb7Extraction(entry.value.dir)),
    ]);
  }

  private async openComic(fileId: number, user: RequestUser): Promise<OpenedComic> {
    const file = await this.bookService.verifyFileAccess(fileId, user);
    if (!isComicFormat(file.format)) {
      throw new NotFoundException(`Unsupported comic format: ${file.format ?? ''}`);
    }
    const stamp = await this.statFile(fileId, file.absolutePath);
    const format = await this.resolveFormat(fileId, file.absolutePath, file.format, stamp);
    return { absolutePath: file.absolutePath, format, stamp };
  }

  private async statFile(fileId: number, absolutePath: string): Promise<FileStamp> {
    let stats: Awaited<ReturnType<typeof stat>>;
    try {
      stats = await stat(absolutePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'ENOENT' || code === 'ENOTDIR') throw new NotFoundException('Comic file is missing on disk');
      throw err;
    }

    const stamp = { mtimeMs: Number(stats.mtimeMs), size: Number(stats.size) };
    if (this.hasStaleEntry(fileId, stamp)) await this.invalidate(fileId);
    return stamp;
  }

  private hasStaleEntry(fileId: number, stamp: FileStamp): boolean {
    const entries = [this.zipIndex.get(fileId), this.rarCache.get(fileId), this.sevenZPages.get(fileId), this.resolvedFormat.get(fileId)];
    return entries.some((entry) => entry !== undefined && !sameStamp(entry.stamp, stamp));
  }

  private async invalidate(fileId: number): Promise<void> {
    const sevenZip = this.sevenZPages.get(fileId);
    this.zipIndex.delete(fileId);
    this.rarCache.delete(fileId);
    this.sevenZPages.delete(fileId);
    this.resolvedFormat.delete(fileId);
    if (sevenZip) {
      this.sevenZCacheBytes -= sevenZip.value.sizeBytes;
      await this.disposeSevenZip(sevenZip.value);
    }
  }

  private async resolveFormat(fileId: number, absolutePath: string, storedFmt: ComicFormat, stamp: FileStamp): Promise<ComicFormat> {
    const cached = this.resolvedFormat.get(fileId);
    if (cached && sameStamp(cached.stamp, stamp)) return cached.value;

    const resolved = await detectComicContainerFormat(absolutePath, storedFmt);
    this.resolvedFormat.set(fileId, { stamp, value: resolved });
    return resolved;
  }

  // ── CBZ ──────────────────────────────────────────────────────────────────────

  private async getCbzIndex(fileId: number, filePath: string, stamp: FileStamp): Promise<CbzZipEntry[]> {
    const cached = this.zipIndex.get(fileId);
    if (cached && sameStamp(cached.stamp, stamp)) return cached.value;

    const index = await readCbzZipIndex(filePath);
    // Not cached: the reader also answers null for a transient read error, which a retry should get past.
    if (!index) throw new UnprocessableEntityException('CBZ archive is unreadable');

    const entries = index.entries
      .filter((entry) => !entry.name.endsWith('/') && !isHidden(entry.name) && isImage(entry.name))
      .filter((entry) => (entry.compression === 0 || entry.compression === 8) && entry.compressedSize > 0)
      .sort((a, b) => compareArchiveEntryNames(a.name, b.name));
    this.zipIndex.set(fileId, { stamp, value: entries });
    return entries;
  }

  // ── CBR ──────────────────────────────────────────────────────────────────────

  private async getRarCache(fileId: number, filePath: string, stamp: FileStamp): Promise<RarCache> {
    const cached = this.rarCache.get(fileId);
    if (cached && sameStamp(cached.stamp, stamp)) return cached.value;

    const pages: string[] = [];
    try {
      const extractor = await createExtractorFromFile({ filepath: filePath });
      const { fileHeaders } = extractor.getFileList();
      for (const h of fileHeaders) {
        if (!h.flags.directory && isImage(h.name) && !isHidden(h.name)) {
          pages.push(h.name);
        }
      }
    } catch (err) {
      // Some RAR 1.5 archives throw ERAR_BAD_DATA at the end-of-archive
      // marker instead of returning ERAR_END_ARCHIVE. If we already have
      // pages, the archive is readable - accept the partial list.
      if (!isUnrarError(err) || pages.length === 0) {
        throw isUnrarError(err) ? unreadableCbrArchive(err) : err;
      }
    }

    pages.sort(compareArchiveEntryNames);
    const value = { pages };
    this.rarCache.set(fileId, { stamp, value });
    return value;
  }

  private async extractRarPage(filePath: string, pageName: string): Promise<NodeJS.ReadableStream> {
    const tempDir = await mkdtemp(join(tmpdir(), 'bookorbit-cbr-'));
    this.rarTempDirs.add(tempDir);
    const extractedName = `page${extname(pageName)}`;
    let found = false;
    try {
      const extractor = await createExtractorFromFile({ filepath: filePath, targetPath: tempDir, filenameTransform: () => extractedName });
      // Pass an array so the extractor stops after the first match and never
      // hits the malformed end-of-archive marker present in some RAR 1.5 files.
      const { files } = extractor.extract({ files: [pageName] });
      for (const file of files) {
        if (!file.fileHeader.flags.directory) found = true;
      }
    } catch (err) {
      await this.removeRarTempDir(tempDir);
      if (isUnrarError(err)) {
        throw unreadableCbrPage(err);
      }
      throw err;
    }
    if (!found) {
      await this.removeRarTempDir(tempDir);
      throw new NotFoundException(`Page not found in RAR archive`);
    }

    const stream = createReadStream(join(tempDir, extractedName));
    stream.once('close', () => void this.removeRarTempDir(tempDir));
    return stream;
  }

  private async removeRarTempDir(tempDir: string): Promise<void> {
    this.rarTempDirs.delete(tempDir);
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  // ── CB7 ──────────────────────────────────────────────────────────────────────

  private async getSevenZPages(fileId: number, filePath: string, stamp: FileStamp): Promise<SevenZipPages> {
    const cached = this.sevenZPages.get(fileId);
    if (cached && sameStamp(cached.stamp, stamp)) {
      this.sevenZPages.delete(fileId);
      this.sevenZPages.set(fileId, cached);
      return cached.value;
    }

    const extracted = await extractCb7ToDisk(filePath);

    const previous = this.sevenZPages.get(fileId);
    const value = { ...extracted, activeReaders: 0, evicted: false };
    this.sevenZPages.set(fileId, { stamp, value });
    this.sevenZCacheBytes += value.sizeBytes;
    if (previous && previous.value.dir !== value.dir) {
      this.sevenZCacheBytes -= previous.value.sizeBytes;
      await this.disposeSevenZip(previous.value);
    }
    await this.evictSevenZipCache();
    return value;
  }

  private async evictSevenZipCache(): Promise<void> {
    while (this.sevenZCacheBytes > SEVEN_Z_CACHE_MAX_BYTES && this.sevenZPages.size > 1) {
      const oldest = this.sevenZPages.entries().next().value as [number, Stamped<SevenZipPages>] | undefined;
      if (!oldest) return;
      this.sevenZPages.delete(oldest[0]);
      this.sevenZCacheBytes -= oldest[1].value.sizeBytes;
      await this.disposeSevenZip(oldest[1].value);
    }
  }

  private async disposeSevenZip(value: SevenZipPages): Promise<void> {
    value.evicted = true;
    if (value.activeReaders === 0) await removeCb7Extraction(value.dir);
  }

  private streamSevenZipPage(value: SevenZipPages, pageIndex: number): NodeJS.ReadableStream {
    value.activeReaders++;
    const stream = createReadStream(cb7PagePath(value.dir, value.pages[pageIndex]));
    stream.once('close', () => {
      value.activeReaders--;
      if (value.evicted && value.activeReaders === 0) void removeCb7Extraction(value.dir);
    });
    return stream;
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  async getPageCount(fileId: number, user: RequestUser): Promise<number> {
    const comic = await this.openComic(fileId, user);

    if (comic.format === 'cbz') return (await this.getCbzIndex(fileId, comic.absolutePath, comic.stamp)).length;
    if (comic.format === 'cbr') return (await this.getRarCache(fileId, comic.absolutePath, comic.stamp)).pages.length;
    return (await this.getSevenZPages(fileId, comic.absolutePath, comic.stamp)).pages.length;
  }

  /**
   * Answers `notModified` without reading the archive when `ifNoneMatch` names this exact page of
   * this exact version of the file, so a client revalidating a page it already has costs a stat.
   */
  async streamPage(fileId: number, pageIndex: number, user: RequestUser, ifNoneMatch?: string): Promise<ComicPageResult> {
    const comic = await this.openComic(fileId, user);
    const etag = pageEtag(fileId, comic.stamp, pageIndex);
    if (matchesIfNoneMatch(ifNoneMatch, etag)) return { notModified: true, etag };

    if (comic.format === 'cbz') {
      const entries = await this.getCbzIndex(fileId, comic.absolutePath, comic.stamp);
      if (pageIndex < 0 || pageIndex >= entries.length) {
        throw new NotFoundException(`Page ${pageIndex} out of range`);
      }
      const entry = entries[pageIndex];
      return { notModified: false, etag, stream: createCbzZipEntryReadStream(comic.absolutePath, entry), mimeType: mimeForExt(entry.name) };
    }

    if (comic.format === 'cbr') {
      const { pages } = await this.getRarCache(fileId, comic.absolutePath, comic.stamp);
      if (pageIndex < 0 || pageIndex >= pages.length) {
        throw new NotFoundException(`Page ${pageIndex} out of range`);
      }
      const stream = await this.extractRarPage(comic.absolutePath, pages[pageIndex]);
      return { notModified: false, etag, stream, mimeType: mimeForExt(pages[pageIndex]) };
    }

    const value = await this.getSevenZPages(fileId, comic.absolutePath, comic.stamp);
    const { pages } = value;
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new NotFoundException(`Page ${pageIndex} out of range`);
    }
    return { notModified: false, etag, stream: this.streamSevenZipPage(value, pageIndex), mimeType: mimeForExt(pages[pageIndex]) };
  }
}
