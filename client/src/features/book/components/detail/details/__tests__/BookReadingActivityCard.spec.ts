import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { BookReadingSession, BookReadingSessionStats } from '@bookorbit/types'
import BookReadingActivityCard from '../BookReadingActivityCard.vue'

function session(id: number, endProgress: number | null, format: string | null = 'epub'): BookReadingSession {
  return {
    id,
    bookFileId: 101,
    startedAt: '2026-11-10T10:00:00.000Z',
    endedAt: '2026-11-10T10:41:00.000Z',
    durationSeconds: 2460,
    progressDelta: 4,
    endProgress,
    format,
    source: null,
    attemptId: null,
  }
}

function stats(overrides: Partial<BookReadingSessionStats> = {}): BookReadingSessionStats {
  return {
    totalSessions: 14,
    totalSeconds: 22320,
    avgDurationSeconds: 1620,
    firstSessionAt: '2026-10-24T10:00:00.000Z',
    lastSessionAt: '2026-11-10T10:00:00.000Z',
    dailySummary: [
      { day: '2026-11-08', totalMinutes: 30 },
      { day: '2026-11-10', totalMinutes: 41 },
    ],
    paceProgressDelta: 0,
    paceDurationSeconds: 0,
    progressSummary: [],
    latestEndProgress: 64,
    bySource: [],
    longestSessionSeconds: 3900,
    longestSessionAt: '2026-11-05T10:00:00.000Z',
    backtrackCount: 0,
    ...overrides,
  }
}

describe('BookReadingActivityCard', () => {
  it('shows a not-started status row and no last-read line before any session', () => {
    const wrapper = mount(BookReadingActivityCard, { props: { stats: stats({ totalSessions: 0 }) } })

    const status = wrapper.get('[data-test="reading-not-started"]')
    expect(status.text()).toContain('Not started')
    expect(status.text()).toContain('Opening this book in the reader tracks time, pace and per-device progress.')
    expect(wrapper.text()).not.toContain('last read')
    expect(wrapper.find('[data-test="reading-summary"]').exists()).toBe(false)
  })

  it('lays the four stats and the daily bars out as one band', () => {
    const wrapper = mount(BookReadingActivityCard, { props: { stats: stats(), sessions: [session(1, 64)] } })

    const summary = wrapper.get('[data-test="reading-summary"]')
    expect(summary.findAll('dt').map((term) => term.text())).toEqual(['Sessions', 'Time', 'Avg', 'Progress'])
    expect(summary.findAll('dd').map((value) => value.text())).toEqual(['14', '6h 12m', '27m', '64%'])

    const daily = wrapper.get('[data-test="reading-daily"]')
    expect(daily.attributes('aria-hidden')).toBe('true')
    expect(daily.text()).toBe('Daily')
    expect(daily.findAll('[title]')).toHaveLength(7)
  })

  it('lists recent sessions with where each one ended as a bar and an accessible label', () => {
    const wrapper = mount(BookReadingActivityCard, {
      props: { stats: stats(), sessions: [session(1, 64), session(2, null, null), session(3, 140), session(4, 10)] },
    })

    const rows = wrapper.findAll('li')
    expect(rows).toHaveLength(3)

    const first = rows[0]!
    expect(first.text()).toContain('41m')
    expect(first.find('[title="EPUB e-book"]').exists()).toBe(true)
    const reached = first.get('[title="64% reached"]')
    expect(reached.get('.sr-only').text()).toBe('64% reached')
    expect(reached.get('[style*="width"]').attributes('style')).toContain('width: 64%')

    expect(rows[1]!.get('[title="0% reached"] .sr-only').text()).toBe('0% reached')
    expect(rows[1]!.find('[title="EPUB e-book"]').exists()).toBe(false)
    expect(rows[2]!.get('[title="100% reached"] [style*="width"]').attributes('style')).toContain('width: 100%')
  })
})
