import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiJobListItem, AiJobQueueAction } from '@bookorbit/types'

import { formatNumber, formatPercent, formatRelativeTimeFromNow } from '@/i18n/formatters'
import { aiJobPhaseText, aiJobProgress, aiJobReasonText, aiJobSubjectLabel } from '../lib/ai-job-copy'
import { orderedActions } from '../lib/ai-job-presentation'

/** The words a job's row shows: its name, where it stands, when, for whom and at what cost. */
export function useAiJobDisplay(item: () => AiJobListItem) {
  const { t } = useI18n()

  const name = computed(() => aiJobSubjectLabel(item()))
  const reason = computed(() => aiJobReasonText(item()))
  const phase = computed(() => aiJobPhaseText(item()))
  const progress = computed(() => aiJobProgress(item()))
  const progressPercent = computed(() => (progress.value === null ? 0 : Math.round(progress.value * 100)))
  const progressText = computed(() => (progress.value === null ? null : formatPercent(progress.value)))
  const actions = computed<AiJobQueueAction[]>(() => orderedActions(item().actions))

  const placeText = computed(() => {
    const { status, position } = item()
    if (status !== 'queued' || position === null) return null
    return position === 1 ? t('aiArea.activity.nextUp') : t('aiArea.activity.position', { position: formatNumber(position) })
  })

  const timeText = computed(() => {
    const { status, finishedAt, pausedAt, startedAt, createdAt } = item()
    const when = (value: string) => formatRelativeTimeFromNow(value, { smallestUnit: 'minute' })
    if (finishedAt && (status === 'completed' || status === 'failed' || status === 'cancelled')) {
      return t('aiArea.activity.times.finished', { time: when(finishedAt) })
    }
    if (status === 'paused' && pausedAt) return t('aiArea.activity.times.paused', { time: when(pausedAt) })
    if (status === 'running' && startedAt) return t('aiArea.activity.times.started', { time: when(startedAt) })
    return t('aiArea.activity.times.queued', { time: when(createdAt) })
  })

  const requesterText = computed(() => item().requester?.name ?? t('aiArea.activity.deletedAccountName'))

  /** Dollars spent so far, as an amount alone. */
  const costText = computed(() => {
    const cost = item().cost
    if (cost === null) return null
    return formatNumber(cost, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  })

  /** A label that names the job too, since every row offers the same buttons. */
  function actionLabel(action: AiJobQueueAction): string {
    return t(`aiArea.activity.actionsOn.${action}`, { name: name.value })
  }

  return { name, reason, phase, progress, progressPercent, progressText, actions, placeText, timeText, requesterText, costText, actionLabel }
}
