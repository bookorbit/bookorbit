import { computed, type Ref } from 'vue'
import type { BookReadingSessionStats } from '@bookorbit/types'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A pace measured over a handful of seconds is noise rather than a rate: a comic that records
 * 48% of itself in seventy seconds works out at 2608%/h. Quote a pace only once enough reading
 * has actually been sampled, and leave it blank otherwise.
 */
const MIN_PACE_SAMPLE_SECONDS = 600

export type ReadingMomentum = {
  direction: 'up' | 'down' | 'flat'
  /** Change against the previous seven days, or null when there is nothing to compare against. */
  percent: number | null
  /** First activity in a fortnight: an increase, but not one with a percentage. */
  isNew: boolean
  hasActivity: boolean
}

export type ReadingDayTotal = { day: string; minutes: number }

function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * The facts about a reading log that no single field of `stats` carries: momentum, streaks, the
 * best day, and a pace that is safe to print. Everything is derived from the stats summary rather
 * than the loaded page of sessions, so it stays correct for a book with more sessions than fit in
 * one request.
 */
export function useReadingLogInsights(stats: Ref<BookReadingSessionStats | null>, now: Ref<number> | (() => number) = () => Date.now()) {
  const nowMs = computed(() => (typeof now === 'function' ? now() : now.value))

  const days = computed<ReadingDayTotal[]>(() =>
    (stats.value?.dailySummary ?? [])
      .filter((entry) => entry.totalMinutes > 0)
      .map((entry) => ({ day: entry.day, minutes: entry.totalMinutes }))
      .sort((left, right) => left.day.localeCompare(right.day)),
  )

  const activeDays = computed(() => days.value.length)

  const spanDays = computed(() => {
    const list = days.value
    const first = list[0]
    const last = list[list.length - 1]
    if (!first || !last) return 0
    return Math.round((Date.parse(`${last.day}T00:00:00Z`) - Date.parse(`${first.day}T00:00:00Z`)) / DAY_MS) + 1
  })

  const longestStreakDays = computed(() => {
    const list = days.value
    if (list.length === 0) return 0
    let best = 1
    let run = 1
    for (let index = 1; index < list.length; index += 1) {
      const gap = (Date.parse(`${list[index]!.day}T00:00:00Z`) - Date.parse(`${list[index - 1]!.day}T00:00:00Z`)) / DAY_MS
      run = gap === 1 ? run + 1 : 1
      if (run > best) best = run
    }
    return best
  })

  const bestDay = computed<ReadingDayTotal | null>(() => {
    let best: ReadingDayTotal | null = null
    for (const entry of days.value) {
      if (!best || entry.minutes > best.minutes) best = entry
    }
    return best
  })

  const pacePercentPerHour = computed(() => {
    const value = stats.value
    if (!value || value.paceProgressDelta <= 0) return null
    if (value.paceDurationSeconds < MIN_PACE_SAMPLE_SECONDS) return null
    return value.paceProgressDelta / (value.paceDurationSeconds / 3600)
  })

  const momentum = computed<ReadingMomentum>(() => {
    const byDay = new Map(days.value.map((entry) => [entry.day, entry.minutes]))
    const reference = new Date(nowMs.value)
    const todayStart = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate())
    let recent = 0
    let previous = 0
    for (let offset = 0; offset < 7; offset += 1) {
      recent += byDay.get(utcDayKey(todayStart - offset * DAY_MS)) ?? 0
      previous += byDay.get(utcDayKey(todayStart - (offset + 7) * DAY_MS)) ?? 0
    }
    if (recent === 0 && previous === 0) return { direction: 'flat', percent: null, isNew: false, hasActivity: false }
    if (previous <= 0) return { direction: 'up', percent: null, isNew: true, hasActivity: true }
    const percent = Math.round(((recent - previous) / previous) * 100)
    const direction = percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat'
    return { direction, percent, isNew: false, hasActivity: true }
  })

  return { days, activeDays, spanDays, longestStreakDays, bestDay, pacePercentPerHour, momentum }
}
