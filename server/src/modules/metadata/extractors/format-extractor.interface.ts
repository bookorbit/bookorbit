import type { ParsedCbzComicMetadata } from '../lib/cbz-metadata';

export interface ParsedBookData {
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  isbn10?: string | null;
  isbn13?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  language?: string | null;
  seriesName?: string | null;
  seriesIndex?: number | null;
  authors: { name: string; sortName: string | null }[];
  genres: string[];
  tags?: string[];
  rating?: number | null;
  googleBooksId?: string | null;
  goodreadsId?: string | null;
  amazonId?: string | null;
  hardcoverId?: string | null;
  openLibraryId?: string | null;
  ranobedbId?: string | null;
  itunesId?: string | null;
  audibleId?: string | null;
  cover: Buffer | null;
  // audio-specific
  narrators?: string[];
  durationSeconds?: number | null;
  chapters?: { title: string; startMs: number }[];
  // ebook-specific extras
  pageCount?: number | null;
  comicMetadata?: ParsedCbzComicMetadata | null;
}

export interface FormatExtractor {
  extract(absolutePath: string): Promise<ParsedBookData | null>;
}
