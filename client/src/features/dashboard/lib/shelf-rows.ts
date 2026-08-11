import { DASHBOARD_SCROLLER_MAX_LIMIT } from '@bookorbit/types'

export const MIN_SHELF_ROWS = 1
export const MAX_SHELF_ROWS = 3

// Below the sm breakpoint only two covers fit across, so a third row costs a
// screen height while adding two books.
export const COMPACT_MAX_SHELF_ROWS = 2

export const SHELF_ROW_OPTIONS: readonly number[] = [1, 2, 3]

export function normalizeShelfRows(value: unknown, fallback: number = MIN_SHELF_ROWS): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.max(Math.round(parsed), MIN_SHELF_ROWS), MAX_SHELF_ROWS)
}

export function effectiveShelfRows(rows: number, compact: boolean): number {
  const normalized = normalizeShelfRows(rows)
  return compact ? Math.min(normalized, COMPACT_MAX_SHELF_ROWS) : normalized
}

export function shelfBookLimit(limit: number, rows: number): number {
  const perRow = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1
  return Math.min(perRow * normalizeShelfRows(rows), DASHBOARD_SCROLLER_MAX_LIMIT)
}

export function chunkIntoBands<T>(items: readonly T[], rows: number): T[][] {
  const bandCount = normalizeShelfRows(rows)
  if (items.length === 0) return []
  if (bandCount === 1) return [[...items]]

  const perBand = Math.ceil(items.length / bandCount)
  const bands: T[][] = []
  for (let band = 0; band < bandCount; band += 1) {
    const slice = items.slice(band * perBand, (band + 1) * perBand)
    if (slice.length > 0) bands.push(slice)
  }
  return bands
}
