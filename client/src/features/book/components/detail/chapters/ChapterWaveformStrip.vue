<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import type { WaveformView } from '@/features/book/composables/useChapterWaveform'
import { formatNumber } from '@/i18n/formatters'
import { formatChapterClock } from '@/features/book/lib/chapter-time'

const props = defineProps<{
  view: WaveformView | null
  loading: boolean
  failed: boolean
  startMs: number
  /** The range the start may move in, between its neighbours. */
  minMs: number
  maxMs: number
  /** Where the start was when the list was last saved; the scale counts from here. */
  savedMs: number | null
  /** Where Snap would put the start, drawn while `showSnap` is on. */
  snapMs: number | null
  showSnap: boolean
  /** Every chapter start; the ones inside the window are drawn as context. */
  boundaries: number[]
  playheadMs: number | null
  disabled: boolean
}>()

const emit = defineEmits<{ move: [startMs: number]; commit: []; nudge: [deltaMs: number]; seek: [ms: number] }>()

const { t } = useI18n()
const clipId = useId()

/** How close to the line a press has to land to grab it rather than move the playhead. */
const GRAB_PX = 10

const track = ref<HTMLElement | null>(null)
const dragging = ref(false)
/** The pointer is over the line, so a press grabs it. */
const overLine = ref(false)

/** The measured window. It may hold the cut, or only a playing playhead that has left the cut behind. */
const shown = computed(() => {
  const waveform = props.view?.waveform
  return waveform && !waveform.failed && waveform.peaks.length ? waveform : null
})

const span = computed(() => (shown.value ? Math.max(1, shown.value.toMs - shown.value.fromMs) : 1))
const count = computed(() => shown.value?.peaks.length ?? 0)

function percentOf(ms: number): number | null {
  const current = shown.value
  if (!current || ms < current.fromMs || ms > current.toMs) return null
  return ((ms - current.fromMs) / span.value) * 100
}

/** Loudness on a square-root scale so quiet narration still shows against the pauses, as one path. */
const barsPath = computed(() => {
  let path = ''
  for (const [index, peak] of (shown.value?.peaks ?? []).entries()) {
    const half = Math.max(0.7, Math.sqrt(peak) * 46)
    path += `M${index + 0.16} ${(50 - half).toFixed(2)}h0.68v${(2 * half).toFixed(2)}h-0.68z`
  }
  return path
})

const startLeft = computed(() => percentOf(props.startMs))
/** Which side of the window the cut is on when it is not drawn, so the way back can point at it. */
const awaySide = computed<'before' | 'after' | null>(() => {
  if (!shown.value || startLeft.value !== null) return null
  return props.startMs < shown.value.fromMs ? 'before' : 'after'
})

const cutX = computed(() => (startLeft.value === null ? 0 : (startLeft.value / 100) * count.value))

const pauseRects = computed(() => {
  const current = shown.value
  if (!current || !props.view) return []
  return props.view.pauses.flatMap((pause) => {
    const from = Math.max(pause.startMs, current.fromMs)
    const to = Math.min(pause.endMs, current.toMs)
    if (to <= from) return []
    return [{ key: `${pause.startMs}`, x: ((from - current.fromMs) / span.value) * count.value, width: ((to - from) / span.value) * count.value }]
  })
})

const neighbours = computed(() =>
  props.boundaries.flatMap((ms) => {
    if (ms === props.startMs) return []
    const left = percentOf(ms)
    return left === null ? [] : [{ ms, left }]
  }),
)

/** The stretches the start cannot reach, past a neighbour; only beside the cut, or the whole strip would be hatched. */
const blocked = computed(() => {
  const current = shown.value
  if (!current || startLeft.value === null) return []
  const parts: { key: string; start: number; end: number }[] = []
  if (props.minMs > current.fromMs) parts.push({ key: 'before', start: 0, end: percentOf(Math.min(props.minMs, current.toMs)) ?? 100 })
  if (props.maxMs < current.toMs) parts.push({ key: 'after', start: percentOf(Math.max(props.maxMs, current.fromMs)) ?? 0, end: 100 })
  return parts
})

const savedLeft = computed(() => (props.savedMs !== null && props.savedMs !== props.startMs ? percentOf(props.savedMs) : null))
const snapLeft = computed(() => (props.showSnap && props.snapMs !== null && props.snapMs !== props.startMs ? percentOf(props.snapMs) : null))
const playheadLeft = computed(() => (props.playheadMs === null ? null : percentOf(props.playheadMs)))

/**
 * A tick a second, labelled every five. Beside the cut they count from the saved start, so a move
 * reads as a distance; away from it they read as the time in the book.
 */
const ticks = computed(() => {
  const current = shown.value
  if (!current) return []
  const relative = startLeft.value !== null
  const origin = relative ? (props.savedMs ?? props.startMs) : 0
  const result: { key: number; left: number; label: string | null }[] = []
  for (let second = Math.ceil((current.fromMs - origin) / 1000); origin + second * 1000 <= current.toMs; second += 1) {
    const left = percentOf(origin + second * 1000)
    if (left === null) continue
    let label: string | null = null
    if (second % 5 === 0) {
      label = relative
        ? formatNumber(second, { style: 'unit', unit: 'second', unitDisplay: 'narrow', signDisplay: 'exceptZero' })
        : formatChapterClock(second * 1000, { withMs: false })
    }
    result.push({ key: second, left, label })
  }
  return result
})

function clamp(ms: number): number {
  return Math.round(Math.min(props.maxMs, Math.max(props.minMs, ms)))
}

function timeAt(clientX: number): number | null {
  const current = shown.value
  const element = track.value
  if (!current || !element) return null
  const rect = element.getBoundingClientRect()
  const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(rect.width, 1)))
  return current.fromMs + fraction * span.value
}

function onTheLine(clientX: number): boolean {
  const element = track.value
  if (!element || startLeft.value === null) return false
  const rect = element.getBoundingClientRect()
  return Math.abs(clientX - (rect.left + (startLeft.value / 100) * rect.width)) <= GRAB_PX
}

function handlePointerDown(event: PointerEvent) {
  if (props.disabled || event.button !== 0) return
  const ms = timeAt(event.clientX)
  if (ms === null) return
  if (!onTheLine(event.clientX)) {
    emit('seek', Math.round(ms))
    return
  }
  dragging.value = true
  capture(event, true)
}

/** Capture keeps a drag going past the track's edge; a browser that refuses it still gets the drag. */
function capture(event: PointerEvent, on: boolean) {
  try {
    if (on) track.value?.setPointerCapture?.(event.pointerId)
    else track.value?.releasePointerCapture?.(event.pointerId)
  } catch {
    // The pointer is already gone, as with a synthetic or cancelled press.
  }
}

function handlePointerMove(event: PointerEvent) {
  if (!dragging.value) {
    overLine.value = !props.disabled && onTheLine(event.clientX)
    return
  }
  const ms = timeAt(event.clientX)
  if (ms !== null) emit('move', clamp(ms))
}

function handlePointerUp(event: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  capture(event, false)
  emit('commit')
}

const STEPS: Record<string, number> = { ArrowLeft: -100, ArrowRight: 100, ArrowDown: -100, ArrowUp: 100, PageDown: -1_000, PageUp: 1_000 }

function handleKeydown(event: KeyboardEvent) {
  const step = STEPS[event.key]
  if (props.disabled || step === undefined) return
  event.preventDefault()
  emit('nudge', clamp(props.startMs + (event.shiftKey ? step * 10 : step)) - props.startMs)
}
</script>

<template>
  <div class="flex flex-col">
    <div v-if="$slots.flag || $slots.away" class="relative mb-1 h-[26px]" dir="ltr">
      <div v-if="startLeft !== null" class="absolute bottom-0 -translate-x-1/2" :style="{ left: `${startLeft}%` }">
        <slot name="flag" />
      </div>
      <div v-else-if="awaySide" class="absolute bottom-0" :class="awaySide === 'before' ? 'left-0' : 'right-0'">
        <slot name="away" :side="awaySide" />
      </div>
    </div>
    <div
      ref="track"
      dir="ltr"
      role="slider"
      :tabindex="disabled ? -1 : 0"
      :aria-label="t('book.detail.chapters.waveform.label')"
      :aria-valuemin="minMs"
      :aria-valuemax="maxMs"
      :aria-valuenow="startMs"
      :aria-valuetext="formatChapterClock(startMs)"
      :aria-disabled="disabled ? 'true' : undefined"
      class="wave relative touch-none select-none overflow-hidden rounded-lg border border-border bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="disabled ? '' : dragging || overLine ? 'cursor-ew-resize' : 'cursor-crosshair'"
      @pointerdown="handlePointerDown"
      @pointermove="handlePointerMove"
      @pointerup="handlePointerUp"
      @pointercancel="handlePointerUp"
      @keydown="handleKeydown"
    >
      <svg v-if="count" :viewBox="`0 0 ${count} 100`" preserveAspectRatio="none" class="absolute inset-0 size-full" aria-hidden="true">
        <defs>
          <clipPath :id="`${clipId}-before`"><rect x="0" y="0" :width="cutX" height="100" /></clipPath>
          <clipPath :id="`${clipId}-after`"><rect :x="cutX" y="0" :width="count - cutX" height="100" /></clipPath>
        </defs>
        <rect v-for="pause in pauseRects" :key="pause.key" :x="pause.x" y="0" :width="pause.width" height="100" class="fill-foreground/[0.07]" />
        <template v-if="startLeft !== null">
          <rect :x="cutX" y="0" :width="count - cutX" height="100" class="fill-primary/[0.08]" />
          <path :d="barsPath" class="fill-muted-foreground/70" :clip-path="`url(#${clipId}-before)`" />
          <path :d="barsPath" class="fill-primary/80" :clip-path="`url(#${clipId}-after)`" />
        </template>
        <path v-else :d="barsPath" class="fill-muted-foreground/70" />
      </svg>
      <span
        v-for="part in blocked"
        :key="part.key"
        class="blocked pointer-events-none absolute inset-y-0"
        :style="{ left: `${part.start}%`, width: `${Math.max(0, part.end - part.start)}%` }"
        aria-hidden="true"
      />
      <span
        v-for="neighbour in neighbours"
        :key="neighbour.ms"
        class="neighbour pointer-events-none absolute inset-y-0 border-l border-dashed border-foreground/50"
        :style="{ left: `${neighbour.left}%` }"
        aria-hidden="true"
      />
      <span
        v-if="savedLeft !== null"
        class="pointer-events-none absolute inset-y-0 border-l border-dashed border-muted-foreground"
        :style="{ left: `${savedLeft}%` }"
        aria-hidden="true"
      >
        <span
          class="absolute bottom-1 rounded bg-card px-1 text-[10.5px] leading-[14px] text-muted-foreground"
          :class="savedMs !== null && startMs > savedMs ? 'end-1.5' : 'start-1.5'"
        >
          {{ t('book.detail.chapters.cut.saved') }}
        </span>
      </span>
      <span
        v-if="snapLeft !== null"
        class="pointer-events-none absolute inset-y-0 border-l-2 border-dashed border-primary"
        :style="{ left: `${snapLeft}%` }"
        aria-hidden="true"
      />
      <span
        v-if="playheadLeft !== null"
        class="playhead pointer-events-none absolute inset-y-0 border-l-[1.5px] border-foreground"
        :style="{ left: `${playheadLeft}%` }"
        aria-hidden="true"
      />
      <span
        v-if="startLeft !== null"
        class="cut pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary"
        :style="{ left: `${startLeft}%` }"
        aria-hidden="true"
      />
      <div v-if="loading && !count" class="absolute inset-0 grid place-items-center text-muted-foreground" role="status">
        <Loader2 class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <span class="sr-only">{{ t('book.detail.chapters.waveform.loading') }}</span>
      </div>
      <p v-else-if="failed && !count" class="absolute inset-0 grid place-items-center px-3 text-center text-xs text-muted-foreground">
        {{ t('book.detail.chapters.waveform.failed') }}
      </p>
    </div>
    <div
      v-if="count || $slots.flag || $slots.away"
      class="relative mt-[3px] h-[18px] text-[10.5px] text-muted-foreground tabular-nums"
      dir="ltr"
      aria-hidden="true"
    >
      <span
        v-for="tick in ticks"
        :key="tick.key"
        class="absolute top-0 w-px"
        :class="tick.label === null ? 'h-[3px] bg-foreground/20' : 'h-[5px] bg-foreground/35'"
        :style="{ left: `${tick.left}%` }"
      >
        <span v-if="tick.label !== null" class="absolute left-0 top-1.5 -translate-x-1/2 whitespace-nowrap leading-3">{{ tick.label }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.wave {
  height: var(--wave-height, 88px);
}

.blocked {
  background: repeating-linear-gradient(
    135deg,
    color-mix(in oklab, var(--card) 72%, transparent) 0 5px,
    color-mix(in oklab, var(--card) 58%, transparent) 5px 10px
  );
}

.playhead::before {
  content: '';
  position: absolute;
  top: 0;
  left: -0.75px;
  translate: -50% 0;
  border: 5px solid transparent;
  border-top: 6px solid var(--foreground);
  border-bottom: 0;
}

.cut::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 8px;
  height: 24px;
  translate: -50% -50%;
  border-radius: 4px;
  background: var(--primary);
  box-shadow: 0 0 0 2px var(--card);
}
</style>
