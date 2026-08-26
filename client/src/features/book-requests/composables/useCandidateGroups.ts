import { computed, type ComputedRef, type Ref } from 'vue'
import { bookRequestWorkKey, canonicalizeBookRequestIsbn, languagesAgree } from '@bookorbit/types'
import type { BookRequestAvailability, BookRequestMediaKind, MetadataCandidate, MetadataProviderKey } from '@bookorbit/types'
import { candidateTitle } from './useRequestSubmission'

/**
 * One work, assembled from every provider that described it. A requester picks a book, not a
 * metadata record, so the list shows works and keeps the records behind them.
 */
export interface CandidateGroup {
  key: string
  /** The record a request is built from: the most complete one the providers returned. */
  candidate: MetadataCandidate
  /** Every provider record behind the work row, retained so identifiers never disappear silently. */
  candidates: MetadataCandidate[]
  /** Distinct canonical ISBN-13 values after equivalent ISBN-10 values are folded in. */
  isbns: string[]
  /** ISBN editions ordered by the same evidence used for the primary action. */
  isbnChoices: CandidateIsbnChoice[]
  /** The exact edition used by the primary action, or null when only title and author are available. */
  recommendedIsbnChoice: CandidateIsbnChoice | null
  title: string
  authors: string[]
  coverUrl: string | null
  coverUrls: string[]
  publishedYear: number | null
  providers: MetadataProviderKey[]
  availability: BookRequestAvailability | null
}

export interface CandidateIsbnChoice {
  isbn: string
  candidate: MetadataCandidate
  providers: MetadataProviderKey[]
  languageRank: number
  agreementCount: number
  providerPriority: number
  providerResultRank: number
  yearDistance: number
}

/** A record with a cover and an ISBN says more about the book than a bare title and year. */
function completeness(candidate: MetadataCandidate): number {
  return (candidate.coverUrl ? 4 : 0) + (candidate.isbn13 ? 2 : 0) + (candidate.publishedYear ? 1 : 0)
}

function candidateLanguageRank(requestedLanguage: string | null | undefined, candidate: MetadataCandidate): number {
  if (!requestedLanguage) return 1
  if (!candidate.language) return 1
  return languagesAgree(requestedLanguage, candidate.language) ? 2 : 0
}

function candidateYearDistance(workYear: number | null, candidate: MetadataCandidate): number {
  return workYear !== null && candidate.publishedYear != null ? Math.abs(candidate.publishedYear - workYear) : Number.MAX_SAFE_INTEGER
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * The strongest claim any record in the group carries. Requesting one edition of a work claims the
 * work, so an answer about one record answers for its siblings too.
 */
function mergeAvailability(members: MetadataCandidate[], getAvailability: (candidate: MetadataCandidate) => BookRequestAvailability | null) {
  const known = members.map(getAvailability).filter((entry): entry is BookRequestAvailability => entry !== null)
  if (known.length === 0) return null

  const requested = known.find((entry) => entry.existingRequestId !== null)
  return {
    ownedBookId: known.find((entry) => entry.ownedBookId !== null)?.ownedBookId ?? null,
    existingRequestId: requested?.existingRequestId ?? null,
    existingRequestStatus: requested?.existingRequestStatus ?? null,
    alreadySubscribed: known.some((entry) => entry.alreadySubscribed),
  }
}

/**
 * Collapses search results into the works they describe, keyed exactly as the server dedupes a
 * request. Without this a title carried by five providers reads as five different books, and
 * requesting one of them leaves the other four still offering a button that folds into it.
 */
export function useCandidateGroups(
  results: Ref<MetadataCandidate[]> | ComputedRef<MetadataCandidate[]>,
  mediaKind: Ref<BookRequestMediaKind>,
  getAvailability: (candidate: MetadataCandidate) => BookRequestAvailability | null,
  coverProviderOrder?: Ref<readonly MetadataProviderKey[]> | ComputedRef<readonly MetadataProviderKey[]>,
  requestedLanguage?: Ref<string | null> | ComputedRef<string | null>,
  resultProviderOrder?: Ref<readonly MetadataProviderKey[]> | ComputedRef<readonly MetadataProviderKey[]>,
): { groups: ComputedRef<CandidateGroup[]> } {
  const groups = computed<CandidateGroup[]>(() => {
    const providerPriorities = new Map((resultProviderOrder?.value ?? []).map((provider, index) => [provider, index]))
    const providerResultCounts = new Map<MetadataProviderKey, number>()
    const providerResultRanks = new Map<MetadataCandidate, number>()

    for (const candidate of results.value) {
      const rank = providerResultCounts.get(candidate.provider) ?? 0
      providerResultRanks.set(candidate, rank)
      providerResultCounts.set(candidate.provider, rank + 1)
    }

    const providerPriority = (provider: MetadataProviderKey): number => providerPriorities.get(provider) ?? providerPriorities.size

    // Insertion order carries the provider ranking the results already arrived in, so it is what
    // orders the works too.
    const byWork = new Map<string, MetadataCandidate[]>()
    for (const candidate of results.value) {
      const title = candidateTitle(candidate)
      if (!title) continue
      const key = bookRequestWorkKey(title, candidate.authors?.[0], mediaKind.value)
      const members = byWork.get(key)
      if (members) members.push(candidate)
      else byWork.set(key, [candidate])
    }

    return [...byWork.entries()].map(([key, members]) => {
      const ranked = [...members].sort(
        (a, b) =>
          completeness(b) - completeness(a) ||
          providerPriority(a.provider) - providerPriority(b.provider) ||
          (providerResultRanks.get(a) ?? Number.MAX_SAFE_INTEGER) - (providerResultRanks.get(b) ?? Number.MAX_SAFE_INTEGER) ||
          compareText(a.provider, b.provider) ||
          compareText(a.providerId, b.providerId),
      )
      const best = ranked[0]!
      const years = members.map((member) => member.publishedYear).filter((year): year is number => year != null)
      const workYear = years.length ? Math.min(...years) : null
      const membersByIsbn = new Map<string, MetadataCandidate[]>()
      for (const member of members) {
        const isbn = canonicalizeBookRequestIsbn(member.isbn10, member.isbn13)
        if (!isbn) continue
        const matching = membersByIsbn.get(isbn)
        if (matching) matching.push(member)
        else membersByIsbn.set(isbn, [member])
      }
      const isbnChoices = [...membersByIsbn.entries()]
        .map(([isbn, matching]): CandidateIsbnChoice => {
          const rankedMatches = [...matching].sort(
            (a, b) =>
              candidateLanguageRank(requestedLanguage?.value, b) - candidateLanguageRank(requestedLanguage?.value, a) ||
              providerPriority(a.provider) - providerPriority(b.provider) ||
              (providerResultRanks.get(a) ?? Number.MAX_SAFE_INTEGER) - (providerResultRanks.get(b) ?? Number.MAX_SAFE_INTEGER) ||
              candidateYearDistance(workYear, a) - candidateYearDistance(workYear, b) ||
              compareText(a.provider, b.provider) ||
              compareText(a.providerId, b.providerId),
          )
          const representative = rankedMatches[0]!
          return {
            isbn,
            candidate: representative,
            providers: [...new Set(matching.map((candidate) => candidate.provider))].sort(
              (a, b) => providerPriority(a) - providerPriority(b) || compareText(a, b),
            ),
            languageRank: Math.max(...matching.map((candidate) => candidateLanguageRank(requestedLanguage?.value, candidate))),
            agreementCount: new Set(matching.map((candidate) => candidate.provider)).size,
            providerPriority: providerPriority(representative.provider),
            providerResultRank: providerResultRanks.get(representative) ?? Number.MAX_SAFE_INTEGER,
            yearDistance: Math.min(...matching.map((candidate) => candidateYearDistance(workYear, candidate))),
          }
        })
        .sort(
          (a, b) =>
            b.languageRank - a.languageRank ||
            b.agreementCount - a.agreementCount ||
            a.providerPriority - b.providerPriority ||
            a.providerResultRank - b.providerResultRank ||
            a.yearDistance - b.yearDistance ||
            compareText(a.isbn, b.isbn),
        )
      const coverPriorities = new Map((coverProviderOrder?.value ?? []).map((provider, index) => [provider, index]))
      const coverUrls = [...members]
        .sort((a, b) => {
          const aPriority = coverPriorities.get(a.provider) ?? Number.MAX_SAFE_INTEGER
          const bPriority = coverPriorities.get(b.provider) ?? Number.MAX_SAFE_INTEGER
          return aPriority - bPriority || completeness(b) - completeness(a)
        })
        .flatMap((member) => (member.coverUrl ? [member.coverUrl] : []))
        .filter((url, index, urls) => urls.indexOf(url) === index)

      return {
        key,
        candidate: best,
        candidates: members,
        isbns: isbnChoices.map((choice) => choice.isbn),
        isbnChoices,
        recommendedIsbnChoice: isbnChoices[0] ?? null,
        title: candidateTitle(best),
        authors: best.authors ?? [],
        coverUrl: coverUrls[0] ?? null,
        coverUrls,
        // The earliest edition dates the work; a reprint year only says when this record was made.
        publishedYear: workYear,
        providers: [...new Set(members.map((member) => member.provider))],
        availability: mergeAvailability(members, getAvailability),
      }
    })
  })

  return { groups }
}
