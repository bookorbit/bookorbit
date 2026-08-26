import { mount } from '@vue/test-utils'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createPinia } from 'pinia'
import type { BookReadingSessionStats } from '@bookorbit/types'

vi.mock('vue-echarts', () => ({
  default: { name: 'VChart', template: '<div class="chart" />' },
}))

import ReadingLogBand from '../ReadingLogBand.vue'

function makeStats(overrides: Partial<BookReadingSessionStats> = {}): BookReadingSessionStats {
  return {
    totalSessions: 2,
    totalSeconds: 600,
    avgDurationSeconds: 300,
    firstSessionAt: '2026-06-01T10:00:00.000Z',
    lastSessionAt: '2026-06-04T10:00:00.000Z',
    dailySummary: [
      { day: '2026-06-01', totalMinutes: 5 },
      { day: '2026-06-04', totalMinutes: 5 },
    ],
    paceProgressDelta: 0,
    paceDurationSeconds: 0,
    progressSummary: [],
    latestEndProgress: 20,
    bySource: [],
    longestSessionSeconds: 300,
    longestSessionAt: '2026-06-01T10:00:00.000Z',
    backtrackCount: 0,
    ...overrides,
  }
}

function mountBand(overrides: Partial<BookReadingSessionStats> = {}) {
  return mount(ReadingLogBand, {
    props: { sessions: [], stats: makeStats(overrides), loading: false },
    global: { plugins: [createPinia()] },
  })
}

describe('ReadingLogBand', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('opens on the progress curve', () => {
    const wrapper = mountBand()
    expect(wrapper.text()).toContain('Progress over time')
    expect(wrapper.find('button[data-band-view="curve"]').attributes('aria-pressed')).toBe('true')
  })

  it('summarises the span the book was read over', () => {
    const wrapper = mountBand()
    expect(wrapper.text()).toContain('2 active days across 4')
  })

  it('switches to the position trace and remembers the choice', async () => {
    const wrapper = mountBand()
    await wrapper.find('button[data-band-view="trace"]').trigger('click')

    expect(wrapper.text()).toContain('Where you were in the book')
    expect(wrapper.text()).toContain('Jumped back')
    expect(localStorage.getItem('bookorbit.readingLog.bandView')).toBe('trace')

    const reopened = mountBand()
    expect(reopened.text()).toContain('Where you were in the book')
  })

  it('counts the backtracks in the trace subtitle', async () => {
    const wrapper = mountBand({ backtrackCount: 2 })
    await wrapper.find('button[data-band-view="trace"]').trigger('click')
    expect(wrapper.text()).toContain('2 jumped back')
  })
})
