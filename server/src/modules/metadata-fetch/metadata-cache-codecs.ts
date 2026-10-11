import type { MetadataCandidate } from '@bookorbit/types';

import { parseFields, pickAllowed, type CacheCodec, type CacheFieldKind } from '../../common/provider-cache/cache-codec';

/**
 * Every candidate field the cache may store, with its JSON type. Typed as a full record so adding a
 * field to `MetadataCandidate` fails to compile until it is listed here, instead of silently
 * vanishing from cached answers.
 */
const CANDIDATE_FIELDS: Record<keyof MetadataCandidate, CacheFieldKind> = {
  provider: 'string',
  providerId: 'string',
  hardcoverEditionId: 'string',
  title: 'string',
  displayTitle: 'string',
  subtitle: 'string',
  authors: 'string[]',
  description: 'string',
  publisher: 'string',
  publishedDate: 'string',
  publishedYear: 'number',
  language: 'string',
  pageCount: 'number',
  isbn10: 'string',
  isbn13: 'string',
  seriesName: 'string',
  seriesIndex: 'string',
  seriesTotalBooks: 'number',
  seriesMemberships: 'object[]',
  genres: 'string[]',
  coverUrl: 'string',
  coverShape: 'string',
  coverWidth: 'number',
  coverHeight: 'number',
  sourceUrl: 'string',
  narrators: 'string[]',
  durationSeconds: 'number',
  abridged: 'boolean',
  audibleId: 'string',
  chapters: 'object[]',
  comicMetadata: 'object',
  communityRating: 'number',
  communityRatingCount: 'number',
};

function sanitizeCandidate(candidate: MetadataCandidate): MetadataCandidate {
  return pickAllowed(candidate, CANDIDATE_FIELDS);
}

function parseCandidate(value: unknown): MetadataCandidate | null {
  return parseFields<MetadataCandidate>(value, CANDIDATE_FIELDS, ['provider', 'providerId']);
}

function candidateDates(candidate: MetadataCandidate): string[] {
  if (typeof candidate.publishedDate === 'string' && candidate.publishedDate) return [candidate.publishedDate];
  if (typeof candidate.publishedYear === 'number' && candidate.publishedYear) return [String(candidate.publishedYear)];
  return [];
}

export const bookSearchCodec: CacheCodec<MetadataCandidate[]> = {
  isEmpty: (value) => value.length === 0,
  sanitize: (value) => value.map(sanitizeCandidate),
  parse: (payload) => {
    if (!Array.isArray(payload)) return undefined;
    const parsed = payload.map(parseCandidate);
    return parsed.every((candidate): candidate is MetadataCandidate => candidate !== null) ? parsed : undefined;
  },
  slice: (value, max) => value.slice(0, max),
  publishedDates: (value) => value.flatMap(candidateDates),
};

export const bookLookupCodec: CacheCodec<MetadataCandidate | null> = {
  isEmpty: (value) => value === null,
  sanitize: (value) => (value ? sanitizeCandidate(value) : null),
  parse: (payload) => (payload === null ? null : (parseCandidate(payload) ?? undefined)),
  slice: (value) => value,
  publishedDates: (value) => (value ? candidateDates(value) : []),
};
