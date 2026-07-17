import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore } from '../theme'

function createColorSchemeQuery(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn<(type: string, listener: (event: MediaQueryListEvent) => void) => void>(
      (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener)
      },
    ),
    removeEventListener: vi.fn<(type: string, listener: (event: MediaQueryListEvent) => void) => void>(
      (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener)
      },
    ),
    addListener: vi.fn<() => void>(),
    removeListener: vi.fn<() => void>(),
    dispatchEvent: vi.fn<() => boolean>(() => true),
  }

  return {
    query: query as unknown as MediaQueryList,
    change(nextMatches: boolean) {
      query.matches = nextMatches
      const event = { matches: nextMatches, media: query.media } as MediaQueryListEvent
      listeners.forEach((listener) => listener(event))
    },
  }
}

function stubColorScheme(query: MediaQueryList) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn<(media: string) => MediaQueryList>(() => query),
  )
}

describe('useThemeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it.each([
    { systemDark: false, expected: 'light', hasDarkClass: false },
    { systemDark: true, expected: 'dark', hasDarkClass: true },
  ])('defaults to the resolved system theme when systemDark=$systemDark', ({ systemDark, expected, hasDarkClass }) => {
    const colorScheme = createColorSchemeQuery(systemDark)
    stubColorScheme(colorScheme.query)
    setActivePinia(createPinia())

    const store = useThemeStore()

    expect(store.theme).toBe('system')
    expect(store.resolvedTheme).toBe(expected)
    expect(document.documentElement.classList.contains('dark')).toBe(hasDarkClass)
    expect(localStorage.getItem('theme')).toBe('"system"')
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)')
  })

  it('follows live system color scheme changes while system is selected', async () => {
    const colorScheme = createColorSchemeQuery(false)
    stubColorScheme(colorScheme.query)
    setActivePinia(createPinia())
    const store = useThemeStore()

    colorScheme.change(true)
    await nextTick()

    expect(store.theme).toBe('system')
    expect(store.resolvedTheme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('"system"')

    colorScheme.change(false)
    await nextTick()

    expect(store.resolvedTheme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('keeps an explicit selection when the system color scheme changes', async () => {
    const colorScheme = createColorSchemeQuery(false)
    stubColorScheme(colorScheme.query)
    setActivePinia(createPinia())
    const store = useThemeStore()

    store.setTheme('light')
    colorScheme.change(true)
    await nextTick()

    expect(store.theme).toBe('light')
    expect(store.resolvedTheme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    store.setTheme('system')
    await nextTick()

    expect(store.resolvedTheme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('restores saved system and explicit selections and rejects invalid stored values', () => {
    const colorScheme = createColorSchemeQuery(true)
    stubColorScheme(colorScheme.query)

    localStorage.setItem('theme', '"light"')
    setActivePinia(createPinia())
    expect(useThemeStore().theme).toBe('light')

    localStorage.setItem('theme', '"system"')
    setActivePinia(createPinia())
    expect(useThemeStore().theme).toBe('system')

    localStorage.setItem('theme', '"sepia"')
    setActivePinia(createPinia())
    expect(useThemeStore().theme).toBe('system')
  })

  it('toggles away from system based on the currently resolved theme', async () => {
    const colorScheme = createColorSchemeQuery(true)
    stubColorScheme(colorScheme.query)
    setActivePinia(createPinia())
    const store = useThemeStore()

    store.toggleTheme()
    await nextTick()

    expect(store.theme).toBe('light')
    expect(store.resolvedTheme).toBe('light')
    expect(localStorage.getItem('theme')).toBe('"light"')
  })

  it('removes the system color scheme listener when the store is disposed', () => {
    const colorScheme = createColorSchemeQuery(false)
    stubColorScheme(colorScheme.query)
    setActivePinia(createPinia())
    const store = useThemeStore()

    store.$dispose()

    expect(colorScheme.query.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('falls back to light when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    setActivePinia(createPinia())

    const store = useThemeStore()

    expect(store.theme).toBe('system')
    expect(store.resolvedTheme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})
