import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInThisContext } from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const themeInitSource = readFileSync(resolve(process.cwd(), 'public/theme-init.js'), 'utf8')

function runThemeInit(systemDark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn<(query: string) => Pick<MediaQueryList, 'matches' | 'media'>>((query: string) => ({ matches: systemDark, media: query })),
  )
  runInThisContext(themeInitSource)
}

describe('theme-init', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ''
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
})
