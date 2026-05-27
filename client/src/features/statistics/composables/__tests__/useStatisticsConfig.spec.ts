import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_KOREADER_CHART_ORDER } from '@bookorbit/types'

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  apiMock: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  toastError: vi.fn<(message: string) => void>(),
}))

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({
    user: {
      get value() {
        return state.user
      },
      set value(next) {
        state.user = next
      },
    },
  }),
}))

vi.mock('@/lib/api', () => ({
  api: state.apiMock,
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: state.toastError,
  },
}))

describe('useStatisticsConfig', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    state.apiMock.mockReset().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response)
    state.toastError.mockReset()
    state.user = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializes and exposes KOReader charts from defaults', async () => {
    const { useStatisticsConfig } = await import('../useStatisticsConfig')
    const config = useStatisticsConfig()
    config.init()

    expect(config.koreaderChartCount.value).toBe(DEFAULT_KOREADER_CHART_ORDER.length)
    expect(config.visibleKoreaderChartCount.value).toBe(DEFAULT_KOREADER_CHART_ORDER.length)
    expect(config.orderedKoreaderCharts.value.map((chart) => chart.id)).toEqual(DEFAULT_KOREADER_CHART_ORDER)
  })

  it('normalizes legacy/saved chart config and appends missing KOReader charts', async () => {
    state.user = {
      settings: {
        statisticsConfig: {
          charts: [{ id: 'ko-devices', visible: false, order: 0 }],
          filters: {
            libraryIds: [12],
            booksOverTimeGranularity: 'yearly',
            booksOverTimeRange: 'all-time',
          },
        },
      },
    }

    const { useStatisticsConfig } = await import('../useStatisticsConfig')
    const config = useStatisticsConfig()
    config.init()

    expect(config.orderedKoreaderCharts.value.map((chart) => chart.id)).toContain('ko-devices')
    expect(config.orderedKoreaderCharts.value.some((chart) => chart.visible)).toBe(true)
    expect(config.orderedKoreaderCharts.value.find((chart) => chart.id === 'ko-devices')?.visible).toBe(false)
    expect(config.filters.value.libraryIds).toEqual([12])
    expect(config.filters.value.booksOverTimeGranularity).toBe('yearly')
    expect(config.filters.value.booksOverTimeRange).toBe('all-time')
  })

  it('reorders KOReader charts without dropping charts from other categories', async () => {
    const { useStatisticsConfig } = await import('../useStatisticsConfig')
    const config = useStatisticsConfig()
    config.init()

    const beforeTotal = config.orderedCharts.value.length
    const reversedKoreader = [...config.orderedKoreaderCharts.value].reverse()
    config.reorder(reversedKoreader)

    expect(config.orderedCharts.value.length).toBe(beforeTotal)
    expect(config.orderedKoreaderCharts.value.map((chart) => chart.id)).toEqual(reversedKoreader.map((chart) => chart.id))
  })

  it('resetToDefaults restores KOReader chart visibility and order', async () => {
    const { useStatisticsConfig } = await import('../useStatisticsConfig')
    const config = useStatisticsConfig()
    config.init()

    config.toggleVisibility('ko-devices')
    expect(config.orderedKoreaderCharts.value.find((chart) => chart.id === 'ko-devices')?.visible).toBe(false)

    config.resetToDefaults()
    vi.runAllTimers()

    expect(config.orderedKoreaderCharts.value.map((chart) => chart.id)).toEqual(DEFAULT_KOREADER_CHART_ORDER)
    expect(config.orderedKoreaderCharts.value.every((chart) => chart.visible)).toBe(true)
  })

  it('updates filter helpers and exposes chart category metadata', async () => {
    const { useStatisticsConfig } = await import('../useStatisticsConfig')
    const config = useStatisticsConfig()
    config.init()

    config.setLibraryFilter([3, 5])
    config.setGranularity('yearly')
    config.setDateRange('all-time')

    expect(config.filters.value.libraryIds).toEqual([3, 5])
    expect(config.filters.value.booksOverTimeGranularity).toBe('yearly')
    expect(config.filters.value.booksOverTimeRange).toBe('all-time')
    expect(config.chartCategory('ko-top-books')).toBe('koreader')
  })

  it('shows a toast when persisting configuration fails', async () => {
    state.apiMock.mockRejectedValueOnce(new Error('network error'))

    const { useStatisticsConfig } = await import('../useStatisticsConfig')
    const config = useStatisticsConfig()
    config.init()
    config.setLibraryFilter([9])

    await vi.runAllTimersAsync()

    expect(state.toastError).toHaveBeenCalledWith('Failed to save chart configuration')
  })

  it('evaluates all chart-group computed refs and no-op toggle path', async () => {
    const { useStatisticsConfig } = await import('../useStatisticsConfig')
    const config = useStatisticsConfig()
    config.init()

    expect(config.orderedCharts.value.length).toBeGreaterThan(0)
    expect(config.visibleCharts.value.length).toBeGreaterThan(0)
    expect(config.orderedLibraryCharts.value.length).toBeGreaterThan(0)
    expect(config.orderedUserCharts.value.length).toBeGreaterThan(0)
    expect(config.orderedKoreaderCharts.value.length).toBeGreaterThan(0)
    expect(config.visibleLibraryCharts.value.length).toBeGreaterThan(0)
    expect(config.visibleUserCharts.value.length).toBeGreaterThan(0)
    expect(config.visibleKoreaderCharts.value.length).toBeGreaterThan(0)
    expect(config.libraryChartCount.value).toBeGreaterThan(0)
    expect(config.userChartCount.value).toBeGreaterThan(0)
    expect(config.koreaderChartCount.value).toBeGreaterThan(0)
    expect(config.visibleLibraryChartCount.value).toBeGreaterThan(0)
    expect(config.visibleUserChartCount.value).toBeGreaterThan(0)
    expect(config.visibleKoreaderChartCount.value).toBeGreaterThan(0)

    config.toggleVisibility('not-a-real-chart-id' as never)
    expect(config.orderedCharts.value.length).toBeGreaterThan(0)
  })
})
