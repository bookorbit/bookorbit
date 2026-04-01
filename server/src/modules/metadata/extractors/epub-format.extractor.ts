import { extractEpubCover } from '../lib/cover-epub';
import { extractEpubMetadata } from '../lib/epub';
import type { FormatExtractor, ParsedBookData } from './format-extractor.interface';

export class EpubFormatExtractor implements FormatExtractor {
  async extract(absolutePath: string): Promise<ParsedBookData | null> {
    const [metadata, cover] = await Promise.all([extractEpubMetadata(absolutePath), extractEpubCover(absolutePath).catch(() => null)]);
    if (!metadata) return null;
    return {
      title: metadata.title,
      subtitle: metadata.subtitle,
      description: metadata.description,
      isbn10: metadata.isbn10,
      isbn13: metadata.isbn13,
      publisher: metadata.publisher,
      publishedYear: metadata.publishedYear,
      language: metadata.language,
      seriesName: metadata.seriesName,
      seriesIndex: metadata.seriesIndex,
      authors: metadata.authors,
      genres: metadata.genres.length > 0 ? metadata.genres : metadata.tags,
      cover: cover ?? null,
    };
  }
}
