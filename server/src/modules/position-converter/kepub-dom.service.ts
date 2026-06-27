import { stat } from 'fs/promises';

import { Injectable, Logger } from '@nestjs/common';
import * as unzipper from 'unzipper';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { EpubSpine, loadChapterFromZip, readEpubSpine } from './epub-dom.service';
import { ChapterDocument } from './position-converter.core';

const EVENT = 'position_converter.kepub_dom';
const CHAPTER_CACHE_MAX = 12;
const SPINE_CACHE_MAX = 24;

interface SpineCacheEntry {
  mtimeMs: number;
  spine: EpubSpine;
}

function normalizeChapterPath(path: string): string {
  let clean = (path ?? '').replace(/\\/g, '/');
  try {
    clean = decodeURI(clean);
  } catch {
    // Keep the raw path when it is not valid URI-encoded.
  }
  return clean.split('#')[0].split('?')[0].replace(/^\/+/, '');
}

/**
 * Path-keyed twin of EpubDomService for kepub artifacts produced by the kepub
 * conversion cache. Callers resolve the kepub path themselves, so this service
 * stays free of DB and Kobo dependencies.
 */
@Injectable()
export class KepubDomService {
  private readonly logger = new Logger(KepubDomService.name);
  private readonly spineCache = new Map<string, SpineCacheEntry>();
  private readonly chapterCache = new Map<string, ChapterDocument>();

  async getSpine(kepubPath: string): Promise<EpubSpine | null> {
    return (await this.getSpineEntry(kepubPath))?.spine ?? null;
  }

  async getChapterByIndex(kepubPath: string, chapterIndex: number): Promise<ChapterDocument | null> {
    const entry = await this.getSpineEntry(kepubPath);
    if (!entry) return null;
    const href = entry.spine.hrefs[chapterIndex];
    if (href == null) return null;
    return this.loadChapter(kepubPath, entry, chapterIndex, href);
  }

  /**
   * Resolves a Kobo chapter filename against the kepub spine: exact normalized
   * match, then case-insensitive, then path-suffix match.
   */
  async findChapterIndexByFilename(kepubPath: string, chapterFilename: string): Promise<number | null> {
    const entry = await this.getSpineEntry(kepubPath);
    if (!entry) return null;
    const normalized = normalizeChapterPath(chapterFilename);
    if (!normalized) return null;
    const lower = normalized.toLowerCase();
    const hrefs = entry.spine.hrefs;

    let index = hrefs.findIndex((href) => href === normalized);
    if (index < 0) index = hrefs.findIndex((href) => href.toLowerCase() === lower);
    if (index < 0) index = hrefs.findIndex((href) => href.toLowerCase().endsWith(`/${lower}`));
    return index >= 0 ? index : null;
  }

  private async loadChapter(kepubPath: string, entry: SpineCacheEntry, chapterIndex: number, href: string): Promise<ChapterDocument | null> {
    const cacheKey = `${kepubPath}:${entry.mtimeMs}:${chapterIndex}`;
    const cached = this.chapterCache.get(cacheKey);
    if (cached) {
      this.chapterCache.delete(cacheKey);
      this.chapterCache.set(cacheKey, cached);
      return cached;
    }

    try {
      const zip = await unzipper.Open.file(kepubPath);
      const doc = await loadChapterFromZip(zip, href);
      if (!doc) return null;
      this.chapterCache.set(cacheKey, doc);
      while (this.chapterCache.size > CHAPTER_CACHE_MAX) {
        const oldest = this.chapterCache.keys().next().value as string;
        this.chapterCache.delete(oldest);
      }
      return doc;
    } catch (error) {
      this.logFail(kepubPath, error);
      return null;
    }
  }

  private async getSpineEntry(kepubPath: string): Promise<SpineCacheEntry | null> {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(kepubPath)).mtimeMs;
    } catch (error) {
      this.logFail(kepubPath, error);
      return null;
    }

    const cached = this.spineCache.get(kepubPath);
    if (cached && cached.mtimeMs === mtimeMs) return cached;

    try {
      const zip = await unzipper.Open.file(kepubPath);
      const spine = await readEpubSpine(zip);
      const entry: SpineCacheEntry = { mtimeMs, spine };
      this.spineCache.set(kepubPath, entry);
      while (this.spineCache.size > SPINE_CACHE_MAX) {
        const oldest = this.spineCache.keys().next().value as string;
        this.spineCache.delete(oldest);
      }
      return entry;
    } catch (error) {
      this.logFail(kepubPath, error);
      return null;
    }
  }

  private logFail(kepubPath: string, error: unknown): void {
    const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
    this.logger.warn(
      `[${EVENT}] [fail] path="${sanitizeLogValue(kepubPath)}" errorClass=${errorClass} error="${sanitizeLogValue(
        error instanceof Error ? error.message : 'unknown error',
      )}" - kepub chapter load failed`,
    );
  }
}
