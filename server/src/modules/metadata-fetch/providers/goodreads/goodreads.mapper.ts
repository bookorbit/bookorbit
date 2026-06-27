import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import {
  GoodreadsApolloBook,
  GoodreadsApolloContributor,
  GoodreadsApolloSeries,
  GoodreadsApolloWork,
  GoodreadsAutocompleteItem,
} from './goodreads.types';

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
  const work = findWork(state, book.work?.__ref);

  const genres = (book.bookGenres ?? []).map((g) => g.genre?.name).filter((n): n is string => !!n);

  const { title, subtitle } = splitTitle(book.title);

  const publishedYear = parseEpochYear(details?.publicationTime);
  const pageCount = parsePositiveInt(details?.numPages);
  const seriesIndex = parseSeriesIndex(firstSeries?.userPosition);
  const communityRating = normalizeCommunityRating(work?.stats?.averageRating);
  const communityRatingCount = normalizeCommunityRatingCount(work?.stats?.ratingsCount);

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
    ...(communityRating !== undefined ? { communityRating } : {}),
    ...(communityRatingCount !== undefined ? { communityRatingCount } : {}),
  };
}

export function mapGoodreadsAutocompleteItem(item: GoodreadsAutocompleteItem, bookId: string): MetadataCandidate | null {
  const rawTitle = normalize(item.bookTitleBare) ?? normalize(stripSeriesSuffix(item.title));
  if (!rawTitle) return null;

  const { title, subtitle } = splitTitle(rawTitle);
  const authorName = normalize(typeof item.author === 'string' ? item.author : item.author?.name);
  const { seriesName, seriesIndex } = parseSeriesFromTitle(item.title);
  const communityRating = normalizeCommunityRating(item.avgRating);
  const communityRatingCount = normalizeCommunityRatingCount(item.ratingsCount);

  return {
    provider: MetadataProviderKey.GOODREADS,
    providerId: bookId,
    title,
    subtitle,
    authors: authorName ? [authorName] : undefined,
    description: extractAutocompleteDescription(item.description),
    pageCount: parsePositiveInt(item.numPages),
    coverUrl: upgradeCoverUrl(item.imageUrl),
    sourceUrl: `https://www.goodreads.com/book/show/${bookId}`,
    seriesName,
    seriesIndex,
    ...(communityRating !== undefined ? { communityRating } : {}),
    ...(communityRatingCount !== undefined ? { communityRatingCount } : {}),
  };
}

// Autocomplete cover URLs carry a thumbnail size token (e.g. `._SY75_`).
// Stripping it yields the full-resolution image.
function upgradeCoverUrl(url: string | undefined): string | undefined {
  const normalized = normalize(url);
  return normalized ? normalized.replace(/\._S[XY]\d+_\./, '.') : undefined;
}

function stripSeriesSuffix(title: string | undefined): string | undefined {
  return title?.replace(/\s*\([^,(]+,\s*#[\d.]+\)\s*$/, '').trim();
}

function parseSeriesFromTitle(title: string | undefined): { seriesName?: string; seriesIndex?: number } {
  const match = title?.match(/\(([^,(]+),\s*#([\d.]+)\)\s*$/);
  if (!match) return {};
  return { seriesName: normalize(match[1]), seriesIndex: parseSeriesIndex(match[2]) };
}

function extractAutocompleteDescription(description: GoodreadsAutocompleteItem['description']): string | undefined {
  const html = typeof description === 'string' ? description : description?.html;
  if (!html) return undefined;
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&(?:#39|#x27|apos);/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
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

function findWork(state: Record<string, unknown>, ref: string | undefined): GoodreadsApolloWork | undefined {
  if (!ref) return undefined;
  return state[ref] as GoodreadsApolloWork | undefined;
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

function normalizeCommunityRating(value: string | number | undefined): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : undefined;
}

function normalizeCommunityRatingCount(value: string | number | undefined): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const normalized = typeof value === 'string' ? value.replace(/,/g, '') : value;
  const n = typeof normalized === 'string' ? Number(normalized) : normalized;
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

function parseSeriesIndex(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseFloat(value);
  return Number.isNaN(n) ? undefined : n;
}
