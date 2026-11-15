import type { Component } from 'vue'
import {
  ArrowUpToLine,
  AudioLines,
  BookSearch,
  Copy,
  Download,
  EyeOff,
  FolderSearch,
  Layers,
  ListOrdered,
  ListStart,
  ListTodo,
  Merge,
  Pause,
  Play,
  RotateCcw,
  ScanSearch,
  Sparkles,
  StepForward,
  UserSearch,
  X,
} from '@lucide/vue'
import type { JobActionKind, JobListItem, JobType } from '@bookorbit/types'

/** The order actions are offered in: the step forward first, the way out last. */
export const JOB_ACTION_ORDER: readonly JobActionKind[] = ['continue', 'retry', 'resume', 'pause', 'move-to-top', 'prioritize', 'dismiss', 'cancel']

export const JOB_ACTION_ICONS: Record<JobActionKind, Component> = {
  continue: StepForward,
  retry: RotateCcw,
  resume: Play,
  pause: Pause,
  'move-to-top': ListStart,
  prioritize: ArrowUpToLine,
  dismiss: EyeOff,
  cancel: X,
}

const TYPE_ICONS: Partial<Record<JobType, Component>> = {
  'story-guide': Sparkles,
  'read-along': AudioLines,
  'book-merge': Merge,
  'chapter-edit': ListOrdered,
  'chapter-lookup': ScanSearch,
  'duplicate-scan': Copy,
  'request-download': Download,
  'library-scan': FolderSearch,
  'metadata-fetch': BookSearch,
  'author-enrichment': UserSearch,
  'bulk-run': Layers,
}

/** A type this page does not know yet still gets an icon. */
export function jobTypeIcon(type: string): Component {
  return TYPE_ICONS[type as JobType] ?? ListTodo
}

export function orderedJobActions(actions: readonly JobActionKind[]): JobActionKind[] {
  return JOB_ACTION_ORDER.filter((action) => actions.includes(action))
}

/** The Queue view's bands: running, every type's next job, the rest in queue order, then what is held. */
export const JOB_QUEUE_BANDS = ['running', 'next', 'later', 'paused'] as const
export type JobQueueBand = (typeof JOB_QUEUE_BANDS)[number]

export function jobQueueBand(item: Pick<JobListItem, 'status' | 'position'>): JobQueueBand {
  if (item.status === 'running') return 'running'
  if (item.status === 'paused') return 'paused'
  return (item.position ?? 1) <= 1 ? 'next' : 'later'
}

/** How far a running job is, as a fraction; null while unknown. */
export function jobProgress(item: Pick<JobListItem, 'status' | 'done' | 'total' | 'percent'>): number | null {
  if (item.status !== 'running') return null
  if (item.total !== null && item.total > 0 && item.done !== null) return Math.min(1, Math.max(0, item.done / item.total))
  if (item.percent !== null) return Math.min(1, Math.max(0, item.percent / 100))
  return null
}

/** The moment a row is about: when it ended, paused, started or was asked for. */
export function jobMoment(item: Pick<JobListItem, 'status' | 'finishedAt' | 'pausedAt' | 'startedAt' | 'createdAt'>): {
  kind: 'finished' | 'paused' | 'started' | 'queued'
  at: string
} {
  if (item.finishedAt && (item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled')) {
    return { kind: 'finished', at: item.finishedAt }
  }
  if (item.status === 'paused' && item.pausedAt) return { kind: 'paused', at: item.pausedAt }
  if (item.status === 'running' && item.startedAt) return { kind: 'started', at: item.startedAt }
  return { kind: 'queued', at: item.createdAt }
}

/** The local calendar day a moment falls on, as `YYYY-MM-DD`, for History's day bands. */
export function localDayKey(at: string): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
