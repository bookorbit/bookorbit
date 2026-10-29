import { extractEpubCover } from '../lib/cover-epub';
import { extractEpubMetadata, isPrePaginated } from '../lib/epub';
import type { FormatExtractOptions, FormatExtractor, ParsedBookData } from './format-extractor.interface';
import { mapOpfMetadata } from './opf-metadata.mapper';

export class EpubFormatExtractor implements FormatExtractor {
  async extract(absolutePath: string, options?: FormatExtractOptions): Promise<ParsedBookData | null> {
    const [metadata, cover] = await Promise.all([
      extractEpubMetadata(absolutePath),
      options?.cover === false ? null : extractEpubCover(absolutePath).catch(() => null),
    ]);
    if (!metadata) return null;
    return { ...mapOpfMetadata(metadata, cover ?? null), isFixedLayout: isPrePaginated(metadata) };
  }
}
