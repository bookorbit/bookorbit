// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ReleaseCandidateItem } from '@bookorbit/types'
import { facetsOf, formatKey, formatKeys, languageKey } from '../releaseFacets'

function release(overrides: Partial<ReleaseCandidateItem> = {}): ReleaseCandidateItem {
  return {
    indexerId: 1,
    indexerName: 'jackett',
    guid: 'g1',
    title: 'Dune',
    sizeBytes: null,
    seeders: null,
    leechers: null,
    format: null,
    formats: [],
    language: null,
    fileCount: null,
    freeleech: false,
    vipOnly: false,
    alreadyGrabbed: false,
    publishedAt: null,
    audio: null,
    score: 50,
    tier: null,
    tierName: null,
    reasons: [],
    ...overrides,
  }
}

/**
 * The picker groups its language and format facets by resolved name rather than by the raw string
 * the indexer sent. These lock in the collisions that made it necessary: MyAnonaMouse reports
 * "ENG" where Project Gutenberg reports "en", and both render as English. Faceting on the raw code
 * produced two chips reading "English", and picking either silently hid the other's releases.
 */
describe('release language faceting', () => {
  it('resolves the two spellings indexers actually send to the same name', () => {
    expect(languageKey('ENG')).toBe(languageKey('en'))
  })

  it('collapses them into one facet rather than two chips reading English', () => {
    const releases = [{ language: 'ENG' }, { language: 'ENG' }, { language: 'en' }, { language: 'fi' }, { language: null }]

    const facets = facetsOf(releases, (item) => languageKey(item.language))

    expect(facets).toEqual([
      { value: 'English', count: 3 },
      { value: 'Finnish', count: 1 },
    ])
  })

  it('leaves a code it cannot resolve alone rather than dropping the releases', () => {
    expect(languageKey('zzz')).toBe('zzz')
  })
})

describe('release format faceting', () => {
  it('treats a format as one value regardless of the case the indexer used', () => {
    const releases = [release({ formats: ['epub'] }), release({ formats: ['EPUB'] }), release({ formats: ['Epub'] }), release({ formats: ['pdf'] })]

    expect(facetsOf(releases, formatKeys)).toEqual([
      { value: 'EPUB', count: 3 },
      { value: 'PDF', count: 1 },
    ])
  })

  it('ignores a release that states no format at all', () => {
    expect(facetsOf([release(), release({ formats: ['EPUB'] })], formatKeys)).toEqual([{ value: 'EPUB', count: 1 }])
  })

  /**
   * The bug this exists to prevent. MyAnonaMouse publishes "azw3 epub mobi" for one book in three
   * formats; counting it under only the first left the EPUB chip reading 1, and choosing that chip
   * hid the very release that carried the requested EPUB.
   */
  it('counts a multi-format release under every format it carries', () => {
    const releases = [release({ formats: ['epub', 'azw3', 'mobi'] }), release({ formats: ['epub'] })]

    expect(facetsOf(releases, formatKeys)).toEqual([
      { value: 'EPUB', count: 2 },
      { value: 'AZW3', count: 1 },
      { value: 'MOBI', count: 1 },
    ])
  })

  it('counts a release once per format even where the indexer repeated one', () => {
    expect(facetsOf([release({ formats: ['epub', 'EPUB'] })], formatKeys)).toEqual([{ value: 'EPUB', count: 1 }])
  })

  it('normalises a single format the same way as a list', () => {
    expect(formatKey('epub')).toBe('EPUB')
    expect(formatKey(null)).toBeNull()
  })
})
