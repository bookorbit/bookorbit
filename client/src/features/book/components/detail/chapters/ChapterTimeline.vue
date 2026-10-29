<script setup lang="ts">
import { computed, ref } from 'vue'
import { useElementSize } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { formatNumber, formatPercent } from '@/i18n/formatters'
import { chapterEndMs, type ChapterIssue, type DraftChapter } from '@/features/book/lib/chapter-edit'
import { formatChapterClock, formatChapterLength } from '@/features/book/lib/chapter-time'

const props = defineProps<{
  rows: DraftChapter[]
  totalDurationMs: number
  /** Listening shows what has been heard; editing shows the cuts, problems and the playhead, and scrubs. */
  mode: 'listen' | 'edit'
  activeKey?: string | null
  issuesByKey?: Map<string, ChapterIssue[]>
  listeningMs?: number | null
  playheadMs?: number | null
}>()

const emit = defineEmits<{ seek: [ms: number] }>()

const { t } = useI18n()

const HOUR_MS = 3_600_000
/** Tick spacings to choose from, smallest first; the first that leaves at most a dozen ticks, each with room for its label, wins. */
const TICK_STEPS_MS = [300_000, 600_000, 900_000, 1_800_000, HOUR_MS, 2 * HOUR_MS, 5 * HOUR_MS, 10 * HOUR_MS]
/** Room one tick label needs, and the room kept clear before the runtime printed at the end. */
const TICK_LABEL_PX = 40
const END_LABEL_PX = 64

const bar = ref<HTMLElement | null>(null)
const { width } = useElementSize(bar)
const dragMs = ref<number | null>(null)

const total = computed(() => Math.max(1, props.totalDurationMs))
const percent = (ms: number) => `${((Math.min(total.value, Math.max(0, ms)) / total.value) * 100).toFixed(3)}%`

const segments = computed(() =>
  props.rows.map((row, index) => {
    const end = chapterEndMs(props.rows, index, total.value) ?? total.value
    const length = Math.max(1, end - row.startMs)
    const issues = props.issuesByKey?.get(row.key)
    let tone = index % 2 ? 'alt' : 'base'
    let heard: number | null = null
    if (props.mode === 'listen' && props.listeningMs != null) {
      if (end <= props.listeningMs) tone = 'done'
      else if (row.startMs < props.listeningMs) {
        tone = 'heard'
        heard = ((props.listeningMs - row.startMs) / length) * 100
      }
    }
    if (props.mode === 'edit') {
      if (issues?.some((issue) => issue.severity === 'error')) tone = 'error'
      else if (issues?.length) tone = 'warning'
      else if (row.key === props.activeKey) tone = 'active'
    }
    return { key: row.key, grow: length, tone, heard, label: `${row.title} · ${formatChapterLength(length)}` }
  }),
)

const ticks = computed(() => {
  const room = width.value || 1_000
  const most = Math.max(1, Math.min(12, Math.floor(room / TICK_LABEL_PX)))
  const step = TICK_STEPS_MS.find((candidate) => total.value / candidate <= most) ?? TICK_STEPS_MS.at(-1)!
  const result: { ms: number; label: string }[] = []
  for (let ms = step; ((total.value - ms) / total.value) * room > END_LABEL_PX; ms += step) {
    const label = step % HOUR_MS === 0 ? formatNumber(ms / HOUR_MS, { style: 'unit', unit: 'hour', unitDisplay: 'narrow' }) : formatChapterLength(ms)
    result.push({ ms, label })
  }
  return result
})

const shownPlayhead = computed(() => dragMs.value ?? props.playheadMs ?? null)

const listenLabel = computed(() =>
  props.listeningMs != null
    ? t('book.detail.chapters.timeline.listened', { percent: formatPercent(props.listeningMs / total.value) })
    : t('book.detail.chapters.timeline.label'),
)

function timeAt(clientX: number): number {
  const rect = bar.value?.getBoundingClientRect()
  if (!rect || rect.width <= 0) return 0
  return Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * total.value)
}

function handlePointerDown(event: PointerEvent) {
  if (props.mode !== 'edit' || event.button !== 0) return
  dragMs.value = timeAt(event.clientX)
  capture(event, true)
}

/** Capture keeps a scrub going past the bar's edge; a browser that refuses it still gets the press. */
function capture(event: PointerEvent, on: boolean) {
  try {
    if (on) bar.value?.setPointerCapture?.(event.pointerId)
    else bar.value?.releasePointerCapture?.(event.pointerId)
  } catch {
    // The pointer is already gone, as with a synthetic or cancelled press.
  }
}

function handlePointerMove(event: PointerEvent) {
  if (dragMs.value !== null) dragMs.value = timeAt(event.clientX)
}

function handlePointerUp(event: PointerEvent) {
  if (dragMs.value === null) return
  capture(event, false)
  const ms = dragMs.value
  dragMs.value = null
  emit('seek', ms)
}

const STEPS: Record<string, number> = { ArrowLeft: -5_000, ArrowRight: 5_000, ArrowDown: -5_000, ArrowUp: 5_000, PageDown: -60_000, PageUp: 60_000 }

function handleKeydown(event: KeyboardEvent) {
  if (props.mode !== 'edit') return
  const now = props.playheadMs ?? 0
  let next: number | null = null
  if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = total.value
  else if (STEPS[event.key] !== undefined) next = now + STEPS[event.key]! * (event.shiftKey ? 6 : 1)
  if (next === null) return
  event.preventDefault()
  emit('seek', Math.min(total.value, Math.max(0, next)))
}
</script>

<template>
  <div class="chapter-timeline" dir="ltr">
    <div
      ref="bar"
      class="relative flex touch-none select-none"
      :class="
        mode === 'edit'
          ? 'h-4 cursor-crosshair gap-px rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card'
          : 'h-2.5 gap-0.5'
      "
      :role="mode === 'edit' ? 'slider' : 'img'"
      :tabindex="mode === 'edit' ? 0 : undefined"
      :aria-label="mode === 'edit' ? t('book.detail.chapters.player.scrubber') : listenLabel"
      :aria-valuemin="mode === 'edit' ? 0 : undefined"
      :aria-valuemax="mode === 'edit' ? total : undefined"
      :aria-valuenow="mode === 'edit' ? Math.round(shownPlayhead ?? 0) : undefined"
      :aria-valuetext="mode === 'edit' ? formatChapterClock(shownPlayhead ?? 0) : undefined"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerUp"
      @keydown="handleKeydown"
    >
      <span
        v-for="segment in segments"
        :key="segment.key"
        class="segment block min-w-px rounded-[2px]"
        :class="`tone-${segment.tone}`"
        :style="segment.heard === null ? { flexGrow: segment.grow } : { flexGrow: segment.grow, '--heard': `${segment.heard}%` }"
        :title="segment.label"
        aria-hidden="true"
      />
      <span
        v-if="mode === 'edit' && shownPlayhead !== null"
        class="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground shadow-[0_0_0_1px_var(--card)]"
        :style="{ left: percent(shownPlayhead) }"
        aria-hidden="true"
      >
        <span class="absolute -top-1.5 left-1/2 -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-foreground" />
      </span>
      <span
        v-if="mode === 'listen' && listeningMs != null"
        class="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-[2.5px] ring-card"
        :style="{ left: percent(listeningMs) }"
        aria-hidden="true"
      />
    </div>
    <div
      class="timeline-ticks relative mt-[7px] h-[13px] whitespace-nowrap text-[10.5px] leading-[13px] text-muted-foreground tabular-nums"
      aria-hidden="true"
    >
      <span class="absolute start-0">{{ formatChapterLength(0) }}</span>
      <span v-for="tick in ticks" :key="tick.ms" class="tick absolute -translate-x-1/2" :style="{ left: percent(tick.ms) }">{{ tick.label }}</span>
      <span class="absolute end-0">{{ formatChapterLength(total) }}</span>
    </div>
  </div>
</template>

<style scoped>
.segment.tone-base {
  background: color-mix(in oklab, var(--foreground) 13%, transparent);
}
.segment.tone-alt {
  background: color-mix(in oklab, var(--foreground) 19%, transparent);
}
.segment.tone-done {
  background: color-mix(in oklab, var(--primary) 72%, transparent);
}
.segment.tone-heard {
  background: linear-gradient(
    to right,
    color-mix(in oklab, var(--primary) 72%, transparent) var(--heard),
    color-mix(in oklab, var(--foreground) 13%, transparent) var(--heard)
  );
}
.segment.tone-active {
  background: color-mix(in oklab, var(--primary) 50%, transparent);
  box-shadow: inset 0 0 0 1px var(--primary);
}
.segment.tone-warning {
  min-width: 3px;
  background: color-mix(in oklab, var(--warning) 70%, transparent);
}
.segment.tone-error {
  min-width: 3px;
  background: color-mix(in oklab, var(--destructive) 75%, transparent);
}
.tick::before {
  content: '';
  position: absolute;
  left: 50%;
  top: -6px;
  width: 1px;
  height: 4px;
  background: color-mix(in oklab, var(--foreground) 22%, transparent);
}

/* A phone keeps the tick marks; the hour labels would collide. */
@container chapterstab (max-width: 40rem) {
  .tick {
    font-size: 0;
  }
}
</style>
