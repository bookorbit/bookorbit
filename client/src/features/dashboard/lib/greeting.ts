export type DashboardGreetingLabel = 'night' | 'morning' | 'afternoon' | 'evening'

const DEFAULT_TIME_ZONE = 'UTC'

export function resolveDashboardGreetingTimeZone(value: string | null | undefined): string {
  const normalized = value?.trim()
  if (!normalized) return DEFAULT_TIME_ZONE

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized })
    return normalized
  } catch {
    return DEFAULT_TIME_ZONE
  }
}

export function getHourInTimeZone(date: Date, timeZone: string): number {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Invalid date')
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveDashboardGreetingTimeZone(timeZone),
    hour: '2-digit',
    hourCycle: 'h23',
  })
  const hourPart = formatter.formatToParts(date).find((part) => part.type === 'hour')?.value
  const hour = Number(hourPart)

  if (hour === 24) return 0
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError('Invalid timezone hour')
  }

  return hour
}

export function getDashboardGreetingLabel(date: Date, timeZone: string | null | undefined): DashboardGreetingLabel {
  const hour = getHourInTimeZone(date, resolveDashboardGreetingTimeZone(timeZone))

  if (hour < 5) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}
