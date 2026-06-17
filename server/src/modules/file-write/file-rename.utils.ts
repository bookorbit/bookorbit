import { formatSeriesIndex } from '../../common/utils/series-index-format.utils';

export { formatSeriesIndex };

export interface RenameMetadata {
  title: string | null;
  subtitle: string | null;
  publisher: string | null;
  language: string | null;
  isbn13: string | null;
  publishedYear: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
}

export function buildTokens(metadata: RenameMetadata, authors: string[], originalStem: string, format: string): Record<string, string> {
  const tokens: Record<string, string> = { originalFilename: originalStem, extension: format };

  if (metadata.title) tokens['title'] = metadata.title;
  if (metadata.subtitle) tokens['subtitle'] = metadata.subtitle;
  if (metadata.publisher) tokens['publisher'] = metadata.publisher;
  if (metadata.language) tokens['language'] = metadata.language;
  if (metadata.isbn13) tokens['isbn'] = metadata.isbn13;
  if (metadata.publishedYear) tokens['year'] = String(metadata.publishedYear);
  if (metadata.seriesName) tokens['series'] = metadata.seriesName;

  const seriesIndex = formatSeriesIndex(metadata.seriesIndex);
  if (seriesIndex) tokens['seriesIndex'] = seriesIndex;
  if (authors.length > 0) tokens['authors'] = authors.join(', ');

  return tokens;
}
