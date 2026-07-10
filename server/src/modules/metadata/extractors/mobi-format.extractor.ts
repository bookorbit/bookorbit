import { extractMobiCover, parseMobiFile } from '../lib/mobi-parser';
import { parsePublishedDateKey, parsePublishedYear, publishedYearFromDateKey } from '../../../common/utils/published-date.utils';
import type { FormatExtractor, ParsedBookData } from './format-extractor.interface';

export class MobiFormatExtractor implements FormatExtractor {
  async extract(absolutePath: string): Promise<ParsedBookData | null> {
    const [mobi, cover] = await Promise.all([parseMobiFile(absolutePath), extractMobiCover(absolutePath).catch(() => null)]);
    if (!mobi) return null;

    const publishedDate = parsePublishedDateKey(mobi.publishedDate ?? undefined) ?? null;
    const publishedYear = publishedDate ? publishedYearFromDateKey(publishedDate) : (parsePublishedYear(mobi.publishedDate) ?? null);
    return {
      title: mobi.title,
      description: mobi.description,
      isbn13: mobi.isbn,
      publisher: mobi.publisher,
      publishedDate,
      publishedYear,
      language: mobi.language,
      authors: mobi.authors.map((name) => ({ name, sortName: null })),
      genres: mobi.tags,
      cover: cover ?? null,
    };
  }
}
