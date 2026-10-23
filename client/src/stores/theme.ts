import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'
import {
  BACKGROUND_IDS,
  type Background,
  ACCENT_IDS,
  type Accent,
  DEFAULT_STYLE,
  DEFAULT_SURFACE_PALETTE,
  GLOW_REACH_DEFAULT,
  GLOW_REACH_MAX,
  GLOW_REACH_MIN,
  RADIUS_IDS,
  type Radius,
  STYLE_IDS,
  type Style,
  SURFACE_OPACITY_DEFAULT,
  SURFACE_OPACITY_MAX,
  SURFACE_OPACITY_MIN,
  SURFACE_PALETTE_IDS,
  type SurfacePalette,
  THEME_IDS,
  type ResolvedTheme,
  type Theme,
} from '@bookorbit/types'
import { readCssColor, toLegacyColor } from '@/lib/css-color'
import { DEFAULT_ACCENT } from '@/lib/theme-accent-meta'
import { getAppearanceControls, getThemeStyle, isAppShellPath } from '@/lib/theme-styles'
import { storage } from '@/services/storage'

export { ACCENT_VIVID, ACCENT_PASTEL, ACCENT_OPTIONS, ACCENT_PAIRS, ACCENT_ROWS } from '@/lib/theme-accent-meta'

export const DEFAULT_RADIUS: Radius = 'default'

export interface RadiusOption {
  id: Radius
  labelKey: string
  descriptionKey: string
  /** Corner of the small outline swatch that previews this preset. */
  previewRadius: string
}

export const RADIUS_OPTIONS: RadiusOption[] = [
  {
    id: 'sharp',
    labelKey: 'settings.appearance.theme.cornerRadius.options.sharp',
    descriptionKey: 'components.radiusPicker.sharp',
    previewRadius: '0',
  },
  {
    id: 'default',
    labelKey: 'settings.appearance.theme.cornerRadius.options.default',
    descriptionKey: 'components.radiusPicker.default',
    previewRadius: '3px',
  },
  {
    id: 'rounded',
    labelKey: 'settings.appearance.theme.cornerRadius.options.rounded',
    descriptionKey: 'components.radiusPicker.rounded',
    previewRadius: '8px',
  },
  {
    id: 'pill',
    labelKey: 'settings.appearance.theme.cornerRadius.options.pill',
    descriptionKey: 'components.radiusPicker.pill',
    previewRadius: '99px',
  },
]

function backgroundOption(id: Background, cssClass: string) {
  return { id, labelKey: `components.backgroundPicker.${id}`, cssClass }
}

export const BACKGROUND_OPTIONS: { id: Background; labelKey: string; cssClass: string }[] = [
  // Fundamental
  backgroundOption('none', ''),
  backgroundOption('dots', 'pattern-dots'),
  backgroundOption('cross', 'pattern-cross'),
  backgroundOption('millimeter', 'pattern-millimeter'),

  // Structural
  backgroundOption('blueprint', 'pattern-blueprint'),
  backgroundOption('brushed', 'pattern-brushed'),
  backgroundOption('scanlines', 'pattern-scanlines'),
  backgroundOption('vinyl', 'pattern-vinyl'),
  backgroundOption('carbon', 'pattern-carbon'),
  backgroundOption('perforated', 'pattern-perforated'),

  // Ambient
  backgroundOption('aurora', 'pattern-aurora'),
  backgroundOption('horizon', 'pattern-horizon'),
  backgroundOption('glow', 'pattern-glow'),
  backgroundOption('mesh', 'pattern-mesh'),
  backgroundOption('elevation', 'pattern-elevation'),

  // Refractive
  backgroundOption('prism', 'pattern-prism'),
  backgroundOption('spectrum', 'pattern-spectrum'),
  backgroundOption('spectrum-x', 'pattern-spectrum-x'),
  backgroundOption('spectrum-plus', 'pattern-spectrum-plus'),
  backgroundOption('eclipse', 'pattern-eclipse'),
]

const DEFAULT_SURFACE_BRIGHTNESS = 35

export function clampGlowReach(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(numeric)) return GLOW_REACH_DEFAULT
  return Math.min(GLOW_REACH_MAX, Math.max(GLOW_REACH_MIN, Math.round(numeric)))
}

export function clampSurfaceOpacity(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(numeric)) return SURFACE_OPACITY_DEFAULT
  return Math.min(SURFACE_OPACITY_MAX, Math.max(SURFACE_OPACITY_MIN, Math.round(numeric)))
}

function storedChoice<T extends string>(key: string, ids: readonly T[], fallback: T, retiredFallback: T = fallback): T {
  const stored = storage.get<T>(key, fallback)
  return ids.includes(stored) ? stored : retiredFallback
}

// Everything that paints `<html>` runs synchronously, so a token read straight after a setter (a
// chart rebuilding on `appearanceKey`) never sees the previous appearance.
const SYNC = { immediate: true, flush: 'sync' } as const

export const useThemeStore = defineStore('theme', () => {
  const root = document.documentElement
  const colorSchemeQuery = window.matchMedia?.('(prefers-color-scheme: dark)')
  const systemTheme = ref<ResolvedTheme>(colorSchemeQuery?.matches ? 'dark' : 'light')

  const theme = ref<Theme>(storedChoice('theme', THEME_IDS, 'system'))
  const resolvedTheme = computed<ResolvedTheme>(() => (theme.value === 'system' ? systemTheme.value : theme.value))
  const accent = ref<Accent>(storedChoice('accent', ACCENT_IDS, DEFAULT_ACCENT))
  const radius = ref<Radius>(storedChoice('radius', RADIUS_IDS, DEFAULT_RADIUS))
  // A background that has since been removed falls back to the quietest pattern, not the default.
  const background = ref<Background>(storedChoice('background', BACKGROUND_IDS, 'vinyl', 'dots'))
  const brightness = ref<number>(storage.get<number>('brightness', DEFAULT_SURFACE_BRIGHTNESS))
  const surfaceOpacity = ref<number>(clampSurfaceOpacity(storage.get<number>('surfaceOpacity', SURFACE_OPACITY_DEFAULT)))
  const style = ref<Style>(storedChoice('style', STYLE_IDS, DEFAULT_STYLE))
  const surfacePalette = ref<SurfacePalette>(storedChoice('surfacePalette', SURFACE_PALETTE_IDS, DEFAULT_SURFACE_PALETTE))
  const glowReach = ref<number>(clampGlowReach(storage.get<unknown>('glowReach', GLOW_REACH_DEFAULT)))

  /** A style dresses the app shell only; sign-in pages and readers always paint as BookOrbit. */
  const styleScopeActive = ref(isAppShellPath(window.location.pathname))
  const appliedStyle = computed<Style>(() => (styleScopeActive.value ? style.value : 'bookorbit'))
  const appliedStyleDefinition = computed(() => getThemeStyle(appliedStyle.value))
  const styleDefinition = computed(() => getThemeStyle(style.value))
  const appearanceControls = computed(() => getAppearanceControls(style.value))

  // What is painted: a style that pins a setting overrides the stored choice without replacing it.
  const appliedBackground = computed(() => appliedStyleDefinition.value.pinned.background ?? background.value)
  const appliedBackgroundClass = computed(() => BACKGROUND_OPTIONS.find((option) => option.id === appliedBackground.value)?.cssClass ?? '')
  const appliedBrightness = computed(() => appliedStyleDefinition.value.pinned.brightness ?? brightness.value)
  const appliedSurfaceOpacity = computed(() => appliedStyleDefinition.value.pinned.surfaceOpacity ?? surfaceOpacity.value)

  /** Changes exactly when a token value can: anything derived from tokens keys its cache on it. */
  const appearanceKey = computed(() =>
    [
      resolvedTheme.value,
      accent.value,
      appliedStyle.value,
      appliedStyleDefinition.value.controls.surfacePalette ? surfacePalette.value : '',
      resolvedTheme.value === 'dark' ? appliedBrightness.value : '',
    ].join(':'),
  )

  function handleColorSchemeChange(event: MediaQueryListEvent) {
    systemTheme.value = event.matches ? 'dark' : 'light'
  }

  function applyAccent(a: Accent) {
    ACCENT_IDS.forEach((id) => root.classList.remove(`accent-${id}`))
    root.classList.add(`accent-${a}`)
  }

  function applyRadius(r: Radius) {
    RADIUS_IDS.forEach((id) => root.classList.remove(`radius-${id}`))
    if (r !== DEFAULT_RADIUS) root.classList.add(`radius-${r}`)
  }

  function applyBackgroundClass(cssClass: string) {
    BACKGROUND_OPTIONS.forEach((option) => {
      if (option.cssClass) document.body.classList.remove(option.cssClass)
    })
    if (cssClass) document.body.classList.add(cssClass)
  }

  function applyThemeColorMeta() {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const background = meta ? toLegacyColor(readCssColor('--background')) : ''
    if (meta && background) meta.content = background
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

  function setBackground(b: Background) {
    background.value = b
  }

  function setBrightness(b: number) {
    brightness.value = Math.min(100, Math.max(0, b))
  }

  function setSurfaceOpacity(value: number) {
    surfaceOpacity.value = clampSurfaceOpacity(value)
  }

  function setStyle(nextStyle: Style) {
    style.value = nextStyle
  }

  function setSurfacePalette(palette: SurfacePalette) {
    surfacePalette.value = palette
  }

  function setGlowReach(reach: number) {
    glowReach.value = clampGlowReach(reach)
  }

  function applyGlowReach(reach: number) {
    root.style.setProperty('--glow-reach', String(reach / 100))
    root.setAttribute('data-glow', reach > 0 ? 'on' : 'off')
  }

  function setStyleScopeActive(active: boolean) {
    styleScopeActive.value = active
  }

  colorSchemeQuery?.addEventListener('change', handleColorSchemeChange)
  onScopeDispose(() => colorSchemeQuery?.removeEventListener('change', handleColorSchemeChange))

  watch(resolvedTheme, (t) => root.classList.toggle('dark', t === 'dark'), SYNC)
  watch(accent, applyAccent, SYNC)
  watch(radius, applyRadius, SYNC)
  watch(appliedBackgroundClass, applyBackgroundClass, SYNC)
  watch(appliedBrightness, (b) => root.style.setProperty('--bg-lift', ((b / 100) * 0.12).toFixed(4)), SYNC)
  watch(appliedSurfaceOpacity, (value) => root.style.setProperty('--shell-surface-opacity', `${value}%`), SYNC)
  watch(appliedStyle, (s) => root.setAttribute('data-style', s), SYNC)
  watch(surfacePalette, (palette) => root.setAttribute('data-surface', palette), SYNC)
  watch(glowReach, applyGlowReach, SYNC)
  watch(appearanceKey, applyThemeColorMeta, { immediate: true, flush: 'post' })

  watch(theme, (t) => storage.set('theme', t), { immediate: true })
  watch(accent, (a) => storage.set('accent', a), { immediate: true })
  watch(radius, (r) => storage.set('radius', r), { immediate: true })
  watch(background, (b) => storage.set('background', b), { immediate: true })
  watch(brightness, (b) => storage.set('brightness', b), { immediate: true })
  watch(surfaceOpacity, (value) => storage.set('surfaceOpacity', value), { immediate: true })
  watch(style, (s) => storage.set('style', s), { immediate: true })
  watch(surfacePalette, (palette) => storage.set('surfacePalette', palette), { immediate: true })
  watch(glowReach, (reach) => storage.set('glowReach', reach), { immediate: true })

  return {
    theme,
    resolvedTheme,
    accent,
    radius,
    background,
    brightness,
    surfaceOpacity,
    style,
    surfacePalette,
    glowReach,
    appliedStyle,
    styleDefinition,
    appearanceControls,
    appliedBackgroundClass,
    appearanceKey,
    setTheme,
    toggleTheme,
    setAccent,
    setRadius,
    setBackground,
    setBrightness,
    setSurfaceOpacity,
    setStyle,
    setSurfacePalette,
    setGlowReach,
    setStyleScopeActive,
  }
})
