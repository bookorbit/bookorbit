import { readFile } from 'fs/promises';
import path from 'path';

import { parseOpf } from '../lib/opf-parser';
import type { FormatExtractOptions, FormatExtractor, ParsedBookData } from './format-extractor.interface';
import { hasOpfMetadata, mapOpfMetadata } from './opf-metadata.mapper';

export class OpfFormatExtractor implements FormatExtractor {
  async extract(absolutePath: string, options?: FormatExtractOptions): Promise<ParsedBookData | null> {
    const xml = await readFile(absolutePath, 'utf8');
    const metadata = parseOpf(xml);
    if (!hasOpfMetadata(metadata)) return null;

    let cover: Buffer | null = null;
    if (metadata.coverHref && options?.cover !== false) {
      const coverPath = path.resolve(path.dirname(absolutePath), metadata.coverHref);
      try {
        cover = await readFile(coverPath);
      } catch {
        // image file missing or unreadable - proceed without cover
      }
    }

    return mapOpfMetadata(metadata, cover);
  }
}
