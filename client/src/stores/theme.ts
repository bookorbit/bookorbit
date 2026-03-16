import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { storage } from '@/services/storage'

type Theme = 'light' | 'dark'
export type Accent =
  | 'grey'
  // Vivid — rainbow order
  | 'rose'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'fuchsia'
  | 'pink'
  // Pastel — rainbow order
  | 'white'
  | 'coral'
  | 'peach'
  | 'butter'
  | 'lemon'
  | 'celadon'
  | 'sage'
  | 'mint'
  | 'seafoam'
  | 'powder'
  | 'mist'
  | 'periwinkle'
  | 'wisteria'
  | 'lavender'
  | 'orchid'
  | 'blush'
export type Radius = 'sharp' | 'default' | 'rounded' | 'pill'
export type Background =
  | 'none'
  | 'dots'
  | 'cross'
  | 'terminal'
  | 'millimeter'
  | 'blueprint'
  | 'brushed'
  | 'scanlines'
  | 'carbon'
  | 'vinyl'
  | 'perforated'
  | 'aurora'
  | 'horizon'
  | 'glow'
  | 'mesh'
  | 'elevation'
  | 'prism'
  | 'spectrum'
  | 'spectrum-x'
  | 'spectrum-plus'
  | 'eclipse'
  | 'nova'
  | 'golden-ratio'

export const ACCENT_VIVID: { id: Accent; label: string; color: string }[] = [
  { id: 'white', label: 'White', color: '#fafafa' },
  { id: 'rose', label: 'Rose', color: '#e11d48' },
  { id: 'orange', label: 'Orange', color: '#ea580c' },
  { id: 'amber', label: 'Amber', color: '#d97706' },
  { id: 'yellow', label: 'Yellow', color: '#ca8a04' },
  { id: 'lime', label: 'Lime', color: '#65a30d' },
  { id: 'green', label: 'Green', color: '#16a34a' },
  { id: 'emerald', label: 'Emerald', color: '#059669' },
  { id: 'teal', label: 'Teal', color: '#0d9488' },
  { id: 'cyan', label: 'Cyan', color: '#0891b2' },
  { id: 'sky', label: 'Sky', color: '#0284c7' },
  { id: 'blue', label: 'Blue', color: '#2563eb' },
  { id: 'indigo', label: 'Indigo', color: '#4338ca' },
  { id: 'violet', label: 'Violet', color: '#7c3aed' },
  { id: 'fuchsia', label: 'Fuchsia', color: '#c026d3' },
  { id: 'pink', label: 'Pink', color: '#db2777' },
]

export const ACCENT_PASTEL: { id: Accent; label: string; color: string }[] = [
  { id: 'grey', label: 'Grey', color: '#737373' },
  { id: 'coral', label: 'Coral', color: '#e8968a' },
  { id: 'peach', label: 'Peach', color: '#e8b08a' },
  { id: 'butter', label: 'Butter', color: '#d4be7a' },
  { id: 'lemon', label: 'Lemon', color: '#d4d07a' },
  { id: 'celadon', label: 'Celadon', color: '#a0c8a0' },
  { id: 'sage', label: 'Sage', color: '#92ad91' },
  { id: 'mint', label: 'Mint', color: '#96c8b8' },
  { id: 'seafoam', label: 'Seafoam', color: '#96c4bc' },
  { id: 'powder', label: 'Powder', color: '#90b8d0' },
  { id: 'mist', label: 'Mist', color: '#8aacc8' },
  { id: 'periwinkle', label: 'Periwinkle', color: '#9fa8d8' },
  { id: 'wisteria', label: 'Wisteria', color: '#b0a0d0' },
  { id: 'lavender', label: 'Lavender', color: '#b8a8d4' },
  { id: 'orchid', label: 'Orchid', color: '#c8a8c8' },
  { id: 'blush', label: 'Blush', color: '#c8a0b4' },
]

export const ACCENT_OPTIONS = [...ACCENT_VIVID, ...ACCENT_PASTEL]

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
  { id: 'nova', label: 'Nova', cssClass: 'pattern-nova' },
  { id: 'golden-ratio', label: 'Golden Ratio', cssClass: 'pattern-golden-ratio' },
]

const ACCENT_IDS = ACCENT_OPTIONS.map((a) => a.id)
const RADIUS_IDS = RADIUS_OPTIONS.map((r) => r.id)
const BACKGROUND_IDS = BACKGROUND_OPTIONS.map((b) => b.id)

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<Theme>(storage.get<Theme>('theme', 'dark'))

  const storedAccent = storage.get<Accent>('accent', 'blue')
  const accent = ref<Accent>(ACCENT_IDS.includes(storedAccent) ? storedAccent : 'blue')

  const storedRadius = storage.get<Radius>('radius', 'default')
  const radius = ref<Radius>(RADIUS_IDS.includes(storedRadius) ? storedRadius : 'default')

  const storedBackground = storage.get<Background>('background', 'vinyl')
  const background = ref<Background>(BACKGROUND_IDS.includes(storedBackground) ? storedBackground : 'dots')

  const brightness = ref<number>(storage.get<number>('brightness', 50))

  function applyTheme(t: Theme) {
    document.documentElement.classList.toggle('dark', t === 'dark')
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

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
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

  watch(
    theme,
    (t) => {
      applyTheme(t)
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

  return { theme, accent, radius, background, brightness, toggleTheme, setAccent, setRadius, setBackground, setBrightness }
})
