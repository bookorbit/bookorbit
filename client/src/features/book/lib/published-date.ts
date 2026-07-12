const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function formatPublishedDate(dateKey: string | null | undefined): string | null {
  if (!dateKey) return null
  const match = dateKey.match(DATE_KEY_RE)
  if (!match) return dateKey
  const [, yearValue, monthValue, dayValue] = match
  const date = new Date(Number(yearValue), Number(monthValue) - 1, Number(dayValue))
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function displayPublishedDate(dateKey: string | null | undefined, year: number | null | undefined): string | null {
  return formatPublishedDate(dateKey) ?? (year != null ? String(year) : null)
}
