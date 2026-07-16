import { describe, expect, it } from 'vitest'
import { METADATA_TABS, normalizeMetadataTab } from '../metadata-tabs'

describe('metadata tabs', () => {
  it('keeps genre blocklist as the final metadata tab', () => {
    expect(METADATA_TABS).toEqual(['providers', 'field-rules', 'custom-fields', 'score', 'auto-fetch', 'authors', 'genre-blocklist'])
  })

  it('normalizes supported metadata tabs and falls back to providers', () => {
    expect(normalizeMetadataTab('custom-fields')).toBe('custom-fields')
    expect(normalizeMetadataTab('genre-blocklist')).toBe('genre-blocklist')
    expect(normalizeMetadataTab('unknown')).toBe('providers')
  })
})
