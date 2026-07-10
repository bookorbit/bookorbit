import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

import type { BookDockMetadata } from '@bookorbit/types';
import { isAudioFormat } from '@bookorbit/types';
import { extractEpubMetadata } from '../metadata/lib/epub';
import { extractCbzMetadata, extractCbrMetadata, extractCb7Metadata } from '../metadata/lib/cbz-metadata';
import { parseFb2File } from '../metadata/lib/fb2-parser';
import { parseMobiFile } from '../metadata/lib/mobi-parser';
import { parsePdfFile, type PdfParsed, type PdfParseWarning } from '../metadata/lib/pdf-parser';
import { mapOpfMetadata } from '../metadata/extractors/opf-metadata.mapper';
import type { ParsedBookData } from '../metadata/extractors/format-extractor.interface';
import { extractAudioMetadata, type AudioExtractResult } from '../metadata/extractors/audio.extractor';
import { extractCover, generateThumbnail, imageExt } from '../metadata/lib/cover';
import { detectComicContainerFormat } from '../../common/comic-format-detect';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { parsePublishedDateKey, parsePublishedYear, publishedYearFromDateKey } from '../../common/utils/published-date.utils';
import { BookDockRepository } from './book-dock.repository';

@Injectable()
export class BookDockMetadataService {
  private readonly logger = new Logger(BookDockMetadataService.name);

  constructor(private readonly repo: BookDockRepository) {}

  async extractAndSave(fileId: number, absolutePath: string, format: string, coversDir: string): Promise<void> {
    const startedAt = Date.now();
    await this.repo.update(fileId, { status: 'extracting' });
    try {
      let metadata: BookDockMetadata;
      let coverBytes: Buffer | null;

      if (format === 'pdf') {
        const parsedPdf = await this.extractPdfData(absolutePath, true);
        metadata = this.toPdfMetadata(parsedPdf);
        coverBytes = parsedPdf?.coverBuffer ?? null;
      } else if (isAudioFormat(format)) {
        const audio = await extractAudioMetadata(absolutePath);
        metadata = this.toAudioMetadata(audio);
        coverBytes = audio.coverBytes;
      } else {
        [metadata, coverBytes] = await Promise.all([this.extractMetadata(absolutePath, format), extractCover(absolutePath, format)]);
      }

      let coverPath: string | null = null;
      if (coverBytes && coverBytes.length > 0) {
        coverPath = await this.saveCover(fileId, coverBytes, coversDir);
      }

      await this.repo.update(fileId, {
        embeddedMetadata: metadata,
        coverPath,
        status: 'ready',
      });
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[book_dock.extract_metadata] [fail] fileId=${fileId} format=${format} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - metadata extraction failed`,
      );
      await this.repo.update(fileId, {
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Metadata extraction failed',
      });
    }
  }

  private async extractMetadata(absolutePath: string, format: string): Promise<BookDockMetadata> {
    switch (format) {
      case 'epub':
        return this.fromEpub(absolutePath);
      case 'pdf':
        return this.fromPdf(absolutePath);
      case 'mobi':
      case 'azw3':
      case 'azw':
        return this.fromMobi(absolutePath);
      case 'cbz':
        return this.fromCbx(absolutePath, 'cbz');
      case 'cbr':
        return this.fromCbx(absolutePath, 'cbr');
      case 'cb7':
        return this.fromCbx(absolutePath, 'cb7');
      case 'fb2':
        return this.fromFb2(absolutePath);
      default:
        return {};
    }
  }

  private async fromEpub(absolutePath: string): Promise<BookDockMetadata> {
    const parsed = await extractEpubMetadata(absolutePath);
    if (!parsed) return {};
    return this.toBookDockMetadata(mapOpfMetadata(parsed, null));
  }

  private async fromPdf(absolutePath: string): Promise<BookDockMetadata> {
    return this.toPdfMetadata(await this.extractPdfData(absolutePath, false));
  }

  private async fromMobi(absolutePath: string): Promise<BookDockMetadata> {
    const parsed = await parseMobiFile(absolutePath);
    if (!parsed) return {};
    const publishedDate = parsePublishedDateKey(parsed.publishedDate);
    const year = publishedDate ? publishedYearFromDateKey(publishedDate) : parsePublishedYear(parsed.publishedDate);
    return {
      title: parsed.title ?? undefined,
      description: parsed.description ?? undefined,
      publisher: parsed.publisher ?? undefined,
      publishedDate,
      publishedYear: year,
      language: parsed.language ?? undefined,
      isbn13: parsed.isbn ?? undefined,
      authors: parsed.authors.length > 0 ? parsed.authors : undefined,
      genres: parsed.tags.length > 0 ? parsed.tags : undefined,
    };
  }

  private async fromCbx(absolutePath: string, format: 'cbz' | 'cbr' | 'cb7'): Promise<BookDockMetadata> {
    const actualFormat = await detectComicContainerFormat(absolutePath, format);
    const extractor = actualFormat === 'cbz' ? extractCbzMetadata : actualFormat === 'cbr' ? extractCbrMetadata : extractCb7Metadata;
    const parsed = await extractor(absolutePath);
    if (!parsed) return {};
    return {
      title: parsed.title ?? undefined,
      description: parsed.description ?? undefined,
      publisher: parsed.publisher ?? undefined,
      publishedDate: parsed.publishedDate ?? undefined,
      publishedYear: parsed.publishedYear ?? undefined,
      language: parsed.language ?? undefined,
      seriesName: parsed.seriesName ?? undefined,
      seriesIndex: parsed.seriesIndex ?? undefined,
      authors: parsed.authors.length > 0 ? parsed.authors.map((a) => a.name) : undefined,
      genres: parsed.tags.length > 0 ? parsed.tags : undefined,
    };
  }

  private async fromFb2(absolutePath: string): Promise<BookDockMetadata> {
    const parsed = await parseFb2File(absolutePath);
    if (!parsed) return {};
    return {
      title: parsed.title ?? undefined,
      description: parsed.description ?? undefined,
      publishedDate: parsed.publishedDate ?? undefined,
      publishedYear: parsed.publishedYear ?? undefined,
      language: parsed.language ?? undefined,
      seriesName: parsed.seriesName ?? undefined,
      seriesIndex: parsed.seriesIndex ?? undefined,
      authors: parsed.authors.length > 0 ? parsed.authors.map((a) => a.name) : undefined,
      genres: parsed.genres.length > 0 ? parsed.genres : undefined,
    };
  }

  private async saveCover(fileId: number, bytes: Buffer, coversDir: string): Promise<string> {
    await mkdir(coversDir, { recursive: true });

    const ext = imageExt(bytes);
    const coverPath = join(coversDir, `${fileId}.${ext}`);
    const thumbPath = join(coversDir, `${fileId}_thumb.jpg`);

    const thumbnail = await generateThumbnail(bytes);
    await Promise.all([writeFile(coverPath, bytes), writeFile(thumbPath, thumbnail)]);

    return coverPath;
  }

  private async extractPdfData(absolutePath: string, extractCover: boolean): Promise<PdfParsed | null> {
    return parsePdfFile(absolutePath, {
      extractCover,
      onWarning: (warning) => this.logPdfParseWarning(warning),
    });
  }

  private toAudioMetadata(audio: AudioExtractResult): BookDockMetadata {
    return {
      title: audio.title ?? undefined,
      subtitle: audio.subtitle ?? undefined,
      description: audio.description ?? undefined,
      publisher: audio.publisher ?? undefined,
      publishedDate: audio.publishedDate ?? undefined,
      publishedYear: audio.publishedYear ?? undefined,
      language: audio.language ?? undefined,
      seriesName: audio.seriesName ?? undefined,
      seriesIndex: audio.seriesIndex ?? undefined,
      authors: audio.authors.length > 0 ? audio.authors.map((a) => a.name) : undefined,
      narrators: audio.narrators.length > 0 ? audio.narrators : undefined,
      genres: audio.genres.length > 0 ? audio.genres : undefined,
      durationSeconds: audio.durationSeconds ?? undefined,
      chapters: audio.chapters.length > 0 ? audio.chapters : undefined,
    };
  }

  private toPdfMetadata(parsed: PdfParsed | null): BookDockMetadata {
    if (!parsed) return {};
    return {
      title: parsed.title ?? undefined,
      publisher: parsed.publisher ?? undefined,
      publishedDate: parsed.publishedDate ?? undefined,
      publishedYear: parsed.publishedYear ?? undefined,
      pageCount: parsed.pageCount ?? undefined,
      authors: parsed.authors.length > 0 ? parsed.authors.map((a) => a.name) : undefined,
      genres: parsed.genres.length > 0 ? parsed.genres : undefined,
    };
  }

  private toBookDockMetadata(data: ParsedBookData): BookDockMetadata {
    return {
      title: data.title ?? undefined,
      subtitle: data.subtitle ?? undefined,
      description: data.description ?? undefined,
      publisher: data.publisher ?? undefined,
      publishedDate: data.publishedDate ?? undefined,
      publishedYear: data.publishedYear ?? undefined,
      language: data.language ?? undefined,
      isbn10: data.isbn10 ?? undefined,
      isbn13: data.isbn13 ?? undefined,
      seriesName: data.seriesName ?? undefined,
      seriesIndex: data.seriesIndex ?? undefined,
      pageCount: data.pageCount ?? undefined,
      authors: data.authors.length > 0 ? data.authors.map((a) => a.name) : undefined,
      genres: data.genres.length > 0 ? data.genres : undefined,
    };
  }

  private logPdfParseWarning(warning: PdfParseWarning): void {
    if (warning.code === 'buffered-large-pdf') {
      this.logger.warn(
        `[book_dock.pdf_parse] [end] path="${warning.absolutePath}" code=${warning.code} sizeBytes=${warning.sizeBytes ?? 0} thresholdBytes=${warning.thresholdBytes ?? 0} - large pdf buffered in memory`,
      );
      return;
    }
    this.logger.warn(
      `[book_dock.pdf_parse] [fail] path="${warning.absolutePath}" code=${warning.code} errorClass=${warning.errorClass} error="${warning.errorMessage}" - pdf parse warning emitted`,
    );
  }
}
