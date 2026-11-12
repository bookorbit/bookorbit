import { STORY_GUIDE_FEATURE, type AiJobListItem, type AiJobQueueAction } from '@bookorbit/types'

import { i18n } from '@/i18n'
import { formatNumber } from '@/i18n/formatters'
import { storyGuidePhaseText } from '@/features/story-guide/lib/story-guide-copy'
import { storyGuidePhase } from '@/features/story-guide/lib/story-guide-presentation'

const t = i18n.global.t

const KNOWN_REASONS = new Set([
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

export function aiJobKindLabel(kind: AiJobListItem['kind']): string {
  return t(`aiArea.activity.kinds.${kind}`)
}

export function aiJobStatusLabel(status: AiJobListItem['status']): string {
  return t(`aiArea.activity.status.${status}`)
}

/** What a job is for, even once its title is gone or out of the viewer's reach. */
export function aiJobSubjectLabel(item: AiJobListItem): string {
  if (item.subject.label) return item.subject.label
  return item.subject.url ? t('aiArea.activity.untitled') : t('aiArea.activity.unavailable')
}

/** One short sentence on why a job waits or stopped; any reason this version does not know reads as a generic one. */
export function aiJobReasonText(item: AiJobListItem): string | null {
  if (item.status !== 'paused' && item.status !== 'failed') return null
  if (item.reason && KNOWN_REASONS.has(item.reason)) return t(`aiArea.activity.reasons.${item.reason}`)
  return item.status === 'paused' ? t('aiArea.activity.reasons.pausedOther') : t('aiArea.activity.reasons.error')
}

/** The step a running job is on, as its feature names it. */
export function aiJobPhaseText(item: AiJobListItem): string | null {
  if (item.status !== 'running') return null
  if (item.feature === STORY_GUIDE_FEATURE) return storyGuidePhaseText(storyGuidePhase(item))
  return item.total > 0 ? t('aiArea.activity.progress', { done: formatNumber(item.done), total: formatNumber(item.total) }) : null
}

export function aiJobProgress(item: AiJobListItem): number | null {
  if (item.status !== 'running' || item.total <= 0) return null
  return Math.min(1, Math.max(0, item.done / item.total))
}

export function aiJobActionLabel(action: AiJobQueueAction): string {
  return t(`aiArea.activity.actions.${action}`)
}
