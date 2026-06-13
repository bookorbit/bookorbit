import { READING_SESSION_SOURCE_BUCKETS, READING_SESSION_SOURCE_BUCKET_LABELS, type ReadingSessionSourceBucket } from '@bookorbit/types'

import { getFormatColor } from '@/features/book/lib/format-colors'
import { resolveSourceBucketColors } from './source-bucket-colors'

export type BreakdownDimension = 'source' | 'format'

export const BREAKDOWN_OPTIONS: { value: BreakdownDimension; label: string }[] = [
  { value: 'source', label: 'Source' },
  { value: 'format', label: 'Format' },
]

export interface BreakdownSeries {
  key: string
  label: string
  color: string
}

// Ordered series descriptors for charts that stack/colour by the chosen dimension.
// `formatKeys` (uppercase, e.g. EPUB/PDF/UNKNOWN) is only consulted for the format dimension.
export function getBreakdownSeries(dimension: BreakdownDimension, themeKey: string, formatKeys: string[]): BreakdownSeries[] {
  if (dimension === 'source') {
    const colors = resolveSourceBucketColors(themeKey)
    return READING_SESSION_SOURCE_BUCKETS.map((bucket) => ({
      key: bucket,
      label: READING_SESSION_SOURCE_BUCKET_LABELS[bucket],
      color: colors[bucket],
    }))
  }
  return formatKeys.map((key) => ({ key, label: key, color: getFormatColor(key) }))
}

// Colour for a single item keyed by the chosen dimension (used by per-item charts).
export function getBreakdownColor(dimension: BreakdownDimension, key: string, themeKey: string): string {
  if (dimension === 'source') return resolveSourceBucketColors(themeKey)[key as ReadingSessionSourceBucket]
  return getFormatColor(key)
}
