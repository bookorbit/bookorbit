import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { GoodreadsApolloBook, GoodreadsApolloContributor, GoodreadsApolloSeries } from './goodreads.types';

export function mapGoodreadsApolloState(state: Record<string, unknown>, bookId: string): MetadataCandidate | null {
  const book = findBook(state, bookId);
  if (!book?.title) return null;

  const firstSeries = book.bookSeries?.[0];
  const seriesRef = firstSeries?.series?.__ref;
  const series = findSeries(state, seriesRef) ?? firstSeries?.series;

  const primaryContributorRef = book.primaryContributorEdge?.node?.__ref;
  const contributor = findContributor(state, primaryContributorRef);
  const authorName = contributor?.name;

  const details = book.details;

  const genres = (book.bookGenres ?? []).map((g) => g.genre?.name).filter((n): n is string => !!n);

  const { title, subtitle } = splitTitle(book.title);

  const publishedYear = parseEpochYear(details?.publicationTime);
  const pageCount = parsePositiveInt(details?.numPages);
  const seriesIndex = parseSeriesIndex(firstSeries?.userPosition);

  return {
    provider: MetadataProviderKey.GOODREADS,
    providerId: bookId,
    title,
    subtitle,
    authors: authorName ? [authorName] : undefined,
    description: normalize(book.description),
    publisher: normalize(details?.publisher),
    publishedYear,
    language: normalize(details?.language?.name),
    pageCount,
    isbn10: normalize(details?.isbn),
    isbn13: normalize(details?.isbn13),
    genres: genres.length ? genres : undefined,
    coverUrl: book.imageUrl,
    sourceUrl: `https://www.goodreads.com/book/show/${bookId}`,
    seriesName: normalize(series?.title),
    seriesIndex,
  };
}

function findByKeyPrefix<T>(state: Record<string, unknown>, prefix: string): T | undefined {
  const key = Object.keys(state).find((k) => k.startsWith(prefix));
  return key ? (state[key] as T) : undefined;
}

function findBook(state: Record<string, unknown>, bookId: string): GoodreadsApolloBook | undefined {
  const exact = state[`Book:kca:${bookId}`] as GoodreadsApolloBook | undefined;
  if (isTitledBook(exact)) return exact;

  const books = Object.keys(state)
    .filter((key) => key.startsWith('Book:kca:'))
    .map((key) => state[key] as GoodreadsApolloBook | undefined)
    .filter((book): book is GoodreadsApolloBook => !!book);

  const legacyMatch = books.find((book) => isTitledBook(book) && String(book.legacyId) === bookId);
  if (legacyMatch) return legacyMatch;

  return books.filter(isTitledBook).sort((a, b) => scoreBookShape(b) - scoreBookShape(a))[0];
}

function isTitledBook(book: GoodreadsApolloBook | undefined): book is GoodreadsApolloBook & { title: string } {
  return typeof book?.title === 'string' && book.title.trim().length > 0;
}

function scoreBookShape(book: GoodreadsApolloBook): number {
  let score = 0;
  if (book.title) score += 8;
  if (book.description) score += 4;
  if (book.details) score += 4;
  if (book.primaryContributorEdge) score += 2;
  if (book.bookGenres?.length) score += 2;
  if (book.imageUrl) score += 2;
  if (book.bookSeries?.length) score += 1;
  return score;
}

function findContributor(state: Record<string, unknown>, ref: string | undefined): GoodreadsApolloContributor | undefined {
  if (ref) {
    return state[ref] as GoodreadsApolloContributor | undefined;
  }
  const key = Object.keys(state).find((k) => k.startsWith('Contributor:kca') && !!(state[k] as GoodreadsApolloContributor)?.name);
  return key ? (state[key] as GoodreadsApolloContributor) : undefined;
}

function findSeries(state: Record<string, unknown>, ref: string | undefined): GoodreadsApolloSeries | undefined {
  if (ref) {
    return state[ref] as GoodreadsApolloSeries | undefined;
  }
  return findByKeyPrefix<GoodreadsApolloSeries>(state, 'Series:kca');
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
