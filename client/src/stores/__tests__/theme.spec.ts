import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GLOW_REACH_DEFAULT } from '@bookorbit/types'
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

  it('replaces the removed terminal background preference with dots', () => {
    const colorScheme = createColorSchemeQuery(false)
    stubColorScheme(colorScheme.query)
    localStorage.setItem('background', '"terminal"')
    setActivePinia(createPinia())

    const store = useThemeStore()

    expect(store.background).toBe('dots')
    expect(localStorage.getItem('background')).toBe('"dots"')
  })

  describe('surfaceOpacity', () => {
    beforeEach(() => {
      const colorScheme = createColorSchemeQuery(false)
      stubColorScheme(colorScheme.query)
      document.documentElement.style.removeProperty('--shell-surface-opacity')
    })

    it('defaults to 92% and writes the shell CSS variable', () => {
      setActivePinia(createPinia())

      const store = useThemeStore()

      expect(store.surfaceOpacity).toBe(92)
      expect(document.documentElement.style.getPropertyValue('--shell-surface-opacity')).toBe('92%')
      expect(localStorage.getItem('surfaceOpacity')).toBe('92')
    })

    it.each([
      { input: 79, expected: 80 },
      { input: 80, expected: 80 },
      { input: 100, expected: 100 },
      { input: 140, expected: 100 },
      { input: 87.6, expected: 88 },
    ])('clamps $input to $expected', async ({ input, expected }) => {
      setActivePinia(createPinia())
      const store = useThemeStore()

      store.setSurfaceOpacity(input)
      await nextTick()

      expect(store.surfaceOpacity).toBe(expected)
      expect(document.documentElement.style.getPropertyValue('--shell-surface-opacity')).toBe(`${expected}%`)
    })

    it('falls back to the default when the stored value is unusable', () => {
      localStorage.setItem('surfaceOpacity', '"not-a-number"')
      setActivePinia(createPinia())

      expect(useThemeStore().surfaceOpacity).toBe(92)
    })

    it('restores a stored value inside the supported range', () => {
      localStorage.setItem('surfaceOpacity', '84')
      setActivePinia(createPinia())

      expect(useThemeStore().surfaceOpacity).toBe(84)
    })
  })

  describe('style', () => {
    beforeEach(() => {
      stubColorScheme(createColorSchemeQuery(true).query)
      window.history.replaceState(null, '', '/')
      document.documentElement.removeAttribute('data-style')
      document.documentElement.removeAttribute('data-surface')
    })

    it('starts on the BookOrbit style with the steel palette', () => {
      setActivePinia(createPinia())
      const store = useThemeStore()

      expect(store.style).toBe('bookorbit')
      expect(store.surfacePalette).toBe('steel')
      expect(document.documentElement.getAttribute('data-style')).toBe('bookorbit')
      expect(document.documentElement.getAttribute('data-surface')).toBe('steel')
    })

    it('paints a style and surface palette as soon as they are set, then persists them', async () => {
      setActivePinia(createPinia())
      const store = useThemeStore()

      store.setStyle('nostalgia')
      store.setSurfacePalette('sepia')

      expect(document.documentElement.getAttribute('data-style')).toBe('nostalgia')
      expect(document.documentElement.getAttribute('data-surface')).toBe('sepia')
      await nextTick()
      expect(localStorage.getItem('style')).toBe('"nostalgia"')
      expect(localStorage.getItem('surfacePalette')).toBe('"sepia"')
    })

    it('rejects unknown stored ids', () => {
      localStorage.setItem('style', '"retro"')
      localStorage.setItem('surfacePalette', '"teal"')
      setActivePinia(createPinia())
      const store = useThemeStore()

      expect(store.style).toBe('bookorbit')
      expect(store.surfacePalette).toBe('steel')
    })

    it('keeps the accent, radius and background when the style changes', () => {
      setActivePinia(createPinia())
      const store = useThemeStore()
      store.setAccent('rose')
      store.setRadius('pill')
      store.setBackground('aurora')

      store.setStyle('nostalgia')

      expect(store.accent).toBe('rose')
      expect(store.radius).toBe('pill')
      expect(store.background).toBe('aurora')
    })

    it('paints BookOrbit outside the app shell and the chosen style inside it', () => {
      localStorage.setItem('style', '"nostalgia"')
      window.history.replaceState(null, '', '/login')
      setActivePinia(createPinia())
      const store = useThemeStore()

      expect(store.style).toBe('nostalgia')
      expect(store.appliedStyle).toBe('bookorbit')
      expect(document.documentElement.getAttribute('data-style')).toBe('bookorbit')

      store.setStyleScopeActive(true)

      expect(document.documentElement.getAttribute('data-style')).toBe('nostalgia')
    })

    it('exposes the controls of the selected style', () => {
      setActivePinia(createPinia())
      const store = useThemeStore()

      expect(store.styleDefinition.controls.surfacePalette).toBe(false)
      store.setStyle('nostalgia')
      expect(store.styleDefinition.controls.surfacePalette).toBe(true)
    })

    it('changes the appearance key only for settings that change token values', () => {
      setActivePinia(createPinia())
      const store = useThemeStore()
      const initial = store.appearanceKey

      store.setSurfacePalette('olive')
      expect(store.appearanceKey).toBe(initial)

      store.setStyle('nostalgia')
      const nostalgia = store.appearanceKey
      expect(nostalgia).not.toBe(initial)

      store.setSurfacePalette('pine')
      expect(store.appearanceKey).not.toBe(nostalgia)

      const beforeRadius = store.appearanceKey
      store.setRadius('sharp')
      expect(store.appearanceKey).toBe(beforeRadius)
    })

    it('paints the pinned brightness and opacity under Nostalgia and keeps the stored ones', async () => {
      localStorage.setItem('brightness', '80')
      localStorage.setItem('surfaceOpacity', '85')
      setActivePinia(createPinia())
      const store = useThemeStore()
      const root = document.documentElement

      expect(root.style.getPropertyValue('--bg-lift')).toBe('0.0960')
      expect(root.style.getPropertyValue('--shell-surface-opacity')).toBe('85%')

      store.setStyle('nostalgia')
      expect(root.style.getPropertyValue('--bg-lift')).toBe('0.0000')
      expect(root.style.getPropertyValue('--shell-surface-opacity')).toBe('100%')
      expect(store.brightness).toBe(80)
      expect(store.surfaceOpacity).toBe(85)
      expect(store.appearanceControls).toEqual({ surfacePalette: true, background: false, surfaceOpacity: false, brightness: false })

      const pinnedKey = store.appearanceKey
      store.setBrightness(20)
      expect(store.appearanceKey).toBe(pinnedKey)
      expect(root.style.getPropertyValue('--bg-lift')).toBe('0.0000')

      store.setStyle('bookorbit')
      expect(root.style.getPropertyValue('--bg-lift')).toBe('0.0240')
      expect(root.style.getPropertyValue('--shell-surface-opacity')).toBe('85%')
      await nextTick()
      expect(localStorage.getItem('brightness')).toBe('20')
    })

    it('keeps the stored brightness outside the app shell, where the BookOrbit style applies', () => {
      localStorage.setItem('style', '"nostalgia"')
      localStorage.setItem('brightness', '50')
      window.history.replaceState(null, '', '/login')
      setActivePinia(createPinia())
      const store = useThemeStore()

      expect(store.appliedStyle).toBe('bookorbit')
      expect(document.documentElement.style.getPropertyValue('--bg-lift')).toBe('0.0600')
    })

    it('drops the background pattern under Nostalgia and restores the stored one after', () => {
      localStorage.setItem('background', '"aurora"')
      setActivePinia(createPinia())
      const store = useThemeStore()

      expect(document.body.classList.contains('pattern-aurora')).toBe(true)
      store.setStyle('nostalgia')
      expect(document.body.classList.contains('pattern-aurora')).toBe(false)
      expect(store.appliedBackgroundClass).toBe('')
      expect(store.background).toBe('aurora')
      store.setStyle('bookorbit')
      expect(document.body.classList.contains('pattern-aurora')).toBe(true)
    })

    it('paints the default glow reach and turns the glow off at zero', async () => {
      setActivePinia(createPinia())
      const store = useThemeStore()
      const root = document.documentElement

      expect(store.glowReach).toBe(GLOW_REACH_DEFAULT)
      expect(root.style.getPropertyValue('--glow-reach')).toBe(String(GLOW_REACH_DEFAULT / 100))
      expect(root.getAttribute('data-glow')).toBe('on')

      store.setGlowReach(150)
      expect(root.style.getPropertyValue('--glow-reach')).toBe('1.5')

      store.setGlowReach(0)
      expect(root.getAttribute('data-glow')).toBe('off')
      await nextTick()
      expect(localStorage.getItem('glowReach')).toBe('0')
    })

    it('clamps the glow reach to its range and rejects unusable stored values', () => {
      localStorage.setItem('glowReach', '"far"')
      setActivePinia(createPinia())
      const store = useThemeStore()

      expect(store.glowReach).toBe(GLOW_REACH_DEFAULT)
      store.setGlowReach(500)
      expect(store.glowReach).toBe(200)
      store.setGlowReach(-20)
      expect(store.glowReach).toBe(0)
    })
  })
})
