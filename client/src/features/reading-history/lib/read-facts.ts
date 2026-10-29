import {
  READING_SESSION_SOURCE_BUCKET_LABELS,
  toReadingSessionSourceBucket,
  type ReadingHistoryItem,
  type ReadingSessionSourceBucket,
} from '@bookorbit/types'
import { SOURCE_BUCKET_COLOR_TOKENS } from '@/features/statistics/lib/source-bucket-colors'

export interface SourceBadge {
  bucket: ReadingSessionSourceBucket
  label: string
  color: string
}

/** Where a read happened, one entry per app or device, in the order the charts list them. */
export function sourceBadges(sources: ReadingHistoryItem['sources']): SourceBadge[] {
  const buckets = new Set(sources.map((source) => toReadingSessionSourceBucket(source)))
  return [...buckets].map((bucket) => ({
    bucket,
    label: READING_SESSION_SOURCE_BUCKET_LABELS[bucket],
    color: `var(${SOURCE_BUCKET_COLOR_TOKENS[bucket]})`,
  }))
}

export function sourceBucketColor(bucket: ReadingSessionSourceBucket): string {
  return `var(${SOURCE_BUCKET_COLOR_TOKENS[bucket]})`
}

/** A reread is any completed read after a book's first. */
export function isReread(item: Pick<ReadingHistoryItem, 'outcome' | 'readNumber'>): boolean {
  return item.outcome === 'completed' && (item.readNumber ?? 1) > 1
}
