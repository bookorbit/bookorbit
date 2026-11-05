import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { EpubDomService } from './epub-dom.service';
import { collapsedRangeToCfi } from './position-converter.core';
import {
  buildLocateIndex,
  findDensestMatch,
  LOCATE_MIN_QUERY_WORDS,
  LocateBookIndex,
  prepareRecognisedText,
  resolveLocatedRange,
  tokenizeWords,
} from './text-locator.core';

const EVENT = 'text_locator.index';
const INDEX_CACHE_MAX = 4;
/** Several long novels' worth. An omnibus beyond it is searched up to this point only. */
const MAX_INDEXED_WORDS = 3_000_000;
const MAX_READ_CHARS = 30_000_000;
const EXCERPT_MAX_LENGTH = 160;
const OPENING_PUNCTUATION = /^["'“‘«([]$/u;
const CLOSING_PUNCTUATION = /^[.,;:!?"'”’»)\]]$/u;

export type TextLocateOutcome =
  { status: 'matched'; chapterIndex: number; cfi: string; confidence: number; excerpt: string } | { status: 'no_match' } | { status: 'unavailable' };

@Injectable()
export class TextLocatorService {
  private readonly logger = new Logger(TextLocatorService.name);
  private readonly indexes = new Map<number, { version: string; index: LocateBookIndex }>();
  private readonly building = new Map<string, Promise<LocateBookIndex | null>>();

  constructor(private readonly epubDom: EpubDomService) {}

  /** Finds where recognised page text appears in an EPUB or KEPUB file. */
  async locate(bookFileId: number, text: string): Promise<TextLocateOutcome> {
    const query = tokenizeWords(prepareRecognisedText(text)).words;
    if (query.length < LOCATE_MIN_QUERY_WORDS) return { status: 'no_match' };

    const index = await this.indexFor(bookFileId);
    if (!index) return { status: 'unavailable' };

    const candidate = findDensestMatch(index.words, query);
    if (!candidate) return { status: 'no_match' };
    const range = resolveLocatedRange(index, candidate);
    if (!range) return { status: 'no_match' };

    const doc = await this.epubDom.getChapter(bookFileId, range.chapterIndex);
    if (!doc) return { status: 'unavailable' };
    // The index and this document come from the same parse; a shorter document means the file changed.
    if (range.endCp > doc.index.collapsedCpLength) return { status: 'no_match' };

    // Words carry no punctuation, so a match starting at "Tickets" would leave out the quotation
    // mark that opens the sentence. Take in what directly touches either end.
    let startCp = range.startCp;
    let endCp = range.endCp;
    while (startCp > 0 && OPENING_PUNCTUATION.test(doc.index.extractCollapsed(startCp - 1, startCp))) startCp -= 1;
    while (endCp < doc.index.collapsedCpLength && CLOSING_PUNCTUATION.test(doc.index.extractCollapsed(endCp, endCp + 1))) endCp += 1;

    const cfi = collapsedRangeToCfi(doc, range.chapterIndex, startCp, endCp);
    if (!cfi) return { status: 'no_match' };

    return {
      status: 'matched',
      chapterIndex: range.chapterIndex,
      cfi,
      confidence: Math.round(candidate.share * 100) / 100,
      excerpt: excerptOf(doc.index.extractCollapsed(startCp, endCp)),
    };
  }

  private async indexFor(bookFileId: number): Promise<LocateBookIndex | null> {
    const version = await this.epubDom.getFileVersion(bookFileId);
    if (!version) return null;

    const cached = this.indexes.get(bookFileId);
    if (cached?.version === version) {
      this.indexes.delete(bookFileId);
      this.indexes.set(bookFileId, cached);
      return cached.index;
    }

    const key = `${bookFileId}:${version}`;
    let build = this.building.get(key);
    if (!build) {
      build = this.build(bookFileId).finally(() => this.building.delete(key));
      this.building.set(key, build);
    }
    return build;
  }

  private async build(bookFileId: number): Promise<LocateBookIndex | null> {
    const startedAt = Date.now();
    this.logger.debug(`[${EVENT}] [start] bookFileId=${bookFileId} - building page text index`);
    try {
      const texts = await this.epubDom.readChapterTexts(bookFileId, MAX_READ_CHARS);
      if (!texts) {
        this.logger.debug(
          `[${EVENT}] [end] bookFileId=${bookFileId} durationMs=${Date.now() - startedAt} outcome=unavailable - page text index skipped`,
        );
        return null;
      }

      const index = buildLocateIndex(texts.chapters, MAX_INDEXED_WORDS);
      this.indexes.delete(bookFileId);
      this.indexes.set(bookFileId, { version: texts.version, index });
      while (this.indexes.size > INDEX_CACHE_MAX) {
        const oldest = this.indexes.keys().next().value as number;
        this.indexes.delete(oldest);
      }

      this.logger.debug(
        `[${EVENT}] [end] bookFileId=${bookFileId} durationMs=${Date.now() - startedAt} chapters=${index.chapters.length} words=${index.words.length} truncated=${index.truncated} - page text index built`,
      );
      return index;
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${EVENT}] [fail] bookFileId=${bookFileId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(
          error instanceof Error ? error.message : 'unknown error',
        )}" - page text index failed`,
      );
      return null;
    }
  }
}

function excerptOf(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= EXCERPT_MAX_LENGTH) return clean;
  const cut = clean.slice(0, EXCERPT_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > EXCERPT_MAX_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd();
}
