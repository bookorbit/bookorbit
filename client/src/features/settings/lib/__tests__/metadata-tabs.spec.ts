import { describe, expect, it } from 'vitest'
import { METADATA_TABS, normalizeMetadataTab } from '../metadata-tabs'

describe('metadata tabs', () => {
  it('places reminders last after genre blocklist', () => {
    expect(METADATA_TABS).toEqual([
      'providers',
      'field-rules',
      'custom-fields',
      'score',
      'auto-fetch',
      'authors',
      'search-cache',
      'genre-blocklist',
      'reminders',
    ])
  })

  it('normalizes supported metadata tabs and falls back to providers', () => {
    expect(normalizeMetadataTab('custom-fields')).toBe('custom-fields')
    expect(normalizeMetadataTab('genre-blocklist')).toBe('genre-blocklist')
    expect(normalizeMetadataTab('search-cache')).toBe('search-cache')
    expect(normalizeMetadataTab('reminders')).toBe('reminders')
    expect(normalizeMetadataTab('unknown')).toBe('providers')
  })
})
