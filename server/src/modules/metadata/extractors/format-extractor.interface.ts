import type { ParsedCbzComicMetadata } from '../lib/cbz-metadata';

export interface ParsedBookData {
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  isbn10?: string | null;
  isbn13?: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  publishedYear?: number | null;
  language?: string | null;
  seriesName?: string | null;
  seriesIndex?: string | null;
  /** Series length declared by the file itself; annotates the series, never the book row. */
  seriesTotalBooks?: number | null;
  authors: { name: string; sortName: string | null }[];
  genres: string[];
  tags?: string[];
  rating?: number | null;
  googleBooksId?: string | null;
  goodreadsId?: string | null;
  amazonId?: string | null;
  hardcoverId?: string | null;
  hardcoverEditionId?: string | null;
  openLibraryId?: string | null;
  ranobedbId?: string | null;
  koboId?: string | null;
  comicvineId?: string | null;
  lubimyczytacId?: string | null;
  aladinId?: string | null;
  itunesId?: string | null;
  audibleId?: string | null;
  librofmId?: string | null;
  cover: Buffer | null;
  // audio-specific
  narrators?: string[];
  durationSeconds?: number | null;
  chapters?: { title: string; startMs: number }[];
  // ebook-specific extras
  pageCount?: number | null;
  /**
   * Fixed-layout (`rendition:layout: pre-paginated`) declaration. Only EPUB extraction sets it,
   * because it describes the book file itself, not the bibliographic metadata a sidecar can carry.
   */
  isFixedLayout?: boolean | null;
  comicMetadata?: ParsedCbzComicMetadata | null;
}

export interface FormatExtractor {
  extract(absolutePath: string): Promise<ParsedBookData | null>;
}
