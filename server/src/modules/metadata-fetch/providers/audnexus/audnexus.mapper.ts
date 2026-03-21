import { AudiobookChapter, MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import { AudNexusBook, AudNexusChaptersResponse } from './audnexus.types';

export function mapAudNexusBook(book: AudNexusBook, chaptersResponse?: AudNexusChaptersResponse): MetadataCandidate {
  let publishedYear: number | undefined;
  if (book.releaseDate) {
    const year = new Date(book.releaseDate).getFullYear();
    if (!isNaN(year)) publishedYear = year;
  }

  const durationSeconds = book.runtimeLengthMin != null ? book.runtimeLengthMin * 60 : undefined;

  const abridged = book.formatType != null ? book.formatType.toLowerCase() === 'abridged' : undefined;

  const seriesIndex = book.seriesPart != null ? parseFloat(book.seriesPart) : undefined;

  const chapters: AudiobookChapter[] | undefined = chaptersResponse?.chapters?.map((ch) => ({
    title: ch.title,
    startMs: ch.startOffsetMs,
    durationMs: ch.lengthMs,
  }));

  return {
    provider: MetadataProviderKey.AUDNEXUS,
    providerId: book.asin,
    title: book.name,
    authors: book.authors?.map((a) => a.name) ?? [],
    narrators: book.narrators?.map((n) => n.name) ?? [],
    description: book.summary,
    publisher: book.publisherName,
    publishedYear,
    language: book.language,
    coverUrl: book.image,
    durationSeconds,
    abridged,
    audibleId: book.asin,
    seriesName: book.seriesName,
    seriesIndex: !isNaN(seriesIndex ?? NaN) ? seriesIndex : undefined,
    chapters,
  };
}
