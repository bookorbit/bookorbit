import { extractCb7Cover } from '../lib/cover-cb7';
import { extractCbrCover } from '../lib/cover-cbr';
import { extractCbzCover } from '../lib/cover-cbz';
import { extractCb7Metadata, extractCbrMetadata, extractCbzMetadata } from '../lib/cbz-metadata';
import { parseBookFilename } from '../lib/filename-parser';
import { detectComicContainerFormat } from '../../../common/comic-format-detect';
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
    const actualFormat = await detectComicContainerFormat(absolutePath, this.format);
    const [comicMetadata, cover] = await Promise.all([
      metadataExtractors[actualFormat](absolutePath),
      coverExtractors[actualFormat](absolutePath).catch(() => null),
    ]);

    const fb = parseBookFilename(absolutePath);
    return {
      title: comicMetadata?.title ?? fb.title,
      description: comicMetadata?.description ?? null,
      publisher: comicMetadata?.publisher ?? null,
      publishedYear: comicMetadata?.publishedYear ?? fb.publishedYear ?? null,
      language: comicMetadata?.language ?? null,
      seriesName: comicMetadata?.seriesName ?? null,
      seriesIndex: comicMetadata?.seriesIndex ?? null,
      authors: comicMetadata?.authors ?? [],
      genres: comicMetadata?.genres?.length ? comicMetadata.genres : (comicMetadata?.tags ?? []),
      googleBooksId: comicMetadata?.googleBooksId ?? null,
      goodreadsId: comicMetadata?.goodreadsId ?? null,
      amazonId: comicMetadata?.amazonId ?? null,
      hardcoverId: comicMetadata?.hardcoverId ?? null,
      openLibraryId: comicMetadata?.openLibraryId ?? null,
      ranobedbId: comicMetadata?.ranobedbId ?? null,
      itunesId: comicMetadata?.itunesId ?? null,
      cover: cover ?? null,
      comicMetadata: comicMetadata?.comicMetadata ?? null,
    };
  }
}
