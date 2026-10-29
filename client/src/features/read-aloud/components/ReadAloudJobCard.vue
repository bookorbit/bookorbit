<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Ban,
  BookOpen,
  ChevronDown,
  Circle,
  CircleAlert,
  CircleCheck,
  ClipboardCheck,
  Loader2,
  LocateFixed,
  RotateCcw,
  TriangleAlert,
  X,
} from '@lucide/vue'
import type { ReadAloudDecisions, ReadAloudJob } from '@bookorbit/types'
import { formatDate, formatListParts, formatNumber, formatPercent, formatRelativeTimeFromNow } from '@/i18n/formatters'
import {
  coverageSummary,
  formatReadAloudDuration,
  isCompletedJob,
  jobErrorMessageKey,
  READ_ALOUD_STEPS,
  stageDetailKey,
  stageLabelKey,
  stepIndexOf,
} from '../lib/read-aloud'
import type { ReadAloudAction } from '../composables/useReadAloud'
import { useReadAloudEvents } from '../composables/useReadAloudEvents'
import ReadAloudActivityLog from './ReadAloudActivityLog.vue'
import ReadAloudInlineConfirm from './ReadAloudInlineConfirm.vue'
import ReadAloudReview from './ReadAloudReview.vue'

/** Output waiting this close to its automatic discard earns a reminder on the card. */
const EXPIRY_HINT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const CLOCK_INTERVAL_MS = 30_000

const props = defineProps<{
  job: ReadAloudJob
  action: ReadAloudAction | null
  /** The last failed action on this job, as a translation key. */
  errorKey: string | null
  /** Whether a new job could start now, which "Start over" needs. */
  canStartOver: boolean
  viewerId: number | null
}>()

const emit = defineEmits<{
  cancel: []
  publish: []
  retry: []
  resync: [decisions: ReadAloudDecisions]
  dismiss: []
  startOver: []
  openOutput: [fileId: number]
  showOutput: [fileId: number]
}>()

const { t, te } = useI18n()
const ids = useId()
const headingId = `${ids}-heading`
const root = ref<HTMLElement | null>(null)
const statusHeading = ref<HTMLElement | null>(null)
const detailsOpen = ref(false)
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null

const status = computed(() => props.job.status)
const queued = computed(() => status.value === 'queued')
const processing = computed(() => status.value === 'processing')
const running = computed(() => queued.value || processing.value)
const stopping = computed(() => running.value && props.job.cancelRequested)
const publishing = computed(() => processing.value && props.job.stage === 'publishing')
const review = computed(() => status.value === 'awaiting_review')
const complete = computed(() => isCompletedJob(props.job))
const failed = computed(() => status.value === 'failed')
const cancelled = computed(() => status.value === 'cancelled')
const finished = computed(() => complete.value || failed.value || cancelled.value)
const expired = computed(() => props.job.errorCode === 'review_expired')
/** Output the user threw away at review, or that expired there, reads as discarded rather than stopped. */
const discarded = computed(() => expired.value || props.job.errorCode === 'discarded')
const busy = computed(() => props.action !== null)

const retryable = computed(() => {
  const until = props.job.retryableUntil
  return failed.value && !expired.value && until !== null && Date.parse(until) > now.value
})

const startedBy = computed(() => {
  const requester = props.job.requestedBy
  const isOther = !props.job.canManage || (props.viewerId !== null && requester.id !== null && requester.id !== props.viewerId)
  if (!isOther) return null
  return requester.name
    ? t('book.detail.files.readAloud.job.startedBy', { name: requester.name })
    : t('book.detail.files.readAloud.job.startedByUnknown')
})

const title = computed(() => {
  if (stopping.value) return t('book.detail.files.readAloud.job.stoppingTitle')
  if (queued.value) return t('book.detail.files.readAloud.job.queuedTitle')
  if (processing.value) return t(stageLabelKey(props.job.stage))
  if (review.value) return t('book.detail.files.readAloud.job.reviewTitle')
  if (complete.value) {
    return props.job.status === 'completed_with_warnings'
      ? t('book.detail.files.readAloud.job.completeWarningsTitle')
      : t('book.detail.files.readAloud.job.completeTitle')
  }
  if (discarded.value) return t('book.detail.files.readAloud.job.discardedTitle')
  if (failed.value) return t('book.detail.files.readAloud.job.failedTitle')
  return t('book.detail.files.readAloud.job.cancelledTitle')
})

const elapsed = computed(() => {
  const startedAt = props.job.startedAt ? Date.parse(props.job.startedAt) : Number.NaN
  if (!processing.value || Number.isNaN(startedAt)) return null
  const seconds = (now.value - startedAt) / 1000
  // The clock ticks every 30 seconds, so anything under a minute reads as just started rather than a rounded-up minute.
  if (seconds < 60) return t('book.detail.files.readAloud.job.justStarted')
  return t('book.detail.files.readAloud.job.elapsed', { duration: formatReadAloudDuration(seconds, t) })
})

const stageDetail = computed(() => {
  const detail = props.job.stageDetail
  if (!processing.value || !detail || detail.total <= 0) return null
  // The worker counts finished items, so the one in progress is the next one.
  return t(stageDetailKey(detail.unit), { current: Math.min(detail.current + 1, detail.total), total: detail.total })
})

/** Each part renders on its own, with a decorative separator between, rather than as one joined string. */
const descriptionParts = computed<string[]>(() => {
  if (stopping.value) return [t('book.detail.files.readAloud.job.stoppingDescription')]
  if (queued.value) {
    return props.job.queuePosition === null ? [] : [t('book.detail.files.readAloud.job.queueAhead', { count: props.job.queuePosition })]
  }
  if (processing.value) {
    const parts = [
      stageDetail.value,
      props.job.stage === 'downloading_model' ? t('book.detail.files.readAloud.job.firstRunForLanguage') : null,
      elapsed.value,
    ]
    return parts.filter((part): part is string => Boolean(part))
  }
  if (review.value) {
    const summary = coverage.value
    if (!summary || summary.total <= 0) return [t('book.detail.files.readAloud.job.reviewDescriptionPlain')]
    return [t('book.detail.files.readAloud.job.reviewDescription', { percent: formatPercent(summary.matched / summary.total) })]
  }
  if (complete.value) {
    return [
      props.job.input.replaceFileId !== null
        ? t('book.detail.files.readAloud.job.completeReplaced')
        : t('book.detail.files.readAloud.job.completeAdded'),
    ]
  }
  if (expired.value) return [t('book.detail.files.readAloud.job.expiredDescription')]
  if (failed.value) return [t(jobErrorMessageKey(props.job.errorCode, te))]
  return [t('book.detail.files.readAloud.job.nothingAdded')]
})

/** Measured on the text the narration covers, so front and back matter never reads as a failed match. */
const coverage = computed(() => (complete.value || review.value ? coverageSummary(props.job) : null))

const coverageParts = computed<string[]>(() => {
  const summary = coverage.value
  if (!complete.value || !summary) return []
  const parts = [
    t('book.detail.files.readAloud.job.matchedSentences', {
      matched: formatNumber(summary.matched),
      total: formatNumber(summary.total),
      count: summary.total,
    }),
  ]
  if (summary.audioFraction !== null) parts.push(t('book.detail.files.readAloud.job.audioUsed', { percent: formatPercent(summary.audioFraction) }))
  return parts
})

const outsideLine = computed(() => {
  const summary = coverage.value
  if (!summary || summary.outsideTitles.length === 0) return null
  const names = [...summary.outsideTitles]
  if (summary.outsideMore > 0) names.push(t('book.detail.files.readAloud.job.outsideMore', { count: summary.outsideMore }))
  // A sentence-style list ("A, B, and C"), since the titles sit inside a sentence.
  return t('book.detail.files.readAloud.job.outsideNarration', {
    chapters: formatListParts(names)
      .map((part) => part.value)
      .join(''),
  })
})

const reviewExpiry = computed(() => {
  const expiresAt = props.job.expiresAt ? Date.parse(props.job.expiresAt) : Number.NaN
  if (!review.value || Number.isNaN(expiresAt) || expiresAt - now.value > EXPIRY_HINT_WINDOW_MS) return null
  return t('book.detail.files.readAloud.job.reviewExpires', {
    when: formatRelativeTimeFromNow(expiresAt, { now: now.value, smallestUnit: 'minute' }),
  })
})

const retryHint = computed(() => {
  if (!retryable.value || !props.job.retryableUntil) return null
  return t('book.detail.files.readAloud.job.retryUntil', {
    date: formatDate(new Date(props.job.retryableUntil), { month: 'short', day: 'numeric' }),
  })
})

const showPercent = computed(() => processing.value && !stopping.value)
const progressFraction = computed(() => Math.min(Math.max(props.job.progress, 0), 100) / 100)

const warnings = computed(() => props.job.warnings.map((code) => `book.detail.files.readAloud.warnings.${code}`).filter((key) => te(key)))

const steps = computed(() => {
  const current = stepIndexOf(props.job.stage)
  const labels: Record<(typeof READ_ALOUD_STEPS)[number]['key'], string> = {
    audio: t('book.detail.files.readAloud.steps.audio'),
    speech: t('book.detail.files.readAloud.steps.speech'),
    text: t('book.detail.files.readAloud.steps.text'),
    align: t('book.detail.files.readAloud.steps.align'),
    check: t('book.detail.files.readAloud.steps.check'),
    publish: t('book.detail.files.readAloud.steps.publish'),
  }
  return READ_ALOUD_STEPS.map((step, index) => {
    const state = current < 0 || index > current ? 'upcoming' : index < current ? 'done' : 'current'
    const label = labels[step.key]
    const accessibleLabel =
      state === 'done'
        ? t('book.detail.files.readAloud.job.stepDone', { step: label })
        : state === 'current'
          ? t('book.detail.files.readAloud.job.stepCurrent', { step: label })
          : t('book.detail.files.readAloud.job.stepUpcoming', { step: label })
    return { key: step.key, label, state, accessibleLabel }
  })
})

/** Status and stage only: a percentage tick every few seconds would talk over everything else. */
const liveMessage = computed(() => t('book.detail.files.readAloud.job.live', { status: title.value }))

const {
  events,
  loading: eventsLoading,
  failed: eventsFailed,
  reload: reloadEvents,
} = useReadAloudEvents(
  computed(() => props.job.id),
  detailsOpen,
  computed(() => props.job.updatedAt),
)

function stopClock(): void {
  if (clock !== null) clearInterval(clock)
  clock = null
}

watch(
  [processing, review, failed],
  ([isProcessing, isReview, isFailed]) => {
    now.value = Date.now()
    stopClock()
    if (isProcessing || isReview || isFailed) {
      clock = setInterval(() => {
        now.value = Date.now()
      }, CLOCK_INTERVAL_MS)
    }
  },
  { immediate: true },
)

onScopeDispose(stopClock)

// When the controls someone was using disappear with the state that held them, keep the keyboard
// in the card rather than dropping it on the page body.
watch(
  () => [props.job.status, props.job.cancelRequested, props.job.stage] as const,
  async () => {
    const hadFocus = root.value?.contains(document.activeElement) ?? false
    await nextTick()
    if (!hadFocus) return
    const active = document.activeElement
    if (!active || active === document.body || !root.value?.contains(active)) statusHeading.value?.focus()
  },
)

function handleCancel(): void {
  emit('cancel')
}

function handleDiscard(): void {
  emit('cancel')
}

function handlePublish(): void {
  emit('publish')
}

function handleResync(decisions: ReadAloudDecisions): void {
  emit('resync', decisions)
}

function handleRetry(): void {
  if (!busy.value) emit('retry')
}

function handleStartOver(): void {
  emit('startOver')
}

function handleDismiss(): void {
  if (!busy.value) emit('dismiss')
}

function handleOpenOutput(): void {
  if (props.job.outputFileId !== null) emit('openOutput', props.job.outputFileId)
}

function handleShowOutput(): void {
  if (props.job.outputFileId !== null) emit('showOutput', props.job.outputFileId)
}

function handleToggleDetails(): void {
  detailsOpen.value = !detailsOpen.value
}

function handleReloadEvents(): void {
  void reloadEvents()
}
</script>

<template>
  <section ref="root" class="flex shrink-0 flex-col rounded-xl border border-border bg-card" :aria-labelledby="headingId" data-read-aloud-card>
    <div class="flex h-[38px] shrink-0 items-center gap-2.5 border-b border-border px-3.5">
      <h3 :id="headingId" class="text-[10.5px] font-bold uppercase leading-none tracking-[0.09em] text-muted-foreground">
        {{ t('book.detail.files.readAloud.job.heading') }}
      </h3>
      <span v-if="startedBy" class="ms-auto truncate text-[11.5px] leading-none text-muted-foreground">{{ startedBy }}</span>
      <button
        v-if="finished && job.canManage"
        type="button"
        class="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        :class="startedBy ? '-me-1.5' : '-me-1.5 ms-auto'"
        :aria-label="t('book.detail.files.readAloud.job.dismiss')"
        :disabled="busy"
        @click="handleDismiss"
      >
        <Loader2 v-if="action === 'dismiss'" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <X v-else class="size-4" aria-hidden="true" />
      </button>
    </div>

    <div class="flex flex-col gap-3 px-3.5 py-3.5">
      <div class="flex items-start gap-2.5">
        <span class="mt-px flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
          <Loader2 v-if="running" class="size-4 animate-spin text-primary motion-reduce:animate-none" />
          <ClipboardCheck v-else-if="review" class="size-4 text-warning" />
          <CircleCheck v-else-if="complete" class="size-4 text-success" />
          <CircleAlert v-else-if="failed && !expired" class="size-4 text-destructive" />
          <Ban v-else class="size-4 text-muted-foreground" />
        </span>
        <div class="min-w-0 flex-1">
          <p ref="statusHeading" tabindex="-1" class="text-[13.5px] font-semibold leading-snug text-foreground focus:outline-none">{{ title }}</p>
          <p
            v-if="descriptionParts.length > 0"
            class="mt-0.5 flex flex-wrap gap-x-1.5 text-[12.5px] leading-relaxed text-muted-foreground"
            data-test="read-aloud-description"
          >
            <template v-for="(part, index) in descriptionParts" :key="index">
              <span v-if="index > 0" aria-hidden="true">·</span>
              <span>{{ part }}</span>
            </template>
          </p>
          <p
            v-if="coverageParts.length > 0"
            class="mt-1 flex flex-wrap gap-x-1.5 text-[12.5px] leading-relaxed tabular-nums text-foreground"
            data-test="read-aloud-coverage"
          >
            <template v-for="(part, index) in coverageParts" :key="index">
              <span v-if="index > 0" aria-hidden="true">·</span>
              <span>{{ part }}</span>
            </template>
          </p>
          <p v-if="outsideLine" class="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{{ outsideLine }}</p>
          <p v-if="reviewExpiry" class="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{{ reviewExpiry }}</p>
          <p v-if="retryHint" class="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{{ retryHint }}</p>
        </div>
        <span v-if="showPercent" class="shrink-0 text-[13.5px] font-semibold tabular-nums text-foreground">{{
          formatPercent(progressFraction)
        }}</span>
      </div>

      <template v-if="processing">
        <div
          class="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          :aria-label="t('book.detail.files.readAloud.job.progress')"
          :aria-valuenow="Math.round(progressFraction * 100)"
          :aria-valuetext="formatPercent(progressFraction)"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span
            class="block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
            :class="stopping ? 'bg-muted-foreground' : 'bg-primary'"
            :style="{ width: `${progressFraction * 100}%` }"
          />
        </div>

        <ol v-if="!stopping" class="flex flex-wrap gap-x-3.5 gap-y-1.5" :aria-label="t('book.detail.files.readAloud.job.steps')">
          <li
            v-for="step in steps"
            :key="step.key"
            class="inline-flex items-center gap-1 text-[12px]"
            :class="step.state === 'current' ? 'font-semibold text-foreground' : 'text-muted-foreground'"
            :aria-current="step.state === 'current' ? 'step' : undefined"
          >
            <CircleCheck v-if="step.state === 'done'" class="size-3.5 text-success" aria-hidden="true" />
            <Loader2 v-else-if="step.state === 'current'" class="size-3.5 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
            <Circle v-else class="size-3.5" aria-hidden="true" />
            <span aria-hidden="true">{{ step.label }}</span>
            <span class="sr-only">{{ step.accessibleLabel }}</span>
          </li>
        </ol>
      </template>

      <ReadAloudReview v-if="review" :job="job" :action="action" @resync="handleResync" @publish="handlePublish" @discard="handleDiscard" />

      <ul v-if="complete && warnings.length > 0" class="flex flex-col gap-1.5" :aria-label="t('book.detail.files.readAloud.job.warnings')">
        <li v-for="warning in warnings" :key="warning" class="flex items-start gap-2 text-[12.5px] text-foreground">
          <TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
          <span>{{ t(warning) }}</span>
        </li>
      </ul>

      <p v-if="errorKey" role="alert" class="text-[12.5px] text-destructive">{{ t(errorKey) }}</p>

      <div class="flex flex-wrap items-center gap-2">
        <ReadAloudInlineConfirm
          v-if="running && job.canManage && job.cancellable && !stopping && !publishing"
          :label="t('book.detail.files.readAloud.job.cancel')"
          :prompt="t('book.detail.files.readAloud.job.cancelPrompt')"
          :confirm-label="t('book.detail.files.readAloud.job.cancel')"
          :keep-label="t('book.detail.files.readAloud.job.keepRunning')"
          :busy="action === 'cancel'"
          :disabled="busy && action !== 'cancel'"
          @confirm="handleCancel"
        />

        <template v-if="complete && job.outputFileId !== null">
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @click="handleOpenOutput"
          >
            <BookOpen class="size-3.5" aria-hidden="true" />
            {{ t('book.detail.files.readAloud.job.openReadAlong') }}
          </button>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @click="handleShowOutput"
          >
            <LocateFixed class="size-3.5" aria-hidden="true" />
            {{ t('book.detail.files.readAloud.job.showFile') }}
          </button>
        </template>

        <button
          v-if="retryable && job.canManage"
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          :disabled="busy"
          @click="handleRetry"
        >
          <Loader2 v-if="action === 'retry'" class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <RotateCcw v-else class="size-3.5" aria-hidden="true" />
          {{ t('book.detail.files.readAloud.job.retry') }}
        </button>
        <button
          v-if="(failed || cancelled) && job.canManage && canStartOver"
          type="button"
          class="inline-flex h-8 items-center rounded-md border border-input px-2.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          :disabled="busy"
          @click="handleStartOver"
        >
          {{ t('book.detail.files.readAloud.job.startOver') }}
        </button>

        <button
          type="button"
          class="-mx-1 ms-auto inline-flex min-h-7 items-center gap-1 rounded px-1 text-[12.5px] font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-expanded="detailsOpen"
          :aria-controls="`${ids}-details`"
          @click="handleToggleDetails"
        >
          {{ t('book.detail.files.readAloud.job.details') }}
          <ChevronDown
            class="size-3.5 transition-transform motion-reduce:transition-none"
            :class="detailsOpen ? 'rotate-180' : ''"
            aria-hidden="true"
          />
        </button>
      </div>

      <div v-show="detailsOpen" :id="`${ids}-details`" class="flex flex-col gap-3">
        <section v-if="complete" class="flex flex-col gap-2" :aria-labelledby="`${ids}-chapters`">
          <h4 :id="`${ids}-chapters`" class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {{ t('book.detail.files.readAloud.job.chaptersHeading') }}
          </h4>
          <!-- Mounted on first open, so a card nobody expands never asks for the report. -->
          <ReadAloudReview v-if="detailsOpen" :job="job" :action="null" readonly />
        </section>
        <section class="flex flex-col gap-2" :aria-labelledby="`${ids}-activity`">
          <!-- Always rendered so the section keeps its name; it only shows beside the chapters list. -->
          <h4
            :id="`${ids}-activity`"
            class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            :class="complete ? undefined : 'sr-only'"
          >
            {{ t('book.detail.files.readAloud.job.activityHeading') }}
          </h4>
          <ReadAloudActivityLog :events="events" :loading="eventsLoading" :failed="eventsFailed" @retry="handleReloadEvents" />
        </section>
      </div>
    </div>

    <p class="sr-only" aria-live="polite">{{ liveMessage }}</p>
  </section>
</template>
