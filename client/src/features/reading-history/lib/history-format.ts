import type { ReadingHistoryItem } from '@bookorbit/types'
import { READING_HISTORY_UNDATED_MONTH } from '@bookorbit/types'
import { formatDate } from '@/i18n/formatters'

type Translate = (key: string, values?: Record<string, unknown>) => string

/** A `YYYY-MM-DD` day as a local date; days carry no zone, so they are never shifted. */
export function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year!, (month ?? 1) - 1, day ?? 1)
}

export function formatDay(key: string): string {
  return formatDate(dateFromKey(key), { month: 'short', day: 'numeric' })
}

export function formatDayLong(key: string): string {
  return formatDate(dateFromKey(key), { year: 'numeric', month: 'short', day: 'numeric' })
}

/** An instant's local calendar day, short: what a highlight or journal entry is dated by. */
export function formatInstantDay(iso: string): string {
  return formatDate(new Date(iso), { month: 'short', day: 'numeric' })
}

export function formatWeekday(key: string): string {
  return formatDate(dateFromKey(key), { weekday: 'short' })
}

export function formatDayWithWeekday(key: string): string {
  return formatDate(dateFromKey(key), { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
}

/** `2026-10` → "October 2026"; the undated bucket gets its own label. */
export function formatMonthKey(key: string, t: Translate): string {
  if (key === READING_HISTORY_UNDATED_MONTH) return t('readingHistory.month.undated')
  return formatDate(dateFromKey(`${key}-01`), { month: 'long', year: 'numeric' })
}

export function formatMonthName(month: number, style: 'long' | 'short' | 'narrow' = 'short'): string {
  return formatDate(new Date(2000, month - 1, 1), { month: style })
}

/** Days from the day a read began to the day it ended, both counted; null without both. */
export function readSpanDays(item: Pick<ReadingHistoryItem, 'startedOn' | 'endedOn'>): number | null {
  if (!item.startedOn || !item.endedOn) return null
  return Math.round((dateFromKey(item.endedOn).getTime() - dateFromKey(item.startedOn).getTime()) / 86_400_000) + 1
}

export function formatReadingTime(seconds: number, t: Translate): string | null {
  if (seconds <= 0) return null
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return t('readingHistory.duration.underMinute')
  if (minutes < 60) return t('readingHistory.duration.minutes', { minutes })
  return t('readingHistory.duration.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, '0') })
}

export function formatHours(seconds: number): number {
  return Math.round(seconds / 3600)
}

/** The read's first fact line: when it began and how long it took, or why that is unknown. */
export function readSpanLabel(item: Pick<ReadingHistoryItem, 'startedOn' | 'endedOn'>, t: Translate): string {
  const span = readSpanDays(item)
  if (span === 1) return t('readingHistory.row.sameDay')
  if (span !== null && item.startedOn) return t('readingHistory.row.startedSpan', { date: formatDay(item.startedOn), count: span })
  if (item.endedOn) return t('readingHistory.row.finishOnly')
  return t('readingHistory.row.noDates')
}
