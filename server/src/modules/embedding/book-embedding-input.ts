import { BookEmbeddingSourceData } from './book-embedding.types';

const MAX_DESCRIPTION_CHARS = 4000;

export function buildEmbeddingInput(source: BookEmbeddingSourceData): string {
  const lines: string[] = [];
  if (source.title?.trim()) lines.push(`Title: ${source.title.trim()}`);
  if (source.seriesName?.trim()) lines.push(`Series: ${source.seriesName.trim()}`);
  if (source.authors.length) lines.push(`Authors: ${source.authors.join(', ')}`);
  if (source.publisher?.trim()) lines.push(`Publisher: ${source.publisher.trim()}`);
  if (source.genres.length) lines.push(`Genres: ${source.genres.join(', ')}`);
  if (source.tags.length) lines.push(`Tags: ${source.tags.join(', ')}`);
  if (source.description?.trim()) lines.push(`Description: ${source.description.trim().slice(0, MAX_DESCRIPTION_CHARS)}`);
  return lines.join('\n');
}
