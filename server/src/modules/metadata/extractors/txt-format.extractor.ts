import { basename, dirname } from 'path';
import { parseBookFilename } from '../lib/filename-parser';
import type { FormatExtractor, ParsedBookData } from './format-extractor.interface';

/**
 * Plain-text ebooks: title from filename. Cover is not embedded.
 */
export class TxtFormatExtractor implements FormatExtractor {
  extract(absolutePath: string): Promise<ParsedBookData | null> {
    const fb = parseBookFilename(absolutePath);
    return Promise.resolve({
      title: fb.title || null,
      authors: [],
      genres: [],
      cover: null,
      publishedYear: fb.publishedYear,
    });
  }
}

/**
 * Image-folder comics (imgdir): title from parent folder name, cover from the
 * primary image path (often cover.jpg) when available as bytes elsewhere.
 */
export class ImgdirFormatExtractor implements FormatExtractor {
  extract(absolutePath: string): Promise<ParsedBookData | null> {
    const folderName = basename(dirname(absolutePath));
    const seriesName = basename(dirname(dirname(absolutePath)));
    const fb = parseBookFilename(absolutePath);
    return Promise.resolve({
      title: folderName || fb.title || null,
      seriesName: seriesName && seriesName !== folderName ? seriesName : null,
      authors: [],
      genres: [],
      cover: null,
      publishedYear: fb.publishedYear,
    });
  }
}
