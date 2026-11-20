<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { Ban, CircleCheck, Clock, Pause, ScanEye, TriangleAlert } from '@lucide/vue'
import type { JobListItem } from '@bookorbit/types'

import { formatNumber, formatPercent } from '@/i18n/formatters'
import { jobOutcomeText, jobPhaseText, jobPlaceText, jobReasonText, jobSubjectLabel } from '../lib/job-copy'
import { jobProgress } from '../lib/job-presentation'

const props = defineProps<{
  item: JobListItem
  /** The phone line: no phase beside a progress bar, and no cost. */
  compact: boolean
  showCost: boolean
}>()

const { t } = useI18n()

const progress = computed(() => jobProgress(props.item))
const percent = computed(() => (progress.value === null ? 0 : Math.round(progress.value * 100)))
const phase = computed(() => jobPhaseText(props.item))
const running = computed(() => props.item.status === 'running' && (progress.value !== null || phase.value !== null))
const costText = computed(() => {
  const cost = props.item.cost
  if (props.compact || !props.showCost || cost === null) return null
  return formatNumber(cost, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
})

interface Mark {
  icon: Component
  tone: string
  text: string | null
}

/** Why a job waits or stopped, where it stands in its queue, or how it ended. */
const mark = computed<Mark | null>(() => {
  const item = props.item
  switch (item.status) {
    case 'paused':
      return { icon: Pause, tone: 'text-muted-foreground', text: jobReasonText(item) }
    case 'failed':
      return { icon: TriangleAlert, tone: 'text-destructive', text: jobReasonText(item) }
    case 'needs-you':
      return { icon: ScanEye, tone: 'text-info', text: jobReasonText(item) }
    case 'completed':
      return { icon: CircleCheck, tone: 'text-success', text: jobOutcomeText(item) }
    case 'cancelled':
      return { icon: Ban, tone: 'text-muted-foreground', text: jobOutcomeText(item) }
    case 'queued':
      return { icon: Clock, tone: 'text-muted-foreground', text: jobPlaceText(item) }
    default:
      return null
  }
})
</script>

<template>
  <div
    v-if="running"
    class="flex min-w-0 items-center gap-2 text-[13px] leading-[18px] text-foreground @max-4xl/jobs:gap-1.5 @max-4xl/jobs:text-[12.5px]"
    data-testid="job-detail"
  >
    <div
      v-if="progress !== null"
      class="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted @max-4xl/jobs:w-14"
      role="progressbar"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="t('aiArea.activity.progressLabel', { name: jobSubjectLabel(item) })"
    >
      <div class="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" :style="{ width: `${percent}%` }" />
    </div>
    <span v-if="progress !== null" class="shrink-0 text-[12.5px] text-muted-foreground tabular-nums" :class="compact ? undefined : 'min-w-11'">{{
      formatPercent(progress)
    }}</span>
    <span v-if="phase && (!compact || progress === null)" class="min-w-0 truncate">{{ phase }}</span>
    <span v-if="costText" class="shrink-0 text-[12.5px] text-muted-foreground tabular-nums" :title="t('jobsArea.costSoFar')">{{ costText }}</span>
  </div>
  <!-- The phone line may take a second line, which the 60px row still holds, rather than cut a reason short. -->
  <div
    v-else-if="mark?.text"
    class="flex min-w-0 gap-2 text-[13px] text-foreground @max-4xl/jobs:gap-1.5 @max-4xl/jobs:text-[12.5px]"
    :class="compact ? 'items-start leading-4' : 'items-center leading-[18px]'"
    data-testid="job-detail"
  >
    <component :is="mark.icon" class="size-3.5 shrink-0" :class="[mark.tone, compact ? 'mt-px' : undefined]" aria-hidden="true" />
    <span class="min-w-0" :class="compact ? 'line-clamp-2' : 'truncate'" data-testid="job-detail-text">{{ mark.text }}</span>
    <span v-if="costText && item.status !== 'queued'" class="shrink-0 text-[12.5px] text-muted-foreground tabular-nums" :title="t('jobsArea.cost')">{{
      costText
    }}</span>
  </div>
</template>
