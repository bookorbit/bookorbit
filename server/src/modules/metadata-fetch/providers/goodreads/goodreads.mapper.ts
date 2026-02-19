import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';

import {
  GoodreadsApolloBook,
  GoodreadsApolloContributor,
  GoodreadsApolloSeries,
} from './goodreads.types';

export function mapGoodreadsApolloState(
  state: Record<string, unknown>,
  bookId: string,
): MetadataCandidate | null {
  const book = findByKeyPrefix<GoodreadsApolloBook>(state, 'Book:kca:');
  if (!book?.title) return null;

  const contributor = findByKeyPrefix<GoodreadsApolloContributor>(state, 'Contributor:kca');
  const series = findByKeyPrefix<GoodreadsApolloSeries>(state, 'Series:kca');

  const details = book.details;
  const firstSeries = book.bookSeries?.[0];

  const tags = (book.bookGenres ?? [])
    .map((g) => g.genre?.name)
    .filter((n): n is string => !!n);

  const { title, subtitle } = splitTitle(book.title);

  const publishedYear = parseEpochYear(details?.publicationTime);
  const pageCount = parsePositiveInt(details?.numPages);
  const seriesIndex = parseSeriesIndex(firstSeries?.userPosition);

  return {
    provider: MetadataProviderKey.GOODREADS,
    providerId: bookId,
    title,
    subtitle,
    authors: contributor?.name ? [contributor.name] : undefined,
    description: normalize(book.description),
    publisher: normalize(details?.publisher),
    publishedYear,
    language: normalize(details?.language?.name),
    pageCount,
    isbn10: normalize(details?.isbn),
    isbn13: normalize(details?.isbn13),
    tags: tags.length ? tags : undefined,
    coverUrl: book.imageUrl,
    sourceUrl: `https://www.goodreads.com/book/show/${bookId}`,
    seriesName: normalize(series?.title),
    seriesIndex,
  };
}

function findByKeyPrefix<T>(state: Record<string, unknown>, prefix: string): T | undefined {
  const key = Object.keys(state).find((k) => k.includes(prefix));
  return key ? (state[key] as T) : undefined;
}

function splitTitle(fullTitle: string): { title: string; subtitle?: string } {
  const colon = fullTitle.indexOf(':');
  if (colon > 0) {
    return {
      title: fullTitle.substring(0, colon).trim(),
      subtitle: fullTitle.substring(colon + 1).trim(),
    };
  }
  return { title: fullTitle };
}

function normalize(value: string | undefined | null): string | undefined {
  if (!value || value === 'null') return undefined;
  return value.trim() || undefined;
}

function parseEpochYear(value: string | number | undefined): number | undefined {
  if (value == null) return undefined;
  const ms = typeof value === 'string' ? parseFloat(value) : value;
  if (!ms || Number.isNaN(ms)) return undefined;
  return new Date(ms).getFullYear();
}

function parsePositiveInt(value: string | number | undefined): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === 'string' ? parseInt(value, 10) : Math.round(value);
  return n > 0 && !Number.isNaN(n) ? n : undefined;
}

function parseSeriesIndex(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseFloat(value);
  return Number.isNaN(n) ? undefined : n;
}
