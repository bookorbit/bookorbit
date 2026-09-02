import { MetadataCandidate } from '@bookorbit/types';

import { matchableTitle, scoreCandidate } from './candidate-relevance';
import { candidateHasNormalizedIsbn, candidatesShareIsbn, normalizeMetadataIsbn } from './isbn-match';
import { MetadataSearchParams } from './providers/metadata-search-params';
import { scoreTitleMatch, shareSignificantToken } from '../../common/text-match/title-match';

/**
 * How closely two providers' titles must match before their records are treated as the same book.
 * Set at full overlap of the meaningful words, which admits subtitle differences, word reordering,
 * and translated editions while rejecting unrelated works.
 */
export const MIN_AGREEMENT_SCORE = 6;

export interface CandidateAgreement {
  anchor: MetadataCandidate | undefined;
  accepted: MetadataCandidate[];
  rejected: MetadataCandidate[];
}

/**
 * Field rules resolve each field from whichever provider ranks first for it, so a provider that
 * matched the wrong book contributes real-looking values for whatever fields it wins. Nothing
 * downstream compares candidates to each other, which is how one record ends up holding a title
 * from one book, a cover from a second, and a subtitle from a third.
 *
 * This picks the best-supported candidate as the anchor and holds every other candidate to it.
 * Candidates are only rejected on positive evidence of a different book; when there is no basis to
 * judge (no title on either side) they are kept, matching how relevance scoring treats an
 * unscoreable query.
 *
 * `candidates` must be in identity-trust order: the anchor tie-break follows it.
 */
export function resolveCandidateAgreement(candidates: readonly MetadataCandidate[], params: MetadataSearchParams): CandidateAgreement {
  if (candidates.length <= 1) {
    return { anchor: candidates[0], accepted: [...candidates], rejected: [] };
  }

  const anchor = selectAnchor(candidates, params);
  if (!anchor) return { anchor: undefined, accepted: [...candidates], rejected: [] };

  const accepted: MetadataCandidate[] = [];
  const rejected: MetadataCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate === anchor || describesSameBook(anchor, candidate)) {
      accepted.push(candidate);
    } else {
      rejected.push(candidate);
    }
  }

  return { anchor, accepted, rejected };
}

/**
 * The candidate the others are measured against: an edition confirmed by the book's own ISBN when
 * one is available, otherwise whichever candidate the query supports most strongly. Ties fall to
 * the caller's trust order.
 */
function selectAnchor(candidates: readonly MetadataCandidate[], params: MetadataSearchParams): MetadataCandidate | undefined {
  const isbn = normalizeMetadataIsbn(params.isbn);
  if (isbn) {
    const isbnMatch = candidates.find((candidate) => candidateHasNormalizedIsbn(candidate, isbn));
    if (isbnMatch) return isbnMatch;
  }

  const scoreable = candidates.filter((candidate) => matchableTitle(candidate));
  if (scoreable.length === 0) return undefined;
  if (!hasText(params.title) && !hasText(params.author)) return scoreable[0];

  let best = scoreable[0];
  let bestScore = scoreCandidate(best, params);
  for (const candidate of scoreable.slice(1)) {
    const score = scoreCandidate(candidate, params);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function describesSameBook(anchor: MetadataCandidate, candidate: MetadataCandidate): boolean {
  if (candidatesShareIsbn(anchor, candidate)) return true;

  const anchorTitle = matchableTitle(anchor);
  const candidateTitle = matchableTitle(candidate);
  // No title on either side means no evidence either way, so the candidate keeps the benefit of
  // the doubt rather than being dropped on a guess.
  if (!anchorTitle || !candidateTitle) return true;
  if (scoreTitleMatch(anchorTitle, candidateTitle) < MIN_AGREEMENT_SCORE) return false;

  return authorsAgree(anchor, candidate);
}

/**
 * Titles alone cannot separate a book from its companion volumes and cash-ins, which routinely
 * extend the real title ("The Hobbit" / "The Hobbit Cookbook"). Authors can, when both sides
 * name one.
 */
function authorsAgree(anchor: MetadataCandidate, candidate: MetadataCandidate): boolean {
  const anchorAuthors = anchor.authors?.filter(Boolean) ?? [];
  const candidateAuthors = candidate.authors?.filter(Boolean) ?? [];
  if (anchorAuthors.length === 0 || candidateAuthors.length === 0) return true;

  return shareSignificantToken(anchorAuthors, candidateAuthors);
}

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
