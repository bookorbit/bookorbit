import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { HardcoverBookWithEditions, HardcoverCachedContributor, HardcoverEdition, HardcoverSearchDocument } from './hardcover.types';

function parseYear(releaseYear: number | undefined | null, releaseDate: string | undefined): number | undefined {
  if (releaseYear != null) return releaseYear;
  if (!releaseDate) return undefined;
  const year = parseInt(releaseDate.substring(0, 4), 10);
  return Number.isNaN(year) ? undefined : year;
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

export function mapSearchDocument(doc: HardcoverSearchDocument): MetadataCandidate {
  const { isbn10, isbn13 } = pickIsbn(doc.isbns);

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
  };
}

export function mapBookWithEditions(book: HardcoverBookWithEditions): MetadataCandidate[] {
  if (!book.editions || book.editions.length === 0) return [];
  return book.editions.map((edition) => mapEdition(edition, book));
}

function mapEdition(edition: HardcoverEdition, book: HardcoverBookWithEditions): MetadataCandidate {
  const editionAuthors = extractAuthorsFromContributors(edition.cached_contributors);
  const authors = editionAuthors.length > 0 ? editionAuthors : extractAuthorsFromContributors(book.cached_contributors);

  return {
    provider: MetadataProviderKey.HARDCOVER,
    providerId: book.slug,
    title: edition.title ?? book.title,
    subtitle: edition.subtitle ?? book.subtitle,
    description: book.description,
    authors,
    publisher: edition.publisher?.name,
    language: edition.language?.code2,
    pageCount: edition.pages ?? book.pages,
    publishedYear: parseYear(edition.release_year ?? book.release_year, edition.release_date ?? book.release_date),
    isbn10: edition.isbn_10,
    isbn13: edition.isbn_13,
    seriesName: book.featured_book_series?.series?.name,
    seriesIndex: book.featured_book_series?.position ?? undefined,
    coverUrl: edition.image?.url ?? book.image?.url,
    sourceUrl: `https://hardcover.app/books/${book.slug}`,
  };
}
