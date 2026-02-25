import { ref } from 'vue'

import type { ScrollerConfig, ScrollerType } from '@projectx/types'

const STORAGE_KEY = 'projectx:dashboard:config'
const MAX_SCROLLERS = 6

export const DEFAULT_SCROLLERS: ScrollerConfig[] = [
  { id: '1', type: 'continue-reading', label: 'Continue Reading', enabled: true, order: 1, limit: 20 },
  { id: '2', type: 'recently-added', label: 'Recently Added', enabled: true, order: 2, limit: 20 },
  { id: '3', type: 'random', label: 'Discover Something New', enabled: true, order: 3, limit: 20 },
]

export const SCROLLER_LABELS: Record<ScrollerType, string> = {
  'continue-reading': 'Continue Reading',
  'recently-added': 'Recently Added',
  random: 'Discover Something New',
  lens: 'Lens',
}

function loadConfig(): ScrollerConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : DEFAULT_SCROLLERS
  } catch {
    return DEFAULT_SCROLLERS
  }
}

// Module-level singleton — all callers share the same reactive ref
const scrollers = ref<ScrollerConfig[]>(loadConfig())

export function useDashboardConfig() {
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scrollers.value))
  }

  function saveScrollers(newScrollers: ScrollerConfig[]) {
    scrollers.value = newScrollers.map((s, i) => ({ ...s, order: i + 1 }))
    save()
  }

  function addScroller(type: ScrollerType) {
    if (scrollers.value.length >= MAX_SCROLLERS) return
    const maxId = Math.max(0, ...scrollers.value.map((s) => Number(s.id)))
    scrollers.value.push({
      id: String(maxId + 1),
      type,
      label: SCROLLER_LABELS[type],
      enabled: true,
      order: scrollers.value.length + 1,
      limit: 20,
    })
    save()
  }

  function reset() {
    scrollers.value = DEFAULT_SCROLLERS.map((s) => ({ ...s }))
    localStorage.removeItem(STORAGE_KEY)
  }

  return { scrollers, saveScrollers, addScroller, reset, MAX_SCROLLERS }
}
