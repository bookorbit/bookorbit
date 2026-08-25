import { formatSeriesIndex } from './series-index-format.utils';

/**
 * The metadata a naming pattern can draw on. Every consumer reads these same field names
 * off its own row shape, so callers pass the row through rather than mapping it field by
 * field. `isbn13` is the only token whose source differs between callers: the KOReader
 * catalogue falls back to ISBN-10, and resolves that before calling.
 */
export interface PatternTokenMetadata {
  title?: string | null;
  subtitle?: string | null;
  publisher?: string | null;
  language?: string | null;
  isbn13?: string | null;
  publishedYear?: number | null;
  seriesName?: string | null;
  seriesIndex?: string | null;
}

export interface PatternTokenInput {
  metadata: PatternTokenMetadata;
  authors?: string[];
  narrators?: string[];
  originalStem: string;
  format: string;
  libraryName?: string | null;
}

/**
 * Builds the token map every naming pattern resolves against. This is the single place a
 * new token is added: upload, rename, bulk rename, move, Book Dock, download and the
 * KOReader catalogue all resolve patterns through it, and a token wired into only some of
 * them fails silently, producing a wrong path rather than an error.
 *
 * Absent values are left out rather than set to an empty string. `replacePlaceholders`
 * treats the two identically, and omitting them keeps the map readable in logs.
 */
export function buildPatternTokens(input: PatternTokenInput): Record<string, string> {
  const { metadata, authors = [], narrators = [], originalStem, format, libraryName } = input;
  const tokens: Record<string, string> = { originalFilename: originalStem, extension: format };

  if (libraryName) tokens['library'] = libraryName;
  if (metadata.title) tokens['title'] = metadata.title;
  if (metadata.subtitle) tokens['subtitle'] = metadata.subtitle;
  if (metadata.publisher) tokens['publisher'] = metadata.publisher;
  if (metadata.language) tokens['language'] = metadata.language;
  if (metadata.isbn13) tokens['isbn'] = metadata.isbn13;
  if (metadata.publishedYear) tokens['year'] = String(metadata.publishedYear);
  if (metadata.seriesName) tokens['series'] = metadata.seriesName;

  const seriesIndex = formatSeriesIndex(metadata.seriesIndex ?? null);
  if (seriesIndex) tokens['seriesIndex'] = seriesIndex;
  if (authors.length > 0) tokens['authors'] = authors.join(', ');
  if (narrators.length > 0) tokens['narrators'] = narrators.join(', ');

  return tokens;
}
