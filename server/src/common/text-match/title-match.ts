import { distance } from 'fastest-levenshtein';

/**
 * Shared title-comparison primitives.
 *
 * Two callers with different thresholds use these: candidate relevance (is this candidate worth
 * keeping for the query?) and candidate agreement (do two providers describe the same book?).
 */

export const TITLE_MATCH_SCORES = {
  exact: 10,
  prefix: 8,
  substring: 7,
  tokenOverlap: 6,
  levenshtein: 4,
} as const;

/**
 * Function words carry no identifying signal, so counting them in token overlap makes any two
 * titles sharing "the" look related. They are dropped from the query side only: a stopword left in
 * a candidate can no longer match anything once the query side is stripped.
 */
const STOPWORDS = new Set([
  'the',
  'an',
  'and',
  'or',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'from',
  'by',
  'is',
  'it',
  'as',
  'be',
  'are',
  'was',
  'were',
  'this',
  'that',
  'these',
  'those',
  'into',
  'over',
  'under',
  'its',
  'his',
  'her',
  'their',
  'our',
  'your',
  'my',
]);

const MIN_LEVENSHTEIN_SIMILARITY = 0.6;
const MIN_TOKEN_OVERLAP_RATIO = 0.5;

/**
 * Folds a title to its comparable form: decomposed, stripped of nonspacing marks so that "Sōseki"
 * and "Soseki" agree, lowercased, and reduced to letters and digits of any script.
 *
 * Restricting this to `[a-z0-9]` would empty every title written in a non-Latin script, which makes
 * two providers reporting the identical Japanese or Russian title look like different books.
 * Spacing combining marks are kept, since scripts such as Devanagari carry vowels in them.
 */
export function normalizeTitleText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mn}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function tokenizeTitleText(value: string): string[] {
  return value.split(' ').filter((token) => token.length > 1);
}

/**
 * Tokens worth matching on. Falls back to the raw tokens when a title is nothing but stopwords,
 * so a book genuinely titled "It" or "Them" still has something to match.
 */
export function significantTokens(tokens: string[]): string[] {
  const significant = tokens.filter((token) => !STOPWORDS.has(token));
  return significant.length > 0 ? significant : tokens;
}

/**
 * Substring matching has to respect word boundaries. Without it "Ubik" matches "Rubik Cube
 * Solutions" and "It" matches "Italian Cooking Basics", both scoring as strongly as a real hit.
 */
export function containsWord(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;

  for (let from = 0; from <= haystack.length - needle.length;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return false;

    const startsAtBoundary = index === 0 || haystack[index - 1] === ' ';
    const endIndex = index + needle.length;
    const endsAtBoundary = endIndex === haystack.length || haystack[endIndex] === ' ';
    if (startsAtBoundary && endsAtBoundary) return true;

    from = index + 1;
  }

  return false;
}

export function startsWithWord(haystack: string, needle: string): boolean {
  if (needle.length === 0 || !haystack.startsWith(needle)) return false;
  return haystack.length === needle.length || haystack[needle.length] === ' ';
}

/**
 * Scores how strongly two titles refer to the same work. Both arguments are raw titles; ordering
 * matters only in that `query` supplies the tokens the overlap ratio is measured against.
 */
export function scoreTitleMatch(query: string, candidate: string): number {
  const normalizedQuery = normalizeTitleText(query);
  const normalizedCandidate = normalizeTitleText(candidate);
  if (!normalizedQuery || !normalizedCandidate) return 0;

  if (normalizedCandidate === normalizedQuery) return TITLE_MATCH_SCORES.exact;
  if (startsWithWord(normalizedCandidate, normalizedQuery) || startsWithWord(normalizedQuery, normalizedCandidate)) {
    return TITLE_MATCH_SCORES.prefix;
  }
  if (containsWord(normalizedCandidate, normalizedQuery) || containsWord(normalizedQuery, normalizedCandidate)) {
    return TITLE_MATCH_SCORES.substring;
  }

  const queryTokens = significantTokens(tokenizeTitleText(normalizedQuery));
  const candidateTokens = new Set(tokenizeTitleText(normalizedCandidate));
  const overlapRatio = queryTokens.length > 0 ? queryTokens.filter((token) => candidateTokens.has(token)).length / queryTokens.length : 0;
  // A minority of the query's meaningful words in common is not evidence of the same book;
  // "The Way of Kings" and "The Way We Were" share exactly one.
  const tokenScore = overlapRatio > MIN_TOKEN_OVERLAP_RATIO ? overlapRatio * TITLE_MATCH_SCORES.tokenOverlap : 0;

  const similarity = levenshteinSimilarity(normalizedQuery, normalizedCandidate);
  const levenshteinScore = similarity >= MIN_LEVENSHTEIN_SIMILARITY ? similarity * TITLE_MATCH_SCORES.levenshtein : 0;

  return Math.max(tokenScore, levenshteinScore);
}

/**
 * Symmetric 0-1 similarity, unlike `scoreTitleMatch`, which is deliberately generous about a
 * candidate that extends the query so a search for "Dune" still surfaces "Dune (Special Edition)".
 *
 * That generosity is wrong when the question is "is this the book that was asked for": under it,
 * "Dune" and "Dune Messiah" score as a prefix hit. Here every token either side does not share
 * costs, so a sequel separates from its predecessor.
 */
export function symmetricTitleSimilarity(left: string, right: string): number {
  const a = normalizeTitleText(left);
  const b = normalizeTitleText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const leftTokens = new Set(significantTokens(tokenizeTitleText(a)));
  const rightTokens = new Set(significantTokens(tokenizeTitleText(b)));
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared++;
  const union = leftTokens.size + rightTokens.size - shared;
  const jaccard = union > 0 ? shared / union : 0;

  // Below the floor, edit distance is measuring alphabet overlap rather than a typo, and two
  // unrelated titles would carry a few points each into whatever weighting sits on top of this.
  const similarity = levenshteinSimilarity(a, b);
  return Math.max(jaccard, similarity >= MIN_LEVENSHTEIN_SIMILARITY ? similarity : 0);
}

/**
 * The part of a title before its subtitle. A subtitle is punctuation-separated and a sequel is
 * not, which is the one cheap signal that tells "The Hobbit: There and Back Again" apart from
 * "Dune Messiah" when comparing against a bare series title.
 */
export function mainTitlePart(value: string): string {
  const cut = value.search(/[:(\u2013\u2014]|\s-\s/);
  const main = cut > 0 ? value.slice(0, cut) : value;
  return main.trim() || value.trim();
}

export function shareSignificantToken(left: readonly string[], right: readonly string[]): boolean {
  const leftTokens = new Set(left.flatMap((value) => tokenizeTitleText(normalizeTitleText(value))).filter((token) => token.length > 2));
  if (leftTokens.size === 0) return false;
  return right.some((value) => tokenizeTitleText(normalizeTitleText(value)).some((token) => leftTokens.has(token)));
}

function levenshteinSimilarity(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 1 : 1 - distance(a, b) / maxLength;
}
