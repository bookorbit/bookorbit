import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({ api: apiMock }))

vi.mock('vue-echarts', () => ({
  default: { name: 'VChart', props: ['option'], template: '<div class="vchart" />' },
}))

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({ theme: 'dark', accent: 'blue' }),
}))

vi.mock('@/features/statistics/composables/useStatisticsConfig', () => ({
  useStatisticsConfig: () => ({ filters: { value: { libraryIds: [] } } }),
}))

import SourceDistributionChart from '../SourceDistributionChart.vue'

function makeResponse(data: unknown, options: { ok?: boolean; status?: number } = {}): Response {
  const { ok = true, status = ok ? 200 : 500 } = options
  return { ok, status, json: async () => data } as Response
}

function stubMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn<(query: string) => unknown>().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn<() => void>(),
    removeEventListener: vi.fn<() => void>(),
    addListener: vi.fn<() => void>(),
    removeListener: vi.fn<() => void>(),
    dispatchEvent: vi.fn<() => void>(),
  })) as unknown as typeof window.matchMedia
}

describe('SourceDistributionChart', () => {
  beforeEach(() => {
    apiMock.mockReset()
    stubMatchMedia(false)
  })

  it('requests the source distribution over a 365-day window', async () => {
    apiMock.mockResolvedValue(makeResponse({ totalSeconds: 0, slices: [] }))
    mount(SourceDistributionChart)
    await flushPromises()

    const url = String(apiMock.mock.calls[0]![0])
    expect(url).toContain('/api/v1/user-statistics/reading-source-distribution')
    expect(url).toContain('days=365')
  })

  it('shows the empty state when no source has reading time', async () => {
    apiMock.mockResolvedValue(makeResponse({ totalSeconds: 0, slices: [] }))
    const wrapper = mount(SourceDistributionChart)
    await flushPromises()

    expect(wrapper.text()).toContain('No reading activity yet')
    expect(wrapper.findComponent({ name: 'VChart' }).exists()).toBe(false)
  })

  it('builds a donut series from the source slices', async () => {
    apiMock.mockResolvedValue(
      makeResponse({
        totalSeconds: 4800,
        slices: [
          { bucket: 'bookorbit', readingSeconds: 3600 },
          { bucket: 'kobo', readingSeconds: 1200 },
        ],
      }),
    )
    const wrapper = mount(SourceDistributionChart)
    await flushPromises()

    const chart = wrapper.findComponent({ name: 'VChart' })
    expect(chart.exists()).toBe(true)

    const option = chart.props('option') as {
      series: { data: { name: string; value: number }[] }[]
      tooltip: { formatter: (p: { name: string; value: number; percent: number; color: string }) => string }
    }
    const data = option.series[0]!.data
    expect(data.map((d) => d.name)).toEqual(['BookOrbit', 'Kobo'])
    expect(data.map((d) => d.value)).toEqual([3600, 1200])

    // The tooltip formatter exercises the duration helper across all 3 branches.
    const fmt = option.tooltip.formatter
    expect(fmt({ name: 'BookOrbit', value: 3661, percent: 75, color: '#abc' })).toContain('1h 1m')
    expect(fmt({ name: 'Kobo', value: 120, percent: 20, color: '#def' })).toContain('2m')
    expect(fmt({ name: 'Kobo', value: 30, percent: 5, color: '#def' })).toContain('30s')
    expect(fmt({ name: 'BookOrbit', value: 3661, percent: 75, color: '#abc' })).toContain('75%')
  })

  it('uses the desktop legend and centre layout at >= md width', async () => {
    stubMatchMedia(true)
    apiMock.mockResolvedValue(makeResponse({ totalSeconds: 1200, slices: [{ bucket: 'kobo', readingSeconds: 1200 }] }))
    const wrapper = mount(SourceDistributionChart)
    await flushPromises()

    const option = wrapper.findComponent({ name: 'VChart' }).props('option') as {
      legend: { orient: string; right: string }
      series: { center: string[] }[]
    }
    expect(option.legend.orient).toBe('vertical')
    expect(option.legend.right).toBe('2%')
    expect(option.series[0]!.center).toEqual(['38%', '50%'])
  })

  it('shows the error state when the request fails', async () => {
    apiMock.mockResolvedValue(makeResponse({}, { ok: false, status: 500 }))
    const wrapper = mount(SourceDistributionChart)
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load data')
  })
})
