import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

type Theme = 'light' | 'dark'
export type Accent = 'neutral' | 'violet' | 'blue' | 'cyan' | 'green' | 'amber' | 'orange' | 'rose'
export type Radius = 'sharp' | 'default' | 'rounded'

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

const ACCENT_IDS = ACCENT_OPTIONS.map((a) => a.id)
const RADIUS_IDS = RADIUS_OPTIONS.map((r) => r.id)

export const useThemeStore = defineStore('theme', () => {
  const storedTheme = localStorage.getItem('theme') as Theme | null
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = ref<Theme>(storedTheme ?? (prefersDark ? 'dark' : 'light'))

  const storedAccent = localStorage.getItem('accent') as Accent | null
  const accent = ref<Accent>(storedAccent && ACCENT_IDS.includes(storedAccent) ? storedAccent : 'neutral')

  const storedRadius = localStorage.getItem('radius') as Radius | null
  const radius = ref<Radius>(storedRadius && RADIUS_IDS.includes(storedRadius) ? storedRadius : 'default')

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

  watch(
    theme,
    (t) => {
      applyTheme(t)
      localStorage.setItem('theme', t)
    },
    { immediate: true },
  )
  watch(
    accent,
    (a) => {
      applyAccent(a)
      localStorage.setItem('accent', a)
    },
    { immediate: true },
  )
  watch(
    radius,
    (r) => {
      applyRadius(r)
      localStorage.setItem('radius', r)
    },
    { immediate: true },
  )

  return { theme, accent, radius, toggleTheme, setAccent, setRadius }
})
