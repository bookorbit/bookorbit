import { extractEpubCover } from '../lib/cover-epub';
import { extractEpubMetadata } from '../lib/epub';
import type { FormatExtractor, ParsedBookData } from './format-extractor.interface';
import { mapOpfMetadata } from './opf-metadata.mapper';

export class EpubFormatExtractor implements FormatExtractor {
  async extract(absolutePath: string): Promise<ParsedBookData | null> {
    const [metadata, cover] = await Promise.all([extractEpubMetadata(absolutePath), extractEpubCover(absolutePath).catch(() => null)]);
    if (!metadata) return null;
    return mapOpfMetadata(metadata, cover ?? null);
  }
}
