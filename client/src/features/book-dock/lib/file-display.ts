import type { BookDockFile, BookDockMetadata } from '@bookorbit/types'
import { toDisplayCoverUrl } from '@/features/book/lib/metadata-fetch'

export type MetadataState = 'edited' | 'fetched' | 'embedded' | 'none'

export function hasMetadataContent(m: BookDockMetadata | null | undefined): boolean {
  if (!m) return false
  return Object.values(m).some((v) => v !== undefined && v !== null && v !== '')
}

export function metadataState(file: BookDockFile): MetadataState {
  if (hasMetadataContent(file.selectedMetadata)) return 'edited'
  if (hasMetadataContent(file.fetchedMetadata)) return 'fetched'
  if (hasMetadataContent(file.embeddedMetadata)) return 'embedded'
  return 'none'
}

export function effectiveMetadata(file: BookDockFile): BookDockMetadata | null {
  return file.selectedMetadata ?? file.embeddedMetadata
}

/**
 * Resolve per field, not per object. Falling back on the whole object means an
 * applied edit that leaves the title empty masks the embedded title and the row
 * drops back to showing a raw filename.
 */
export function displayTitle(file: BookDockFile): string {
  return file.selectedMetadata?.title || file.embeddedMetadata?.title || file.fileName
}

export function displayAuthor(file: BookDockFile): string {
  const authors = file.selectedMetadata?.authors?.length ? file.selectedMetadata.authors : file.embeddedMetadata?.authors
  return authors?.length ? authors.join(', ') : ''
}

export function proposedTitle(file: BookDockFile): string | null {
  return file.selectedMetadata?.title ?? file.fetchedMetadata?.title ?? null
}

export function proposedAuthor(file: BookDockFile): string | null {
  const authors = file.selectedMetadata?.authors ?? file.fetchedMetadata?.authors
  return authors?.length ? authors.join(', ') : null
}

export function currentCoverUrl(file: BookDockFile): string {
  return `/api/v1/book-dock/files/${file.id}/cover?v=${new Date(file.updatedAt).getTime()}`
}

export function proposedCoverUrl(file: BookDockFile): string | null {
  return toDisplayCoverUrl(file.selectedMetadata?.coverUrl) || toDisplayCoverUrl(file.fetchedMetadata?.coverUrl) || null
}

export function isTargetUnassigned(file: BookDockFile): boolean {
  return file.targetLibraryId == null || file.targetFolderId == null
}

export function isAwaitingMetadataExtraction(file: BookDockFile): boolean {
  return file.status === 'pending' || file.status === 'extracting'
}

export function isInProgress(file: BookDockFile): boolean {
  return file.status === 'extracting' || file.status === 'fetching'
}

/**
 * A file the user still has to make a call on: the provider guessed poorly, or
 * nothing has told us where the file should be filed. Both block a clean finalize.
 */
export function needsReview(file: BookDockFile): boolean {
  if (file.status !== 'ready') return false
  return isTargetUnassigned(file) || (file.confidence != null && file.confidence < CONFIDENCE_REVIEW_BELOW)
}

/**
 * What finalize will actually accept: a resolvable destination. Confidence is
 * advisory and only gates *automatic* finalization, so a weak match still files
 * on request - it just also shows up under Needs review.
 */
export function isReadyToFile(file: BookDockFile): boolean {
  return file.status === 'ready' && !isTargetUnassigned(file)
}

export const CONFIDENCE_REVIEW_BELOW = 70

export type ConfidenceTone = 'strong' | 'fair' | 'weak' | 'unknown'

export function confidenceTone(confidence: number | null | undefined): ConfidenceTone {
  if (confidence == null) return 'unknown'
  if (confidence >= 85) return 'strong'
  if (confidence >= CONFIDENCE_REVIEW_BELOW) return 'fair'
  return 'weak'
}

const CONFIDENCE_TEXT: Record<ConfidenceTone, string> = {
  strong: 'text-emerald-600 dark:text-emerald-400',
  fair: 'text-amber-600 dark:text-amber-400',
  weak: 'text-red-600 dark:text-red-400',
  unknown: 'text-muted-foreground',
}

const CONFIDENCE_FILL: Record<ConfidenceTone, string> = {
  strong: 'bg-emerald-500',
  fair: 'bg-amber-500',
  weak: 'bg-red-500',
  unknown: 'bg-muted-foreground',
}

const CONFIDENCE_BADGE: Record<ConfidenceTone, string> = {
  strong: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  fair: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  weak: 'bg-red-500/15 text-red-600 dark:text-red-400',
  unknown: 'bg-muted text-muted-foreground',
}

export function confidenceTextClass(confidence: number | null | undefined): string {
  return CONFIDENCE_TEXT[confidenceTone(confidence)]
}

export function confidenceFillClass(confidence: number | null | undefined): string {
  return CONFIDENCE_FILL[confidenceTone(confidence)]
}

export function confidenceBadgeClass(confidence: number | null | undefined): string {
  return CONFIDENCE_BADGE[confidenceTone(confidence)]
}

const STATUS_DOT: Record<BookDockFile['status'], string> = {
  pending: 'bg-amber-500',
  extracting: 'bg-blue-500',
  fetching: 'bg-blue-500',
  ready: 'bg-emerald-500',
  error: 'bg-red-500',
}

const STATUS_EDGE: Record<BookDockFile['status'], string> = {
  pending: 'border-l-amber-500/50',
  extracting: 'border-l-blue-500/50',
  fetching: 'border-l-blue-500/50',
  ready: 'border-l-emerald-500/50',
  error: 'border-l-red-500/50',
}

export function statusDotClass(status: BookDockFile['status']): string {
  return STATUS_DOT[status]
}

export function statusEdgeClass(status: BookDockFile['status']): string {
  return STATUS_EDGE[status]
}

/**
 * Which fields the fetched metadata would change if applied. Used by the review
 * and workstation layouts to show the proposal as a diff rather than a score.
 */
export type MetadataDiffRow = {
  key: keyof BookDockMetadata
  from: string | null
  to: string
}

const DIFF_FIELDS: (keyof BookDockMetadata)[] = ['title', 'subtitle', 'authors', 'seriesName', 'publisher', 'publishedYear', 'language', 'isbn13']

function toDisplayValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (Array.isArray(value)) return value.length ? value.join(', ') : null
  return String(value)
}

export function metadataDiff(file: BookDockFile): MetadataDiffRow[] {
  const incoming = file.selectedMetadata ?? file.fetchedMetadata
  if (!incoming) return []
  const current = file.embeddedMetadata

  const rows: MetadataDiffRow[] = []
  for (const key of DIFF_FIELDS) {
    const to = toDisplayValue(incoming[key])
    if (to === null) continue
    const from = toDisplayValue(current?.[key])
    if (from === to) continue
    rows.push({ key, from, to })
  }
  return rows
}
