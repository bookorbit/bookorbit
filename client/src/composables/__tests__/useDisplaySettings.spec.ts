import { afterEach, describe, expect, it } from 'vitest'
import { applyDisplayPreferences, getDisplayPreferencesSnapshot, sanitizeDisplayPreferences, useDisplaySettings } from '../useDisplaySettings'

const settings = useDisplaySettings()

function resetDisplaySettings() {
  settings.portraitCoverSize.value = 130
  settings.squareCoverSize.value = 150
  settings.coverSizeScope.value = 'per-view'
  settings.gridGap.value = 28
  settings.portraitGridGap.value = 28
  settings.squareGridGap.value = 28
  settings.viewMode.value = 'grid'
  settings.cardOverlays.value = ['progress-bar', 'format', 'rating', 'read-status', 'series-position']
  settings.smartScopeFilterExpanded.value = true
  settings.authorCoverSize.value = 120
  settings.authorCoverShape.value = 'circle'
  settings.tableZebraStriping.value = false
  settings.tableDensity.value = 'comfortable'
  settings.bookSpineOverlay.value = 'off'
  settings.bookShadowStrength.value = 'default'
  settings.bookCoverDisplayMode.value = 'blurred-fit'
  settings.seriesCardCoverMode.value = 'mosaic'
  settings.gridCardPrimaryLabel.value = 'hidden'
  settings.gridCardSecondaryLabel.value = 'hidden'
}

afterEach(() => {
  resetDisplaySettings()
})

describe('useDisplaySettings preferences helpers', () => {
  it('returns a complete normalized display preferences snapshot', () => {
    settings.bookCoverDisplayMode.value = 'natural-bottom'
    settings.bookSpineOverlay.value = 'strong'
    settings.cardOverlays.value = ['format', 'format', 'provider' as never, 'rating']

    expect(getDisplayPreferencesSnapshot()).toMatchObject({
      portraitCoverSize: 130,
      squareCoverSize: 150,
      coverSizeScope: 'per-view',
      viewMode: 'grid',
      cardOverlays: ['format', 'rating'],
      bookSpineOverlay: 'strong',
      bookCoverDisplayMode: 'natural-bottom',
    })
  })

  it('sanitizes valid incoming preferences and drops invalid fields', () => {
    const sanitized = sanitizeDisplayPreferences({
      portraitCoverSize: 999,
      squareCoverSize: 'large',
      coverSizeScope: 'synced',
      cardOverlays: ['format', 'unknown', 'format', 'lock-status'],
      bookCoverDisplayMode: 'fill-crop',
      tableDensity: 'huge',
      extra: true,
    })

    expect(sanitized).toEqual({
      portraitCoverSize: 400,
      coverSizeScope: 'synced',
      cardOverlays: ['format', 'lock-status'],
      bookCoverDisplayMode: 'fill-crop',
    })
  })

  it('applies only sanitized fields to the singleton display settings', () => {
    applyDisplayPreferences({
      portraitCoverSize: 50,
      gridGap: 120,
      viewMode: 'table',
      authorCoverShape: 'square',
      tableZebraStriping: true,
      bookShadowStrength: 'strong',
      bookCoverDisplayMode: 'natural-bottom',
      tableDensity: 'invalid',
    })

    expect(settings.portraitCoverSize.value).toBe(100)
    expect(settings.gridGap.value).toBe(80)
    expect(settings.viewMode.value).toBe('table')
    expect(settings.authorCoverShape.value).toBe('square')
    expect(settings.tableZebraStriping.value).toBe(true)
    expect(settings.tableDensity.value).toBe('comfortable')
    expect(settings.bookShadowStrength.value).toBe('strong')
    expect(settings.bookCoverDisplayMode.value).toBe('natural-bottom')
  })

  it('ignores non-object payloads', () => {
    expect(sanitizeDisplayPreferences(null)).toEqual({})
    expect(sanitizeDisplayPreferences('bad')).toEqual({})
  })

  it('includes seriesCardCoverMode in snapshot', () => {
    settings.seriesCardCoverMode.value = 'first-volume'
    const snap = getDisplayPreferencesSnapshot()
    expect(snap.seriesCardCoverMode).toBe('first-volume')
  })

  it('sanitizes valid seriesCardCoverMode values', () => {
    const sanitized = sanitizeDisplayPreferences({ seriesCardCoverMode: 'latest-volume' })
    expect(sanitized).toEqual({ seriesCardCoverMode: 'latest-volume' })
  })

  it('drops invalid seriesCardCoverMode values', () => {
    const sanitized = sanitizeDisplayPreferences({ seriesCardCoverMode: 'unknown-mode' })
    expect(sanitized).toEqual({})
  })

  it('applies seriesCardCoverMode from preferences', () => {
    applyDisplayPreferences({ seriesCardCoverMode: 'first-unread' })
    expect(settings.seriesCardCoverMode.value).toBe('first-unread')
  })

  it('defaults seriesCardCoverMode to mosaic', () => {
    resetDisplaySettings()
    expect(settings.seriesCardCoverMode.value).toBe('mosaic')
  })

  it('includes gridCardPrimaryLabel and gridCardSecondaryLabel in snapshot', () => {
    settings.gridCardPrimaryLabel.value = 'book-title'
    settings.gridCardSecondaryLabel.value = 'author'
    const snap = getDisplayPreferencesSnapshot()
    expect(snap.gridCardPrimaryLabel).toBe('book-title')
    expect(snap.gridCardSecondaryLabel).toBe('author')
  })

  it('defaults both label fields to hidden', () => {
    resetDisplaySettings()
    expect(settings.gridCardPrimaryLabel.value).toBe('hidden')
    expect(settings.gridCardSecondaryLabel.value).toBe('hidden')
  })

  it('sanitizes valid gridCardPrimaryLabel values', () => {
    for (const value of ['hidden', 'book-title', 'series-title', 'series-title-position', 'author'] as const) {
      expect(sanitizeDisplayPreferences({ gridCardPrimaryLabel: value })).toEqual({ gridCardPrimaryLabel: value })
    }
  })

  it('sanitizes valid gridCardSecondaryLabel values', () => {
    for (const value of ['hidden', 'book-title', 'series-title', 'series-title-position', 'author'] as const) {
      expect(sanitizeDisplayPreferences({ gridCardSecondaryLabel: value })).toEqual({ gridCardSecondaryLabel: value })
    }
  })

  it('drops invalid gridCardPrimaryLabel values', () => {
    expect(sanitizeDisplayPreferences({ gridCardPrimaryLabel: 'unknown-field' })).toEqual({})
    expect(sanitizeDisplayPreferences({ gridCardPrimaryLabel: 42 })).toEqual({})
  })

  it('drops invalid gridCardSecondaryLabel values', () => {
    expect(sanitizeDisplayPreferences({ gridCardSecondaryLabel: 'bad-value' })).toEqual({})
  })

  it('applies gridCardPrimaryLabel and gridCardSecondaryLabel from preferences', () => {
    applyDisplayPreferences({ gridCardPrimaryLabel: 'series-title', gridCardSecondaryLabel: 'author' })
    expect(settings.gridCardPrimaryLabel.value).toBe('series-title')
    expect(settings.gridCardSecondaryLabel.value).toBe('author')
  })
})
