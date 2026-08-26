import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { BookReadingSessionStats } from '@bookorbit/types'
import { useReadingLogInsights } from '../useReadingLogInsights'

const NOW = Date.parse('2026-08-26T12:00:00Z')

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

function insights(stats: BookReadingSessionStats | null) {
  return useReadingLogInsights(ref(stats), () => NOW)
}

describe('useReadingLogInsights', () => {
  it('returns empty values without stats', () => {
    const { activeDays, spanDays, longestStreakDays, bestDay, pacePercentPerHour } = insights(null)
    expect(activeDays.value).toBe(0)
    expect(spanDays.value).toBe(0)
    expect(longestStreakDays.value).toBe(0)
    expect(bestDay.value).toBeNull()
    expect(pacePercentPerHour.value).toBeNull()
  })

  it('counts only days that carry reading time', () => {
    const { activeDays, spanDays } = insights(
      makeStats({
        dailySummary: [
          { day: '2026-08-01', totalMinutes: 20 },
          { day: '2026-08-03', totalMinutes: 0 },
          { day: '2026-08-05', totalMinutes: 12 },
        ],
      }),
    )
    expect(activeDays.value).toBe(2)
    expect(spanDays.value).toBe(5)
  })

  it('finds the longest run of consecutive days', () => {
    const { longestStreakDays } = insights(
      makeStats({
        dailySummary: [
          { day: '2026-08-01', totalMinutes: 5 },
          { day: '2026-08-02', totalMinutes: 5 },
          { day: '2026-08-03', totalMinutes: 5 },
          { day: '2026-08-09', totalMinutes: 5 },
          { day: '2026-08-10', totalMinutes: 5 },
        ],
      }),
    )
    expect(longestStreakDays.value).toBe(3)
  })

  it('picks the day with the most reading time', () => {
    const { bestDay } = insights(
      makeStats({
        dailySummary: [
          { day: '2026-08-01', totalMinutes: 20 },
          { day: '2026-08-02', totalMinutes: 121 },
          { day: '2026-08-03', totalMinutes: 44 },
        ],
      }),
    )
    expect(bestDay.value).toEqual({ day: '2026-08-02', minutes: 121 })
  })

  it('suppresses a pace derived from too small a sample', () => {
    // 48% in seventy seconds is 2469%/h, which is a comic being paged through, not a rate.
    const { pacePercentPerHour } = insights(makeStats({ paceProgressDelta: 48, paceDurationSeconds: 70 }))
    expect(pacePercentPerHour.value).toBeNull()
  })

  it('quotes a pace once enough reading has been sampled', () => {
    const { pacePercentPerHour } = insights(makeStats({ paceProgressDelta: 10, paceDurationSeconds: 3600 }))
    expect(pacePercentPerHour.value).toBeCloseTo(10, 5)
  })

  it('reports no momentum when nothing was read in a fortnight', () => {
    const { momentum } = insights(makeStats({ dailySummary: [{ day: '2026-01-01', totalMinutes: 30 }] }))
    expect(momentum.value).toEqual({ direction: 'flat', percent: null, isNew: false, hasActivity: false })
  })

  it('reports new activity when the previous week was empty', () => {
    const { momentum } = insights(makeStats({ dailySummary: [{ day: '2026-08-25', totalMinutes: 30 }] }))
    expect(momentum.value).toMatchObject({ direction: 'up', isNew: true, percent: null })
  })

  it('compares the last seven days against the seven before them', () => {
    const { momentum } = insights(
      makeStats({
        dailySummary: [
          { day: '2026-08-14', totalMinutes: 40 },
          { day: '2026-08-25', totalMinutes: 10 },
        ],
      }),
    )
    expect(momentum.value).toMatchObject({ direction: 'down', percent: -75 })
  })
})
