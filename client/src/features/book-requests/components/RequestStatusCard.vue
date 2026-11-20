<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Ban, Check, CircleCheck, CircleX, Copy, Download, FolderInput, Hourglass, ScanSearch, Search, X } from '@lucide/vue'
import type { BookRequestItem, BookRequestProgressEvent, BookRequestReview } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatDate, formatDateTime, formatPercent, formatRelativeTimeFromNow } from '@/i18n/formatters'
import { copyToClipboard } from '@/lib/clipboard'
import { formatBytes } from '@/lib/formatting'
import { REQUEST_PIPELINE_STEPS, requestPipelineState, requestStepState, requestStepTime, type RequestPipelineTone } from '../requestPipeline'
import { requestCardModel, type RequestCardIcon } from '../requestStatusCard'

const props = defineProps<{
  request: BookRequestItem
  live: BookRequestProgressEvent | null
  review: BookRequestReview | null
  /** The viewer approves or rejects, which is who the waiting card addresses. */
  canDecide: boolean
  /** Whether the client still seeds the finished download, where the drawer has read it. */
  seeding: boolean | null
}>()

const { t } = useI18n()

/** One colour per card, read by every tinted part of it through `--tone`. */
const TONE_CLASS: Record<RequestPipelineTone, string> = {
  waiting: '[--tone:var(--warning)]',
  progress: '[--tone:var(--info)]',
  done: '[--tone:var(--success)]',
  failed: '[--tone:var(--destructive)]',
  stopped: '[--tone:var(--muted-foreground)]',
}

const ICONS: Record<RequestCardIcon, typeof Hourglass> = {
  waiting: Hourglass,
  search: Search,
  download: Download,
  filing: FolderInput,
  review: ScanSearch,
  failed: CircleX,
  done: CircleCheck,
  stopped: Ban,
}

const model = computed(() =>
  requestCardModel({
    request: props.request,
    live: props.live,
    review: props.review,
    canDecide: props.canDecide,
    seeding: props.seeding,
    t: (key, named) => (named ? t(key, named) : t(key)),
    formatBytes,
    relativeTime: (iso) => formatRelativeTimeFromNow(iso, { smallestUnit: 'minute' }),
  }),
)

const state = computed(() => requestPipelineState(props.request, props.live))
const percentLabel = computed(() => (model.value.percent === null ? null : formatPercent(model.value.percent / 100)))

type StepLook = 'done' | 'current' | 'failed' | 'upcoming'

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** A clock time for today, a day for anything older; the full stamp rides in the tooltip. */
function shortTime(iso: string): string {
  const date = new Date(iso)
  return sameDay(date, new Date()) ? formatDate(date, { hour: 'numeric', minute: '2-digit' }) : formatDate(date, { month: 'short', day: 'numeric' })
}

const steps = computed(() =>
  REQUEST_PIPELINE_STEPS.map((step, index) => {
    const raw = requestStepState(state.value, index)
    const look: StepLook = raw === 'current' && state.value.tone === 'failed' ? 'failed' : raw
    const time = requestStepTime(props.request, state.value, index)
    const label = t(`bookRequests.pipeline.steps.${step}`)
    return {
      step,
      look,
      label,
      spoken: t(`bookRequests.statusCard.stepState.${look}`, { step: label }),
      time,
      short: time ? shortTime(time) : null,
      full: time ? formatDateTime(new Date(time)) : null,
    }
  }),
)

const STEP_BAR: Record<StepLook, string> = {
  done: 'bg-success',
  current: 'bg-[var(--tone)]',
  failed: 'bg-destructive',
  upcoming: 'bg-border',
}

const STEP_LABEL: Record<StepLook, string> = {
  done: 'text-foreground',
  current: 'font-semibold text-[var(--tone)]',
  failed: 'font-semibold text-destructive',
  upcoming: 'text-muted-foreground',
}

/**
 * The scale under the score meter names two points, which collide when the score sits next to the
 * line it has to clear; the sentence above already states the score, so the mark keeps its label.
 */
const scoreScale = computed(() => {
  const score = model.value.score
  if (!score) return []
  const threshold = { key: 'threshold', at: score.threshold, text: t('bookRequests.statusCard.filesAt', { threshold: score.threshold }), lead: false }
  if (Math.abs(score.score - score.threshold) < 14) return [threshold]
  return [{ key: 'score', at: score.score, text: String(score.score), lead: true }, threshold]
})

/** Centred on its point, but never pushed past either end of the track. */
function scaleShift(at: number): string {
  if (at < 8) return 'translate-x-0'
  if (at > 92) return '-translate-x-full rtl:translate-x-full'
  return '-translate-x-1/2 rtl:translate-x-1/2'
}

async function handleCopyPath() {
  const path = model.value.path
  if (!path) return
  if (await copyToClipboard(path)) toast.success(t('bookRequests.statusCard.pathCopied'))
  else toast.error(t('bookRequests.statusCard.copyFailed'))
}
</script>

<template>
  <section
    data-status-card
    class="mt-5 rounded-lg border border-[color-mix(in_oklab,var(--tone)_32%,var(--border))] bg-[color-mix(in_oklab,var(--tone)_7%,var(--card))] p-3.5 @min-[30rem]:p-4"
    :class="TONE_CLASS[model.tone]"
    :aria-label="t('bookRequests.statusCard.label')"
  >
    <div class="flex items-start gap-3">
      <span
        class="grid size-8 flex-none place-items-center rounded-full bg-[color-mix(in_oklab,var(--tone)_16%,transparent)] text-[var(--tone)]"
        aria-hidden="true"
      >
        <component :is="ICONS[model.icon]" :size="16" />
      </span>
      <div class="min-w-0 flex-1 pt-px">
        <p role="status" class="text-[15px] leading-[1.3] font-semibold text-foreground">{{ model.headline }}</p>
        <p v-if="model.sentence" class="mt-[3px] text-[13px] leading-[1.45] text-pretty text-muted-foreground">{{ model.sentence }}</p>
      </div>
      <span v-if="percentLabel" class="pt-0.5 text-[15px] font-[650] text-[var(--tone)] tabular-nums">{{ percentLabel }}</span>
    </div>

    <div
      v-if="model.percent !== null"
      class="mt-3 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--tone)_18%,var(--border))] @min-[30rem]:ms-11"
      role="progressbar"
      :aria-label="t('bookRequests.download.progressLabel', { title: request.title })"
      :aria-valuenow="model.percent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <span
        class="block h-full rounded-[inherit] bg-[var(--tone)] transition-[width] duration-500 motion-reduce:transition-none"
        :style="{ width: `${model.percent}%` }"
      />
    </div>

    <div v-if="model.score" class="mt-3 @min-[30rem]:ms-11" aria-hidden="true">
      <div class="relative h-1.5 rounded-full bg-[color-mix(in_oklab,var(--tone)_18%,var(--border))]">
        <span class="absolute inset-y-0 start-0 rounded-[inherit] bg-[var(--tone)]" :style="{ width: `${model.score.score}%` }" />
        <span class="absolute -top-1 -bottom-1 -ms-px w-0.5 rounded-[1px] bg-foreground" :style="{ insetInlineStart: `${model.score.threshold}%` }" />
      </div>
      <div class="relative mt-[5px] h-4 text-[11px] text-muted-foreground">
        <span
          v-for="mark in scoreScale"
          :key="mark.key"
          class="absolute top-0 whitespace-nowrap tabular-nums"
          :class="[scaleShift(mark.at), mark.lead && 'font-semibold text-[var(--tone)]']"
          :style="{ insetInlineStart: `${mark.at}%` }"
        >
          {{ mark.text }}
        </span>
      </div>
    </div>

    <div
      v-if="model.path"
      class="mt-2.5 flex items-center gap-1.5 rounded-sm border border-border bg-background py-[5px] ps-2.5 pe-[5px] @min-[30rem]:ms-11"
    >
      <code class="min-w-0 flex-1 font-mono text-xs leading-[1.45] [overflow-wrap:anywhere] text-foreground">{{ model.path }}</code>
      <Button variant="ghost" size="icon-sm" class="size-7" :aria-label="t('bookRequests.statusCard.copyPath')" @click="handleCopyPath">
        <Copy :size="13" aria-hidden="true" />
      </Button>
    </div>

    <ol class="mt-4 grid grid-cols-5 gap-1 @min-[30rem]:ms-11" :aria-label="t('bookRequests.pipeline.label')">
      <li
        v-for="entry in steps"
        :key="entry.step"
        class="grid min-w-0 content-start gap-1.5"
        :aria-current="entry.look === 'current' || entry.look === 'failed' ? 'step' : undefined"
      >
        <span class="h-1 rounded-full" :class="STEP_BAR[entry.look]" aria-hidden="true" />
        <span
          class="items-center gap-1 text-[11px] leading-[1.2]"
          :class="[STEP_LABEL[entry.look], entry.look === 'current' || entry.look === 'failed' ? 'inline-flex' : 'hidden @min-[30rem]:inline-flex']"
          aria-hidden="true"
        >
          <Check v-if="entry.look === 'done'" :size="11" :stroke-width="3" class="flex-none text-success" />
          <X v-else-if="entry.look === 'failed'" :size="11" :stroke-width="3" class="flex-none" />
          {{ entry.label }}
        </span>
        <span class="sr-only">{{ entry.spoken }}</span>
        <time
          v-if="entry.short && entry.time"
          class="hidden text-[11px] leading-[1.2] whitespace-nowrap text-muted-foreground tabular-nums @min-[30rem]:block"
          :datetime="entry.time"
          :title="entry.full ?? undefined"
        >
          {{ entry.short }}
        </time>
      </li>
    </ol>
  </section>
</template>
