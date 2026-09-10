const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const UTC_MIDNIGHT_DATE_RE = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?Z$/

function localDateKey(value: Date, timeZone?: string): string {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value)
    const year = parts.find((part) => part.type === 'year')?.value
    const month = parts.find((part) => part.type === 'month')?.value
    const day = parts.find((part) => part.type === 'day')?.value
    return year && month && day ? `${year}-${month}-${day}` : ''
  }

  const year = String(value.getFullYear()).padStart(4, '0')
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function readingDateToDateKey(value: string | null | undefined, timeZone?: string): string {
  if (!value) return ''
  if (DATE_KEY_RE.test(value)) return value

  // Reading-attempt dates are projected into the legacy status columns as UTC midnight.
  const projectedDate = UTC_MIDNIGHT_DATE_RE.exec(value)?.[1]
  if (projectedDate) return projectedDate

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : localDateKey(parsed, timeZone)
}
