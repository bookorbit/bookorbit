import { colorLabel, originLabel, styleLabel } from './filter-options'

export interface ActiveFilterChip {
  id: string
  label: string
}

export function dateRangeLabel(from: string, to: string): string {
  if (from && to) return `${from} to ${to}`
  if (from) return `From ${from}`
  return `Until ${to}`
}

/** Builds the dismissible chip list for the filters that live inside the Filters popover. */
export function buildFilterChips(opts: {
  colors: string[]
  styleFilter?: string
  originFilter?: string
  dateFrom: string
  dateTo: string
}): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = []
  for (const hex of opts.colors) chips.push({ id: `color:${hex}`, label: `Color: ${colorLabel(hex)}` })
  if (opts.styleFilter && opts.styleFilter !== 'all') chips.push({ id: 'style', label: `Style: ${styleLabel(opts.styleFilter)}` })
  if (opts.originFilter && opts.originFilter !== 'all') chips.push({ id: 'origin', label: `Source: ${originLabel(opts.originFilter)}` })
  if (opts.dateFrom || opts.dateTo) chips.push({ id: 'date', label: `Date: ${dateRangeLabel(opts.dateFrom, opts.dateTo)}` })
  return chips
}
