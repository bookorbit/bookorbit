<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BOOK_METADATA_FETCH_SCORE_BIN_WIDTH } from '@bookorbit/types'

const props = defineProps<{
  /** Scored books per 5-point bucket, lowest first. */
  bins: number[]
  threshold: number
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:threshold': [value: number] }>()

const { t } = useI18n()
const track = ref<HTMLElement | null>(null)

const BANDS = [
  { key: 'poor', from: 0, to: 50, fill: 'color-mix(in oklch, var(--destructive) 26%, transparent)', ink: 'var(--destructive)' },
  { key: 'fair', from: 50, to: 70, fill: 'color-mix(in oklch, var(--warning) 26%, transparent)', ink: 'var(--warning)' },
  { key: 'good', from: 70, to: 90, fill: 'color-mix(in oklch, var(--success) 20%, transparent)', ink: 'var(--success)' },
  { key: 'great', from: 90, to: 100, fill: 'color-mix(in oklch, var(--success) 38%, transparent)', ink: 'var(--success)' },
]

// Square-root heights so a bucket of three books still reads beside one of a hundred.
const bars = computed(() => {
  const max = Math.max(1, ...props.bins)
  return props.bins.map((count, index) => {
    const from = index * BOOK_METADATA_FETCH_SCORE_BIN_WIDTH
    const to = from + BOOK_METADATA_FETCH_SCORE_BIN_WIDTH
    const below = Math.max(0, Math.min(1, (props.threshold - from) / (to - from)))
    return { key: from, height: count ? Math.max(7, Math.sqrt(count / max) * 100) : 0, below: count ? below * 100 : 0 }
  })
})
const valueText = computed(() => t('settings.metadata.autoFetch.histogram.valueText', { threshold: props.threshold }))

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function valueAt(clientX: number): number {
  const rect = track.value?.getBoundingClientRect()
  if (!rect || rect.width === 0) return props.threshold
  return clamp(((clientX - rect.left) / rect.width) * 100)
}

function handlePointerDown(event: PointerEvent) {
  if (props.disabled) return
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  emit('update:threshold', valueAt(event.clientX))
}

function handlePointerMove(event: PointerEvent) {
  if (props.disabled || !(event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) return
  const next = valueAt(event.clientX)
  if (next !== props.threshold) emit('update:threshold', next)
}

const KEY_STEPS: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }

function handleKeydown(event: KeyboardEvent) {
  if (props.disabled) return
  let next: number | null = null
  if (event.key in KEY_STEPS) next = props.threshold + KEY_STEPS[event.key]!
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = 100
  if (next === null) return
  event.preventDefault()
  emit('update:threshold', clamp(next))
}
</script>

<template>
  <div
    class="relative touch-none select-none rounded-md pt-5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
    :class="disabled ? 'pointer-events-none opacity-50' : 'cursor-ew-resize'"
    role="slider"
    :tabindex="disabled ? -1 : 0"
    :aria-label="t('settings.metadata.autoFetch.histogram.label')"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="threshold"
    :aria-valuetext="valueText"
    :aria-disabled="disabled || undefined"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @keydown="handleKeydown"
  >
    <div ref="track" class="relative flex h-14 items-end gap-0.5">
      <div v-for="bar in bars" :key="bar.key" class="flex h-full flex-1 items-end">
        <div class="relative w-full overflow-hidden rounded-t-[2px] bg-foreground/20" :style="{ height: `${bar.height}%` }">
          <span class="absolute inset-x-0 bottom-0 bg-primary" :style="{ height: `${bar.below}%` }" />
        </div>
      </div>
      <div
        class="pointer-events-none absolute -top-1.5 -bottom-0.5 w-0 border-s-[1.5px] border-primary"
        :style="{ insetInlineStart: `${threshold}%` }"
      >
        <span
          class="absolute -top-4 start-0 -translate-x-1/2 rounded-[4px] bg-primary px-1.5 text-[10.5px] font-bold leading-[15px] text-primary-foreground tabular-nums rtl:translate-x-1/2"
        >
          {{ threshold }}
        </span>
      </div>
    </div>
    <div class="mt-1 flex h-[18px] overflow-hidden rounded-[5px] border border-border" aria-hidden="true">
      <div
        v-for="band in BANDS"
        :key="band.key"
        class="flex min-w-0 items-center justify-center overflow-hidden whitespace-nowrap text-[9.5px] font-bold tracking-[0.06em]"
        :style="{ width: `${band.to - band.from}%`, backgroundColor: band.fill, color: band.ink }"
      >
        {{ t(`settings.admin.scoreWeights.rail.bands.${band.key}`) }}
      </div>
    </div>
  </div>
</template>
