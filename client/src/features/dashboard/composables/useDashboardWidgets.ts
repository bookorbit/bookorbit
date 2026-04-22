import { computed } from 'vue'

import type { DashboardConfig, WidgetConfig, WidgetType } from '@bookorbit/types'
import { WIDGET_TYPES } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useAuth } from '@/features/auth/composables/useAuth'

const WIDGET_LABELS: Record<WidgetType, string> = {
  'reading-goal': 'Reading Goal',
  'currently-reading': 'Currently Reading',
  'reading-streak': 'Reading Streak',
  'library-overview': 'Library Overview',
  'highlight-of-the-day': 'Highlight of the Day',
  'monthly-challenge': 'Monthly Challenge',
  'year-projection': 'Year Projection',
  'neglected-gems': 'Neglected Gems',
  'reading-dna': 'Reading DNA',
  'long-wait': 'The Long Wait',
  'diversity-score': 'Diversity Score',
  'reading-rhythm': 'Reading Rhythm',
}

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: '1', type: 'reading-streak', enabled: true, order: 1 },
  { id: '2', type: 'currently-reading', enabled: true, order: 2 },
  { id: '3', type: 'reading-goal', enabled: true, order: 3 },
  { id: '4', type: 'reading-dna', enabled: true, order: 4 },
  { id: '5', type: 'monthly-challenge', enabled: true, order: 5 },
  { id: '6', type: 'highlight-of-the-day', enabled: true, order: 6 },
  { id: '7', type: 'neglected-gems', enabled: true, order: 7 },
  { id: '8', type: 'reading-rhythm', enabled: true, order: 8 },
  { id: '9', type: 'diversity-score', enabled: true, order: 9 },
  { id: '10', type: 'library-overview', enabled: false, order: 10 },
  { id: '11', type: 'year-projection', enabled: false, order: 11 },
  { id: '12', type: 'long-wait', enabled: false, order: 12 },
]

const VALID_TYPES = new Set<WidgetType>(WIDGET_TYPES)

function cloneDefaultWidgets(): WidgetConfig[] {
  return DEFAULT_WIDGETS.map((w) => ({ ...w }))
}

function normalizeWidgets(raw: unknown): WidgetConfig[] {
  const seenTypes = new Set<WidgetType>()
  let normalized: WidgetConfig[] = []

  if (Array.isArray(raw)) {
    normalized = raw
      .filter(
        (w): w is Record<string, unknown> => w != null && typeof w === 'object' && VALID_TYPES.has((w as Record<string, unknown>).type as WidgetType),
      )
      .map((w, i) => {
        const type = w.type as WidgetType
        seenTypes.add(type)
        return {
          id: typeof w.id === 'string' ? w.id : String(i + 1),
          type,
          enabled: typeof w.enabled === 'boolean' ? w.enabled : true,
          order: i + 1,
        }
      })
  }

  if (normalized.length === 0) {
    normalized = cloneDefaultWidgets()
    for (const w of normalized) seenTypes.add(w.type)
  }

  // Append any widget types not in the saved config so new widgets
  // automatically appear for users who already have a saved config.
  // Types outside the default set are added disabled so they don't clutter the dashboard.
  const defaultTypes = new Set(DEFAULT_WIDGETS.map((d) => d.type))
  const nextOrder = normalized.length + 1
  const missing = WIDGET_TYPES.filter((t) => !seenTypes.has(t)).map((t, i) => ({
    id: String(nextOrder + i),
    type: t,
    enabled: defaultTypes.has(t),
    order: nextOrder + i,
  }))

  return [...normalized, ...missing]
}

export function useDashboardWidgets() {
  const { user, me } = useAuth()

  const dashboardConfig = computed<DashboardConfig>(() => {
    return (user.value?.settings?.dashboardConfig as DashboardConfig) ?? {}
  })

  const widgets = computed<WidgetConfig[]>(() => {
    return normalizeWidgets(dashboardConfig.value.widgets)
  })

  const enabledWidgets = computed(() => widgets.value.filter((w) => w.enabled).sort((a, b) => a.order - b.order))

  const readingGoal = computed(() => dashboardConfig.value.readingGoal ?? null)

  async function saveWidgets(newWidgets: WidgetConfig[]): Promise<void> {
    const normalized = normalizeWidgets(newWidgets)
    const updatedConfig: DashboardConfig = {
      ...dashboardConfig.value,
      widgets: normalized,
    }

    const res = await api('/api/v1/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { dashboardConfig: updatedConfig } }),
    })
    if (!res.ok) throw new Error(`Failed to save widgets: ${res.status}`)
    await me()
  }

  async function saveReadingGoal(goalBooks: number): Promise<void> {
    const updatedConfig: DashboardConfig = {
      ...dashboardConfig.value,
      readingGoal: goalBooks,
    }

    const res = await api('/api/v1/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { dashboardConfig: updatedConfig } }),
    })
    if (!res.ok) throw new Error(`Failed to save reading goal: ${res.status}`)
    await me()
  }

  return {
    widgets,
    enabledWidgets,
    readingGoal,
    saveWidgets,
    saveReadingGoal,
    WIDGET_LABELS,
    DEFAULT_WIDGETS,
  }
}
