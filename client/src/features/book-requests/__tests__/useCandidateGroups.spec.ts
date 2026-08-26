// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { MetadataProviderKey, type BookRequestAvailability, type BookRequestMediaKind, type MetadataCandidate } from '@bookorbit/types'

import { useCandidateGroups } from '../composables/useCandidateGroups'

function candidate(overrides: Partial<MetadataCandidate> & Pick<MetadataCandidate, 'provider' | 'providerId'>): MetadataCandidate {
  return { title: 'Dune', authors: ['Frank Herbert'], ...overrides } as MetadataCandidate
}

function groupsFor(
  results: MetadataCandidate[],
  availability: Record<string, BookRequestAvailability> = {},
  kind: BookRequestMediaKind = 'ebook',
  coverProviderOrder: MetadataProviderKey[] = [],
  requestedLanguage: string | null = null,
  resultProviderOrder: MetadataProviderKey[] = [],
) {
  const { groups } = useCandidateGroups(
    ref(results),
    ref(kind),
    (item) => availability[`${item.provider}:${item.providerId}`] ?? null,
    ref(coverProviderOrder),
    ref(requestedLanguage),
    ref(resultProviderOrder),
  )
  return groups.value
}

describe('useCandidateGroups', () => {
  it('collapses the same work carried by several providers into one row', () => {
    const groups = groupsFor([
      candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'gr1', publishedYear: 1975 }),
      candidate({ provider: MetadataProviderKey.AMAZON, providerId: 'az1' }),
      candidate({ provider: MetadataProviderKey.OPEN_LIBRARY, providerId: 'ol1', publishedYear: 1965 }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]!.providers).toEqual([MetadataProviderKey.GOODREADS, MetadataProviderKey.AMAZON, MetadataProviderKey.OPEN_LIBRARY])
  })

  it('separates works that share a title but not an author', () => {
    const groups = groupsFor([
      candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'gr1' }),
      candidate({ provider: MetadataProviderKey.AMAZON, providerId: 'az1', authors: ['Brian Herbert', 'Kevin J. Anderson'] }),
    ])

    expect(groups).toHaveLength(2)
  })

  it('ignores punctuation, case, and accents the way the server dedupe does', () => {
    const groups = groupsFor([
      candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'gr1', title: 'Les Misérables', authors: ['Victor Hugo'] }),
      candidate({ provider: MetadataProviderKey.AMAZON, providerId: 'az1', title: 'les miserables!', authors: ['victor hugo'] }),
    ])

    expect(groups).toHaveLength(1)
  })

  it('requests the most complete record in the group rather than the first one seen', () => {
    const complete = candidate({ provider: MetadataProviderKey.AMAZON, providerId: 'az1', coverUrl: 'cover.jpg', isbn13: '9780441013593' })
    const groups = groupsFor([candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'gr1' }), complete])

    expect(groups[0]!.candidate.providerId).toBe('az1')
    expect(groups[0]!.coverUrl).toBe('cover.jpg')
  })

  it('folds equivalent ISBN-10 and ISBN-13 values into one work identifier', () => {
    const groups = groupsFor([
      candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'gr1', isbn10: '0441013597' }),
      candidate({ provider: MetadataProviderKey.GOOGLE, providerId: 'g1', isbn13: '9780441013593' }),
    ])

    expect(groups[0]!.isbns).toEqual(['9780441013593'])
    expect(groups[0]!.candidates).toHaveLength(2)
  })

  it('retains conflicting provider ISBNs instead of silently choosing one', () => {
    const groups = groupsFor([
      candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'gr1', isbn13: '9780441013593' }),
      candidate({ provider: MetadataProviderKey.GOOGLE, providerId: 'g1', isbn13: '9781250301697' }),
    ])

    expect(groups[0]!.isbns).toEqual(['9780441013593', '9781250301697'])
  })

  it('prefers the requested language before provider agreement', () => {
    const groups = groupsFor(
      [
        candidate({ provider: MetadataProviderKey.GOOGLE, providerId: 'english', isbn13: '9781250827999', language: 'en' }),
        candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'german-1', isbn13: '9781761620003', language: 'de' }),
        candidate({ provider: MetadataProviderKey.AMAZON, providerId: 'german-2', isbn13: '9781761620003', language: 'German' }),
      ],
      {},
      'ebook',
      [],
      'English',
      [MetadataProviderKey.GOODREADS, MetadataProviderKey.AMAZON, MetadataProviderKey.GOOGLE],
    )

    expect(groups[0]!.recommendedIsbnChoice?.isbn).toBe('9781250827999')
  })

  it('prefers an unknown language over a known mismatch', () => {
    const groups = groupsFor(
      [
        candidate({ provider: MetadataProviderKey.GOOGLE, providerId: 'unknown', isbn13: '9781250827999' }),
        candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'german', isbn13: '9781761620003', language: 'de' }),
      ],
      {},
      'ebook',
      [],
      'en',
      [MetadataProviderKey.GOODREADS, MetadataProviderKey.GOOGLE],
    )

    expect(groups[0]!.recommendedIsbnChoice?.isbn).toBe('9781250827999')
  })

  it('prefers an ISBN confirmed by more independent providers', () => {
    const groups = groupsFor(
      [
        candidate({ provider: MetadataProviderKey.GOOGLE, providerId: 'single', isbn13: '9781250827999', language: 'en' }),
        candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'agreed-1', isbn13: '9781761620003', language: 'en' }),
        candidate({ provider: MetadataProviderKey.AMAZON, providerId: 'agreed-2', isbn13: '9781761620003', language: 'en' }),
      ],
      {},
      'ebook',
      [],
      'en',
      [MetadataProviderKey.GOOGLE, MetadataProviderKey.GOODREADS, MetadataProviderKey.AMAZON],
    )

    expect(groups[0]!.recommendedIsbnChoice).toMatchObject({ isbn: '9781761620003', agreementCount: 2 })
  })

  it('uses stable provider priority regardless of provider arrival order', () => {
    const google = candidate({ provider: MetadataProviderKey.GOOGLE, providerId: 'google', isbn13: '9781250827999', language: 'en' })
    const goodreads = candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'goodreads', isbn13: '9781761620003', language: 'en' })
    const providerOrder = [MetadataProviderKey.GOOGLE, MetadataProviderKey.GOODREADS]

    const googleFirst = groupsFor([google, goodreads], {}, 'ebook', [], 'en', providerOrder)
    const goodreadsFirst = groupsFor([goodreads, google], {}, 'ebook', [], 'en', providerOrder)

    expect(googleFirst[0]!.recommendedIsbnChoice?.isbn).toBe('9781250827999')
    expect(goodreadsFirst[0]!.recommendedIsbnChoice?.isbn).toBe('9781250827999')
  })

  it("uses a provider's own result position when earlier evidence ties", () => {
    const groups = groupsFor(
      [
        candidate({ provider: MetadataProviderKey.GOOGLE, providerId: 'rank-1', isbn13: '9781250827999', language: 'en' }),
        candidate({ provider: MetadataProviderKey.GOOGLE, providerId: 'rank-2', isbn13: '9781761620003', language: 'en' }),
      ],
      {},
      'ebook',
      [],
      'en',
      [MetadataProviderKey.GOOGLE],
    )

    expect(groups[0]!.recommendedIsbnChoice).toMatchObject({ isbn: '9781250827999', providerResultRank: 0 })
  })

  it('uses edition year and then ISBN as stable final tie-breakers', () => {
    const yearWinner = groupsFor([
      candidate({ provider: MetadataProviderKey.GOOGLE, providerId: 'newer', isbn13: '9781761620003', language: 'en', publishedYear: 2026 }),
      candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'original', isbn13: '9781250827999', language: 'en', publishedYear: 2025 }),
    ])
    const isbnWinner = groupsFor([
      candidate({ provider: MetadataProviderKey.GOOGLE, providerId: 'larger', isbn13: '9781761620003', language: 'en', publishedYear: 2025 }),
      candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'smaller', isbn13: '9781250827999', language: 'en', publishedYear: 2025 }),
    ])

    expect(yearWinner[0]!.recommendedIsbnChoice?.isbn).toBe('9781250827999')
    expect(isbnWinner[0]!.recommendedIsbnChoice?.isbn).toBe('9781250827999')
  })

  it('uses the configured cover order without changing the selected metadata record', () => {
    const amazon = candidate({ provider: MetadataProviderKey.AMAZON, providerId: 'az1', coverUrl: 'amazon.jpg' })
    const google = candidate({
      provider: MetadataProviderKey.GOOGLE,
      providerId: 'g1',
      coverUrl: 'google.jpg',
      isbn13: '9780441013593',
      publishedYear: 1965,
    })
    const groups = groupsFor([google, amazon], {}, 'ebook', [MetadataProviderKey.AMAZON, MetadataProviderKey.GOOGLE])

    expect(groups[0]!.candidate.providerId).toBe('g1')
    expect(groups[0]!.coverUrl).toBe('amazon.jpg')
    expect(groups[0]!.coverUrls).toEqual(['amazon.jpg', 'google.jpg'])
  })

  it('deduplicates fallback cover urls while preserving provider priority', () => {
    const groups = groupsFor(
      [
        candidate({ provider: MetadataProviderKey.GOOGLE, providerId: 'g1', coverUrl: 'shared.jpg' }),
        candidate({ provider: MetadataProviderKey.AMAZON, providerId: 'az1', coverUrl: 'shared.jpg' }),
        candidate({ provider: MetadataProviderKey.OPEN_LIBRARY, providerId: 'ol1', coverUrl: 'open-library.jpg' }),
      ],
      {},
      'ebook',
      [MetadataProviderKey.AMAZON, MetadataProviderKey.GOOGLE, MetadataProviderKey.OPEN_LIBRARY],
    )

    expect(groups[0]!.coverUrls).toEqual(['shared.jpg', 'open-library.jpg'])
  })

  it('dates the work by its earliest edition', () => {
    const groups = groupsFor([
      candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'gr1', publishedYear: 2005 }),
      candidate({ provider: MetadataProviderKey.AMAZON, providerId: 'az1', publishedYear: 1965 }),
      candidate({ provider: MetadataProviderKey.OPEN_LIBRARY, providerId: 'ol1' }),
    ])

    expect(groups[0]!.publishedYear).toBe(1965)
  })

  it('carries a claim found on one record across the whole group', () => {
    const groups = groupsFor(
      [
        candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'gr1' }),
        candidate({ provider: MetadataProviderKey.AMAZON, providerId: 'az1' }),
      ],
      { 'amazon:az1': { ownedBookId: null, existingRequestId: 12, existingRequestStatus: 'pending', alreadySubscribed: true } },
    )

    expect(groups[0]!.availability).toEqual({
      ownedBookId: null,
      existingRequestId: 12,
      existingRequestStatus: 'pending',
      alreadySubscribed: true,
    })
  })

  it('leaves availability unknown until some record in the group has been answered for', () => {
    const groups = groupsFor([candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'gr1' })])

    expect(groups[0]!.availability).toBeNull()
  })

  it('drops a record with no title, which would otherwise render as a blank row', () => {
    const groups = groupsFor([
      candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'gr1', title: undefined }),
      candidate({ provider: MetadataProviderKey.AMAZON, providerId: 'az1' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]!.providers).toEqual([MetadataProviderKey.AMAZON])
  })

  it('keeps the same work apart across media, since a request is per medium', () => {
    const results = [candidate({ provider: MetadataProviderKey.GOODREADS, providerId: 'gr1' })]

    expect(groupsFor(results, {}, 'ebook')[0]!.key).not.toBe(groupsFor(results, {}, 'audiobook')[0]!.key)
  })
})
