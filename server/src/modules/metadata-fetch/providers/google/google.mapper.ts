import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { parsePublishedDateKey, parsePublishedYear, publishedYearFromDateKey } from '../../../../common/utils/published-date.utils';
import { GoogleVolumeItem } from './google.types';

function parseYear(dateString: string | undefined): number | undefined {
  return parsePublishedYear(dateString);
}

function normalizeCommunityRating(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5 ? value : undefined;
}

function normalizeCommunityRatingCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function mapGoogleVolume(raw: GoogleVolumeItem): MetadataCandidate {
  const info = raw.volumeInfo;
  const identifiers = info.industryIdentifiers ?? [];

  const publishedDate = parsePublishedDateKey(info.publishedDate);
  const publishedYear = publishedDate ? publishedYearFromDateKey(publishedDate) : parseYear(info.publishedDate);

  const isbn10 = identifiers.find((i) => i.type === 'ISBN_10')?.identifier;
  const isbn13 = identifiers.find((i) => i.type === 'ISBN_13')?.identifier;

  const coverUrl = info.imageLinks?.thumbnail
    ? info.imageLinks.thumbnail.replace('http://', 'https://').replace('&edge=curl', '').replace('zoom=1', 'zoom=0')
    : undefined;
  const communityRating = normalizeCommunityRating(info.averageRating);
  const communityRatingCount = normalizeCommunityRatingCount(info.ratingsCount);

  return {
    provider: MetadataProviderKey.GOOGLE,
    providerId: raw.id,
    title: info.title,
    subtitle: info.subtitle,
    authors: info.authors,
    description: info.description,
    publisher: info.publisher,
    publishedDate,
    publishedYear,
    language: info.language,
    pageCount: info.pageCount,
    isbn10,
    isbn13,
    genres: info.categories,
    coverUrl,
    sourceUrl: `https://books.google.com/books?id=${raw.id}`,
    ...(communityRating !== undefined ? { communityRating } : {}),
    ...(communityRatingCount !== undefined ? { communityRatingCount } : {}),
  };
}
