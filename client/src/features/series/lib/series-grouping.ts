import type { SeriesSummary } from '@bookorbit/types'
import type { SeriesGrouping } from '../types/series'
import { seriesRowFacts } from './series-summary'

export type SeriesGroup = {
  key: string
  /** Null for the ungrouped case, so the caller renders no rule at all. */
  label: string | null
  items: SeriesSummary[]
}

export type StatusGroupLabels = {
  inProgress: string
  hasGaps: string
  notStarted: string
  complete: string
}

const STATUS_ORDER = ['inProgress', 'hasGaps', 'notStarted', 'complete'] as const
type StatusKey = (typeof STATUS_ORDER)[number]

function statusKeyOf(series: SeriesSummary): StatusKey {
  const facts = seriesRowFacts(series)
  if (facts.hasGaps) return 'hasGaps'
  if (facts.isComplete) return 'complete'
  return facts.isStarted ? 'inProgress' : 'notStarted'
}

/**
 * Groups collect, they do not detect runs. Walking a sorted page and opening a new rule whenever
 * the key changes prints the same letter several times as soon as the sort is anything but that
 * key, so every row is bucketed first and the buckets are then ordered.
 */
export function groupSeries(items: SeriesSummary[], grouping: SeriesGrouping, statusLabels: StatusGroupLabels): SeriesGroup[] {
  if (grouping === 'none') return [{ key: 'all', label: null, items }]

  const buckets = new Map<string, SeriesSummary[]>()
  const keyOf = (series: SeriesSummary): string => {
    if (grouping === 'letter') {
      const first = series.name.trim().charAt(0).toUpperCase()
      return /^\p{Lu}$/u.test(first) ? first : '#'
    }
    if (grouping === 'library') return series.libraryNames[0] ?? ''
    return statusKeyOf(series)
  }

  for (const series of items) {
    const key = keyOf(series)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(series)
    else buckets.set(key, [series])
  }

  if (grouping === 'status') {
    return STATUS_ORDER.filter((key) => buckets.has(key)).map((key) => ({ key, label: statusLabels[key], items: buckets.get(key)! }))
  }

  // "#" collects everything a locale's collation would not sort under a letter, and sits last.
  const keys = [...buckets.keys()].sort((a, b) => {
    if (a === '#') return 1
    if (b === '#') return -1
    return a.localeCompare(b)
  })

  return keys.map((key) => ({ key: key || 'unfiled', label: key || '-', items: buckets.get(key)! }))
}
