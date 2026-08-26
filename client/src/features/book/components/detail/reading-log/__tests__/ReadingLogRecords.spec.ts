import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookReadingSessionStats } from '@bookorbit/types'
import ReadingLogRecords from '../ReadingLogRecords.vue'

function makeStats(overrides: Partial<BookReadingSessionStats> = {}): BookReadingSessionStats {
  return {
    totalSessions: 0,
    totalSeconds: 0,
    avgDurationSeconds: 0,
    firstSessionAt: null,
    lastSessionAt: null,
    dailySummary: [],
    paceProgressDelta: 0,
    paceDurationSeconds: 0,
    progressSummary: [],
    latestEndProgress: null,
    bySource: [],
    longestSessionSeconds: 0,
    longestSessionAt: null,
    backtrackCount: 0,
    ...overrides,
  }
}

describe('ReadingLogRecords', () => {
  it('explains itself when the book has no sessions', () => {
    const wrapper = mount(ReadingLogRecords, { props: { stats: makeStats() } })
    expect(wrapper.text()).toContain('Records appear once this book has sessions.')
  })

  it('reads the longest session from the server aggregate, not the loaded page', () => {
    const wrapper = mount(ReadingLogRecords, {
      props: { stats: makeStats({ longestSessionSeconds: 4650, longestSessionAt: '2026-06-18T20:00:00.000Z' }) },
    })
    expect(wrapper.text()).toContain('Longest session')
    expect(wrapper.text()).toContain('1h 17m')
  })

  it('shows the best day and the longest streak', () => {
    const wrapper = mount(ReadingLogRecords, {
      props: {
        stats: makeStats({
          dailySummary: [
            { day: '2026-06-16', totalMinutes: 30 },
            { day: '2026-06-17', totalMinutes: 121 },
            { day: '2026-06-18', totalMinutes: 15 },
          ],
        }),
      },
    })
    const text = wrapper.text()
    expect(text).toContain('Best day')
    expect(text).toContain('2h 1m')
    expect(text).toContain('Longest streak')
    expect(text).toContain('3 days')
  })

  it('counts sessions that went backwards', () => {
    const wrapper = mount(ReadingLogRecords, { props: { stats: makeStats({ backtrackCount: 1 }) } })
    expect(wrapper.text()).toContain('Jumped back')
    expect(wrapper.text()).toContain('1 time')
  })

  it('keeps the card to the requested number of rows', () => {
    const wrapper = mount(ReadingLogRecords, {
      props: {
        max: 2,
        stats: makeStats({
          longestSessionSeconds: 600,
          backtrackCount: 3,
          firstSessionAt: '2026-06-01T00:00:00.000Z',
          dailySummary: [{ day: '2026-06-16', totalMinutes: 30 }],
        }),
      },
    })
    expect(wrapper.findAll('dl > div')).toHaveLength(2)
  })
})
