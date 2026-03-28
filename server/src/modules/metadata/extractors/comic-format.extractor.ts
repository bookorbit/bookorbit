import { extractCb7Cover } from '../lib/cover-cb7';
import { extractCbrCover } from '../lib/cover-cbr';
import { extractCbzCover } from '../lib/cover-cbz';
import { extractCb7Metadata, extractCbrMetadata, extractCbzMetadata } from '../lib/cbz-metadata';
import { parseBookFilename } from '../lib/filename-parser';
import type { FormatExtractor, ParsedBookData } from './format-extractor.interface';

type ComicFormat = 'cbz' | 'cbr' | 'cb7';

const metadataExtractors: Record<ComicFormat, (path: string) => ReturnType<typeof extractCbzMetadata>> = {
  cbz: extractCbzMetadata,
  cbr: extractCbrMetadata,
  cb7: extractCb7Metadata,
};

const coverExtractors: Record<ComicFormat, (path: string) => Promise<Buffer | null>> = {
  cbz: extractCbzCover,
  cbr: extractCbrCover,
  cb7: extractCb7Cover,
};

export class ComicFormatExtractor implements FormatExtractor {
  constructor(private readonly format: ComicFormat) {}

  async extract(absolutePath: string): Promise<ParsedBookData | null> {
    const [cbx, cover] = await Promise.all([
      metadataExtractors[this.format](absolutePath),
      coverExtractors[this.format](absolutePath).catch(() => null),
    ]);

    const fb = parseBookFilename(absolutePath);
    return {
      title: cbx?.title ?? fb.title,
      description: cbx?.description ?? null,
      publisher: cbx?.publisher ?? null,
      publishedYear: cbx?.publishedYear ?? fb.publishedYear ?? null,
      language: cbx?.language ?? null,
      seriesName: cbx?.seriesName ?? null,
      seriesIndex: cbx?.seriesIndex ?? null,
      authors: cbx?.authors ?? [],
      genres: cbx?.tags ?? [],
      cover: cover ?? null,
      comicMetadata: cbx?.comicMetadata ?? null,
    };
  }
}
