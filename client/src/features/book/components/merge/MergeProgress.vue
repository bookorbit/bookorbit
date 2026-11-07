<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckCircle2, CircleSlash, Loader2, XCircle } from '@lucide/vue'
import type { BookMergeSourceOutcome } from '@bookorbit/types'
import type { BookMergeJobState } from '@/features/book/composables/useBookMerge'
import { isTerminalMergeStatus, sourceOutcomes } from '@/features/book/lib/book-merge'
import { formatBytes } from '@/lib/formatting'

const props = defineProps<{
  job: BookMergeJobState
  bookLabels: Map<number, string>
  unreachable: boolean
}>()

const { t, te } = useI18n()

const finished = computed(() => isTerminalMergeStatus(props.job.status))
const outcomes = computed(() => sourceOutcomes(props.job))
const mergedCount = computed(() => outcomes.value.filter((outcome) => outcome.status === 'merged').length)
const percent = computed(() => (props.job.total > 0 ? Math.round((Math.min(props.job.processed, props.job.total) / props.job.total) * 100) : 0))
/** Files copied to another drive take long enough to count in bytes; a same-drive merge never reports them. */
const bytes = computed(() => {
  const total = props.job.bytesTotal
  if (total === null || total <= 0) return null
  const done = Math.min(Math.max(props.job.bytesDone ?? 0, 0), total)
  return {
    done,
    total,
    percent: Math.round((done / total) * 100),
    text: t('book.merge.crossLibrary.progress.bytes', { done: formatBytes(done), total: formatBytes(total) }),
  }
})
const statusLabel = computed(() => (te(`book.merge.progress.status.${props.job.status}`) ? t(`book.merge.progress.status.${props.job.status}`) : ''))
const currentTitle = computed(() => (props.job.currentSourceBookId !== null ? (props.bookLabels.get(props.job.currentSourceBookId) ?? null) : null))
const resultHeading = computed(() => (mergedCount.value === 0 ? t('book.merge.result.failedHeading') : t('book.merge.result.partialHeading')))

const announcement = computed(() =>
  finished.value
    ? t('book.merge.progress.announceDone')
    : t('book.merge.progress.announce', { processed: props.job.processed, total: props.job.total }),
)

function outcomeLabel(outcome: BookMergeSourceOutcome): string {
  return t(`book.merge.result.outcome.${outcome.status}`)
}

/** Server codes are localized from the catalog; a code this bundle does not know gets the general line. */
function outcomeReason(outcome: BookMergeSourceOutcome): string | null {
  if (outcome.status === 'merged') return null
  const code = outcome.errorCode
  if (code && te(`book.merge.result.reasons.${code}`)) return t(`book.merge.result.reasons.${code}`)
  if (code && te(`errors.codes.${code}`)) return t(`errors.codes.${code}`)
  if (code && te(`book.merge.blockers.${code}`)) return t(`book.merge.blockers.${code}`)
  return outcome.status === 'pending' ? null : t('book.merge.result.failedReason')
}
</script>

<template>
  <div class="space-y-4">
    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>

    <template v-if="!finished">
      <div class="space-y-2">
        <div class="flex items-baseline justify-between gap-2">
          <span class="flex items-center gap-2 text-sm font-medium text-foreground">
            <Loader2 :size="14" class="animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
            {{ statusLabel }}
          </span>
          <span class="text-xs text-muted-foreground tabular-nums">{{
            t('book.merge.progress.count', { processed: job.processed, total: job.total })
          }}</span>
        </div>
        <template v-if="bytes">
          <div
            class="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            :aria-valuenow="bytes.done"
            aria-valuemin="0"
            :aria-valuemax="bytes.total"
            :aria-valuetext="bytes.text"
            :aria-label="statusLabel"
            data-testid="merge-bytes-progress"
          >
            <div class="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" :style="{ width: `${bytes.percent}%` }" />
          </div>
          <p class="text-xs text-muted-foreground tabular-nums" data-testid="merge-bytes-text">{{ bytes.text }}</p>
        </template>
        <div
          v-else
          class="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          :aria-valuenow="percent"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="statusLabel"
        >
          <div class="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" :style="{ width: `${percent}%` }" />
        </div>
        <p v-if="currentTitle" class="text-xs text-muted-foreground">{{ t('book.merge.progress.current', { title: currentTitle }) }}</p>
      </div>
      <p class="text-xs text-muted-foreground">{{ t('book.merge.progress.closeHint') }}</p>
      <p v-if="unreachable" class="text-xs text-muted-foreground" role="status">{{ t('book.merge.progress.unreachable') }}</p>
    </template>

    <template v-else>
      <h4 class="text-sm font-semibold text-foreground">{{ resultHeading }}</h4>
      <ul class="space-y-1.5" data-testid="merge-outcomes">
        <li
          v-for="outcome in outcomes"
          :key="outcome.sourceBookId"
          class="flex items-start gap-2 rounded-md border border-border px-3 py-2"
          :data-status="outcome.status"
          data-testid="merge-outcome"
        >
          <CheckCircle2 v-if="outcome.status === 'merged'" :size="15" class="mt-0.5 shrink-0 text-success" aria-hidden="true" />
          <XCircle v-else-if="outcome.status === 'failed'" :size="15" class="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
          <CircleSlash v-else :size="15" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium break-words text-foreground">{{ bookLabels.get(outcome.sourceBookId) ?? '' }}</span>
            <span class="block text-xs text-foreground">{{ outcomeLabel(outcome) }}</span>
            <span v-if="outcomeReason(outcome)" class="block text-xs text-muted-foreground">{{ outcomeReason(outcome) }}</span>
          </span>
        </li>
      </ul>
      <ul v-if="job.result" class="space-y-0.5 text-xs text-muted-foreground">
        <li v-if="job.result.movedFileCount > 0">{{ t('book.merge.result.movedFiles', { count: job.result.movedFileCount }) }}</li>
        <li v-if="job.result.leftoverFileCount > 0">{{ t('book.merge.result.leftoverFiles', { count: job.result.leftoverFileCount }) }}</li>
        <li v-if="job.result.retiredFileCount > 0">{{ t('book.merge.result.retiredFiles', { count: job.result.retiredFileCount }) }}</li>
      </ul>
    </template>
  </div>
</template>
