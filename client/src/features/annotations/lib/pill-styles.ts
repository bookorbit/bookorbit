import type { AnnotationItem, AnnotationPositionStatus } from '@bookorbit/types'

type AnnotationOrigin = AnnotationItem['origin']

export interface PillStyle {
  label: string
  class: string
}

const PILL_BASE = 'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium'

export const SOURCE_PILLS: Record<AnnotationOrigin, PillStyle> = {
  web: { label: 'Web', class: 'border-[var(--pill-web)]/40 bg-[var(--pill-web)]/10 text-[var(--pill-web)]' },
  koreader: { label: 'KOReader', class: 'border-[var(--pill-koreader)]/40 bg-[var(--pill-koreader)]/10 text-[var(--pill-koreader)]' },
  kobo: { label: 'Kobo', class: 'border-[var(--pill-kobo)]/40 bg-[var(--pill-kobo)]/10 text-[var(--pill-kobo)]' },
}

const STATUS_QUIET = 'border-border bg-muted text-muted-foreground'

const STATUS_PILLS: Record<AnnotationPositionStatus, PillStyle> = {
  exact: { label: 'Exact', class: STATUS_QUIET },
  repaired: { label: 'Repaired', class: 'border-[var(--pill-repaired)]/40 bg-[var(--pill-repaired)]/10 text-[var(--pill-repaired)]' },
  pending: { label: 'Pending', class: 'border-[var(--pill-pending)]/40 bg-[var(--pill-pending)]/10 text-[var(--pill-pending)]' },
  failed: { label: 'Failed', class: 'border-destructive/40 bg-destructive/10 text-destructive' },
}

const APPROXIMATE_PILL: PillStyle = {
  label: 'Approximate',
  class: 'border-[var(--pill-repaired)]/40 bg-[var(--pill-repaired)]/10 text-[var(--pill-repaired)]',
}

export const PILL_CLASS = PILL_BASE

export function sourcePill(origin: AnnotationOrigin): PillStyle {
  return SOURCE_PILLS[origin]
}

export function statusPill(status: AnnotationPositionStatus | null, isApproximate: boolean): PillStyle | null {
  if (!status) return isApproximate ? APPROXIMATE_PILL : null
  return STATUS_PILLS[status]
}
