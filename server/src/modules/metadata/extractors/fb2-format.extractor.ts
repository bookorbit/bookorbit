import { extractFb2Cover } from '../lib/cover-fb2';
import { parseFb2File } from '../lib/fb2-parser';
import type { FormatExtractor, ParsedBookData } from './format-extractor.interface';

export class Fb2FormatExtractor implements FormatExtractor {
  async extract(absolutePath: string): Promise<ParsedBookData | null> {
    const [fb2, cover] = await Promise.all([parseFb2File(absolutePath), extractFb2Cover(absolutePath).catch(() => null)]);
    if (!fb2) return null;
    return {
      title: fb2.title,
      description: fb2.description,
      publishedYear: fb2.publishedYear,
      language: fb2.language,
      seriesName: fb2.seriesName,
      seriesIndex: fb2.seriesIndex,
      authors: fb2.authors,
      genres: fb2.genres,
      cover: cover ?? null,
    };
  }
}
