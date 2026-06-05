import { describe, expect, it } from 'vitest'
import { METADATA_TAB_INFO, METADATA_TABS, normalizeMetadataTab } from '../metadata-tabs'

describe('metadata tabs', () => {
  it('keeps genre blocklist as the final metadata tab', () => {
    expect(METADATA_TABS).toEqual(['providers', 'field-rules', 'score', 'auto-fetch', 'authors', 'genre-blocklist'])
    expect(METADATA_TAB_INFO['genre-blocklist'].navLabel).toBe('Genre Blocklist')
  })

  it('normalizes supported metadata tabs and falls back to providers', () => {
    expect(normalizeMetadataTab('genre-blocklist')).toBe('genre-blocklist')
    expect(normalizeMetadataTab('unknown')).toBe('providers')
  })
})
