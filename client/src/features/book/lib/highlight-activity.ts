import type { AnnotationHubActivityWeek, AnnotationStats } from '@bookorbit/types'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Folds the book stats' daily activity into the weekly buckets the shared sparkline draws.
 * The hub gets weeks straight from Postgres; a book's stats already carry days for other
 * callers, so they are collapsed here rather than adding a second aggregate to the query.
 *
 * Weeks start on Monday in UTC, matching the hub's `date_trunc('week', ...)`.
 */
export function foldDaysIntoWeeks(activity: AnnotationStats['activity']): AnnotationHubActivityWeek[] {
  const byWeek = new Map<string, AnnotationHubActivityWeek>()

  for (const day of activity) {
    const parsed = Date.parse(`${day.day}T00:00:00.000Z`)
    if (Number.isNaN(parsed)) continue
    const date = new Date(parsed)
    // getUTCDay: 0 is Sunday, so Sunday sits six days after its Monday.
    const offset = (date.getUTCDay() + 6) % 7
    const weekStart = new Date(parsed - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    let week = byWeek.get(weekStart)
    if (!week) {
      week = { weekStart, count: 0, origins: [] }
      byWeek.set(weekStart, week)
    }
    week.count += day.count
    for (const origin of day.origins) {
      const existing = week.origins.find((entry) => entry.origin === origin.origin)
      if (existing) existing.count += origin.count
      else week.origins.push({ ...origin })
    }
  }

  const weeks = [...byWeek.values()]
  for (const week of weeks) week.origins.sort((a, b) => b.count - a.count || a.origin.localeCompare(b.origin))
  return weeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export function busiestWeek(weeks: AnnotationHubActivityWeek[]): AnnotationHubActivityWeek | null {
  return weeks.reduce<AnnotationHubActivityWeek | null>((best, week) => (best && best.count >= week.count ? best : week), null)
}

/** Longest run of empty weeks between the first marked week and the last one. */
export function longestQuietWeeks(weeks: AnnotationHubActivityWeek[]): number {
  if (weeks.length < 2) return 0
  let longest = 0
  let previous = Date.parse(`${weeks[0]!.weekStart}T00:00:00.000Z`)
  for (const week of weeks.slice(1)) {
    const current = Date.parse(`${week.weekStart}T00:00:00.000Z`)
    if (Number.isNaN(current)) continue
    longest = Math.max(longest, Math.round((current - previous) / WEEK_MS) - 1)
    previous = current
  }
  return longest
}
