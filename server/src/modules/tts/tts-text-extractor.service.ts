import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { load } from 'cheerio';
import * as unzipper from 'unzipper';
import { XMLParser } from 'fast-xml-parser';

import type { TtsChapterText } from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookReadService } from '../book/book-read.service';

const MAX_CACHE_ENTRIES = 100;

interface CacheEntry {
  text: TtsChapterText;
  lastAccessed: number;
}

export function normalizePath(p: string): string {
  const parts = p.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      resolved.pop();
    } else if (part !== '.') {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

export function htmlToBlocks(html: string): string[] {
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const bodyHtml = bodyMatch?.[1] ?? html;
  const cleanedHtml = bodyHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

  // Keep this block list aligned with Foliate's TTS block segmentation so
  // server-side audio blocks and client-side highlight blocks stay in sync.
  const BLOCK_SPLIT_RE =
    /<(?:article|aside|audio|blockquote|caption|details|dialog|div|dl|dt|dd|figure|footer|form|figcaption|h[1-6]|header|hgroup|hr|li|main|math|nav|ol|p|pre|section|tr)[^>]*>/gi;

  // Foliate's getBlocks() starts the first block at the first block-level
  // element and discards any content before it. Anchor extraction at the same
  // point; otherwise leading content (bare text, an inline drop-cap/span, etc.)
  // becomes an extra server-only block 0, shifting every audio block index by
  // one so playback runs a paragraph behind the highlight.
  const firstBlockIdx = cleanedHtml.search(BLOCK_SPLIT_RE);
  const fromFirstBlock = firstBlockIdx >= 0 ? cleanedHtml.slice(firstBlockIdx) : cleanedHtml;

  // Split on the block-element opening tags themselves (split consumes them).
  // Splitting on the tags - rather than on inserted newlines - means a newline
  // inside a paragraph (common in pretty-printed EPUB HTML) never splits one
  // paragraph into several blocks and desyncs the indices.
  const chunks = fromFirstBlock.split(BLOCK_SPLIT_RE);

  // Only the text conversion below changed: the split above still decides block
  // boundaries, so block indices stay aligned with Foliate's highlight blocks.
  return chunks.map((chunk) => blockText(chunk)).filter((t) => t.length > 0);
}

/**
 * A block's spoken text, which has to be the text the reader displays for that block,
 * because the narration is read against the page.
 *
 * Each chunk is still an HTML fragment, so it is parsed rather than stripped and unescaped
 * by hand. The hand-written table this replaced knew six named entities and no numeric
 * ones, so a reference like `&#39;` survived into the block text and providers read it out
 * verbatim ("hash thirty-nine") where the page showed a normal apostrophe. Parsing decodes
 * whatever the reader's own DOM decodes, and decodes once, so a book that quotes `&amp;#39;`
 * is still narrated as `&#39;`.
 *
 * `htmlToPlainText` is deliberately not used here. It strips tag-shaped text a second time
 * after decoding, which is right for scraped metadata that gets displayed but would silence
 * content in a book: a code sample written `&lt;div&gt;hi&lt;/div&gt;` would narrate as
 * "hi", and "5 &lt; 6" would lose its operator.
 */
function blockText(chunk: string): string {
  return load(chunk, undefined, false).root().text().replace(/\s+/g, ' ').trim();
}

@Injectable()
export class TtsTextExtractorService {
  private readonly logger = new Logger(TtsTextExtractorService.name);
  private readonly textCache = new Map<string, CacheEntry>();

  constructor(private readonly bookReadService: BookReadService) {}

  async extractChapterText(bookFileId: number, chapterIndex: number): Promise<TtsChapterText> {
    const cacheKey = `${bookFileId}:${chapterIndex}`;
    const cached = this.textCache.get(cacheKey);
    if (cached) {
      cached.lastAccessed = Date.now();
      return cached.text;
    }

    const event = 'tts.text_extractor.extract';
    const startMs = Date.now();
    this.logger.log(`[${event}] [start] bookFileId=${bookFileId} chapterIndex=${chapterIndex} - extracting chapter text`);

    try {
      const file = await this.bookReadService.findFileById(bookFileId);
      if (!file) throw new NotFoundException(`Book file ${bookFileId} not found`);
      if (file.format !== 'epub') throw new NotFoundException(`File ${bookFileId} is not an EPUB`);

      const result = await this.extractFromEpub(file.absolutePath, chapterIndex);
      this.logger.log(
        `[${event}] [end] bookFileId=${bookFileId} chapterIndex=${chapterIndex} durationMs=${Date.now() - startMs} blocks=${result.sentences.length} - chapter text extracted`,
      );

      this.addToCache(cacheKey, result);
      return result;
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError';
      const error = err instanceof Error ? sanitizeLogValue(err.message) : 'unknown';
      this.logger.error(
        `[${event}] [fail] bookFileId=${bookFileId} chapterIndex=${chapterIndex} durationMs=${Date.now() - startMs} errorClass=${errorClass} error="${error}" - chapter text extraction failed`,
      );
      throw err;
    }
  }

  private async extractFromEpub(epubPath: string, chapterIndex: number): Promise<TtsChapterText> {
    const zip = await unzipper.Open.file(epubPath);
    const containerXml = zip.files.find((f) => f.path === 'META-INF/container.xml');
    if (!containerXml) throw new NotFoundException('Invalid EPUB: missing container.xml');

    const containerContent = await containerXml.buffer();

    const xmlParserWithAttrs = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
    const containerParsedWithAttrs = xmlParserWithAttrs.parse(containerContent.toString()) as {
      container?: { rootfiles?: { rootfile?: { '@_full-path'?: string } | Array<{ '@_full-path'?: string }> } };
    };

    const rootfiles = containerParsedWithAttrs.container?.rootfiles?.rootfile;
    const rootfileItem = Array.isArray(rootfiles) ? rootfiles[0] : rootfiles;
    const opfPath = rootfileItem?.['@_full-path'];
    if (!opfPath) throw new NotFoundException('Invalid EPUB: missing OPF path');

    const opfFile = zip.files.find((f) => f.path === opfPath);
    if (!opfFile) throw new NotFoundException('Invalid EPUB: OPF file not found');

    const opfContent = await opfFile.buffer();
    const opfParsed = xmlParserWithAttrs.parse(opfContent.toString()) as {
      package?: {
        manifest?: { item?: Array<{ '@_id'?: string; '@_href'?: string; '@_media-type'?: string }> | { '@_id'?: string; '@_href'?: string } };
        spine?: { itemref?: Array<{ '@_idref'?: string }> | { '@_idref'?: string } };
      };
    };

    const items = opfParsed.package?.manifest?.item;
    const manifestItems = Array.isArray(items) ? items : items ? [items] : [];
    const spine = opfParsed.package?.spine?.itemref;
    const spineItems = Array.isArray(spine) ? spine : spine ? [spine] : [];

    if (chapterIndex < 0 || chapterIndex >= spineItems.length) {
      throw new NotFoundException(`Chapter ${chapterIndex} not found in spine (total: ${spineItems.length})`);
    }

    const spineItem = spineItems[chapterIndex];
    const idref = spineItem?.['@_idref'];
    if (!idref) throw new NotFoundException(`Spine item ${chapterIndex} has no idref`);

    const manifestItem = manifestItems.find((m) => m['@_id'] === idref);
    if (!manifestItem) throw new NotFoundException(`Manifest item ${idref} not found`);

    const href = manifestItem['@_href'];
    if (!href) throw new NotFoundException(`Manifest item ${idref} has no href`);

    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
    const chapterPath = normalizePath(opfDir + href);

    const chapterFile = zip.files.find((f) => f.path === chapterPath);
    if (!chapterFile) throw new NotFoundException(`Chapter file not found: ${chapterPath}`);

    const chapterContent = await chapterFile.buffer();
    const blocks = htmlToBlocks(chapterContent.toString('utf8'));

    return {
      chapterIndex,
      sentences: blocks.map((text, index) => ({ text, index })),
    };
  }

  private addToCache(key: string, text: TtsChapterText): void {
    if (this.textCache.size >= MAX_CACHE_ENTRIES) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [k, v] of this.textCache.entries()) {
        if (v.lastAccessed < oldestTime) {
          oldestTime = v.lastAccessed;
          oldestKey = k;
        }
      }
      if (oldestKey) this.textCache.delete(oldestKey);
    }
    this.textCache.set(key, { text, lastAccessed: Date.now() });
  }
}
