import { MetadataProviderKey, type MetadataCandidate, type MetadataSeriesMembership } from '@bookorbit/types';

import { parsePublishedDateKey, publishedYearFromDateKey } from '../../../../common/utils/published-date.utils';
import { stripHtml } from '../provider-utils';
import type { LibroFmAudiobook } from './librofm.types';

function normalizeStrings(values: string[] | null | undefined): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return normalized.length ? normalized : undefined;
}

function normalizeCoverUrl(value: string | null | undefined): string | undefined {
  const coverUrl = value?.trim();
  if (!coverUrl) return undefined;
  if (coverUrl.startsWith('//')) return `https:${coverUrl}`;
  if (coverUrl.startsWith('/')) return `https://libro.fm${coverUrl}`;
  return coverUrl;
}

function parseSeriesIndex(value: string | number | null | undefined): number | undefined {
  if (value == null || String(value).trim() === '') return undefined;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeGenres(values: LibroFmAudiobook['genres']): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const seen = new Set<string>();
  const genres: string[] = [];
  for (const value of values) {
    const name = value.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    genres.push(name);
  }
  return genres.length ? genres : undefined;
}

export function mapLibroFmAudiobook(book: LibroFmAudiobook): MetadataCandidate {
  const providerId = String(book.isbn ?? '').trim();
  if (!providerId) throw new Error('Libro.fm audiobook missing ISBN');

  const title = book.title?.trim();
  if (!title) throw new Error('Libro.fm audiobook missing title');

  const publishedDate = parsePublishedDateKey(book.publication_date ?? undefined);
  const publishedYear = publishedDate ? publishedYearFromDateKey(publishedDate) : undefined;
  const description = book.description ? stripHtml(book.description).replace(/\s+([.,!?;:])/g, '$1') : undefined;
  const seriesName = book.series?.trim() || undefined;
  const seriesIndex = parseSeriesIndex(book.series_num);
  const seriesMemberships: MetadataSeriesMembership[] | undefined = seriesName
    ? [{ seriesName, ...(seriesIndex !== undefined ? { seriesIndex } : {}) }]
    : undefined;
  const duration = book.audiobook_info?.duration;
  const durationSeconds = typeof duration === 'number' && Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : undefined;
  const language = book.audiobook_info?.audio_language_display?.trim() || book.audiobook_info?.audio_language?.trim() || undefined;

  return {
    provider: MetadataProviderKey.LIBROFM,
    providerId,
    title,
    subtitle: book.subtitle?.trim() || undefined,
    authors: normalizeStrings(book.authors),
    narrators: normalizeStrings(book.audiobook_info?.narrators),
    description,
    publisher: book.publisher?.trim() || undefined,
    publishedDate,
    publishedYear,
    language,
    isbn13: /^\d{13}$/.test(providerId) ? providerId : undefined,
    seriesName,
    seriesIndex,
    seriesMemberships,
    genres: normalizeGenres(book.genres),
    coverUrl: normalizeCoverUrl(book.cover_url),
    sourceUrl: `https://libro.fm/audiobooks/${encodeURIComponent(providerId)}`,
    durationSeconds,
    abridged: typeof book.abridged === 'boolean' ? book.abridged : undefined,
  };
}
