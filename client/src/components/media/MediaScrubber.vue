<script setup lang="ts">
import { computed, ref } from 'vue'
import { useElementSize, useMediaQuery } from '@vueuse/core'
import type { MediaBufferedRange, MediaScrubberMarker, MediaScrubberTooltip } from './types'

const props = withDefaults(
  defineProps<{
    current: number
    duration: number
    buffered?: MediaBufferedRange[]
    markers?: MediaScrubberMarker[]
    disabled?: boolean
    ariaLabel: string
    ariaValueText?: string
    tooltip?: (seconds: number) => MediaScrubberTooltip | null
    /** Emit `seek` for every drag movement instead of once on release. Volume-style controls need live feedback. */
    continuous?: boolean
    size?: 'sm' | 'md'
    /** Arrow-key increment, in the same unit as `current`. */
    step?: number
    /** PageUp/PageDown increment, in the same unit as `current`. */
    pageStep?: number
  }>(),
  { size: 'md', step: 5, pageStep: 30, buffered: () => [], markers: () => [] },
)

const emit = defineEmits<{ seek: [seconds: number]; scrubStart: []; scrubEnd: [] }>()

const railRef = ref<HTMLElement | null>(null)
const tooltipRef = ref<HTMLElement | null>(null)
const { width: railWidth } = useElementSize(railRef)
const { width: tooltipWidth } = useElementSize(tooltipRef)
const isCoarsePointer = useMediaQuery('(pointer: coarse)')
const isDragging = ref(false)
const dragPercent = ref<number | null>(null)
const hoverPercent = ref<number | null>(null)

const isInteractive = computed(() => !props.disabled && props.duration > 0)
const progressPercent = computed(() => (props.duration > 0 ? clampPercent((props.current / props.duration) * 100) : 0))
const displayPercent = computed(() => dragPercent.value ?? progressPercent.value)
const ariaValueNow = computed(() => Math.round(clamp(props.current, 0, props.duration) * 100) / 100)
const isSmall = computed(() => props.size === 'sm')
const railClasses = computed(() => [
  isSmall.value ? 'min-h-8' : 'min-h-11',
  isInteractive.value ? 'cursor-pointer focus-visible:ring-ring/50 focus-visible:ring-[3px]' : 'cursor-default',
])
const trackThicknessClass = computed(() => (isSmall.value ? 'h-[3px]' : 'h-[6px]'))
const thumbSizeClass = computed(() => {
  if (isSmall.value) return isDragging.value ? 'size-4' : 'size-3'
  return isDragging.value ? 'size-5' : 'size-4'
})
// Markers must out-measure the track to stay legible against the filled portion.
const markerSizeClass = computed(() => (isSmall.value ? 'h-[7px] w-[1.5px]' : 'h-[12px] w-[2px]'))
const bufferedSegments = computed(() => {
  if (props.duration <= 0) return []
  return props.buffered
    .map((range) => ({ start: clampPercent((range.start / props.duration) * 100), end: clampPercent((range.end / props.duration) * 100) }))
    .filter((segment) => segment.end > segment.start)
})
const visibleMarkers = computed(() => {
  if (props.duration <= 0) return []
  return props.markers
    .map((marker, index) => ({ ...marker, key: `${marker.kind}-${index}`, percent: (marker.position / props.duration) * 100 }))
    .filter((marker) => marker.percent > 0 && marker.percent < 100)
})
const hoverSeconds = computed(() => (hoverPercent.value === null ? null : (hoverPercent.value / 100) * props.duration))
const tooltipContent = computed(() => (hoverSeconds.value === null ? null : (props.tooltip?.(hoverSeconds.value) ?? null)))
// A touch pointer sits under the bubble, so it only earns its space once the finger is actually dragging.
const isTooltipVisible = computed(() => Boolean(tooltipContent.value) && (!isCoarsePointer.value || isDragging.value))
const tooltipStyle = computed(() => {
  const percent = hoverPercent.value ?? 0
  if (railWidth.value <= 0) return { left: `${percent}%` }
  const half = Math.min(tooltipWidth.value, railWidth.value) / 2
  return { left: `${clamp((percent / 100) * railWidth.value, half, railWidth.value - half)}px` }
})

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max)
}

function clampPercent(value: number): number {
  return clamp(value, 0, 100)
}

function markerClasses(marker: MediaScrubberMarker): string {
  if (marker.kind === 'bookmark') return 'bg-warning'
  return marker.active ? 'bg-primary' : 'bg-foreground/35'
}

function percentFromClientX(clientX: number): number {
  const rail = railRef.value
  if (!rail) return 0
  const rect = rail.getBoundingClientRect()
  if (rect.width <= 0) return 0
  return clampPercent(((clientX - rect.left) / rect.width) * 100)
}

function emitSeek(percent: number) {
  emit('seek', (clampPercent(percent) / 100) * props.duration)
}

function handlePointerDown(event: PointerEvent) {
  if (!isInteractive.value) return
  event.preventDefault()
  const percent = percentFromClientX(event.clientX)
  isDragging.value = true
  dragPercent.value = percent
  hoverPercent.value = percent
  railRef.value?.focus()
  // Capture keeps the drag alive outside the rail; engines without it still end the drag on the rail's own pointerup.
  railRef.value?.setPointerCapture?.(event.pointerId)
  emit('scrubStart')
  if (props.continuous) emitSeek(percent)
}

function handlePointerMove(event: PointerEvent) {
  if (!isInteractive.value) return
  const percent = percentFromClientX(event.clientX)
  hoverPercent.value = percent
  if (!isDragging.value) return
  dragPercent.value = percent
  if (props.continuous) emitSeek(percent)
}

function handlePointerUp(event: PointerEvent) {
  if (!isDragging.value) return
  const percent = percentFromClientX(event.clientX)
  endDrag()
  emitSeek(percent)
}

function handlePointerCancel() {
  if (isDragging.value) endDrag()
}

function handlePointerLeave() {
  if (!isDragging.value) hoverPercent.value = null
}

function endDrag() {
  isDragging.value = false
  dragPercent.value = null
  emit('scrubEnd')
}

function handleKeydown(event: KeyboardEvent) {
  if (!isInteractive.value) return
  const next = keyboardTarget(event.key)
  if (next === null) return
  event.preventDefault()
  emit('seek', clamp(next, 0, props.duration))
}

function keyboardTarget(key: string): number | null {
  if (key === 'ArrowLeft' || key === 'ArrowDown') return props.current - props.step
  if (key === 'ArrowRight' || key === 'ArrowUp') return props.current + props.step
  if (key === 'PageDown') return props.current - props.pageStep
  if (key === 'PageUp') return props.current + props.pageStep
  if (key === 'Home') return 0
  if (key === 'End') return props.duration
  return null
}
</script>

<template>
  <!-- Playback time runs start-to-end regardless of locale direction, so the rail and its pointer maths stay LTR. -->
  <div
    ref="railRef"
    dir="ltr"
    role="slider"
    class="relative w-full touch-none select-none rounded-full outline-none"
    :class="railClasses"
    :tabindex="isInteractive ? 0 : -1"
    :aria-label="ariaLabel"
    aria-valuemin="0"
    :aria-valuemax="duration"
    :aria-valuenow="ariaValueNow"
    :aria-valuetext="ariaValueText"
    :aria-disabled="isInteractive ? undefined : 'true'"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
    @pointercancel="handlePointerCancel"
    @pointerleave="handlePointerLeave"
    @keydown="handleKeydown"
  >
    <div
      class="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-muted"
      :class="trackThicknessClass"
      aria-hidden="true"
    >
      <div
        v-for="segment in bufferedSegments"
        :key="`${segment.start}-${segment.end}`"
        class="absolute inset-y-0 bg-primary/25"
        :style="{ left: `${segment.start}%`, width: `${segment.end - segment.start}%` }"
        data-testid="media-scrubber-buffered"
      />
      <div class="absolute inset-y-0 left-0 rounded-full bg-primary" :style="{ width: `${displayPercent}%` }" />
    </div>

    <span
      v-for="marker in visibleMarkers"
      :key="marker.key"
      class="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
      :class="[markerSizeClass, markerClasses(marker)]"
      :style="{ left: `${marker.percent}%` }"
      :data-kind="marker.kind"
      :data-active="marker.active ? 'true' : 'false'"
      aria-hidden="true"
      data-testid="media-scrubber-marker"
    />

    <span
      v-if="isInteractive"
      class="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-[var(--elevation-sm)] transition-[width,height] duration-100 motion-reduce:transition-none"
      :class="thumbSizeClass"
      :style="{ left: `${displayPercent}%` }"
      aria-hidden="true"
      data-testid="media-scrubber-thumb"
    />

    <div
      v-if="isTooltipVisible && tooltipContent"
      ref="tooltipRef"
      class="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 rounded-md bg-popover px-2 py-1 text-center ring-1 ring-border shadow-[var(--elevation-md)]"
      :style="tooltipStyle"
      aria-hidden="true"
      data-testid="media-scrubber-tooltip"
    >
      <span class="block text-xs font-semibold tabular-nums whitespace-nowrap text-popover-foreground">{{ tooltipContent.primary }}</span>
      <span v-if="tooltipContent.secondary" class="mt-0.5 block max-w-40 truncate text-[11px] text-muted-foreground">
        {{ tooltipContent.secondary }}
      </span>
    </div>
  </div>
</template>
