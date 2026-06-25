import { MetadataCandidate, MetadataProviderKey, type ITunesCoverResolution } from '@bookorbit/types';
import { ITunesResult } from './itunes.types';

function mapCoverUrl(artworkUrl100: string | undefined, coverResolution: ITunesCoverResolution): string | undefined {
  if (!artworkUrl100) return undefined;
  if (!artworkUrl100.includes('100x100bb.jpg')) return artworkUrl100;

  const target = coverResolution === 'high' ? '10000x10000bb.jpg' : '600x600bb.jpg';
  return artworkUrl100.replace('100x100bb.jpg', target);
}

function normalizeCommunityRating(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5 ? value : undefined;
}

function normalizeCommunityRatingCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function mapITunesResult(result: ITunesResult, coverResolution: ITunesCoverResolution = 'high'): MetadataCandidate {
  const coverUrl = mapCoverUrl(result.artworkUrl100, coverResolution);

  const publishedYear = result.releaseDate ? new Date(result.releaseDate).getFullYear() : undefined;

  const providerId = (result.trackId ?? result.collectionId)?.toString();
  if (!providerId) {
    throw new Error('iTunes result missing both trackId and collectionId');
  }
  const communityRating = normalizeCommunityRating(result.averageUserRating);
  const communityRatingCount = normalizeCommunityRatingCount(result.userRatingCount);

  return {
    provider: MetadataProviderKey.ITUNES,
    providerId,
    title: result.trackName ?? result.collectionName ?? '',
    authors: result.artistName ? [result.artistName] : [],
    description: result.description,
    publisher: result.sellerName,
    publishedYear,
    language: result.languageCodesISO2A?.[0],
    genres: result.genres,
    coverUrl,
    sourceUrl: result.trackViewUrl ?? result.collectionViewUrl,
    ...(communityRating !== undefined ? { communityRating } : {}),
    ...(communityRatingCount !== undefined ? { communityRatingCount } : {}),
  };
}
