// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { MetadataCandidate, MetadataSource } from '@bookorbit/types'
import {
  classifyDate,
  classifyDescription,
  classifyIdentifier,
  classifyLanguage,
  classifyList,
  classifyNumber,
  classifyRating,
  classifyText,
  descriptionPlainText,
  summarizeDifferences,
} from '../metadata-diff-fields'

describe('difference kinds', () => {
  it('reads an empty book field as a fill and an empty offer as missing', () => {
    expect(classifyText('', 'Dune')).toEqual({ kind: 'fill' })
    expect(classifyText('Dune', '  ')).toEqual({ kind: 'missing' })
  })

  it('tells capitalization and punctuation apart from a real change', () => {
    expect(classifyText('Dune', 'Dune')).toEqual({ kind: 'same' })
    expect(classifyText('Dune Messiah', 'dune messiah')).toEqual({ kind: 'minor', reason: 'capitalization' })
    expect(classifyText('Dune: Messiah', 'Dune Messiah')).toEqual({ kind: 'minor', reason: 'punctuation' })
    expect(classifyText('Miramax', 'Disney Hyperion')).toEqual({ kind: 'change' })
  })

  it('compares lists as sets, so the same genres in another order are only reordered', () => {
    expect(classifyList(['Fantasy', 'Fiction'], ['Fiction', 'Fantasy'])).toEqual({ kind: 'minor', reason: 'reordered' })
    expect(classifyList(['Fantasy'], ['fantasy'])).toEqual({ kind: 'minor', reason: 'capitalization' })
    expect(classifyList(['Fantasy'], ['Fantasy', 'Magic'])).toEqual({ kind: 'change' })
    expect(classifyList([], ['Magic'])).toEqual({ kind: 'fill' })
  })

  it('sees markup-only description changes as formatting', () => {
    expect(classifyDescription('<p>A <i>bold</i> start.</p>', 'A bold start.')).toEqual({ kind: 'minor', reason: 'formatting' })
    expect(classifyDescription('A bold start.', 'A timid start.')).toEqual({ kind: 'change' })
  })

  it('treats a bare year against a full date of the same year as minor', () => {
    expect(classifyDate('2003-04-01', '2003')).toEqual({ kind: 'minor', reason: 'yearOnly' })
    expect(classifyDate('2003', '2003-04-01')).toEqual({ kind: 'minor', reason: 'addsDay' })
    expect(classifyDate('2003-04-01', '2009-08-07')).toEqual({ kind: 'change' })
  })

  it('reads a language code and its name as the same language', () => {
    expect(classifyLanguage('English', 'en')).toEqual({ kind: 'minor', reason: 'languageCode' })
    expect(classifyLanguage('English', 'fr')).toEqual({ kind: 'change' })
  })

  it('compares numbers by value and identifiers without their separators', () => {
    expect(classifyNumber('1', 1)).toEqual({ kind: 'same' })
    expect(classifyNumber(396, 420)).toEqual({ kind: 'change' })
    expect(classifyIdentifier('978-1-4231-3217-2', '9781423132172')).toEqual({ kind: 'minor', reason: 'formatting' })
  })

  it('treats a new rating count with the same rating as minor', () => {
    expect(classifyRating({ rating: 4.4, ratingCount: 9846 }, { rating: 4.4, ratingCount: 9771 })).toEqual({ kind: 'minor', reason: 'ratingCount' })
    expect(classifyRating({ rating: 3.9, ratingCount: 10 }, { rating: 4.4, ratingCount: 10 })).toEqual({ kind: 'change' })
  })
})

describe('descriptionPlainText', () => {
  it('keeps paragraph breaks and decodes entities', () => {
    expect(descriptionPlainText('<p>She lost her daughter&nbsp;once.</p><p>Then&#8212;the letter &amp; more.</p>')).toBe(
      'She lost her daughter once.\n\nThen\u2014the letter & more.',
    )
  })
})

describe('summarizeDifferences', () => {
  const current: MetadataSource = {
    title: 'Artemis Fowl',
    subtitle: null,
    authors: ['Eoin Colfer'],
    genres: ['Fantasy', 'Fiction'],
    description: null,
    publisher: 'Miramax',
    publishedDate: '2003-04-01',
    publishedYear: 2003,
    language: 'English',
    pageCount: 396,
    seriesName: 'Artemis Fowl',
    seriesIndex: '1',
    isbn10: null,
    isbn13: null,
    narrators: [],
    durationSeconds: null,
    abridged: null,
    hardcoverEditionId: null,
    communityRatings: [],
  }

  it('counts fills and real changes, leaving minor differences out', () => {
    const candidate: MetadataCandidate = {
      provider: 'amazon',
      providerId: 'B002KP6DXQ',
      title: 'Artemis Fowl',
      authors: ['Eoin Colfer'],
      genres: ['Fiction', 'Fantasy'],
      publisher: 'Disney Hyperion',
      language: 'en',
      pageCount: 420,
      isbn13: '9781423132172',
    }

    expect(summarizeDifferences(current, candidate, { amazon: 'B002KP6DXQ' })).toEqual({ fills: 1, changes: 2 })
  })
})
