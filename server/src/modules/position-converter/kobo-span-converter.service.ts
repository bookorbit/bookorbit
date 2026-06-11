import { createHash } from 'crypto';
import { stat } from 'fs/promises';

import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { chapterIndexFromSpineStep, parseCfi } from './cfi.utils';
import { EpubDomService } from './epub-dom.service';
import { KepubDomService } from './kepub-dom.service';
import {
  KOBO_SPAN_RESOLVER_VERSION,
  KoboSpanIndex,
  KoboSpanRange,
  buildKoboSpanIndex,
  canonicalCfiToKoboSpan,
  cfiPointToKoboSpanPoint,
  koboSpanPointToCanonical,
  koboSpanRangeToCanonical,
  parseSpanSelector,
  spanSelectorFromId,
} from './kobo-span.core';
import { ChapterDocument } from './position-converter.core';

const EVENT = 'position_converter.kobo_span';

export interface KepubContext {
  kepubPath: string;
  fileHash: string | null;
  hyphenate: boolean;
  kepubifyVersion: string;
}

export interface KoboSpanLocation {
  startPath: string;
  startChar: number;
  endPath: string;
  endChar: number;
  chapterFilename: string;
  chapterProgress?: number;
  chapterTitle?: string | null;
}

export interface KoboSpanToCanonicalOutcome extends Record<string, unknown> {
  status: 'exact' | 'repaired' | 'failed';
  reason?: string;
  chapterIndex?: number;
  cfi?: string;
  xpointerPos0?: string;
  xpointerPos1?: string;
  renditionHash: string | null;
}

export interface CanonicalToKoboSpanOutcome extends Record<string, unknown> {
  status: 'exact' | 'repaired' | 'failed';
  reason?: string;
  chapterIndex?: number;
  pos0?: string;
  pos1?: string;
  location?: {
    span: Required<Pick<KoboSpanLocation, 'startPath' | 'startChar' | 'endPath' | 'endChar' | 'chapterFilename' | 'chapterProgress'>> & {
      chapterTitle: string | null;
    };
  };
  renditionHash: string | null;
}

export interface KoboBookmarkToPositionsOutcome extends Record<string, unknown> {
  status: 'exact' | 'repaired' | 'failed';
  reason?: string;
  chapterIndex?: number;
  cfi?: string;
  xpointer?: string;
  chapterFraction?: number;
}

export interface CfiPointToKoboBookmarkOutcome extends Record<string, unknown> {
  status: 'exact' | 'repaired' | 'failed';
  reason?: string;
  chapterIndex?: number;
  spanId?: string;
  chapterFilename?: string;
  contentSourceProgressPercent?: number;
}

/** Parses an annotation_positions kobo_span pos value ("kobo.N.M:char"). */
export function parseKoboSpanPos(pos: string): { spanId: string; char: number } | null {
  const splitAt = pos.lastIndexOf(':');
  if (splitAt <= 0) return null;
  const spanId = pos.slice(0, splitAt);
  const char = Number(pos.slice(splitAt + 1));
  if (!/^kobo\.\d+\.\d+$/.test(spanId) || !Number.isInteger(char) || char < 0) return null;
  return { spanId, char };
}

export function serializeKoboSpanPos(spanId: string, char: number): string {
  return `${spanId}:${char}`;
}

@Injectable()
export class KoboSpanConverterService {
  readonly version = KOBO_SPAN_RESOLVER_VERSION;

  private readonly logger = new Logger(KoboSpanConverterService.name);
  private readonly spanIndexCache = new WeakMap<ChapterDocument, KoboSpanIndex>();
  private renditionHashCache: { key: string; hash: string } | null = null;

  constructor(
    private readonly epubDom: EpubDomService,
    private readonly kepubDom: KepubDomService,
  ) {}

  async koboSpanToCanonical(params: {
    bookFileId: number;
    ctx: KepubContext;
    location: unknown;
    text: string | null;
  }): Promise<KoboSpanToCanonicalOutcome> {
    const renditionHash = await this.computeRenditionHash(params.ctx);
    const location = this.parseLocation(params.location);
    if (!location) return { status: 'failed', reason: 'invalid_location', renditionHash };

    const startId = parseSpanSelector(location.startPath);
    const endId = parseSpanSelector(location.endPath);
    if (!startId || !endId) return { status: 'failed', reason: 'invalid_span_path', renditionHash };

    const docs = await this.loadChapterPairByFilename(params.bookFileId, params.ctx, location.chapterFilename);
    if ('reason' in docs) return { status: 'failed', reason: docs.reason, renditionHash };

    const range: KoboSpanRange = { startId, startChar: location.startChar, endId, endChar: location.endChar };
    const result = koboSpanRangeToCanonical(docs.epubDoc, docs.kepubDoc, this.getSpanIndex(docs.kepubDoc), docs.epubChapterIndex, range, params.text);
    if (result.status === 'failed') {
      this.logFail('kobo_to_canonical', params.bookFileId, result.reason);
      return { status: 'failed', reason: result.reason, chapterIndex: docs.epubChapterIndex, renditionHash };
    }
    return {
      status: result.status,
      chapterIndex: docs.epubChapterIndex,
      cfi: result.cfi,
      xpointerPos0: result.xpointerPos0,
      xpointerPos1: result.xpointerPos1,
      renditionHash,
    };
  }

  async canonicalToKoboSpan(params: {
    bookFileId: number;
    ctx: KepubContext;
    cfi: string;
    text: string | null;
    chapterTitle?: string | null;
  }): Promise<CanonicalToKoboSpanOutcome> {
    const renditionHash = await this.computeRenditionHash(params.ctx);
    const chapterIndex = chapterIndexFromSpineStep(parseCfi(params.cfi)?.spineStep ?? null);
    if (chapterIndex == null) return { status: 'failed', reason: 'missing_spine_step', renditionHash };

    const docs = await this.loadChapterPairByIndex(params.bookFileId, params.ctx, chapterIndex);
    if ('reason' in docs) return { status: 'failed', reason: docs.reason, chapterIndex, renditionHash };

    const result = canonicalCfiToKoboSpan(docs.epubDoc, docs.kepubDoc, this.getSpanIndex(docs.kepubDoc), params.cfi, params.text);
    if (result.status === 'failed') {
      this.logFail('canonical_to_kobo', params.bookFileId, result.reason);
      return { status: 'failed', reason: result.reason, chapterIndex, renditionHash };
    }

    const chapterProgress = docs.kepubSpineLength > 0 ? docs.kepubChapterIndex / docs.kepubSpineLength : 0;
    return {
      status: result.status,
      chapterIndex,
      pos0: serializeKoboSpanPos(result.startId, result.startChar),
      pos1: serializeKoboSpanPos(result.endId, result.endChar),
      location: {
        span: {
          startPath: spanSelectorFromId(result.startId),
          startChar: result.startChar,
          endPath: spanSelectorFromId(result.endId),
          endChar: result.endChar,
          chapterFilename: docs.kepubHref,
          chapterProgress,
          chapterTitle: params.chapterTitle ?? null,
        },
      },
      renditionHash,
    };
  }

  async koboBookmarkToPositions(params: {
    bookFileId: number;
    ctx: KepubContext;
    chapterFilename: string;
    spanId: string;
  }): Promise<KoboBookmarkToPositionsOutcome> {
    const docs = await this.loadChapterPairByFilename(params.bookFileId, params.ctx, params.chapterFilename);
    if ('reason' in docs) return { status: 'failed', reason: docs.reason };

    const result = koboSpanPointToCanonical(docs.epubDoc, docs.kepubDoc, this.getSpanIndex(docs.kepubDoc), docs.epubChapterIndex, params.spanId);
    if (result.status === 'failed') {
      this.logFail('bookmark_to_canonical', params.bookFileId, result.reason);
      return { status: 'failed', reason: result.reason, chapterIndex: docs.epubChapterIndex };
    }
    return {
      status: result.status,
      chapterIndex: docs.epubChapterIndex,
      cfi: result.cfi,
      xpointer: result.xpointer,
      chapterFraction: result.chapterFraction,
    };
  }

  async cfiPointToKoboBookmark(params: { bookFileId: number; ctx: KepubContext; cfi: string }): Promise<CfiPointToKoboBookmarkOutcome> {
    const chapterIndex = chapterIndexFromSpineStep(parseCfi(params.cfi)?.spineStep ?? null);
    if (chapterIndex == null) return { status: 'failed', reason: 'missing_spine_step' };

    const docs = await this.loadChapterPairByIndex(params.bookFileId, params.ctx, chapterIndex);
    if ('reason' in docs) return { status: 'failed', reason: docs.reason, chapterIndex };

    const result = cfiPointToKoboSpanPoint(docs.epubDoc, docs.kepubDoc, this.getSpanIndex(docs.kepubDoc), params.cfi);
    if (result.status === 'failed') {
      this.logFail('cfi_to_bookmark', params.bookFileId, result.reason);
      return { status: 'failed', reason: result.reason, chapterIndex };
    }
    return {
      status: result.status,
      chapterIndex,
      spanId: result.spanId,
      chapterFilename: docs.kepubHref,
      contentSourceProgressPercent: Math.round(result.chapterFraction * 10000) / 100,
    };
  }

  async computeRenditionHash(ctx: KepubContext): Promise<string | null> {
    try {
      const kepubStat = await stat(ctx.kepubPath);
      const material = [
        ctx.fileHash ?? 'nohash',
        `hyph=${ctx.hyphenate}`,
        `size=${kepubStat.size}`,
        `mtime=${kepubStat.mtimeMs}`,
        `kepubify=${ctx.kepubifyVersion}`,
        `resolver=${KOBO_SPAN_RESOLVER_VERSION}`,
      ].join('|');
      const key = `${ctx.kepubPath}|${material}`;
      if (this.renditionHashCache?.key === key) return this.renditionHashCache.hash;
      const hash = createHash('sha256').update(material).digest('hex');
      this.renditionHashCache = { key, hash };
      return hash;
    } catch {
      return null;
    }
  }

  private getSpanIndex(kepubDoc: ChapterDocument): KoboSpanIndex {
    const cached = this.spanIndexCache.get(kepubDoc);
    if (cached) return cached;
    const index = buildKoboSpanIndex(kepubDoc);
    this.spanIndexCache.set(kepubDoc, index);
    return index;
  }

  private parseLocation(location: unknown): KoboSpanLocation | null {
    if (!location || typeof location !== 'object') return null;
    const span = (location as Record<string, unknown>).span;
    if (!span || typeof span !== 'object') return null;
    const raw = span as Record<string, unknown>;
    const { startPath, endPath, chapterFilename, startChar, endChar } = raw;
    if (typeof startPath !== 'string' || typeof endPath !== 'string' || typeof chapterFilename !== 'string') return null;
    if (typeof startChar !== 'number' || typeof endChar !== 'number') return null;
    if (!Number.isInteger(startChar) || !Number.isInteger(endChar) || startChar < 0 || endChar < 0) return null;
    return {
      startPath,
      startChar,
      endPath,
      endChar,
      chapterFilename,
      chapterTitle: typeof raw.chapterTitle === 'string' ? raw.chapterTitle : null,
    };
  }

  private async loadChapterPairByFilename(bookFileId: number, ctx: KepubContext, chapterFilename: string): Promise<ChapterPair | { reason: string }> {
    const kepubChapterIndex = await this.kepubDom.findChapterIndexByFilename(ctx.kepubPath, chapterFilename);
    if (kepubChapterIndex == null) return { reason: 'chapter_not_found' };
    return this.loadChapterPair(bookFileId, ctx, kepubChapterIndex, 'kepub');
  }

  private async loadChapterPairByIndex(bookFileId: number, ctx: KepubContext, epubChapterIndex: number): Promise<ChapterPair | { reason: string }> {
    return this.loadChapterPair(bookFileId, ctx, epubChapterIndex, 'epub');
  }

  /**
   * Loads the epub/kepub chapter docs for one chapter. kepubify preserves spine
   * order and hrefs, so indexes normally align; when they do not (renamed or
   * filtered spine), the matching href on the other side wins.
   */
  private async loadChapterPair(
    bookFileId: number,
    ctx: KepubContext,
    chapterIndex: number,
    side: 'epub' | 'kepub',
  ): Promise<ChapterPair | { reason: string }> {
    const kepubSpine = await this.kepubDom.getSpine(ctx.kepubPath);
    if (!kepubSpine) return { reason: 'kepub_unavailable' };
    const epubHrefs = await this.epubDom.getSpineHrefs(bookFileId);
    if (!epubHrefs) return { reason: 'chapter_unavailable' };

    let epubChapterIndex = chapterIndex;
    let kepubChapterIndex = chapterIndex;
    if (side === 'kepub') {
      const href = kepubSpine.hrefs[chapterIndex];
      if (href == null) return { reason: 'chapter_not_found' };
      if (epubHrefs[chapterIndex] !== href) {
        const alt = epubHrefs.indexOf(href);
        if (alt >= 0) epubChapterIndex = alt;
      }
    } else {
      const href = epubHrefs[chapterIndex];
      if (href == null) return { reason: 'chapter_not_found' };
      if (kepubSpine.hrefs[chapterIndex] !== href) {
        const alt = kepubSpine.hrefs.indexOf(href);
        if (alt >= 0) kepubChapterIndex = alt;
      }
    }

    const kepubHref = kepubSpine.hrefs[kepubChapterIndex];
    if (kepubHref == null) return { reason: 'chapter_not_found' };

    const [epubDoc, kepubDoc] = await Promise.all([
      this.epubDom.getChapter(bookFileId, epubChapterIndex),
      this.kepubDom.getChapterByIndex(ctx.kepubPath, kepubChapterIndex),
    ]);
    if (!epubDoc) return { reason: 'chapter_unavailable' };
    if (!kepubDoc) return { reason: 'kepub_unavailable' };

    return { epubDoc, kepubDoc, epubChapterIndex, kepubChapterIndex, kepubHref, kepubSpineLength: kepubSpine.hrefs.length };
  }

  private logFail(operation: string, bookFileId: number, reason: string): void {
    this.logger.debug(`[${EVENT}] [fail] op=${operation} bookFileId=${bookFileId} reason=${sanitizeLogValue(reason)} - kobo span conversion failed`);
  }
}

interface ChapterPair {
  epubDoc: ChapterDocument;
  kepubDoc: ChapterDocument;
  epubChapterIndex: number;
  kepubChapterIndex: number;
  kepubHref: string;
  kepubSpineLength: number;
}
