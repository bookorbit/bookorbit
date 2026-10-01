// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { MetadataCandidate } from '@bookorbit/types'
import { assessMatch, candidateKey, groupMatches, rankMatches, type MatchSubject } from '../metadata-match'

const book: MatchSubject = {
  title: 'Artemis Fowl',
  authors: ['Eoin Colfer'],
  isbn13: null,
  isbn10: null,
  seriesName: 'Artemis Fowl',
  seriesIndex: '1',
  providerIds: { goodreads: '249747', amazon: 'B002KP6DXQ' },
}

function result(provider: MetadataCandidate['provider'], providerId: string, data: Partial<MetadataCandidate> = {}): MetadataCandidate {
  return { provider, providerId, title: 'Artemis Fowl', authors: ['Eoin Colfer'], ...data }
}

describe('assessMatch', () => {
  it('rates a record the book is already linked to as a strong match', () => {
    expect(assessMatch(result('goodreads', '249747'), book)).toMatchObject({ tier: 'strong', linked: true })
  })

  it('rates a shared ISBN as a strong match, ignoring hyphens', () => {
    const subject = { ...book, isbn13: '978-0-7868-1787-0' }

    expect(assessMatch(result('google', 'x', { isbn13: '9780786817870' }), subject)).toMatchObject({ tier: 'strong', isbnMatch: true, linked: false })
  })

  it('treats the same title and author as another edition, whatever edition note the provider adds', () => {
    expect(assessMatch(result('google', 'mass', { title: 'Artemis Fowl (Mass market edition)' }), book)).toMatchObject({
      tier: 'possible',
      titleMatch: 'same',
      authorMatch: true,
    })
    expect(assessMatch(result('hardcover', 'tp', { title: 'Artemis Fowl: The Time Paradox by Eoin Colfer' }), book)).toMatchObject({
      tier: 'weak',
      titleMatch: 'longer',
    })
  })

  it('puts a collection or a different author with the probably different books', () => {
    expect(assessMatch(result('google', 'set', { title: 'Artemis Fowl: Books 1-4' }), book).tier).toBe('weak')
    expect(assessMatch(result('itunes', 'x', { title: 'Forget You Know Me', authors: ['Jessica Strawser'] }), book)).toMatchObject({
      tier: 'weak',
      authorMatch: false,
      titleMatch: 'different',
    })
  })

  it('matches an author by surname when the initials differ', () => {
    expect(assessMatch(result('google', 'x', { authors: ['E. Colfer'] }), book).authorMatch).toBe(true)
  })

  it('flags a record with little in it as sparse', () => {
    expect(assessMatch(result('hardcover', 'x'), book)).toMatchObject({ sparse: true, filledFields: 2 })
  })

  it('reads an Audible id the book holds as the link for an AudNexus record', () => {
    expect(assessMatch(result('audnexus', 'B0ASIN'), { ...book, providerIds: { audible: 'B0ASIN' } }).linked).toBe(true)
  })
})

describe('rankMatches', () => {
  it('orders by tier, then score, then provider order', () => {
    const linked = result('amazon', 'B002KP6DXQ', { seriesName: 'Artemis Fowl', seriesIndex: '1' })
    const alsoLinked = result('goodreads', '249747')
    const edition = result('hardcover', 'ed')
    const other = result('google', 'set', { title: 'Artemis Fowl: Books 1-4' })

    const ranked = rankMatches([other, edition, alsoLinked, linked], book, ['goodreads', 'amazon'])
    expect(ranked.map((match) => candidateKey(match.candidate))).toEqual(['amazon:B002KP6DXQ', 'goodreads:249747', 'hardcover:ed', 'google:set'])

    const groups = groupMatches(ranked)
    expect([groups.strong.length, groups.possible.length, groups.weak.length]).toEqual([2, 1, 1])
  })
})
