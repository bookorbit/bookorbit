import { describe, expect, it } from 'vitest'
import { READER_TABS, READER_TAB_LABELS, READER_TAB_TITLE_LABELS, normalizeReaderTab } from '../reader-tabs'

describe('reader-tabs', () => {
  it('includes fonts tab in READER_TABS', () => {
    expect(READER_TABS).toContain('fonts')
  })

  it('has labels for all tabs', () => {
    for (const tab of READER_TABS) {
      expect(READER_TAB_LABELS[tab]).toBeTruthy()
      expect(READER_TAB_TITLE_LABELS[tab]).toBeTruthy()
    }
  })

  it('fonts tab has correct labels', () => {
    expect(READER_TAB_LABELS['fonts']).toBe('Fonts')
    expect(READER_TAB_TITLE_LABELS['fonts']).toBe('Reader Fonts')
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
