import type { AuthorMetadataCandidate } from '@bookorbit/types';

import { parseFields, pickAllowed, type CacheCodec, type CacheFieldKind } from '../../../common/provider-cache/cache-codec';

/**
 * Every candidate field the cache may store, with its JSON type. Typed as a full record so adding a
 * field to `AuthorMetadataCandidate` fails to compile until it is listed here, instead of silently
 * vanishing from cached answers.
 */
export const AUTHOR_CANDIDATE_FIELDS: Record<keyof AuthorMetadataCandidate, CacheFieldKind> = {
  provider: 'string',
  providerId: 'string',
  name: 'string',
  description: 'string',
  imageUrl: 'string',
  sourceUrl: 'string',
  birthDate: 'string',
  birthYear: 'number',
  deathDate: 'string',
  deathYear: 'number',
  website: 'string',
  genres: 'string[]',
  influences: 'string[]',
};

function sanitizeCandidate(candidate: AuthorMetadataCandidate): AuthorMetadataCandidate {
  return pickAllowed(candidate, AUTHOR_CANDIDATE_FIELDS);
}

function parseCandidate(value: unknown): AuthorMetadataCandidate | null {
  return parseFields<AuthorMetadataCandidate>(value, AUTHOR_CANDIDATE_FIELDS, ['provider', 'providerId', 'name']);
}

export const authorSearchCodec: CacheCodec<AuthorMetadataCandidate[]> = {
  isEmpty: (value) => value.length === 0,
  sanitize: (value) => value.map(sanitizeCandidate),
  parse: (payload) => {
    if (!Array.isArray(payload)) return undefined;
    const parsed = payload.map(parseCandidate);
    return parsed.every((candidate): candidate is AuthorMetadataCandidate => candidate !== null) ? parsed : undefined;
  },
  slice: (value, max) => value.slice(0, max),
  publishedDates: () => [],
};

export const authorLookupCodec: CacheCodec<AuthorMetadataCandidate | null> = {
  isEmpty: (value) => value === null,
  sanitize: (value) => (value ? sanitizeCandidate(value) : null),
  parse: (payload) => (payload === null ? null : (parseCandidate(payload) ?? undefined)),
  slice: (value) => value,
  publishedDates: () => [],
};
