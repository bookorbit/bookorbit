import type { MetadataCandidate, MetadataProviderKey, ProviderIds, SeriesIndex } from '@bookorbit/types'
import { existingProviderId, normalizeForMatch } from './metadata-diff-fields'

export type MatchTier = 'strong' | 'possible' | 'weak'

/** What a search result is matched against: the book, or a Book Dock file. */
export interface MatchSubject {
  title: string | null
  authors: readonly string[]
  isbn13: string | null
  isbn10: string | null
  seriesName: string | null
  seriesIndex: SeriesIndex | null
  providerIds?: ProviderIds
}

export interface MatchAssessment {
  tier: MatchTier
  /** Orders results within a tier; not shown. */
  score: number
  /** The book already holds this record's id for the provider. */
  linked: boolean
  isbnMatch: boolean
  titleMatch: 'same' | 'longer' | 'different'
  authorMatch: boolean
  seriesMatch: boolean
  /** How many of the fields that matter the record fills. */
  filledFields: number
  /** Too few fields to be worth much even when it is the right book. */
  sparse: boolean
}

const SPARSE_AT_MOST = 4

/** The title without an edition note in parentheses or a trailing "by Author", which providers append. */
function titleCore(title: string): string {
  return normalizeForMatch(title.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+by\s+[^:]+$/i, ''))
}

function lastName(name: string): string {
  const parts = normalizeForMatch(name).split(' ')
  return parts[parts.length - 1] ?? ''
}

const bareIsbn = (value: string | null | undefined) => (value ?? '').replace(/[^0-9x]/gi, '').toUpperCase()

function filledFields(candidate: MetadataCandidate): number {
  const values = [
    candidate.title ?? candidate.displayTitle,
    candidate.subtitle,
    candidate.authors?.length,
    candidate.description,
    candidate.publisher,
    candidate.publishedDate ?? candidate.publishedYear,
    candidate.language,
    candidate.pageCount,
    candidate.seriesName,
    candidate.isbn13 ?? candidate.isbn10,
    candidate.genres?.length,
    candidate.communityRating,
    candidate.coverUrl,
  ]
  return values.filter((value) => value !== undefined && value !== null && value !== '' && value !== 0).length
}

/**
 * How likely a search result is to be this book, from what the page already knows: the provider
 * ids the book holds, its ISBNs, title, authors and series. A record the book is already linked to,
 * or one sharing its ISBN, is a strong match; the same title and author is another edition; the rest
 * are usually other books that share words with the title.
 */
export function assessMatch(candidate: MetadataCandidate, subject: MatchSubject): MatchAssessment {
  const linkedId = existingProviderId(subject.providerIds, candidate.provider)
  const linked = !!linkedId && !!candidate.providerId && linkedId === candidate.providerId

  const isbns = new Set([bareIsbn(subject.isbn13), bareIsbn(subject.isbn10)].filter(Boolean))
  const isbnMatch = [bareIsbn(candidate.isbn13), bareIsbn(candidate.isbn10)].some((isbn) => isbn && isbns.has(isbn))

  const bookTitle = titleCore(subject.title ?? '')
  const resultTitle = titleCore(candidate.displayTitle ?? candidate.title ?? '')
  const titleMatch: MatchAssessment['titleMatch'] =
    bookTitle && resultTitle === bookTitle
      ? 'same'
      : bookTitle && resultTitle && (resultTitle.startsWith(bookTitle) || bookTitle.startsWith(resultTitle))
        ? 'longer'
        : 'different'

  const bookAuthors = subject.authors.map(normalizeForMatch).filter(Boolean)
  const bookLastNames = new Set(subject.authors.map(lastName).filter(Boolean))
  const authorMatch = (candidate.authors ?? []).some(
    (author) => bookAuthors.includes(normalizeForMatch(author)) || bookLastNames.has(lastName(author)),
  )

  const seriesMatch =
    !!candidate.seriesName &&
    !!subject.seriesName &&
    normalizeForMatch(candidate.seriesName) === normalizeForMatch(subject.seriesName) &&
    String(candidate.seriesIndex ?? '') === String(subject.seriesIndex ?? '')

  const filled = filledFields(candidate)
  const tier: MatchTier = linked || isbnMatch ? 'strong' : titleMatch === 'same' && authorMatch ? 'possible' : 'weak'
  const score =
    (linked ? 60 : 0) +
    (isbnMatch ? 45 : 0) +
    (titleMatch === 'same' ? 25 : titleMatch === 'longer' ? 6 : 0) +
    (authorMatch ? 20 : 0) +
    (seriesMatch ? 10 : 0) +
    filled * 0.6

  return { tier, score, linked, isbnMatch, titleMatch, authorMatch, seriesMatch, filledFields: filled, sparse: filled <= SPARSE_AT_MOST }
}

export interface RankedMatch {
  candidate: MetadataCandidate
  assessment: MatchAssessment
}

export interface MatchGroups {
  strong: RankedMatch[]
  possible: RankedMatch[]
  weak: RankedMatch[]
}

const TIER_ORDER: Record<MatchTier, number> = { strong: 0, possible: 1, weak: 2 }

/** Best first: by tier, then score, then the provider order, then arrival. */
export function rankMatches(
  candidates: readonly MetadataCandidate[],
  subject: MatchSubject,
  providerOrder: readonly MetadataProviderKey[] = [],
): RankedMatch[] {
  const order = new Map(providerOrder.map((provider, index) => [provider, index]))
  return candidates
    .map((candidate, index) => ({ candidate, assessment: assessMatch(candidate, subject), index }))
    .sort(
      (a, b) =>
        TIER_ORDER[a.assessment.tier] - TIER_ORDER[b.assessment.tier] ||
        b.assessment.score - a.assessment.score ||
        (order.get(a.candidate.provider) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.candidate.provider) ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index,
    )
    .map(({ candidate, assessment }) => ({ candidate, assessment }))
}

export function groupMatches(ranked: readonly RankedMatch[]): MatchGroups {
  const groups: MatchGroups = { strong: [], possible: [], weak: [] }
  for (const match of ranked) groups[match.assessment.tier].push(match)
  return groups
}

/** One key per result, stable across re-renders and re-searches, so a pick can name the result it came from. */
export function candidateKey(candidate: Pick<MetadataCandidate, 'provider' | 'providerId'>): string {
  return `${candidate.provider}:${candidate.providerId ?? ''}`
}
