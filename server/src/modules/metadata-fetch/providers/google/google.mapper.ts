import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { GoogleVolumeItem } from './google.types';

function parseYear(dateString: string | undefined): number | undefined {
  if (!dateString) return undefined;
  const year = parseInt(dateString.substring(0, 4), 10);
  return Number.isNaN(year) ? undefined : year;
}

export function mapGoogleVolume(raw: GoogleVolumeItem): MetadataCandidate {
  const info = raw.volumeInfo;
  const identifiers = info.industryIdentifiers ?? [];

  const publishedYear = parseYear(info.publishedDate);

  const isbn10 = identifiers.find((i) => i.type === 'ISBN_10')?.identifier;
  const isbn13 = identifiers.find((i) => i.type === 'ISBN_13')?.identifier;

  const coverUrl = info.imageLinks?.thumbnail
    ? info.imageLinks.thumbnail.replace('http://', 'https://').replace('&edge=curl', '').replace('zoom=1', 'zoom=0')
    : undefined;

  return {
    provider: MetadataProviderKey.GOOGLE,
    providerId: raw.id,
    title: info.title,
    subtitle: info.subtitle,
    authors: info.authors,
    description: info.description,
    publisher: info.publisher,
    publishedYear,
    language: info.language,
    pageCount: info.pageCount,
    isbn10,
    isbn13,
    genres: info.categories,
    coverUrl,
    sourceUrl: `https://books.google.com/books?id=${raw.id}`,
  };
}
