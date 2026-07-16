import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AudioFormatExtractor } from './extractors/audio-format.extractor';
import { ComicFormatExtractor } from './extractors/comic-format.extractor';
import { EpubFormatExtractor } from './extractors/epub-format.extractor';
import { Fb2FormatExtractor } from './extractors/fb2-format.extractor';
import type { FormatExtractor, ParsedBookData } from './extractors/format-extractor.interface';
import { MobiFormatExtractor } from './extractors/mobi-format.extractor';
import { OpfFormatExtractor } from './extractors/opf-format.extractor';
import { PdfFormatExtractor } from './extractors/pdf-format.extractor';
import { extractCover } from './lib/cover';
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

  constructor() {
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
    return this.extractors.has(format);
  }

  async extract(absolutePath: string, format: string): Promise<ParsedBookData | null> {
    return (await this.extractors.get(format)?.extract(absolutePath)) ?? null;
  }

  async extractWithCoverFallback(absolutePath: string, format: string): Promise<MetadataExtractionResult> {
    const metadata = await this.extract(absolutePath, format);
    if (metadata) return { metadata, cover: metadata.cover };

    const cover = await extractCover(absolutePath, format);
    return { metadata: null, cover };
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
