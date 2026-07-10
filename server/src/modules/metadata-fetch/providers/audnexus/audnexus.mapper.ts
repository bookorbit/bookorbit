import { AudiobookChapter, MetadataProviderKey, type MetadataCandidate, type MetadataSeriesMembership } from '@bookorbit/types';

import { parsePublishedDateKey, publishedYearFromDateKey } from '../../../../common/utils/published-date.utils';
import { stripHtml } from '../provider-utils';
import { AudNexusBook, AudNexusChaptersResponse, AudNexusSeriesReference } from './audnexus.types';

function parseSeriesIndex(value: string | number | undefined): number | undefined {
  if (value == null || String(value).trim() === '') return undefined;
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractSeriesMemberships(book: AudNexusBook): MetadataSeriesMembership[] | undefined {
  const memberships: MetadataSeriesMembership[] = [];
  const indexByName = new Map<string, number>();

  const add = (series: AudNexusSeriesReference | undefined) => {
    if (!series) return;
    const seriesName = series.name?.trim();
    if (!seriesName) return;

    const key = seriesName.toLowerCase();
    const seriesIndex = parseSeriesIndex(series.position);
    const existingIndex = indexByName.get(key);
    if (existingIndex !== undefined) {
      if (memberships[existingIndex].seriesIndex == null && seriesIndex !== undefined) {
        memberships[existingIndex].seriesIndex = seriesIndex;
      }
      return;
    }

    indexByName.set(key, memberships.length);
    memberships.push({
      seriesName,
      ...(seriesIndex !== undefined ? { seriesIndex } : {}),
    });
  };

  add(book.seriesPrimary);
  add(book.seriesSecondary);
  add(book.seriesName ? { name: book.seriesName, position: book.seriesPart } : undefined);

  return memberships.length ? memberships : undefined;
}

export function mapAudNexusBook(book: AudNexusBook, chaptersResponse?: AudNexusChaptersResponse): MetadataCandidate {
  const publishedDate = parsePublishedDateKey(book.releaseDate);
  const publishedYear = publishedDate ? publishedYearFromDateKey(publishedDate) : undefined;

  const durationSeconds = book.runtimeLengthMin != null ? book.runtimeLengthMin * 60 : undefined;

  const abridged = book.formatType != null ? book.formatType.toLowerCase() === 'abridged' : undefined;

  const seriesMemberships = extractSeriesMemberships(book);
  const primarySeries = seriesMemberships?.[0];
  const fallbackSeriesIndex = parseSeriesIndex(book.seriesPrimary?.position ?? book.seriesPart);

  const chapters: AudiobookChapter[] | undefined = Array.isArray(chaptersResponse?.chapters)
    ? chaptersResponse.chapters.map((ch) => ({
        title: ch.title,
        startMs: ch.startOffsetMs,
        durationMs: ch.lengthMs,
      }))
    : undefined;

  const description = book.description?.trim() || (book.summary ? stripHtml(book.summary) : undefined);
  const title = book.title ?? book.name ?? '';

  return {
    provider: MetadataProviderKey.AUDNEXUS,
    providerId: book.asin,
    title,
    subtitle: book.subtitle,
    authors: Array.isArray(book.authors) ? book.authors.map((a) => a.name) : [],
    narrators: Array.isArray(book.narrators) ? book.narrators.map((n) => n.name) : [],
    description,
    publisher: book.publisherName,
    publishedDate,
    publishedYear,
    language: book.language,
    coverUrl: book.image,
    durationSeconds,
    abridged,
    audibleId: book.asin,
    seriesName: primarySeries?.seriesName ?? book.seriesPrimary?.name ?? book.seriesName,
    seriesIndex: primarySeries?.seriesIndex ?? fallbackSeriesIndex,
    seriesMemberships,
    chapters,
  };
}
