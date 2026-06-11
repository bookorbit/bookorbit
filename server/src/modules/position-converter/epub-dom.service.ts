import { Inject, Injectable, Logger } from '@nestjs/common';
import { stat } from 'fs/promises';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as unzipper from 'unzipper';
import { XMLParser } from 'fast-xml-parser';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles } from '../../db/schema';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { ChapterDocument, parseChapterDocument } from './position-converter.core';

type Db = NodePgDatabase<typeof schema>;

const EVENT = 'position_converter.epub_dom';
const CHAPTER_CACHE_MAX = 12;
const SPINE_CACHE_MAX = 24;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function normalizeZipPath(path: string): string {
  const clean = (path ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = clean.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (resolved.length > 0) resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  return resolved.join('/');
}

function resolveHref(href: string, basePath: string): string {
  if (!href || /^[a-z][a-z\d+.-]*:/i.test(href)) return href;
  const path = href.split('#')[0].split('?')[0];
  return path.startsWith('/') ? normalizeZipPath(path) : normalizeZipPath(basePath + path);
}

function findInZip(files: unzipper.File[], path: string): unzipper.File | undefined {
  const clean = normalizeZipPath(path);
  const cleanLower = clean.toLowerCase();
  let ciMatch: unzipper.File | undefined;
  for (const file of files) {
    const fp = normalizeZipPath(file.path);
    if (fp === clean) return file;
    if (!ciMatch && fp.toLowerCase() === cleanLower) ciMatch = file;
  }
  return ciMatch;
}

export interface EpubSpine {
  hrefs: string[];
}

/** Parses container.xml + OPF from an opened zip and returns spine hrefs in order. */
export async function readEpubSpine(zip: unzipper.CentralDirectory): Promise<EpubSpine> {
  const containerEntry = findInZip(zip.files, 'META-INF/container.xml');
  if (!containerEntry) throw new Error('Missing META-INF/container.xml');
  const containerDoc = xmlParser.parse(await containerEntry.buffer()) as Record<string, unknown>;
  const container = containerDoc['container'] as Record<string, unknown>;
  const rootfiles = (container?.rootfiles as Record<string, unknown>)?.rootfile;
  const rootfile: unknown = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
  const opfPath = (rootfile as Record<string, string>)?.['@_full-path'];
  if (!opfPath) throw new Error('Cannot find OPF path');

  const rootPath = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opfEntry = findInZip(zip.files, opfPath);
  if (!opfEntry) throw new Error(`OPF not found: ${opfPath}`);
  const opfDoc = xmlParser.parse(await opfEntry.buffer()) as Record<string, unknown>;
  const pkg = (opfDoc['package'] ?? opfDoc) as Record<string, unknown>;
  const manifestEl = pkg['manifest'] as Record<string, unknown> | undefined;
  const spineEl = pkg['spine'] as Record<string, unknown> | undefined;

  const manifestById = new Map<string, string>();
  for (const item of toArray(manifestEl?.item as Record<string, string>[])) {
    const id = item['@_id'];
    const relHref = item['@_href'];
    if (id && relHref) manifestById.set(id, normalizeZipPath(resolveHref(relHref, rootPath)));
  }

  const hrefs: string[] = [];
  for (const itemref of toArray(spineEl?.itemref as Record<string, string>[])) {
    const href = manifestById.get(itemref['@_idref']);
    if (href != null) hrefs.push(href);
  }
  return { hrefs };
}

export async function loadChapterFromZip(zip: unzipper.CentralDirectory, href: string): Promise<ChapterDocument | null> {
  const entry = findInZip(zip.files, href);
  if (!entry) return null;
  const xhtml = (await entry.buffer()).toString('utf-8');
  return parseChapterDocument(xhtml);
}

interface SpineCacheEntry {
  absolutePath: string;
  mtimeMs: number;
  spine: EpubSpine;
}

@Injectable()
export class EpubDomService {
  private readonly logger = new Logger(EpubDomService.name);
  private readonly spineCache = new Map<number, SpineCacheEntry>();
  private readonly chapterCache = new Map<string, ChapterDocument>();

  constructor(@Inject(DB) private readonly db: Db) {}

  async getChapterCount(bookFileId: number): Promise<number | null> {
    const entry = await this.getSpineEntry(bookFileId);
    return entry ? entry.spine.hrefs.length : null;
  }

  async getSpineHrefs(bookFileId: number): Promise<string[] | null> {
    const entry = await this.getSpineEntry(bookFileId);
    return entry ? entry.spine.hrefs : null;
  }

  async getChapter(bookFileId: number, chapterIndex: number): Promise<ChapterDocument | null> {
    const entry = await this.getSpineEntry(bookFileId);
    if (!entry) return null;
    const href = entry.spine.hrefs[chapterIndex];
    if (href == null) return null;

    const cacheKey = `${bookFileId}:${entry.mtimeMs}:${chapterIndex}`;
    const cached = this.chapterCache.get(cacheKey);
    if (cached) {
      this.chapterCache.delete(cacheKey);
      this.chapterCache.set(cacheKey, cached);
      return cached;
    }

    try {
      const zip = await unzipper.Open.file(entry.absolutePath);
      const doc = await loadChapterFromZip(zip, href);
      if (!doc) return null;
      this.chapterCache.set(cacheKey, doc);
      while (this.chapterCache.size > CHAPTER_CACHE_MAX) {
        const oldest = this.chapterCache.keys().next().value as string;
        this.chapterCache.delete(oldest);
      }
      return doc;
    } catch (error) {
      this.logFail(bookFileId, error);
      return null;
    }
  }

  private async getSpineEntry(bookFileId: number): Promise<SpineCacheEntry | null> {
    const [file] = await this.db
      .select({ absolutePath: bookFiles.absolutePath, format: bookFiles.format })
      .from(bookFiles)
      .where(eq(bookFiles.id, bookFileId))
      .limit(1);
    if (!file || file.format !== 'epub') return null;

    let mtimeMs: number;
    try {
      mtimeMs = (await stat(file.absolutePath)).mtimeMs;
    } catch (error) {
      this.logFail(bookFileId, error);
      return null;
    }

    const cached = this.spineCache.get(bookFileId);
    if (cached && cached.absolutePath === file.absolutePath && cached.mtimeMs === mtimeMs) return cached;

    try {
      const zip = await unzipper.Open.file(file.absolutePath);
      const spine = await readEpubSpine(zip);
      const entry: SpineCacheEntry = { absolutePath: file.absolutePath, mtimeMs, spine };
      this.spineCache.set(bookFileId, entry);
      while (this.spineCache.size > SPINE_CACHE_MAX) {
        const oldest = this.spineCache.keys().next().value as number;
        this.spineCache.delete(oldest);
      }
      return entry;
    } catch (error) {
      this.logFail(bookFileId, error);
      return null;
    }
  }

  private logFail(bookFileId: number, error: unknown): void {
    const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
    this.logger.warn(
      `[${EVENT}] [fail] bookFileId=${bookFileId} errorClass=${errorClass} error="${sanitizeLogValue(
        error instanceof Error ? error.message : 'unknown error',
      )}" - epub chapter load failed`,
    );
  }
}
