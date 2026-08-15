import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { parsePublishedDateKey, parsePublishedYear, publishedYearFromDateKey } from '../../../../common/utils/published-date.utils';
import { normalizeSeriesTotalBooks } from '../../../../common/utils/series-total-books.utils';
import { HardcoverBookWithEditions, HardcoverCachedContributor, HardcoverEdition, HardcoverSearchDocument } from './hardcover.types';

function parseYear(releaseYear: number | undefined | null, releaseDate: string | undefined): number | undefined {
  return parsePublishedYear(releaseYear) ?? parsePublishedYear(releaseDate);
}

function parseDate(releaseYear: number | undefined | null, releaseDate: string | undefined): string | undefined {
  const publishedDate = parsePublishedDateKey(releaseDate);
  if (!publishedDate) return undefined;
  const year = parsePublishedYear(releaseYear);
  return year === undefined || year === publishedYearFromDateKey(publishedDate) ? publishedDate : undefined;
}

function extractAuthorsFromContributors(contributors: HardcoverCachedContributor[] | undefined): string[] {
  if (!contributors) return [];
  return contributors
    .filter(
      (contributor) =>
        contributor.contribution == null ||
        (typeof contributor.contribution === 'string' && contributor.contribution.trim().toLowerCase() === 'author'),
    )
    .map((contributor) => contributor.author?.name)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
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

function resolveEditionPublishedDate(edition: HardcoverEdition, book: HardcoverBookWithEditions): string | undefined {
  return parseDate(edition.release_year, edition.release_date) ?? parseDate(book.release_year, book.release_date);
}

// Hardcover's subtitle field is legacy and unmaintained; librarians embed the
// subtitle in the title separated by a colon. Mirror Hardcover's own display
// rule (confirmed by their developers): split on the first colon once the
// title exceeds 60 characters. Short colon titles like "2001: A Space Odyssey"
// stay untouched. An API-provided subtitle is kept verbatim: it blocks the
// split unless it merely duplicates the embedded part, in which case the
// title is trimmed so the subtitle does not appear twice.
const MAX_UNSPLIT_TITLE_LENGTH = 60;

function splitEmbeddedSubtitle(title: string, subtitle: string | undefined): { title: string; subtitle: string | undefined } {
  if (title.length <= MAX_UNSPLIT_TITLE_LENGTH) return { title, subtitle };
  const colonIndex = title.indexOf(':');
  if (colonIndex === -1) return { title, subtitle };
  const baseTitle = title.slice(0, colonIndex).trim();
  const embeddedSubtitle = title.slice(colonIndex + 1).trim();
  if (!baseTitle || !embeddedSubtitle) return { title, subtitle };
  const providedSubtitle = subtitle?.trim();
  if (!providedSubtitle) return { title: baseTitle, subtitle: embeddedSubtitle };
  if (embeddedSubtitle.toLowerCase() === providedSubtitle.toLowerCase()) return { title: baseTitle, subtitle };
  return { title, subtitle };
}

function normalizeCommunityRating(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5 ? value : undefined;
}

function normalizeCommunityRatingCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function mapSearchDocument(doc: HardcoverSearchDocument): MetadataCandidate {
  const { isbn10, isbn13 } = pickIsbn(doc.isbns);
  const authors = extractAuthorsFromContributors(doc.contributions);
  const communityRating = normalizeCommunityRating(doc.rating);
  const communityRatingCount = normalizeCommunityRatingCount(doc.ratings_count);
  const { title, subtitle } = splitEmbeddedSubtitle(doc.title, doc.subtitle);

  return {
    provider: MetadataProviderKey.HARDCOVER,
    providerId: doc.slug,
    title,
    subtitle,
    description: doc.description,
    ...(authors.length > 0 ? { authors } : {}),
    pageCount: doc.pages,
    publishedDate: parseDate(doc.release_year, doc.release_date),
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
  const { title, subtitle } = splitEmbeddedSubtitle(edition.title ?? book.title, edition.subtitle ?? book.subtitle);

  return {
    provider: MetadataProviderKey.HARDCOVER,
    providerId: book.slug,
    hardcoverEditionId: String(edition.id),
    title,
    subtitle,
    description: book.description,
    ...(authors.length > 0 ? { authors } : {}),
    publisher: edition.publisher?.name,
    language: edition.language?.code2,
    pageCount: isAudiobookEdition(edition) ? undefined : (edition.pages ?? book.pages),
    publishedDate: resolveEditionPublishedDate(edition, book),
    publishedYear: resolveEditionPublishedYear(edition, book),
    isbn10: edition.isbn_10,
    isbn13: edition.isbn_13,
    seriesName: book.featured_book_series?.series?.name,
    seriesIndex: book.featured_book_series?.position ?? undefined,
    seriesTotalBooks: normalizeSeriesTotalBooks(book.featured_book_series?.series?.books_count),
    coverUrl: edition.image?.url ?? book.image?.url,
    sourceUrl: `https://hardcover.app/books/${book.slug}`,
    ...(communityRating !== undefined ? { communityRating } : {}),
    ...(communityRatingCount !== undefined ? { communityRatingCount } : {}),
  };
}
