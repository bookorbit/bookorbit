import type { Component } from 'vue'
import { Ban, CircleAlert, Copy, FileWarning, FolderX, Hourglass, Lock, TriangleAlert } from '@lucide/vue'
import { isBookDockHoldReason, type BookDockFile, type BookDockHoldReason } from '@bookorbit/types'

type Translate = (key: string, params?: Record<string, unknown>) => string

export type HoldTone = 'amber' | 'red' | 'violet' | 'sky' | 'grey'

interface HoldStyle {
  tone: HoldTone
  icon: Component
}

/** The order the reason chips follow: what a person can fix fastest first. */
export const HOLD_REASON_ORDER: readonly BookDockHoldReason[] = [
  'low_confidence',
  'duplicate',
  'destination_conflict',
  'not_allowed_in_library',
  'unsupported_layout',
  'no_destination',
  'no_folder',
  'waiting_for_manager',
]

const STYLES: Record<BookDockHoldReason, HoldStyle> = {
  low_confidence: { tone: 'amber', icon: TriangleAlert },
  duplicate: { tone: 'red', icon: Copy },
  destination_conflict: { tone: 'red', icon: FileWarning },
  not_allowed_in_library: { tone: 'violet', icon: Ban },
  unsupported_layout: { tone: 'violet', icon: Ban },
  no_destination: { tone: 'sky', icon: CircleAlert },
  no_folder: { tone: 'sky', icon: FolderX },
  waiting_for_manager: { tone: 'grey', icon: Lock },
}

/** A code a newer server sends that this client does not know reads as a plain wait. */
const UNKNOWN_STYLE: HoldStyle = { tone: 'grey', icon: Hourglass }

export function holdStyle(reason: string): HoldStyle {
  return isBookDockHoldReason(reason) ? STYLES[reason] : UNKNOWN_STYLE
}

/** Chip classes per tone. The dot is the reason row's swatch. */
export const HOLD_TONE_CLASS: Record<HoldTone, { chip: string; dot: string; edge: string; action: string }> = {
  amber: {
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
    edge: 'border-l-amber-500/60',
    action: 'border-dashed border-amber-500/55 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  red: {
    chip: 'bg-red-500/15 text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
    edge: 'border-l-red-500/60',
    action: 'border-red-500/45 bg-red-500/10 text-red-700 dark:text-red-300',
  },
  violet: {
    chip: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    dot: 'bg-violet-500',
    edge: 'border-l-violet-500/60',
    action: 'border-dashed border-violet-500/55 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  },
  sky: {
    chip: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
    edge: 'border-l-sky-500/60',
    action: 'border-dashed border-sky-500/55 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  grey: {
    chip: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground',
    edge: 'border-l-transparent',
    action: 'border-border bg-muted/55 text-foreground',
  },
}

/** The reason row's short name for a reason. */
export function holdReasonLabel(reason: string, t: Translate): string {
  return isBookDockHoldReason(reason) ? t(`bookDock.hold.reason.${reason}`) : t('bookDock.hold.reason.unknown')
}

/** The row chip's words, with the facts behind the reason where the server sent them. */
export function holdChipText(file: Pick<BookDockFile, 'holdReason' | 'holdDetail'>, t: Translate): string {
  const reason = file.holdReason
  if (!reason) return ''
  const detail = file.holdDetail ?? {}
  const library = detail.libraryName
  switch (reason) {
    case 'low_confidence':
      return detail.confidence != null && detail.threshold != null
        ? t('bookDock.hold.chip.lowConfidence', { confidence: detail.confidence, threshold: detail.threshold })
        : holdReasonLabel(reason, t)
    case 'duplicate':
      return library ? t('bookDock.hold.chip.duplicate', { library }) : holdReasonLabel(reason, t)
    case 'not_allowed_in_library':
    case 'unsupported_layout':
      return library ? t('bookDock.hold.chip.doesNotFit', { library }) : holdReasonLabel(reason, t)
    default:
      return holdReasonLabel(reason, t)
  }
}
