import { formatRelativeTime } from '@/i18n/formatters'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY
const YEAR = 365 * DAY

/** Picks the coarsest unit that still reads precisely, so "3 hours ago" never becomes "0 days ago". */
export function relativeTimestamp(value: string | Date): string {
  const differenceMs = (typeof value === 'string' ? new Date(value) : value).getTime() - Date.now()
  const absoluteMs = Math.abs(differenceMs)
  if (absoluteMs < HOUR) return formatRelativeTime(Math.round(differenceMs / MINUTE), 'minute')
  if (absoluteMs < DAY) return formatRelativeTime(Math.round(differenceMs / HOUR), 'hour')
  if (absoluteMs < MONTH) return formatRelativeTime(Math.round(differenceMs / DAY), 'day')
  if (absoluteMs < YEAR) return formatRelativeTime(Math.round(differenceMs / MONTH), 'month')
  return formatRelativeTime(Math.round(differenceMs / YEAR), 'year')
}
