import { parseBookFilename } from '../lib/filename-parser';
import { parsePdfFile } from '../lib/pdf-parser';
import type { FormatExtractor, ParsedBookData } from './format-extractor.interface';

export class PdfFormatExtractor implements FormatExtractor {
  async extract(absolutePath: string): Promise<ParsedBookData | null> {
    const pdf = await parsePdfFile(absolutePath);
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
      cover: pdf.coverBuffer,
      pageCount: pdf.pageCount,
    };
  }
}
