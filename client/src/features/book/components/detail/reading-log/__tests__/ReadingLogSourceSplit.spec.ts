import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookReadingSessionStats, BookReadingSourceSlice } from '@bookorbit/types'

import ReadingLogSourceSplit from '../ReadingLogSourceSplit.vue'

function makeStats(bySource: BookReadingSourceSlice[]): BookReadingSessionStats {
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
    bySource,
    longestSessionSeconds: 0,
    longestSessionAt: null,
    backtrackCount: 0,
  }
}

describe('ReadingLogSourceSplit', () => {
  it('renders nothing when stats is null', () => {
    const wrapper = mount(ReadingLogSourceSplit, { props: { stats: null } })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('renders nothing when the book was read from a single source', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: { stats: makeStats([{ bucket: 'koreader', totalSeconds: 100, totalSessions: 2 }]) },
    })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('stays hidden when buckets exist but carry no reading time', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: {
        stats: makeStats([
          { bucket: 'bookorbit', totalSeconds: 0, totalSessions: 1 },
          { bucket: 'kobo', totalSeconds: 0, totalSessions: 1 },
        ]),
      },
    })
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('renders a labelled split with percentages and durations across sources', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: {
        stats: makeStats([
          { bucket: 'bookorbit', totalSeconds: 3600, totalSessions: 4 },
          { bucket: 'koreader', totalSeconds: 120, totalSessions: 1 },
          { bucket: 'kobo', totalSeconds: 30, totalSessions: 1 },
        ]),
      },
    })

    const text = wrapper.text()
    expect(text).toContain('Reading sources')
    expect(text).toContain('BookOrbit')
    expect(text).toContain('KOReader')
    expect(text).toContain('Kobo')
    // total = 3750s -> 96% / 3% / 1%
    expect(text).toContain('96%')
    expect(text).toContain('3%')
    expect(text).toContain('1%')
    expect(text).toContain('1h 0m')
    expect(text).toContain('2m')
    expect(text).toContain('30s')
  })

  it('sizes each bar segment proportionally to its reading time', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: {
        stats: makeStats([
          { bucket: 'bookorbit', totalSeconds: 300, totalSessions: 2 },
          { bucket: 'kobo', totalSeconds: 100, totalSessions: 1 },
        ]),
      },
    })

    const segments = wrapper.findAll('.h-full')
    expect(segments).toHaveLength(2)
    expect(segments[0]!.attributes('style')).toContain('width: 75%')
    expect(segments[1]!.attributes('style')).toContain('width: 25%')
  })

  it('drops the card chrome in the stacked column form', () => {
    const wrapper = mount(ReadingLogSourceSplit, {
      props: {
        variant: 'stacked',
        stats: makeStats([
          { bucket: 'bookorbit', totalSeconds: 300, totalSessions: 2 },
          { bucket: 'kobo', totalSeconds: 100, totalSessions: 1 },
        ]),
      },
    })
    expect(wrapper.find('section').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Reading sources')
    expect(wrapper.text()).toContain('75%')
  })
})
