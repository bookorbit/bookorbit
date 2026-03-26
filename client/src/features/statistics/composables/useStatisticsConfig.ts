import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'

import {
  DEFAULT_STATISTICS_FILTERS,
  type ChartConfigEntry,
  type StatisticsChartId,
  type StatisticsDateRange,
  type StatisticsFilterConfig,
  type StatisticsGranularity,
  type StatisticsSettings,
} from '@projectx/types'
import { api } from '@/lib/api'
import { useAuth } from '@/features/auth/composables/useAuth'
import { LIBRARY_CHART_IDS, STATISTICS_CHART_IDS, STATISTICS_CHART_META, USER_CHART_IDS } from '../statistics-chart-meta'

const KNOWN_CHART_IDS: StatisticsChartId[] = [...STATISTICS_CHART_IDS]

const DEFAULT_FILTERS: StatisticsFilterConfig = {
  libraryIds: [...DEFAULT_STATISTICS_FILTERS.libraryIds],
  booksOverTimeGranularity: DEFAULT_STATISTICS_FILTERS.booksOverTimeGranularity,
  booksOverTimeRange: DEFAULT_STATISTICS_FILTERS.booksOverTimeRange,
}

const config = ref<ChartConfigEntry[]>([])
const filters = ref<StatisticsFilterConfig>({ ...DEFAULT_FILTERS })

function normalizeCharts(saved: ChartConfigEntry[] | undefined): ChartConfigEntry[] {
  const knownSet = new Set<StatisticsChartId>(KNOWN_CHART_IDS)
  const filtered = (saved ?? []).filter((e) => knownSet.has(e.id))
  const savedIds = new Set(filtered.map((e) => e.id))
  const newEntries: ChartConfigEntry[] = KNOWN_CHART_IDS.filter((id) => !savedIds.has(id)).map((id, i) => ({
    id,
    visible: true,
    order: filtered.length + i,
  }))
  return [...filtered, ...newEntries]
}

const libraryChartIdSet = new Set<StatisticsChartId>(LIBRARY_CHART_IDS)
const userChartIdSet = new Set<StatisticsChartId>(USER_CHART_IDS)

function normalizeFilters(saved: StatisticsFilterConfig | undefined): StatisticsFilterConfig {
  return {
    libraryIds: saved?.libraryIds ?? DEFAULT_FILTERS.libraryIds,
    booksOverTimeGranularity: saved?.booksOverTimeGranularity ?? DEFAULT_FILTERS.booksOverTimeGranularity,
    booksOverTimeRange: saved?.booksOverTimeRange ?? DEFAULT_FILTERS.booksOverTimeRange,
  }
}

async function persist() {
  const payload: StatisticsSettings = { charts: config.value, filters: filters.value }
  try {
    await api('/api/v1/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { statisticsConfig: payload } }),
    })
  } catch {
    toast.error('Failed to save chart configuration')
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(persist, 600)
}

export function useStatisticsConfig() {
  const { user } = useAuth()

  function init() {
    const saved = user.value?.settings?.statisticsConfig
    config.value = normalizeCharts(saved?.charts)
    filters.value = normalizeFilters(saved?.filters)
  }

  const orderedCharts = computed(() => [...config.value].sort((a, b) => a.order - b.order))
  const visibleCharts = computed(() => orderedCharts.value.filter((c) => c.visible))

  const orderedLibraryCharts = computed(() => orderedCharts.value.filter((c) => libraryChartIdSet.has(c.id)))
  const orderedUserCharts = computed(() => orderedCharts.value.filter((c) => userChartIdSet.has(c.id)))
  const visibleLibraryCharts = computed(() => orderedLibraryCharts.value.filter((c) => c.visible))
  const visibleUserCharts = computed(() => orderedUserCharts.value.filter((c) => c.visible))

  const libraryChartCount = computed(() => orderedLibraryCharts.value.length)
  const userChartCount = computed(() => orderedUserCharts.value.length)
  const visibleLibraryChartCount = computed(() => visibleLibraryCharts.value.length)
  const visibleUserChartCount = computed(() => visibleUserCharts.value.length)

  function toggleVisibility(id: StatisticsChartId) {
    const entry = config.value.find((c) => c.id === id)
    if (!entry) return
    entry.visible = !entry.visible
    scheduleSave()
  }

  function reorder(newOrder: ChartConfigEntry[]) {
    const visibleIds = new Set(newOrder.map((entry) => entry.id))
    const previousById = new Map(config.value.map((entry) => [entry.id, entry]))

    const reorderedVisible = newOrder.map((entry, index) => {
      const existing = previousById.get(entry.id)
      return {
        id: entry.id,
        visible: existing?.visible ?? true,
        order: index,
      }
    })

    const reorderedHidden = config.value
      .filter((entry) => !visibleIds.has(entry.id))
      .sort((a, b) => a.order - b.order)
      .map((entry, index) => ({
        ...entry,
        order: reorderedVisible.length + index,
      }))

    config.value = [...reorderedVisible, ...reorderedHidden]
    scheduleSave()
  }

  function setLibraryFilter(ids: number[]) {
    filters.value = { ...filters.value, libraryIds: ids }
    scheduleSave()
  }

  function setGranularity(g: StatisticsGranularity) {
    filters.value = { ...filters.value, booksOverTimeGranularity: g }
    scheduleSave()
  }

  function setDateRange(r: StatisticsDateRange) {
    filters.value = { ...filters.value, booksOverTimeRange: r }
    scheduleSave()
  }

  function resetToDefaults() {
    config.value = KNOWN_CHART_IDS.map((id, i) => ({ id, visible: true, order: i }))
    filters.value = { ...DEFAULT_FILTERS }
    scheduleSave()
  }

  function chartCategory(id: StatisticsChartId) {
    return STATISTICS_CHART_META[id].category
  }

  return {
    orderedCharts,
    visibleCharts,
    orderedLibraryCharts,
    orderedUserCharts,
    visibleLibraryCharts,
    visibleUserCharts,
    libraryChartCount,
    userChartCount,
    visibleLibraryChartCount,
    visibleUserChartCount,
    filters,
    init,
    toggleVisibility,
    reorder,
    resetToDefaults,
    setLibraryFilter,
    setGranularity,
    setDateRange,
    chartCategory,
  }
}
