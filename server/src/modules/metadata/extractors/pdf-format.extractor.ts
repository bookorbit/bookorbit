import { parseBookFilename } from '../lib/filename-parser';
import { parsePdfFile, type PdfParseOptions } from '../lib/pdf-parser';
import type { FormatExtractor, ParsedBookData } from './format-extractor.interface';

type PdfFormatExtractorOptions = Pick<PdfParseOptions, 'extractCover' | 'onWarning'>;

export class PdfFormatExtractor implements FormatExtractor {
  constructor(private readonly options: PdfFormatExtractorOptions = {}) {}

  async extract(absolutePath: string): Promise<ParsedBookData | null> {
    const pdf = await parsePdfFile(absolutePath, {
      extractCover: this.options.extractCover === true,
      onWarning: this.options.onWarning,
    });
    if (!pdf) return null;

    const fb = !pdf.title ? parseBookFilename(absolutePath) : null;
    return {
      title: pdf.title ?? fb?.title ?? null,
      subtitle: pdf.subtitle,
      description: pdf.description,
      isbn10: pdf.isbn10,
      isbn13: pdf.isbn13,
      publisher: pdf.publisher,
      publishedYear: pdf.publishedYear ?? fb?.publishedYear ?? null,
      language: pdf.language,
      seriesName: pdf.seriesName,
      seriesIndex: pdf.seriesIndex,
      authors: pdf.authors,
      genres: pdf.genres,
      tags: pdf.tags,
      rating: pdf.rating,
      googleBooksId: pdf.googleBooksId,
      goodreadsId: pdf.goodreadsId,
      amazonId: pdf.amazonId,
      hardcoverId: pdf.hardcoverId,
      openLibraryId: pdf.openLibraryId,
      ranobedbId: pdf.ranobedbId,
      itunesId: pdf.itunesId,
      cover: pdf.coverBuffer,
      pageCount: pdf.pageCount,
    };
  }
}
