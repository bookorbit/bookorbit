import { describe, expect, it } from 'vitest'
import { APPEARANCE_TAB_LABELS, APPEARANCE_TAB_TITLE_LABELS, APPEARANCE_TABS, normalizeAppearanceTab } from '../appearance-tabs'

describe('appearance-tabs', () => {
  it('keeps the public tab order stable', () => {
    expect(APPEARANCE_TABS).toEqual(['theme', 'book-covers', 'icons', 'layout', 'behavior'])
  })

  it('has nav and title labels for every tab', () => {
    for (const tab of APPEARANCE_TABS) {
      expect(APPEARANCE_TAB_LABELS[tab]).toBeTruthy()
      expect(APPEARANCE_TAB_TITLE_LABELS[tab]).toBeTruthy()
    }
  })

  it('normalizes invalid values to theme', () => {
    expect(normalizeAppearanceTab('unknown')).toBe('theme')
    expect(normalizeAppearanceTab(null)).toBe('theme')
    expect(normalizeAppearanceTab(undefined)).toBe('theme')
    expect(normalizeAppearanceTab({})).toBe('theme')
  })

  it('returns valid tabs unchanged', () => {
    for (const tab of APPEARANCE_TABS) {
      expect(normalizeAppearanceTab(tab)).toBe(tab)
    }
  })
})
