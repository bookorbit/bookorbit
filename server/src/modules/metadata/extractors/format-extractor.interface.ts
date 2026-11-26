import type { SeriesUnit } from '@bookorbit/types';

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
  /**
   * Set only by path rules on a comic file, alongside the number they decided; null clears a stored
   * unit. Undefined leaves the stored one alone, which is what every file extractor does.
   */
  seriesUnit?: SeriesUnit | null;
  /** The volume a chapter or issue belongs to; written with `seriesUnit`. */
  seriesVolumeIndex?: string | null;
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

export interface FormatExtractOptions {
  /** False skips reading the cover; the result's cover is then null. */
  cover?: boolean;
}

export interface FormatExtractor {
  extract(absolutePath: string, options?: FormatExtractOptions): Promise<ParsedBookData | null>;
}
