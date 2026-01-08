import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { storage } from '@/services/storage'

type Theme = 'light' | 'dark'
export type Accent = 'neutral' | 'violet' | 'blue' | 'cyan' | 'green' | 'amber' | 'orange' | 'rose'
export type Radius = 'sharp' | 'default' | 'rounded'
export type Background = 'none' | 'dots' | 'grid' | 'cross' | 'gradient' | 'aurora' | 'rings' | 'noise'

export const ACCENT_OPTIONS: { id: Accent; label: string; color: string }[] = [
  { id: 'neutral', label: 'Neutral', color: '#a8956e' },
  { id: 'violet', label: 'Violet', color: '#7c3aed' },
  { id: 'blue', label: 'Blue', color: '#2563eb' },
  { id: 'cyan', label: 'Cyan', color: '#0891b2' },
  { id: 'green', label: 'Green', color: '#16a34a' },
  { id: 'amber', label: 'Amber', color: '#d97706' },
  { id: 'orange', label: 'Orange', color: '#ea580c' },
  { id: 'rose', label: 'Rose', color: '#e11d48' },
]

export const RADIUS_OPTIONS: { id: Radius; label: string }[] = [
  { id: 'sharp', label: 'Sharp' },
  { id: 'default', label: 'Default' },
  { id: 'rounded', label: 'Rounded' },
]

export const BACKGROUND_OPTIONS: { id: Background; label: string; cssClass: string }[] = [
  { id: 'none', label: 'None', cssClass: '' },
  { id: 'dots', label: 'Dots', cssClass: 'pattern-dots' },
  { id: 'grid', label: 'Grid', cssClass: 'pattern-grid' },
  { id: 'cross', label: 'Cross', cssClass: 'pattern-cross' },
  { id: 'gradient', label: 'Gradient', cssClass: 'pattern-gradient' },
  { id: 'aurora', label: 'Aurora', cssClass: 'pattern-aurora' },
  { id: 'rings', label: 'Rings', cssClass: 'pattern-rings' },
  { id: 'noise', label: 'Noise', cssClass: 'pattern-noise' },
]

const ACCENT_IDS = ACCENT_OPTIONS.map((a) => a.id)
const RADIUS_IDS = RADIUS_OPTIONS.map((r) => r.id)
const BACKGROUND_IDS = BACKGROUND_OPTIONS.map((b) => b.id)

export const useThemeStore = defineStore('theme', () => {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = ref<Theme>(storage.get<Theme>('theme', prefersDark ? 'dark' : 'light'))

  const storedAccent = storage.get<Accent>('accent', 'neutral')
  const accent = ref<Accent>(ACCENT_IDS.includes(storedAccent) ? storedAccent : 'neutral')

  const storedRadius = storage.get<Radius>('radius', 'default')
  const radius = ref<Radius>(RADIUS_IDS.includes(storedRadius) ? storedRadius : 'default')

  const storedBackground = storage.get<Background>('background', 'dots')
  const background = ref<Background>(BACKGROUND_IDS.includes(storedBackground) ? storedBackground : 'dots')

  function applyTheme(t: Theme) {
    document.documentElement.classList.toggle('dark', t === 'dark')
  }

  function applyAccent(a: Accent) {
    ACCENT_IDS.forEach((id) => document.documentElement.classList.remove(`accent-${id}`))
    if (a !== 'neutral') document.documentElement.classList.add(`accent-${a}`)
  }

  function applyRadius(r: Radius) {
    RADIUS_IDS.forEach((id) => document.documentElement.classList.remove(`radius-${id}`))
    if (r !== 'default') document.documentElement.classList.add(`radius-${r}`)
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

  function setBackground(b: Background) {
    background.value = b
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
      storage.set('background', b)
    },
    { immediate: true },
  )

  return { theme, accent, radius, background, toggleTheme, setAccent, setRadius, setBackground }
})
