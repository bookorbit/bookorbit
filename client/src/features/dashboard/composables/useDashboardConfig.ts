import { ref } from 'vue'

import { SCROLLER_TYPES, type ScrollerConfig, type ScrollerType } from '@bookorbit/types'

const STORAGE_KEY = 'bookorbit:dashboard:config'
const MAX_SCROLLERS = 8

export const SHELF_LAYOUT = {
  WIDE: 'wide',
  TWO_COLUMNS: 'two-columns',
} as const

export type DashboardShelfLayout = (typeof SHELF_LAYOUT)[keyof typeof SHELF_LAYOUT]

interface StoredDashboardConfig {
  scrollers: ScrollerConfig[]
  shelfLayout: DashboardShelfLayout
}

export const DEFAULT_SCROLLERS: ScrollerConfig[] = [
  { id: '2', type: 'recently-added', label: 'Recently Added', enabled: true, order: 1, limit: 20 },
  { id: '3', type: 'random', label: 'Discover Something New', enabled: true, order: 2, limit: 20 },
  { id: '1', type: 'continue-reading', label: 'Continue Reading', enabled: true, order: 3, limit: 20 },
  { id: '5', type: 'continue-listening', label: 'Continue Listening', enabled: true, order: 4, limit: 20 },
  { id: '6', type: 'want-to-read', label: 'Want to Read', enabled: false, order: 5, limit: 20 },
  { id: '4', type: 'up-next-in-series', label: 'Up Next in Series', enabled: false, order: 6, limit: 20 },
]

// Persisted-only. Shelf headings and the type selector resolve their text from the active
// locale via useDashboardLabels(); these values just keep stored configs shaped as before.
export const SCROLLER_LABELS: Record<ScrollerType, string> = {
  'continue-reading': 'Continue Reading',
  'continue-listening': 'Continue Listening',
  'want-to-read': 'Want to Read',
  'up-next-in-series': 'Up Next in Series',
  'recently-added': 'Recently Added',
  random: 'Discover Something New',
  'smart-scope': 'Smart Scope',
}

const VALID_SCROLLER_TYPES = new Set<ScrollerType>(SCROLLER_TYPES)

function cloneDefaultScrollers(): ScrollerConfig[] {
  return DEFAULT_SCROLLERS.map((scroller) => ({ ...scroller }))
}

function parseStoredScrollers(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null

  const { scrollers } = value as { scrollers?: unknown }
  return Array.isArray(scrollers) ? scrollers : null
}

function normalizeShelfLayout(value: unknown): DashboardShelfLayout {
  return value === SHELF_LAYOUT.TWO_COLUMNS ? SHELF_LAYOUT.TWO_COLUMNS : SHELF_LAYOUT.WIDE
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

function normalizeSmartScopeId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return undefined
}

function normalizeId(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function normalizeScroller(value: unknown, index: number): ScrollerConfig | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Partial<ScrollerConfig> & { type?: unknown }
  if (typeof raw.type !== 'string' || !VALID_SCROLLER_TYPES.has(raw.type as ScrollerType)) return null

  const type = raw.type as ScrollerType
  const label = typeof raw.label === 'string' && raw.label.trim().length > 0 ? raw.label.trim() : SCROLLER_LABELS[type]
  const smartScopeId = type === 'smart-scope' ? normalizeSmartScopeId(raw.smartScopeId) : undefined

  return {
    id: normalizeId(raw.id, String(index + 1)),
    type,
    label,
    enabled: normalizeBoolean(raw.enabled, true),
    order: index + 1,
    limit: normalizePositiveNumber(raw.limit, 20),
    ...(smartScopeId === undefined ? {} : { smartScopeId }),
  }
}

function normalizeScrollers(value: unknown): ScrollerConfig[] {
  const storedScrollers = parseStoredScrollers(value)
  if (!storedScrollers) return cloneDefaultScrollers()

  const normalized = storedScrollers
    .map((scroller, index) => normalizeScroller(scroller, index))
    .filter((scroller): scroller is ScrollerConfig => scroller !== null)
    .slice(0, MAX_SCROLLERS)
    .map((scroller, index) => ({ ...scroller, order: index + 1 }))

  return normalized.length > 0 ? normalized : cloneDefaultScrollers()
}

function loadConfig(): StoredDashboardConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { scrollers: cloneDefaultScrollers(), shelfLayout: SHELF_LAYOUT.WIDE }

    const parsed: unknown = JSON.parse(raw)
    const shelfLayout =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? normalizeShelfLayout((parsed as { shelfLayout?: unknown }).shelfLayout)
        : SHELF_LAYOUT.WIDE

    return { scrollers: normalizeScrollers(parsed), shelfLayout }
  } catch {
    return { scrollers: cloneDefaultScrollers(), shelfLayout: SHELF_LAYOUT.WIDE }
  }
}

function areScrollersEqual(left: ScrollerConfig[], right: ScrollerConfig[]): boolean {
  if (left.length !== right.length) return false
  return left.every((scroller, index) => {
    const other = right[index]
    if (!other) return false
    return (
      scroller.id === other.id &&
      scroller.type === other.type &&
      scroller.label === other.label &&
      scroller.enabled === other.enabled &&
      scroller.order === other.order &&
      scroller.limit === other.limit &&
      scroller.smartScopeId === other.smartScopeId
    )
  })
}

// Module-level singletons - all callers share the same reactive state
const initialConfig = loadConfig()
const scrollers = ref<ScrollerConfig[]>(initialConfig.scrollers)
const shelfLayout = ref<DashboardShelfLayout>(initialConfig.shelfLayout)

export function useDashboardConfig() {
  function save() {
    scrollers.value = normalizeScrollers(scrollers.value)
    shelfLayout.value = normalizeShelfLayout(shelfLayout.value)
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        scrollers: scrollers.value,
        shelfLayout: shelfLayout.value,
      } satisfies StoredDashboardConfig),
    )
  }

  function saveScrollers(newScrollers: ScrollerConfig[]) {
    scrollers.value = normalizeScrollers(newScrollers)
    save()
  }

  function saveShelfSettings(newScrollers: ScrollerConfig[], newShelfLayout: DashboardShelfLayout) {
    scrollers.value = normalizeScrollers(newScrollers)
    shelfLayout.value = normalizeShelfLayout(newShelfLayout)
    save()
  }

  function addScroller(type: ScrollerType) {
    scrollers.value = normalizeScrollers(scrollers.value)
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

  function pruneDeletedSmartScopeScrollers(validSmartScopeIds: readonly number[]) {
    const validIds = new Set(validSmartScopeIds.filter((id) => Number.isFinite(id) && id > 0))
    const next = scrollers.value
      .filter((scroller) => {
        if (scroller.type !== 'smart-scope') return true
        if (!scroller.smartScopeId) return false
        return validIds.has(scroller.smartScopeId)
      })
      .map((scroller, index) => ({ ...scroller, order: index + 1 }))

    if (areScrollersEqual(scrollers.value, next)) return
    scrollers.value = next
    save()
  }

  function reset() {
    scrollers.value = cloneDefaultScrollers()
    shelfLayout.value = SHELF_LAYOUT.WIDE
    localStorage.removeItem(STORAGE_KEY)
  }

  return { scrollers, shelfLayout, saveScrollers, saveShelfSettings, addScroller, pruneDeletedSmartScopeScrollers, reset, MAX_SCROLLERS }
}
