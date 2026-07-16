import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'
import {
  BACKGROUND_IDS,
  type Background,
  ACCENT_IDS,
  type Accent,
  RADIUS_IDS,
  type Radius,
  THEME_IDS,
  type ResolvedTheme,
  type Theme,
} from '@bookorbit/types'
import { storage } from '@/services/storage'

export { ACCENT_VIVID, ACCENT_PASTEL, ACCENT_OPTIONS } from '@/lib/theme-accent-meta'

export const RADIUS_OPTIONS: { id: Radius; label: string }[] = [
  { id: 'sharp', label: 'Sharp' },
  { id: 'default', label: 'Default' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'pill', label: 'Pill' },
]

export const BACKGROUND_OPTIONS: { id: Background; label: string; cssClass: string }[] = [
  // Fundamental
  { id: 'none', label: 'None', cssClass: '' },
  { id: 'dots', label: 'Dots', cssClass: 'pattern-dots' },
  { id: 'cross', label: 'Cross', cssClass: 'pattern-cross' },
  { id: 'terminal', label: 'Terminal', cssClass: 'pattern-terminal' },
  { id: 'millimeter', label: 'Millimeter', cssClass: 'pattern-millimeter' },

  // Structural
  { id: 'blueprint', label: 'Blueprint', cssClass: 'pattern-blueprint' },
  { id: 'brushed', label: 'Brushed', cssClass: 'pattern-brushed' },
  { id: 'scanlines', label: 'Scanlines', cssClass: 'pattern-scanlines' },
  { id: 'vinyl', label: 'Vinyl', cssClass: 'pattern-vinyl' },
  { id: 'carbon', label: 'Carbon', cssClass: 'pattern-carbon' },
  { id: 'perforated', label: 'Perforated', cssClass: 'pattern-perforated' },

  // Ambient
  { id: 'aurora', label: 'Aurora', cssClass: 'pattern-aurora' },
  { id: 'horizon', label: 'Horizon', cssClass: 'pattern-horizon' },
  { id: 'glow', label: 'Glow', cssClass: 'pattern-glow' },
  { id: 'mesh', label: 'Mesh', cssClass: 'pattern-mesh' },
  { id: 'elevation', label: 'Elevation', cssClass: 'pattern-elevation' },

  // Refractive
  { id: 'prism', label: 'Prism', cssClass: 'pattern-prism' },
  { id: 'spectrum', label: 'Spectrum', cssClass: 'pattern-spectrum' },
  { id: 'spectrum-x', label: 'Spectrum X', cssClass: 'pattern-spectrum-x' },
  { id: 'spectrum-plus', label: 'Spectrum Plus', cssClass: 'pattern-spectrum-plus' },
  { id: 'eclipse', label: 'Eclipse', cssClass: 'pattern-eclipse' },
]

const DEFAULT_SURFACE_BRIGHTNESS = 35

export const useThemeStore = defineStore('theme', () => {
  const colorSchemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)')
  const systemTheme = ref<ResolvedTheme>(colorSchemeQuery?.matches ? 'dark' : 'light')

  const storedTheme = storage.get<Theme>('theme', 'system')
  const theme = ref<Theme>(THEME_IDS.includes(storedTheme) ? storedTheme : 'system')
  const resolvedTheme = computed<ResolvedTheme>(() => (theme.value === 'system' ? systemTheme.value : theme.value))

  const storedAccent = storage.get<Accent>('accent', 'blue')
  const accent = ref<Accent>(ACCENT_IDS.includes(storedAccent) ? storedAccent : 'blue')

  const storedRadius = storage.get<Radius>('radius', 'default')
  const radius = ref<Radius>(RADIUS_IDS.includes(storedRadius) ? storedRadius : 'default')

  const storedBackground = storage.get<Background>('background', 'vinyl')
  const background = ref<Background>(BACKGROUND_IDS.includes(storedBackground) ? storedBackground : 'dots')

  const brightness = ref<number>(storage.get<number>('brightness', DEFAULT_SURFACE_BRIGHTNESS))

  function applyTheme(t: ResolvedTheme) {
    document.documentElement.classList.toggle('dark', t === 'dark')
  }

  function handleColorSchemeChange(event: MediaQueryListEvent) {
    systemTheme.value = event.matches ? 'dark' : 'light'
  }

  function applyAccent(a: Accent) {
    ACCENT_IDS.forEach((id) => document.documentElement.classList.remove(`accent-${id}`))
    document.documentElement.classList.add(`accent-${a}`)
  }

  function applyRadius(r: Radius) {
    RADIUS_IDS.forEach((id) => document.documentElement.classList.remove(`radius-${id}`))
    if (r !== 'default') document.documentElement.classList.add(`radius-${r}`)
  }

  function applyBrightness(b: number) {
    const lift = (b / 100) * 0.12
    document.documentElement.style.setProperty('--bg-lift', lift.toFixed(4))
  }

  function setTheme(nextTheme: Theme) {
    theme.value = nextTheme
  }

  function toggleTheme() {
    setTheme(resolvedTheme.value === 'dark' ? 'light' : 'dark')
  }

  function setAccent(a: Accent) {
    accent.value = a
  }

  function setRadius(r: Radius) {
    radius.value = r
  }

  function applyBackground(b: Background) {
    BACKGROUND_IDS.forEach((id) => {
      const cssClass = BACKGROUND_OPTIONS.find((o) => o.id === id)?.cssClass
      if (cssClass) document.body.classList.remove(cssClass)
    })
    const cssClass = BACKGROUND_OPTIONS.find((o) => o.id === b)?.cssClass
    if (cssClass) document.body.classList.add(cssClass)
  }

  function setBackground(b: Background) {
    background.value = b
  }

  function setBrightness(b: number) {
    brightness.value = Math.min(100, Math.max(0, b))
  }

  colorSchemeQuery?.addEventListener('change', handleColorSchemeChange)
  onScopeDispose(() => colorSchemeQuery?.removeEventListener('change', handleColorSchemeChange))

  watch(
    resolvedTheme,
    (t) => {
      applyTheme(t)
    },
    { immediate: true },
  )
  watch(
    theme,
    (t) => {
      storage.set('theme', t)
    },
    { immediate: true },
  )
  watch(
    accent,
    (a) => {
      applyAccent(a)
      storage.set('accent', a)
    },
    { immediate: true },
  )
  watch(
    radius,
    (r) => {
      applyRadius(r)
      storage.set('radius', r)
    },
    { immediate: true },
  )
  watch(
    background,
    (b) => {
      applyBackground(b)
      storage.set('background', b)
    },
    { immediate: true },
  )
  watch(
    brightness,
    (b) => {
      applyBrightness(b)
      storage.set('brightness', b)
    },
    { immediate: true },
  )

  return { theme, resolvedTheme, accent, radius, background, brightness, setTheme, toggleTheme, setAccent, setRadius, setBackground, setBrightness }
})
