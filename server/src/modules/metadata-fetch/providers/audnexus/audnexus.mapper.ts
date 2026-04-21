import { AudiobookChapter, MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { stripHtml } from '../provider-utils';
import { AudNexusBook, AudNexusChaptersResponse } from './audnexus.types';

export function mapAudNexusBook(book: AudNexusBook, chaptersResponse?: AudNexusChaptersResponse): MetadataCandidate {
  let publishedYear: number | undefined;
  if (book.releaseDate) {
    const year = new Date(book.releaseDate).getFullYear();
    if (!isNaN(year)) publishedYear = year;
  }

  const durationSeconds = book.runtimeLengthMin != null ? book.runtimeLengthMin * 60 : undefined;

  const abridged = book.formatType != null ? book.formatType.toLowerCase() === 'abridged' : undefined;

  const seriesRaw = book.seriesPrimary?.position ?? book.seriesPart;
  const seriesIndex = seriesRaw != null ? parseFloat(String(seriesRaw)) : undefined;

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
    publishedYear,
    language: book.language,
    coverUrl: book.image,
    durationSeconds,
    abridged,
    audibleId: book.asin,
    seriesName: book.seriesPrimary?.name ?? book.seriesName,
    seriesIndex: !isNaN(seriesIndex ?? NaN) ? seriesIndex : undefined,
    chapters,
  };
}
