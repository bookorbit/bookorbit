<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import { errorMessage } from '@/lib/api-json'
import type { DraftChapter } from '@/features/book/lib/chapter-edit'
import { snapToPauses, type AnalyzePauses, type SnapOutcome, type SnapPlacement } from '@/features/book/lib/chapter-snap'
import { formatChapterClock } from '@/features/book/lib/chapter-time'

type Scope = 'all' | 'selected'
type Phase = 'options' | 'running' | 'review'

const RADIUS_SECONDS = [2, 5, 10, 20] as const

const props = defineProps<{
  open: boolean
  rows: DraftChapter[]
  selected: Set<string>
  totalDurationMs: number | null
  analyze: AnalyzePauses
}>()

const emit = defineEmits<{ apply: [rows: DraftChapter[]]; cancel: [] }>()

const { t } = useI18n()

const phase = ref<Phase>('options')
const scope = ref<Scope>('all')
const radiusSeconds = ref<number>(5)
const placement = ref<SnapPlacement>('end')
const progressive = ref(false)
const progress = ref({ done: 0, total: 0 })
const outcome = ref<SnapOutcome | null>(null)
const error = ref<string | null>(null)
let controller: AbortController | null = null

watch(
  () => props.open,
  (open) => {
    if (!open) {
      controller?.abort()
      return
    }
    phase.value = 'options'
    scope.value = props.selected.size > 0 ? 'selected' : 'all'
    outcome.value = null
    error.value = null
  },
)

const scopeOptions = computed(() => [
  { value: 'all' as Scope, label: t('book.detail.chapters.tools.scope.all', { count: props.rows.length }), disabled: false },
  {
    value: 'selected' as Scope,
    label: t('book.detail.chapters.tools.scope.selected', { count: props.selected.size }),
    disabled: props.selected.size === 0,
  },
])

const radiusOptions = computed(() =>
  RADIUS_SECONDS.map((seconds) => ({ value: seconds, label: t('book.detail.chapters.snap.radiusOption', { seconds: formatNumber(seconds) }) })),
)

const placementOptions = computed(() => [
  { value: 'end' as SnapPlacement, label: t('book.detail.chapters.snap.placementEnd') },
  { value: 'middle' as SnapPlacement, label: t('book.detail.chapters.snap.placementMiddle') },
])

const keys = computed(() => (scope.value === 'selected' ? new Set(props.selected) : new Set(props.rows.map((row) => row.key))))

const moves = computed(() => {
  const result = outcome.value
  if (!result) return []
  return result.draft.flatMap((row, index) => {
    const before = props.rows[index]!
    return row.startMs === before.startMs
      ? []
      : [
          {
            key: row.key,
            number: formatNumber(index + 1),
            title: row.title,
            from: before.startMs,
            to: row.startMs,
            delta: row.startMs - before.startMs,
          },
        ]
  })
})

const summary = computed(() => {
  const result = outcome.value
  if (!result) return []
  const seconds = (ms: number) => formatNumber(ms / 1000, { maximumFractionDigits: 1 })
  const lines: { text: string; tone: 'muted' | 'foreground' | 'destructive' }[] = []
  lines.push(
    result.moved > 0
      ? {
          text: t('book.detail.chapters.snap.moved', {
            count: result.moved,
            average: seconds(result.meanShiftMs),
            largest: seconds(result.maxShiftMs),
          }),
          tone: 'foreground',
        }
      : { text: t('book.detail.chapters.snap.nothing'), tone: 'foreground' },
  )
  if (result.notFound > 0) lines.push({ text: t('book.detail.chapters.snap.notFound', { count: result.notFound }), tone: 'muted' })
  if (result.blocked > 0) lines.push({ text: t('book.detail.chapters.snap.blocked', { count: result.blocked }), tone: 'muted' })
  if (result.failed > 0) lines.push({ text: t('book.detail.chapters.snap.failed', { count: result.failed }), tone: 'destructive' })
  return lines
})

const progressLabel = computed(() =>
  t('book.detail.chapters.snap.running', { done: formatNumber(progress.value.done), total: formatNumber(progress.value.total) }),
)
const progressPercent = computed(() => (progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0))

function deltaLabel(ms: number): string {
  return formatNumber(ms / 1000, { signDisplay: 'always', minimumFractionDigits: 1, maximumFractionDigits: 3 })
}

function onProgress(next: { done: number; total: number }) {
  progress.value = next
}

async function handleRun() {
  const targets = [...keys.value].filter((key) => key !== props.rows[0]?.key).length
  controller = new AbortController()
  error.value = null
  progress.value = { done: 0, total: targets }
  phase.value = 'running'
  try {
    outcome.value = await snapToPauses(
      props.rows,
      keys.value,
      { radiusMs: radiusSeconds.value * 1000, placement: placement.value, progressive: progressive.value, totalDurationMs: props.totalDurationMs },
      props.analyze,
      onProgress,
      controller.signal,
    )
    phase.value = 'review'
  } catch (reason) {
    phase.value = 'options'
    if (!(reason instanceof DOMException && reason.name === 'AbortError')) error.value = errorMessage(reason, 'book.detail.chapters.errors.analyze')
  } finally {
    controller = null
  }
}

function handleStop() {
  controller?.abort()
}

function handleBack() {
  phase.value = 'options'
}

function handleOpenChange(open: boolean) {
  if (!open) emit('cancel')
}

function handleCancel() {
  emit('cancel')
}

function handleApply() {
  if (outcome.value && outcome.value.moved > 0) emit('apply', outcome.value.draft)
}
</script>

<template>
  <DialogRoot :open="open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-[70] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none"
      >
        <DialogTitle class="text-lg font-semibold text-foreground">{{ t('book.detail.chapters.snap.title') }}</DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted-foreground">{{ t('book.detail.chapters.snap.description') }}</DialogDescription>

        <form v-if="phase === 'options'" class="mt-5 flex flex-col gap-4" @submit.prevent="handleRun">
          <label class="flex flex-col gap-1.5 text-sm font-medium">
            {{ t('book.detail.chapters.snap.radius') }}
            <select
              v-model.number="radiusSeconds"
              class="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option v-for="option in radiusOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>

          <fieldset class="flex flex-col gap-1.5">
            <legend class="mb-1.5 text-sm font-medium">{{ t('book.detail.chapters.snap.placement') }}</legend>
            <label v-for="option in placementOptions" :key="option.value" class="flex items-center gap-2 text-sm">
              <input v-model="placement" type="radio" :value="option.value" class="size-3.5 accent-[var(--primary)]" />
              {{ option.label }}
            </label>
          </fieldset>

          <label class="flex items-start gap-2 text-sm">
            <input v-model="progressive" type="checkbox" class="mt-0.5 size-3.5 accent-[var(--primary)]" />
            <span>
              {{ t('book.detail.chapters.snap.progressive') }}
              <span class="block text-xs text-muted-foreground">{{ t('book.detail.chapters.snap.progressiveHint') }}</span>
            </span>
          </label>

          <fieldset class="flex flex-col gap-1.5">
            <legend class="mb-1.5 text-sm font-medium">{{ t('book.detail.chapters.tools.scope.label') }}</legend>
            <label
              v-for="option in scopeOptions"
              :key="option.value"
              class="flex items-center gap-2 text-sm"
              :class="option.disabled ? 'text-muted-foreground' : ''"
            >
              <input v-model="scope" type="radio" :value="option.value" :disabled="option.disabled" class="size-3.5 accent-[var(--primary)]" />
              {{ option.label }}
            </label>
          </fieldset>

          <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>

          <div class="mt-1 flex justify-end gap-2">
            <Button variant="outline" type="button" @click="handleCancel">{{ t('common.cancel') }}</Button>
            <Button type="submit" :disabled="rows.length < 2">{{ t('book.detail.chapters.snap.run') }}</Button>
          </div>
        </form>

        <div v-else-if="phase === 'running'" class="mt-5 flex flex-col gap-3">
          <p class="flex items-center gap-2 text-sm" role="status">
            <Loader2 class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ progressLabel }}
          </p>
          <div
            class="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            :aria-label="t('book.detail.chapters.snap.progressLabel')"
            aria-valuemin="0"
            :aria-valuemax="progress.total"
            :aria-valuenow="progress.done"
          >
            <div class="h-full bg-primary transition-[width] motion-reduce:transition-none" :style="{ width: `${progressPercent}%` }" />
          </div>
          <div class="mt-1 flex justify-end">
            <Button variant="outline" type="button" @click="handleStop">{{ t('book.detail.chapters.snap.stop') }}</Button>
          </div>
        </div>

        <div v-else class="mt-5 flex min-h-0 flex-col gap-3">
          <ul class="flex flex-col gap-1 text-sm" role="status">
            <li
              v-for="line in summary"
              :key="line.text"
              :class="line.tone === 'destructive' ? 'text-destructive' : line.tone === 'muted' ? 'text-muted-foreground' : 'text-foreground'"
            >
              {{ line.text }}
            </li>
          </ul>

          <ol v-if="moves.length" class="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            <li
              v-for="move in moves"
              :key="move.key"
              class="snap-row grid grid-cols-[2.25rem_minmax(0,1fr)_auto_4.25rem] items-center gap-2 px-2 py-1.5 text-[12.5px]"
            >
              <span class="text-end text-muted-foreground tabular-nums">{{ move.number }}</span>
              <span class="truncate">{{ move.title || t('book.detail.chapters.untitledChapter') }}</span>
              <span class="font-mono text-[11.5px] text-muted-foreground tabular-nums">{{ formatChapterClock(move.to) }}</span>
              <span class="text-end font-mono text-[11.5px] text-muted-foreground tabular-nums">{{ deltaLabel(move.delta) }}</span>
            </li>
          </ol>

          <div class="mt-1 flex justify-end gap-2">
            <Button variant="outline" type="button" @click="handleBack">{{ t('book.detail.chapters.snap.back') }}</Button>
            <Button type="button" :disabled="!outcome || outcome.moved === 0" @click="handleApply">{{
              t('book.detail.chapters.tools.apply')
            }}</Button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.snap-row {
  content-visibility: auto;
  contain-intrinsic-size: auto 2.25rem;
}
</style>
