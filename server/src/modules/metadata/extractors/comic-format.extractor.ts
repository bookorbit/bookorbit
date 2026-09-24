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

type ComicInfoMetadata = NonNullable<Awaited<ReturnType<typeof extractCbzMetadata>>>;

// A ComicInfo.xml that only lists pages or a language says nothing about the book, so it must not
// keep a sidecar OPF from supplying the series.
function hasBibliographicFields(metadata: ComicInfoMetadata): boolean {
  return Boolean(
    metadata.title ||
    metadata.subtitle ||
    metadata.seriesName ||
    metadata.seriesIndex ||
    metadata.description ||
    metadata.publisher ||
    metadata.publishedDate ||
    metadata.publishedYear ||
    metadata.isbn10 ||
    metadata.isbn13 ||
    metadata.authors.length > 0,
  );
}

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
      publishedDate: comicMetadata?.publishedDate ?? null,
      publishedYear: comicMetadata?.publishedYear ?? fb.publishedYear ?? null,
      language: comicMetadata?.language ?? null,
      seriesName: comicMetadata?.seriesName ?? null,
      seriesIndex: comicMetadata?.seriesIndex ?? null,
      seriesTotalBooks: comicMetadata?.seriesTotalBooks ?? null,
      authors: comicMetadata?.authors ?? [],
      genres: comicMetadata?.genres?.length ? comicMetadata.genres : (comicMetadata?.tags ?? []),
      googleBooksId: comicMetadata?.googleBooksId ?? null,
      goodreadsId: comicMetadata?.goodreadsId ?? null,
      amazonId: comicMetadata?.amazonId ?? null,
      hardcoverId: comicMetadata?.hardcoverId ?? null,
      hardcoverEditionId: comicMetadata?.hardcoverEditionId ?? null,
      openLibraryId: comicMetadata?.openLibraryId ?? null,
      ranobedbId: comicMetadata?.ranobedbId ?? null,
      koboId: comicMetadata?.koboId ?? null,
      comicvineId: comicMetadata?.comicvineId ?? null,
      lubimyczytacId: comicMetadata?.lubimyczytacId ?? null,
      aladinId: comicMetadata?.aladinId ?? null,
      itunesId: comicMetadata?.itunesId ?? null,
      cover: cover ?? null,
      comicMetadata: comicMetadata?.comicMetadata ?? null,
      hasEmbeddedMetadata: comicMetadata !== null && hasBibliographicFields(comicMetadata),
    };
  }
}
