import { formatDate, formatNumber, formatRelativeTime } from '@/i18n/formatters'

const DAY_MS = 86_400_000

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toLocaleUpperCase() + value.slice(1) : value
}

/** "Today", "Yesterday", "6 days ago" within a week; a short date after that, with the year once it is not this one. */
export function awardDateLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS)
  if (days >= 0 && days < 7) return capitalize(formatRelativeTime(-days, 'day'))
  return formatDate(
    date,
    date.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
  )
}

export function awardDateLong(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : formatDate(date, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Progress counts arrive as floats (hours); show what has been reached, not a rounded-up figure. */
export function progressNumber(value: number | null | undefined): string {
  return formatNumber(Math.floor(value ?? 0))
}

export function remainingCount(current: number, threshold: number): number {
  return Math.max(0, Math.ceil(threshold - current))
}
