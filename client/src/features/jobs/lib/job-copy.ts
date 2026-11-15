import type { JobActionKind, JobListItem, JobStatus } from '@bookorbit/types'

import { i18n } from '@/i18n'
import { formatDate, formatNumber } from '@/i18n/formatters'
import { jobErrorMessageKey, stageLabelKey } from '@/features/read-aloud/lib/read-aloud'
import { storyGuidePhaseText } from '@/features/story-guide/lib/story-guide-copy'
import { storyGuidePhase } from '@/features/story-guide/lib/story-guide-presentation'
import { localDayKey } from './job-presentation'

const { t, te } = i18n.global

/** Actions whose AI-area wording carries over unchanged, so their existing translations keep showing. */
const AI_WORDED_ACTIONS = new Set<JobActionKind>(['cancel', 'pause', 'resume', 'retry', 'dismiss'])
const AI_WORDED_STATUSES = new Set<JobStatus>(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled'])
const AI_REASONS = new Set([
  'budget',
  'over-estimate',
  'provider-auth',
  'provider-down',
  'model-missing',
  'off',
  'slot-empty',
  'user',
  'low-coverage',
  'requester',
  'source-changed',
  'unreadable',
  'error',
])

/** Copy for a type this page does not know yet falls back to generic wording. */
function typeKey(type: string, leaf: string): string | null {
  const key = `jobsArea.types.${type}.${leaf}`
  return te(key) ? key : null
}

/** A type's wording for one of its codes, such as a phase or a kind. */
function codeKey(type: string, group: string, code: string | null): string | null {
  return code ? typeKey(type, `${group}.${code}`) : null
}

/** Where a type's own screens already word its failure codes, so a job reads the same in both places. */
const REASON_SOURCES: Partial<Record<string, readonly string[]>> = {
  'book-merge': ['book.merge.result.reasons'],
  'chapter-edit': ['errors.codes'],
}

function reasonKey(type: string, reason: string | null): string | null {
  if (!reason) return null
  const own = codeKey(type, 'reasons', reason)
  if (own) return own
  return (REASON_SOURCES[type] ?? []).map((prefix) => `${prefix}.${reason}`).find((key) => te(key)) ?? null
}

/** What a summary row still has to work through, the item running included. */
function remainingText(item: Pick<JobListItem, 'type' | 'done' | 'total'>): string | null {
  if (item.total === null) return null
  const count = Math.max(0, item.total - (item.done ?? 0))
  return t(typeKey(item.type, 'remaining') ?? 'jobsArea.summary.remaining', { count })
}

export function jobTypeLabel(type: string): string {
  return t(typeKey(type, 'label') ?? 'jobsArea.unknownType')
}

export function jobStatusLabel(status: JobStatus): string {
  if (status === 'needs-you') return t('jobsArea.status.needsYou')
  return AI_WORDED_STATUSES.has(status) ? t(`aiArea.activity.status.${status}`) : t('jobsArea.status.unknown')
}

export function jobActionLabel(action: JobActionKind): string {
  return AI_WORDED_ACTIONS.has(action) ? t(`aiArea.activity.actions.${action}`) : t(`jobsArea.actions.${action}`)
}

/** A label that names the job too, since every row offers the same buttons. */
export function jobActionOnLabel(action: JobActionKind, name: string): string {
  return AI_WORDED_ACTIONS.has(action) ? t(`aiArea.activity.actionsOn.${action}`, { name }) : t(`jobsArea.actionsOn.${action}`, { name })
}

/** What an action did, for the jobs it was done to. */
export function jobResultText(action: JobActionKind, count: number): string {
  return AI_WORDED_ACTIONS.has(action) ? t(`aiArea.activity.results.${action}`, { count }) : t(`jobsArea.results.${action}`, { count })
}

/**
 * What a job is for, even once its subject is gone or out of the viewer's reach. A type whose rows
 * are not about one thing, such as a summary of a whole queue, names itself instead.
 */
export function jobSubjectLabel(item: Pick<JobListItem, 'type' | 'kind' | 'subject'>): string {
  if (item.subject.label) return item.subject.label
  if (item.type === 'story-guide') return item.subject.url ? t('aiArea.activity.untitled') : t('aiArea.activity.unavailable')
  return t(codeKey(item.type, 'titles', item.kind) ?? typeKey(item.type, 'title') ?? 'jobsArea.unavailable')
}

/** A queued job's place in its type's lane, or what a waiting queue holds or waits for. */
export function jobPlaceText(item: Pick<JobListItem, 'type' | 'shape' | 'status' | 'reason' | 'position' | 'done' | 'total'>): string | null {
  if (item.status !== 'queued') return null
  if (item.shape === 'queue') {
    const waitsFor = reasonKey(item.type, item.reason)
    return waitsFor ? t(waitsFor) : remainingText(item)
  }
  if (item.position === null) return null
  if (item.position === 1) return t(typeKey(item.type, 'next') ?? 'aiArea.activity.nextUp')
  const key = typeKey(item.type, 'position') ?? 'aiArea.activity.position'
  return t(key, { position: formatNumber(item.position) })
}

/** Read-aloud jobs that end without output say why, the way the book page does. */
const READ_ALONG_CANCEL_REASONS = new Set(['review_expired', 'discarded'])

/** One short sentence on why a job waits or stopped; a reason this version does not know reads as a generic one. */
export function jobReasonText(item: Pick<JobListItem, 'type' | 'shape' | 'status' | 'reason' | 'extra'>): string | null {
  if (item.type === 'read-along') return readAlongReasonText(item)
  if (item.shape === 'queue') return summaryReasonText(item)
  if (item.status !== 'paused' && item.status !== 'failed' && item.status !== 'needs-you') return null
  if (item.type === 'story-guide' && item.reason && AI_REASONS.has(item.reason)) return t(`aiArea.activity.reasons.${item.reason}`)
  const key = reasonKey(item.type, item.reason)
  if (key) return t(key)
  if (item.status === 'needs-you') return t('jobsArea.reasons.needsYou')
  if (item.status === 'paused') return item.reason === 'user' ? t('aiArea.activity.reasons.user') : t('aiArea.activity.reasons.pausedOther')
  return t(typeKey(item.type, 'failedDefault') ?? 'aiArea.activity.reasons.error')
}

/** A summary row counts what it stands for: the books to review, or the ones that failed. */
function summaryReasonText(item: Pick<JobListItem, 'type' | 'status' | 'reason' | 'extra'>): string | null {
  switch (item.status) {
    // A whole queue is only ever held by someone pausing it.
    case 'paused':
      return t(reasonKey(item.type, item.reason) ?? 'aiArea.activity.reasons.user')
    case 'needs-you':
      return t(typeKey(item.type, 'toReview') ?? 'jobsArea.summary.toReview', { count: item.extra?.review ?? 0 })
    case 'failed':
      return t(typeKey(item.type, 'failedCount') ?? 'jobsArea.summary.failedCount', { count: item.extra?.failed ?? 0 })
    default:
      return null
  }
}

function readAlongReasonText(item: Pick<JobListItem, 'status' | 'reason' | 'extra'>): string | null {
  switch (item.status) {
    case 'paused':
      return item.reason === 'user' ? t('aiArea.activity.reasons.user') : t('aiArea.activity.reasons.pausedOther')
    case 'needs-you': {
      // An unreviewed read-aloud is discarded at its deadline, so the row says when.
      const until = item.extra?.expiresAt ? new Date(item.extra.expiresAt) : null
      if (until && !Number.isNaN(until.getTime())) {
        return t('jobsArea.types.read-along.reviewUntil', { date: formatDate(until, { day: 'numeric', month: 'short' }) })
      }
      return t('jobsArea.types.read-along.review')
    }
    case 'failed':
      return t(jobErrorMessageKey(item.reason, te))
    default:
      return null
  }
}

/** The step a running job is on, as its type names it, or what a running queue has left. */
export function jobPhaseText(item: Pick<JobListItem, 'type' | 'shape' | 'kind' | 'status' | 'phase' | 'done' | 'total'>): string | null {
  if (item.status !== 'running') return null
  if (item.type === 'story-guide') return storyGuidePhaseText(storyGuidePhase({ phase: item.phase, done: item.done ?? 0, total: item.total ?? 0 }))
  if (item.type === 'read-along') return t(stageLabelKey(item.phase))
  if (item.shape === 'queue') return remainingText(item)
  const phase = codeKey(item.type, 'phases', item.phase)
  if (phase) return t(phase)
  const progress = item.total !== null ? typeKey(item.type, 'progress') : null
  if (progress) return t(progress, { done: formatNumber(item.done ?? 0), total: formatNumber(item.total ?? 0) })
  const key = codeKey(item.type, 'kinds', item.kind) ?? typeKey(item.type, 'running')
  return key ? t(key) : null
}

/** How an ended job turned out, when nothing more specific explains it. */
export function jobOutcomeText(item: Pick<JobListItem, 'type' | 'kind' | 'status' | 'reason' | 'done' | 'total' | 'extra'>): string | null {
  if (item.status === 'completed') {
    if (item.reason === 'warnings' && typeKey(item.type, 'completedWarnings')) return t(`jobsArea.types.${item.type}.completedWarnings`)
    const failed = item.extra?.failed ?? 0
    const withFailures = failed > 0 ? typeKey(item.type, 'completedFailed') : null
    if (withFailures) return t(withFailures, { count: failed })
    return t(codeKey(item.type, 'completedKinds', item.kind) ?? typeKey(item.type, 'completed') ?? 'aiArea.activity.status.completed')
  }
  if (item.status === 'cancelled') {
    if (item.type === 'read-along' && item.reason && READ_ALONG_CANCEL_REASONS.has(item.reason)) return t(jobErrorMessageKey(item.reason, te))
    const reason = reasonKey(item.type, item.reason)
    if (reason) return t(reason)
    // A type that counts its work says how far it got.
    const partway = item.total !== null ? typeKey(item.type, 'cancelledAt') : null
    if (partway) return t(partway, { done: formatNumber(item.done ?? 0), total: formatNumber(item.total ?? 0) })
    return t('aiArea.activity.status.cancelled')
  }
  return null
}

/** Why a row the viewer sees offers them nothing to do. */
export function jobNoteText(code: string): string {
  const key = `jobsArea.notes.${code}`
  return te(key) ? t(key) : t('jobsArea.notes.unknown')
}

/** A History band's heading: today, yesterday, or the date. */
export function jobDayLabel(dayKey: string, now = new Date()): string {
  if (dayKey === localDayKey(now.toISOString())) return t('jobsArea.days.today')
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dayKey === localDayKey(yesterday.toISOString())) return t('jobsArea.days.yesterday')
  const [year, month, day] = dayKey.split('-').map(Number)
  const date = new Date(year!, month! - 1, day!)
  return formatDate(date, { weekday: 'short', month: 'short', day: 'numeric', ...(year === now.getFullYear() ? {} : { year: 'numeric' }) })
}
