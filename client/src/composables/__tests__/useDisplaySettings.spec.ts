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
})
