import { MetadataCandidate } from '@bookorbit/types';

import { candidateHasNormalizedIsbn, normalizeMetadataIsbn } from './isbn-match';
import { MetadataSearchParams } from './providers/metadata-search-params';
import { normalizeTitleText, scoreTitleMatch, shareSignificantToken } from '../../common/text-match/title-match';

const DEFAULT_LIMIT = 5;

export const ISBN_MATCH_SCORE = 100;
export const AUTHOR_MATCH_SCORE = 3;
export const AUTHOR_TOKEN_MATCH_SCORE = 1;

/**
 * The weakest title signal a candidate may rest on. Anything below this is a coincidence rather
 * than a match: a shared word or two out of a longer title, or two unrelated titles that happen to
 * be similar in length. Kept low enough that a typo'd title still resolves through the fuzzy path.
 */
export const MIN_RELEVANCE_SCORE = 3;

const SKIP_TITLE_PATTERNS = [
  /^(summary|study guide|analysis|guide to|workbook|review of|summary of|chapter summary|chapter-by-chapter)\b/i,
  /\b(summary|study guide|book analysis|reading guide|literature guide|workbook|digest|breakdown and analysis)\b/i,
];

/**
 * Scores, filters, and ranks candidates by relevance to the search params.
 *
 * - If no title or author is available in params, returns candidates as-is (no basis for scoring).
 * - ISBN exact match always survives regardless of title/author score.
 * - Candidates below `MIN_RELEVANCE_SCORE` are dropped.
 * - Survivors are sorted descending by score and capped at `limit`.
 */
export function filterAndRank(candidates: MetadataCandidate[], params: MetadataSearchParams, limit = DEFAULT_LIMIT): MetadataCandidate[] {
  if (!hasText(params.title) && !hasText(params.author)) {
    return candidates.slice(0, limit);
  }

  return candidates
    .filter((c) => {
      const matchable = matchableTitle(c);
      return !matchable || !SKIP_TITLE_PATTERNS.some((pattern) => pattern.test(matchable));
    })
    .map((c) => ({ candidate: c, score: scoreCandidate(c, params) }))
    .filter(({ score }) => score >= MIN_RELEVANCE_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

export function scoreCandidate(candidate: MetadataCandidate, params: MetadataSearchParams): number {
  if (params.isbn) {
    const isbn = normalizeMetadataIsbn(params.isbn);
    if (candidateHasNormalizedIsbn(candidate, isbn)) return ISBN_MATCH_SCORE;
  }

  let score = 0;

  const matchable = matchableTitle(candidate);
  if (params.title && matchable) {
    score += scoreTitleMatch(params.title, matchable);
  }

  // Author only boosts when there is already a positive title signal.
  // A matching author alone (e.g. a different book by the same author) is not enough to keep a result.
  if (score > 0 && params.author && candidate.authors?.length) {
    score += scoreAuthor(params.author, candidate.authors);
  }

  return score;
}

/**
 * The string a candidate should be matched against. `displayTitle` carries the provider's own
 * disambiguating label (ComicVine's "<volume> #<issue> - <name>"), which is what a user's query
 * is shaped like; `title` alone can be just an issue name, or absent entirely.
 */
export function matchableTitle(candidate: MetadataCandidate): string | undefined {
  return candidate.displayTitle ?? candidate.title;
}

function scoreAuthor(query: string, candidateAuthors: string[]): number {
  const normalizedQuery = normalizeTitleText(query);
  if (!normalizedQuery) return 0;

  for (const candidateAuthor of candidateAuthors) {
    const normalizedAuthor = normalizeTitleText(candidateAuthor);
    if (!normalizedAuthor) continue;
    if (normalizedAuthor.includes(normalizedQuery) || normalizedQuery.includes(normalizedAuthor)) return AUTHOR_MATCH_SCORE;
  }
  return shareSignificantToken([query], candidateAuthors) ? AUTHOR_TOKEN_MATCH_SCORE : 0;
}

function hasText(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
