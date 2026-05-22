import { AuthorMetadataCandidate } from '@bookorbit/types';
import { distance } from 'fastest-levenshtein';

const MIN_ACCEPT_SCORE = 0.82;
const TOKEN_SET_ACCEPT_SCORE = 0.96;

export type AuthorNameMatch = {
  candidate: AuthorMetadataCandidate;
  score: number;
  accept: boolean;
  exactNormalized: boolean;
  tokenSetEqual: boolean;
  firstTokenExact: boolean;
  lastTokenExact: boolean;
};

export function pickBestAuthorNameMatch(queryName: string, candidates: AuthorMetadataCandidate[]): AuthorNameMatch | null {
  const scored = candidates.map((candidate) => scoreAuthorNameMatch(queryName, candidate)).sort((a, b) => b.score - a.score);
  return scored.find((row) => row.accept) ?? null;
}

export function scoreAuthorNameMatch(queryName: string, candidate: AuthorMetadataCandidate): AuthorNameMatch {
  const queryNormalized = normalizeName(queryName);
  const candidateNormalized = normalizeName(candidate.name);
  const queryTokens = tokenize(queryNormalized);
  const candidateTokens = tokenize(candidateNormalized);

  const exactNormalized = queryNormalized.length > 0 && queryNormalized === candidateNormalized;
  const tokenSetEqual = haveEqualTokenMultiset(queryTokens, candidateTokens);
  const firstTokenExact = queryTokens[0] !== undefined && queryTokens[0] === candidateTokens[0];
  const lastTokenExact =
    queryTokens[queryTokens.length - 1] !== undefined && queryTokens[queryTokens.length - 1] === candidateTokens[candidateTokens.length - 1];
  const candidateTokensSubsetOfQuery = isTokenSubset(candidateTokens, queryTokens);
  const queryTokensSubsetOfCandidate = isTokenSubset(queryTokens, candidateTokens);
  const nameShapeCompatible = lastTokenExact || tokenSetEqual;

  let score = 0;
  if (exactNormalized) {
    score = 1;
  } else {
    const levenshteinSimilarity = normalizedLevenshtein(queryNormalized, candidateNormalized);
    const tokenOverlap = overlapRatio(queryTokens, candidateTokens);
    score += levenshteinSimilarity * 0.55;
    score += tokenOverlap * 0.3;
    if (firstTokenExact) score += 0.05;
    if (lastTokenExact) score += 0.1;
    if (candidateTokensSubsetOfQuery && firstTokenExact && lastTokenExact) score += 0.12;
    if (queryTokensSubsetOfCandidate && firstTokenExact && lastTokenExact) score += 0.08;
    if (tokenSetEqual) score = Math.max(score, TOKEN_SET_ACCEPT_SCORE);
    score = clamp(score, 0, 1);
  }

  return {
    candidate,
    score,
    accept: nameShapeCompatible && score >= MIN_ACCEPT_SCORE,
    exactNormalized,
    tokenSetEqual,
    firstTokenExact,
    lastTokenExact,
  };
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  if (!value) return [];
  return value.split(' ').filter((part) => part.length > 0);
}

function normalizedLevenshtein(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - distance(a, b) / maxLen;
}

function overlapRatio(queryTokens: string[], candidateTokens: string[]): number {
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;
  const querySet = new Set(queryTokens);
  const candidateSet = new Set(candidateTokens);
  let overlap = 0;
  for (const token of querySet) {
    if (candidateSet.has(token)) overlap += 1;
  }
  return overlap / Math.max(querySet.size, candidateSet.size);
}

function haveEqualTokenMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((token, index) => token === bSorted[index]);
}

function isTokenSubset(subset: string[], superset: string[]): boolean {
  if (subset.length === 0) return false;
  const set = new Set(superset);
  return subset.every((token) => set.has(token));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
