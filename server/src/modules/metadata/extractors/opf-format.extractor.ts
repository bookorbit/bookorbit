import { readFile } from 'fs/promises';

import { parseOpf } from '../lib/opf-parser';
import type { FormatExtractor, ParsedBookData } from './format-extractor.interface';
import { hasOpfMetadata, mapOpfMetadata } from './opf-metadata.mapper';

export class OpfFormatExtractor implements FormatExtractor {
  async extract(absolutePath: string): Promise<ParsedBookData | null> {
    const xml = await readFile(absolutePath, 'utf8');
    const metadata = parseOpf(xml);
    if (!hasOpfMetadata(metadata)) return null;
    return mapOpfMetadata(metadata, null);
  }
}
