import { MetadataProviderKey, type MetadataCandidate } from '@bookorbit/types';

import { candidateHasNormalizedIsbn, normalizeMetadataIsbn } from './isbn-match';
import { MetadataSearchParams } from './providers/metadata-search-params';
import { scoreComicVineIssue } from './providers/comicvine/comicvine.matching';
import { normalizeTitleText, scoreTitleMatch, shareSignificantToken } from '../../common/text-match/title-match';

const DEFAULT_LIMIT = 5;

export const ISBN_MATCH_SCORE = 100;
export const AUTHOR_MATCH_SCORE = 3;
export const AUTHOR_TOKEN_MATCH_SCORE = 1;
/**
 * What a candidate of another medium than the book loses in ranking. Enough to put "The Faraway
 * Paladin: The Boy in the City of the Dead" (the novel) above "The Faraway Paladin (Manga) Volume 1"
 * for an EPUB searched as "The Faraway Paladin Volume 1", not enough to outrank a query that names
 * the manga outright.
 */
export const MEDIUM_MISMATCH_PENALTY = 3;

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
    .map((ranked) => ({ ...ranked, rank: ranked.score - mediumPenalty(ranked.candidate, params) }))
    .sort((a, b) => b.rank - a.rank)
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
  const comicScore = candidate.provider === MetadataProviderKey.COMICVINE ? scoreComicVineIssue(candidate, params) : null;
  if (comicScore !== null) score = comicScore;
  else if (params.title && matchable) score = scoreTitleMatch(params.title, matchable);

  // When a title was supplied, author remains a boost and cannot rescue an unrelated title.
  // Without a title, an exact or containing author match is strong enough to stand on its own.
  if ((!params.title || score > 0) && params.author && candidate.authors?.length) {
    score += scoreAuthor(params.author, candidate.authors);
  }

  return score;
}

/**
 * `scoreCandidate` adjusted for the book's medium: what orders candidates. A candidate whose provider
 * says it is another medium than the book drops below an equally relevant one, but the relevance
 * floor is applied to the unadjusted score, so a mislabelled record is never lost over it.
 */
export function rankCandidate(candidate: MetadataCandidate, params: MetadataSearchParams): number {
  return scoreCandidate(candidate, params) - mediumPenalty(candidate, params);
}

function mediumPenalty(candidate: MetadataCandidate, params: MetadataSearchParams): number {
  // An ISBN match is the edition itself, whatever its record says.
  if (params.isbn && candidateHasNormalizedIsbn(candidate, normalizeMetadataIsbn(params.isbn))) return 0;
  return params.mediaKind && candidate.mediaKind && candidate.mediaKind !== params.mediaKind ? MEDIUM_MISMATCH_PENALTY : 0;
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
