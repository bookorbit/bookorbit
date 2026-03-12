import { MetadataCandidate, MetadataProviderKey } from '@projectx/types';
import { ITunesResult } from './itunes.types';

export function mapITunesResult(result: ITunesResult): MetadataCandidate {
  // The high-res trick: replace 100x100 with 1000x1000
  const coverUrl = result.artworkUrl100?.replace('100x100bb.jpg', '1000x1000bb.jpg');

  const publishedYear = result.releaseDate ? new Date(result.releaseDate).getFullYear() : undefined;

  return {
    provider: MetadataProviderKey.ITUNES,
    providerId: result.trackId.toString(),
    title: result.trackName,
    authors: [result.artistName],
    description: result.description,
    publisher: result.sellerName,
    publishedYear,
    language: result.languageCodesISO2A?.[0],
    genres: result.genres,
    coverUrl,
    sourceUrl: result.trackViewUrl,
  };
}
