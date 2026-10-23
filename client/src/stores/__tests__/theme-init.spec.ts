import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInThisContext } from 'node:vm'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_STYLE, DEFAULT_SURFACE_PALETTE, GLOW_REACH_DEFAULT } from '@bookorbit/types'
import { DEFAULT_ACCENT } from '@/lib/theme-accent-meta'
import { STANDALONE_ROUTE_PREFIXES, isAppShellPath } from '@/lib/theme-styles'
import { routes } from '@/router'
import { DEFAULT_RADIUS, useThemeStore } from '../theme'

const themeInitSource = readFileSync(resolve(process.cwd(), 'public/theme-init.js'), 'utf8')

function runThemeInit(systemDark: boolean, path = '/') {
  window.history.replaceState(null, '', path)
  vi.stubGlobal(
    'matchMedia',
    vi.fn<(query: string) => Pick<MediaQueryList, 'matches' | 'media' | 'addEventListener' | 'removeEventListener'>>((query: string) => ({
      matches: systemDark,
      media: query,
      addEventListener: vi.fn<MediaQueryList['addEventListener']>(),
      removeEventListener: vi.fn<MediaQueryList['removeEventListener']>(),
    })),
  )
  runInThisContext(themeInitSource)
}

describe('theme-init', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
    document.documentElement.removeAttribute('data-style')
    document.documentElement.removeAttribute('data-surface')
  })

  it.each([
    { systemDark: false, expectedDark: false },
    { systemDark: true, expectedDark: true },
  ])('defaults to the system color scheme when systemDark=$systemDark', ({ systemDark, expectedDark }) => {
    runThemeInit(systemDark)

    expect(document.documentElement.classList.contains('dark')).toBe(expectedDark)
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
  })

  it('resolves a saved system preference before the app mounts', () => {
    localStorage.setItem('theme', JSON.stringify('system'))

    runThemeInit(true)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it.each([
    { theme: 'light', systemDark: true, expectedDark: false },
    { theme: 'dark', systemDark: false, expectedDark: true },
  ])('lets an explicit $theme preference override the system', ({ theme, systemDark, expectedDark }) => {
    localStorage.setItem('theme', JSON.stringify(theme))

    runThemeInit(systemDark)

    expect(document.documentElement.classList.contains('dark')).toBe(expectedDark)
  })

  it('supports legacy unquoted preferences and parses other stored appearance values', () => {
    localStorage.setItem('theme', 'dark')
    localStorage.setItem('accent', JSON.stringify('blue'))
    localStorage.setItem('radius', JSON.stringify('rounded'))

    runThemeInit(false)

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('accent-blue')).toBe(true)
    expect(document.documentElement.classList.contains('radius-rounded')).toBe(true)
  })

  it('paints the same defaults the theme store starts from', () => {
    runThemeInit(false)
    const painted = {
      accent: document.documentElement.className,
      style: document.documentElement.getAttribute('data-style'),
      surface: document.documentElement.getAttribute('data-surface'),
    }

    document.documentElement.className = ''
    setActivePinia(createPinia())
    const store = useThemeStore()

    expect(store.accent).toBe(DEFAULT_ACCENT)
    expect(painted.accent).toContain(`accent-${DEFAULT_ACCENT}`)
    expect(store.radius).toBe(DEFAULT_RADIUS)
    expect(painted.accent).not.toContain('radius-')
    expect(painted.style).toBe(DEFAULT_STYLE)
    expect(painted.surface).toBe(DEFAULT_SURFACE_PALETTE)
  })

  it('paints a saved style and surface palette inside the app shell', () => {
    localStorage.setItem('style', JSON.stringify('nostalgia'))
    localStorage.setItem('surfacePalette', JSON.stringify('sepia'))

    runThemeInit(true, '/library/3')

    expect(document.documentElement.getAttribute('data-style')).toBe('nostalgia')
    expect(document.documentElement.getAttribute('data-surface')).toBe('sepia')
  })

  it.each(['/login', '/read/4/9', '/reset-password'])('keeps %s on the BookOrbit style', (path) => {
    localStorage.setItem('style', JSON.stringify('nostalgia'))

    runThemeInit(true, path)

    expect(document.documentElement.getAttribute('data-style')).toBe('bookorbit')
  })

  it('paints the stored glow reach, off at zero', () => {
    runThemeInit(false)
    expect(document.documentElement.getAttribute('data-glow')).toBe('on')
    expect(document.documentElement.style.getPropertyValue('--glow-reach')).toBe(String(GLOW_REACH_DEFAULT / 100))

    localStorage.setItem('glowReach', JSON.stringify(60))
    runThemeInit(false)
    expect(document.documentElement.style.getPropertyValue('--glow-reach')).toBe('0.6')

    localStorage.setItem('glowReach', JSON.stringify(0))
    runThemeInit(false)
    expect(document.documentElement.getAttribute('data-glow')).toBe('off')
  })

  it('ignores stored values that are not strings', () => {
    localStorage.setItem('accent', JSON.stringify(42))

    runThemeInit(false)

    expect(document.documentElement.classList.contains(`accent-${DEFAULT_ACCENT}`)).toBe(true)
  })
})

describe('style scope paths', () => {
  it('mirrors the standalone prefixes of the app', () => {
    const literal = /STANDALONE_ROUTE_PREFIXES = (\[[^\]]*\])/.exec(themeInitSource)?.[1]
    expect(JSON.parse(literal!.replace(/'/g, '"'))).toEqual([...STANDALONE_ROUTE_PREFIXES])
  })

  it('treats exactly the top-level routes outside the app shell as standalone', () => {
    const misclassified = routes
      .filter((record) => !record.redirect)
      .filter((record) => isAppShellPath(record.path.replace(/:[^/]+/g, '1')) !== (record.path === '/'))
      .map((record) => record.path)
    expect(misclassified).toEqual([])
  })
})
