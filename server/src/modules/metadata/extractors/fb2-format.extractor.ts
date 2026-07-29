import { extractFb2Cover } from '../lib/cover-fb2';
import { parseFb2File } from '../lib/fb2-parser';
import type { FormatExtractor, ParsedBookData } from './format-extractor.interface';

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class Fb2FormatExtractor implements FormatExtractor {
  async extract(absolutePath: string): Promise<ParsedBookData | null> {
    const [fb2, cover] = await Promise.all([parseFb2File(absolutePath), extractFb2Cover(absolutePath).catch(() => null)]);
    if (!fb2) return null;

    const custom = fb2.custom;
    return {
      title: fb2.title,
      subtitle: custom.subtitle ?? null,
      description: fb2.description,
      publisher: fb2.publisher,
      publishedDate: fb2.publishedDate,
      publishedYear: fb2.publishedYear,
      language: fb2.language,
      seriesName: fb2.seriesName,
      seriesIndex: fb2.seriesIndex,
      authors: fb2.authors,
      genres: fb2.genres,
      tags: fb2.tags,
      isbn13: fb2.isbn13,
      isbn10: custom.isbn10 ?? null,
      rating: toNumber(custom.rating),
      pageCount: toNumber(custom.pageCount),
      googleBooksId: custom.googleBooksId ?? null,
      goodreadsId: custom.goodreadsId ?? null,
      amazonId: custom.amazonId ?? null,
      hardcoverId: custom.hardcoverId ?? null,
      hardcoverEditionId: custom.hardcoverEditionId ?? null,
      openLibraryId: custom.openLibraryId ?? null,
      ranobedbId: custom.ranobedbId ?? null,
      koboId: custom.koboId ?? null,
      lubimyczytacId: custom.lubimyczytacId ?? null,
      aladinId: custom.aladinId ?? null,
      itunesId: custom.itunesId ?? null,
      cover: cover ?? null,
    };
  }
}
