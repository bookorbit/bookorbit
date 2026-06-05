import { MetadataCandidate } from '@bookorbit/types';
import { distance } from 'fastest-levenshtein';

import { MetadataSearchParams } from './providers/metadata-search-params';

const DEFAULT_LIMIT = 5;

const SKIP_TITLE_PATTERNS = [
  /^(summary|study guide|analysis|guide to|workbook|review of|summary of|chapter summary|chapter-by-chapter)\b/i,
  /\b(summary|study guide|book analysis|reading guide|literature guide|workbook|digest|breakdown and analysis)\b/i,
];

/**
 * Scores, filters, and ranks candidates by relevance to the search params.
 *
 * - If no title or author is available in params, returns candidates as-is (no basis for scoring).
 * - ISBN exact match always survives regardless of title/author score.
 * - Candidates scoring 0 are dropped (no meaningful signal).
 * - Survivors are sorted descending by score and capped at `limit`.
 */
export function filterAndRank(candidates: MetadataCandidate[], params: MetadataSearchParams, limit = DEFAULT_LIMIT): MetadataCandidate[] {
  if (!hasText(params.title) && !hasText(params.author)) {
    return candidates.slice(0, limit);
  }

  return candidates
    .filter((c) => !c.title || !SKIP_TITLE_PATTERNS.some((pattern) => pattern.test(c.title)))
    .map((c) => ({ candidate: c, score: scoreCandidate(c, params) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

function scoreCandidate(candidate: MetadataCandidate, params: MetadataSearchParams): number {
  if (params.isbn) {
    const isbn = params.isbn.replace(/[^0-9X]/gi, '');
    if (candidate.isbn10 === isbn || candidate.isbn13 === isbn) return 100;
  }

  let score = 0;

  if (params.title && candidate.title) {
    score += scoreTitle(normalize(params.title), normalize(candidate.title));
  }

  // Author only boosts when there is already a positive title signal.
  // A matching author alone (e.g. a different book by the same author) is not enough to keep a result.
  if (score > 0 && params.author && candidate.authors?.length) {
    score += scoreAuthor(normalize(params.author), candidate.authors.map(normalize));
  }

  return score;
}

function scoreTitle(query: string, candidate: string): number {
  if (candidate === query) return 10;
  if (candidate.startsWith(query) || query.startsWith(candidate)) return 8;
  if (candidate.includes(query) || query.includes(candidate)) return 7;

  const queryTokens = tokenize(query);
  const candidateTokens = new Set(tokenize(candidate));
  const overlapRatio = queryTokens.length > 0 ? queryTokens.filter((w) => candidateTokens.has(w)).length / queryTokens.length : 0;
  const tokenScore = overlapRatio * 6;

  const sim = levenshteinSim(query, candidate);
  const levenScore = sim >= 0.6 ? sim * 4 : 0;

  return Math.max(tokenScore, levenScore);
}

function scoreAuthor(query: string, candidateAuthors: string[]): number {
  const queryTokens = new Set(tokenize(query).filter((w) => w.length > 2));
  for (const ca of candidateAuthors) {
    if (ca.includes(query) || query.includes(ca)) return 3;
    if (tokenize(ca).some((w) => queryTokens.has(w))) return 1;
  }
  return 0;
}

function levenshteinSim(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - distance(a, b) / maxLen;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  return s.split(' ').filter((w) => w.length > 1);
}

function hasText(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
