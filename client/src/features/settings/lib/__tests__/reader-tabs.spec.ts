import { describe, expect, it } from 'vitest'
import { READER_TABS, normalizeReaderTab } from '../reader-tabs'

describe('reader-tabs', () => {
  it('includes fonts tab in READER_TABS', () => {
    expect(READER_TABS).toContain('fonts')
  })

  describe('normalizeReaderTab', () => {
    it('returns valid tab unchanged', () => {
      for (const tab of READER_TABS) {
        expect(normalizeReaderTab(tab)).toBe(tab)
      }
    })

    it('returns ebook for unknown string', () => {
      expect(normalizeReaderTab('unknown')).toBe('ebook')
      expect(normalizeReaderTab('manage')).toBe('ebook')
    })

    it('returns ebook for null and undefined', () => {
      expect(normalizeReaderTab(null)).toBe('ebook')
      expect(normalizeReaderTab(undefined)).toBe('ebook')
    })

    it('returns ebook for non-string values', () => {
      expect(normalizeReaderTab(42)).toBe('ebook')
      expect(normalizeReaderTab({})).toBe('ebook')
    })

    it('returns fonts for fonts tab', () => {
      expect(normalizeReaderTab('fonts')).toBe('fonts')
    })
  })
})
