import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { OpenLibraryDoc, OpenLibraryTextValue, OpenLibraryWork } from './open-library.types';

function extractDescription(raw: string | OpenLibraryTextValue | undefined): string | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return raw;
  return raw.value;
}

function stripWorkPrefix(key: string): string {
  return key.replace(/^\/works\//, '');
}

function parseYear(dateString: string | undefined): number | undefined {
  if (!dateString) return undefined;
  const year = parseInt(dateString.substring(0, 4), 10);
  return Number.isNaN(year) ? undefined : year;
}

function coverUrl(coverId: number | undefined): string | undefined {
  if (!coverId) return undefined;
  return `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
}

export function mapOpenLibraryDoc(raw: OpenLibraryDoc): MetadataCandidate {
  const isbn10 = raw.isbn?.find((i) => i.length === 10);
  const isbn13 = raw.isbn?.find((i) => i.length === 13);
  const providerId = stripWorkPrefix(raw.key);

  return {
    provider: MetadataProviderKey.OPEN_LIBRARY,
    providerId,
    title: raw.title,
    authors: raw.author_name,
    publishedYear: raw.first_publish_year,
    isbn10,
    isbn13,
    publisher: raw.publisher?.[0],
    language: raw.language?.[0],
    pageCount: raw.number_of_pages_median,
    genres: raw.subject?.slice(0, 10),
    coverUrl: coverUrl(raw.cover_i),
    sourceUrl: `https://openlibrary.org${raw.key}`,
  };
}

export function mapOpenLibraryWork(raw: OpenLibraryWork): MetadataCandidate {
  const providerId = stripWorkPrefix(raw.key);
  const firstCover = raw.covers?.[0];

  return {
    provider: MetadataProviderKey.OPEN_LIBRARY,
    providerId,
    title: raw.title,
    description: extractDescription(raw.description),
    publishedYear: parseYear(raw.first_publish_date),
    genres: raw.subjects?.slice(0, 10),
    coverUrl: coverUrl(firstCover),
    sourceUrl: `https://openlibrary.org${raw.key}`,
  };
}
