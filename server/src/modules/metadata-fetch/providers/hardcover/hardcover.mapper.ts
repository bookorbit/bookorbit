import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { HardcoverBookWithEditions, HardcoverCachedContributor, HardcoverEdition, HardcoverSearchDocument } from './hardcover.types';

function parseYear(releaseYear: number | undefined | null, releaseDate: string | undefined): number | undefined {
  if (releaseYear != null) {
    return releaseYear >= 1000 && releaseYear <= 2200 ? releaseYear : undefined;
  }
  if (!releaseDate) return undefined;
  const year = parseInt(releaseDate.substring(0, 4), 10);
  if (Number.isNaN(year) || year < 1000 || year > 2200) return undefined;
  return year;
}

function extractAuthorsFromContributors(contributors: HardcoverCachedContributor[] | undefined): string[] {
  if (!contributors) return [];
  return contributors.map((c) => c.author?.name).filter((n): n is string => n != null);
}

function pickIsbn(isbns: string[] | undefined): { isbn10?: string; isbn13?: string } {
  if (!isbns) return {};
  return {
    isbn13: isbns.find((i) => i.length === 13),
    isbn10: isbns.find((i) => i.length === 10),
  };
}

// Hardcover reading_format_id: 1 = physical, 2 = audiobook, 4 = ebook.
const AUDIOBOOK_READING_FORMAT_ID = 2;

function isAudiobookEdition(edition: HardcoverEdition): boolean {
  return edition.reading_format_id === AUDIOBOOK_READING_FORMAT_ID || (edition.audio_seconds ?? 0) > 0;
}

// Lower rank sorts first: physical/ebook before audiobooks, and editions with a
// real page count before those without.
function editionRank(edition: HardcoverEdition): number {
  return (isAudiobookEdition(edition) ? 2 : 0) + (edition.pages == null ? 1 : 0);
}

function resolveEditionPublishedYear(edition: HardcoverEdition, book: HardcoverBookWithEditions): number | undefined {
  return parseYear(edition.release_year, edition.release_date) ?? parseYear(book.release_year, book.release_date);
}

function normalizeCommunityRating(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5 ? value : undefined;
}

function normalizeCommunityRatingCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function mapSearchDocument(doc: HardcoverSearchDocument): MetadataCandidate {
  const { isbn10, isbn13 } = pickIsbn(doc.isbns);
  const communityRating = normalizeCommunityRating(doc.rating);
  const communityRatingCount = normalizeCommunityRatingCount(doc.ratings_count);

  return {
    provider: MetadataProviderKey.HARDCOVER,
    providerId: doc.slug,
    title: doc.title,
    subtitle: doc.subtitle,
    description: doc.description,
    authors: doc.author_names ?? [],
    pageCount: doc.pages,
    publishedYear: parseYear(doc.release_year, doc.release_date),
    isbn10,
    isbn13,
    genres: doc.genres,
    seriesName: doc.featured_series?.series?.name,
    seriesIndex: doc.featured_series?.position ?? undefined,
    coverUrl: doc.image?.url,
    sourceUrl: `https://hardcover.app/books/${doc.slug}`,
    ...(communityRating !== undefined ? { communityRating } : {}),
    ...(communityRatingCount !== undefined ? { communityRatingCount } : {}),
  };
}

export function mapBookWithEditions(book: HardcoverBookWithEditions): MetadataCandidate[] {
  if (!book.editions || book.editions.length === 0) return [];
  return [...book.editions].sort((a, b) => editionRank(a) - editionRank(b)).map((edition) => mapEdition(edition, book));
}

function mapEdition(edition: HardcoverEdition, book: HardcoverBookWithEditions): MetadataCandidate {
  const editionAuthors = extractAuthorsFromContributors(edition.cached_contributors);
  const authors = editionAuthors.length > 0 ? editionAuthors : extractAuthorsFromContributors(book.cached_contributors);
  const communityRating = normalizeCommunityRating(book.rating);
  const communityRatingCount = normalizeCommunityRatingCount(book.ratings_count);

  return {
    provider: MetadataProviderKey.HARDCOVER,
    providerId: book.slug,
    hardcoverEditionId: String(edition.id),
    title: edition.title ?? book.title,
    subtitle: edition.subtitle ?? book.subtitle,
    description: book.description,
    authors,
    publisher: edition.publisher?.name,
    language: edition.language?.code2,
    pageCount: isAudiobookEdition(edition) ? undefined : (edition.pages ?? book.pages),
    publishedYear: resolveEditionPublishedYear(edition, book),
    isbn10: edition.isbn_10,
    isbn13: edition.isbn_13,
    seriesName: book.featured_book_series?.series?.name,
    seriesIndex: book.featured_book_series?.position ?? undefined,
    coverUrl: edition.image?.url ?? book.image?.url,
    sourceUrl: `https://hardcover.app/books/${book.slug}`,
    ...(communityRating !== undefined ? { communityRating } : {}),
    ...(communityRatingCount !== undefined ? { communityRatingCount } : {}),
  };
}
