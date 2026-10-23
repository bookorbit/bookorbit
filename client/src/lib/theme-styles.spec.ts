import { describe, expect, it } from 'vitest'
import { STYLE_IDS, SURFACE_PALETTE_IDS } from '@bookorbit/types'
import en from '@/locales/en.json'
import { SURFACE_PALETTES, THEME_STYLES, getAppearanceControls, getThemeStyle, isAppShellPath } from './theme-styles'

function lookup(key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en)
}

describe('theme styles', () => {
  it('defines every style id once, in order', () => {
    expect(THEME_STYLES.map((style) => style.id)).toEqual([...STYLE_IDS])
  })

  it('gives every style and palette an English label', () => {
    const keys = [...THEME_STYLES.flatMap((style) => [style.labelKey, style.descriptionKey]), ...SURFACE_PALETTES.map((palette) => palette.labelKey)]
    expect(keys.filter((key) => typeof lookup(key) !== 'string')).toEqual([])
    expect(SURFACE_PALETTES.map((palette) => palette.id)).toEqual([...SURFACE_PALETTE_IDS])
  })

  it('only gives Nostalgia the surface palette control', () => {
    expect(getThemeStyle('bookorbit').controls.surfacePalette).toBe(false)
    expect(getThemeStyle('nostalgia').controls.surfacePalette).toBe(true)
  })

  it('pins no pattern, solid panels and no lift for Nostalgia, and hides those controls', () => {
    expect(getThemeStyle('nostalgia').pinned).toEqual({ background: 'none', brightness: 0, surfaceOpacity: 100 })
    expect(getAppearanceControls('nostalgia')).toEqual({ surfacePalette: true, background: false, surfaceOpacity: false, brightness: false })
    expect(getAppearanceControls('bookorbit')).toEqual({ surfacePalette: false, background: true, surfaceOpacity: true, brightness: true })
  })
})

describe('isAppShellPath', () => {
  it.each(['/', '/library/3', '/book/12', '/settings/appearance/theme', '/reader-settings', '/loginx'])('treats %s as the app shell', (path) => {
    expect(isAppShellPath(path)).toBe(true)
  })

  it.each(['/login', '/register', '/setup', '/forgot-password', '/reset-password', '/oauth2-callback', '/magic', '/read/4/9'])(
    'treats %s as standalone',
    (path) => {
      expect(isAppShellPath(path)).toBe(false)
    },
  )
})
