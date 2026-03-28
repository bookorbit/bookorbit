import { extractMobiCover, parseMobiFile } from '../lib/mobi-parser';
import type { FormatExtractor, ParsedBookData } from './format-extractor.interface';

export class MobiFormatExtractor implements FormatExtractor {
  async extract(absolutePath: string): Promise<ParsedBookData | null> {
    const [mobi, cover] = await Promise.all([parseMobiFile(absolutePath), extractMobiCover(absolutePath).catch(() => null)]);
    if (!mobi) return null;

    const yearMatch = mobi.publishedDate?.match(/\b(\d{4})\b/);
    return {
      title: mobi.title,
      description: mobi.description,
      isbn13: mobi.isbn,
      publisher: mobi.publisher,
      publishedYear: yearMatch ? Number.parseInt(yearMatch[1], 10) : null,
      language: mobi.language,
      authors: mobi.authors.map((name) => ({ name, sortName: null })),
      genres: mobi.tags,
      cover: cover ?? null,
    };
  }
}
