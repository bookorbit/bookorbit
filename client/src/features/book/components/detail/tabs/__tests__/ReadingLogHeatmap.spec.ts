import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import type { BookReadingSessionStats } from '@bookorbit/types'

vi.mock('vue-echarts', () => ({
  default: { name: 'VChart', props: ['option'], template: '<div />' },
}))

import ReadingLogHeatmap from '../ReadingLogHeatmap.vue'

function makeStats(): BookReadingSessionStats {
  return {
    totalSessions: 1,
    totalSeconds: 1800,
    avgDurationSeconds: 1800,
    firstSessionAt: '2026-06-08T10:00:00.000Z',
    lastSessionAt: '2026-06-08T10:30:00.000Z',
    dailySummary: [{ day: '2026-06-08', totalMinutes: 30 }],
    paceProgressDelta: 0,
    paceDurationSeconds: 0,
    progressSummary: [],
    bySource: [],
  }
}

describe('ReadingLogHeatmap', () => {
  it('configures the activity axis with every weekday starting on Monday', () => {
    const wrapper = mount(ReadingLogHeatmap, {
      props: { stats: makeStats(), loading: false, quickFilter: 'all' },
      global: { plugins: [createPinia()] },
    })

    const option = wrapper.findComponent({ name: 'VChart' }).props('option') as {
      calendar?: { dayLabel?: { firstDay?: number; nameMap?: string[] } }
    }

    expect(option.calendar?.dayLabel?.firstDay).toBe(1)
    expect(option.calendar?.dayLabel?.nameMap).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  })
})
