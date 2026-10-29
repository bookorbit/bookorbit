import { Injectable, Logger } from '@nestjs/common';
import { DjvuDocumentService } from '../djvu/djvu-document.service';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { extractAudioCover } from './extractors/audio.extractor';
import { AudioFormatExtractor } from './extractors/audio-format.extractor';
import { ComicFormatExtractor } from './extractors/comic-format.extractor';
import { EpubFormatExtractor } from './extractors/epub-format.extractor';
import { Fb2FormatExtractor } from './extractors/fb2-format.extractor';
import type { FormatExtractOptions, FormatExtractor, ParsedBookData } from './extractors/format-extractor.interface';
import { MobiFormatExtractor } from './extractors/mobi-format.extractor';
import { OpfFormatExtractor } from './extractors/opf-format.extractor';
import { PdfFormatExtractor } from './extractors/pdf-format.extractor';
import { extractCover } from './lib/cover';
import { extractEpubFixedLayout } from './lib/epub';
import { parseBookFilename } from './lib/filename-parser';
import type { PdfParseWarning } from './lib/pdf-parser';

export const METADATA_AUDIO_FORMATS = ['m4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac'] as const;

export interface MetadataExtractionResult {
  metadata: ParsedBookData | null;
  cover: Buffer | null;
}

@Injectable()
export class MetadataExtractionService {
  private readonly logger = new Logger(MetadataExtractionService.name);
  private readonly extractors: ReadonlyMap<string, FormatExtractor>;

  constructor(private readonly djvu: DjvuDocumentService) {
    const audio = new AudioFormatExtractor();
    const mobi = new MobiFormatExtractor();
    const epub = new EpubFormatExtractor();
    const extractors = new Map<string, FormatExtractor>([
      ['epub', epub],
      ['kepub', epub],
      ['opf', new OpfFormatExtractor()],
      ['pdf', new PdfFormatExtractor({ extractCover: true, onWarning: (warning) => this.logPdfParseWarning(warning) })],
      ['mobi', mobi],
      ['azw3', mobi],
      ['azw', mobi],
      ['cbz', new ComicFormatExtractor('cbz')],
      ['cbr', new ComicFormatExtractor('cbr')],
      ['cb7', new ComicFormatExtractor('cb7')],
      ['fb2', new Fb2FormatExtractor()],
    ]);

    for (const format of METADATA_AUDIO_FORMATS) {
      extractors.set(format, audio);
    }
    this.extractors = extractors;
  }

  supports(format: string): boolean {
    return format === 'djvu' || this.extractors.has(format);
  }

  async extract(absolutePath: string, format: string, options?: FormatExtractOptions): Promise<ParsedBookData | null> {
    if (format === 'djvu') {
      if (options?.cover === false) return { ...(await this.extractDjvuDetails(absolutePath)), authors: [], genres: [], cover: null };
      const { pageCount, cover } = await this.djvu.extractMetadata(absolutePath);
      const filename = parseBookFilename(absolutePath);
      return {
        title: filename.title,
        authors: [],
        publishedYear: filename.publishedYear,
        genres: [],
        pageCount,
        cover,
      };
    }
    const extractor = this.extractors.get(format);
    if (!extractor) return null;
    return (await (options ? extractor.extract(absolutePath, options) : extractor.extract(absolutePath))) ?? null;
  }

  /** What a DjVu file supplies, read without rendering its cover. */
  async extractDjvuDetails(absolutePath: string): Promise<{ title: string; publishedYear: number | null; pageCount: number }> {
    const filename = parseBookFilename(absolutePath);
    return { title: filename.title, publishedYear: filename.publishedYear, pageCount: await this.djvu.readPageCount(absolutePath) };
  }

  /**
   * Reads only the fixed-layout declaration from an EPUB, without the full metadata parse.
   * Returns null when the format cannot carry the declaration or the file cannot be read, so
   * callers can retry rather than caching a read failure as a definitive answer.
   */
  async detectFixedLayout(absolutePath: string, format: string): Promise<boolean | null> {
    if (format !== 'epub' && format !== 'kepub') return null;
    return extractEpubFixedLayout(absolutePath);
  }

  async extractWithCoverFallback(absolutePath: string, format: string): Promise<MetadataExtractionResult> {
    const metadata = await this.extract(absolutePath, format);
    if (metadata) return { metadata, cover: metadata.cover };

    const cover = await extractCover(absolutePath, format);
    return { metadata: null, cover };
  }

  /** Reads only a file's embedded cover. KEPUB is an EPUB container, and audio art comes from ffmpeg. */
  async extractEmbeddedCover(absolutePath: string, format: string): Promise<Buffer | null> {
    const normalized = format.toLowerCase();
    if (normalized === 'djvu') return this.djvu.extractCover(absolutePath);
    if ((METADATA_AUDIO_FORMATS as readonly string[]).includes(normalized)) return extractAudioCover(absolutePath);
    return extractCover(absolutePath, normalized === 'kepub' ? 'epub' : normalized);
  }

  private logPdfParseWarning(warning: PdfParseWarning): void {
    const pathValue = sanitizeLogValue(warning.absolutePath);
    if (warning.code === 'buffered-large-pdf') {
      this.logger.warn(
        `[metadata.pdf_parse] [end] path="${pathValue}" code=${warning.code} sizeBytes=${warning.sizeBytes ?? 0} thresholdBytes=${warning.thresholdBytes ?? 0} - large pdf buffered in memory`,
      );
      return;
    }
    this.logger.warn(
      `[metadata.pdf_parse] [fail] path="${pathValue}" code=${warning.code} errorClass=${warning.errorClass} error="${sanitizeLogValue(warning.errorMessage)}" - pdf parse warning emitted`,
    );
  }
}
