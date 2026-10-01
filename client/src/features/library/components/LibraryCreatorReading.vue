<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatNumber, formatPercent } from '@/i18n/formatters'
import LibraryCreatorCard from './LibraryCreatorCard.vue'

const { t } = useI18n()

const START_MIN = 0.05
const START_MAX = 5
const FINISH_MIN = 90
const FINISH_MAX = 100

const props = defineProps<{
  readingThreshold: number
  markAsFinishedPercentComplete: number
}>()

const emit = defineEmits<{
  'update:readingThreshold': [value: number]
  'update:markAsFinishedPercentComplete': [value: number]
}>()

const startFraction = computed(() => fractionOf(props.readingThreshold, START_MIN, START_MAX))
const finishFraction = computed(() => fractionOf(props.markAsFinishedPercentComplete, FINISH_MIN, FINISH_MAX))

function fractionOf(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

function onReadingThresholdInput(event: Event) {
  const value = parseFloat((event.target as HTMLInputElement).value)
  if (!Number.isNaN(value)) emit('update:readingThreshold', value)
}

function onFinishedInput(event: Event) {
  const value = parseFloat((event.target as HTMLInputElement).value)
  if (!Number.isNaN(value)) emit('update:markAsFinishedPercentComplete', value)
}

function percent(value: number): string {
  return formatNumber(value / 100, { style: 'percent', maximumFractionDigits: 2 })
}
</script>

<template>
  <LibraryCreatorCard :label="t('library.creator.reading.statusTitle')">
    <div class="mb-7 px-1">
      <div class="mb-2 flex items-center text-[11px]" aria-hidden="true">
        <span class="text-muted-foreground">{{ t('library.creator.reading.zones.notStarted') }}</span>
        <span class="mx-auto font-medium text-primary">{{ t('library.creator.reading.zones.reading') }}</span>
        <span class="font-medium text-success">{{ t('library.creator.reading.zones.read') }}</span>
      </div>

      <!--
        Each end is its own slider over its own range, drawn wider than true scale: at scale the whole
        0.05% to 5% start range would be a few pixels. The break marks say the axis is not continuous.
      -->
      <div class="flex items-center gap-1">
        <div class="relative w-[30%] shrink-0">
          <input
            id="reading-threshold-slider"
            type="range"
            class="reading-range reading-range--start w-full"
            :min="START_MIN"
            :max="START_MAX"
            step="0.05"
            :value="readingThreshold"
            :style="{ '--fraction': startFraction }"
            :aria-label="t('library.creator.reading.startSlider')"
            :aria-valuetext="percent(readingThreshold)"
            @input="onReadingThresholdInput"
          />
          <span class="reading-readout" :style="{ '--fraction': startFraction }" aria-hidden="true">{{ percent(readingThreshold) }}</span>
        </div>
        <svg
          class="h-3.5 w-2 shrink-0 text-muted-foreground"
          viewBox="0 0 8 14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path d="M1 13 4 1M4 13 7 1" />
        </svg>
        <span class="h-2.5 min-w-0 flex-1 rounded-full bg-primary/45" aria-hidden="true" />
        <svg
          class="h-3.5 w-2 shrink-0 text-muted-foreground"
          viewBox="0 0 8 14"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path d="M1 13 4 1M4 13 7 1" />
        </svg>
        <div class="relative w-[30%] shrink-0">
          <input
            id="finished-threshold-slider"
            type="range"
            class="reading-range reading-range--finish w-full"
            :min="FINISH_MIN"
            :max="FINISH_MAX"
            step="0.25"
            :value="markAsFinishedPercentComplete"
            :style="{ '--fraction': finishFraction }"
            :aria-label="t('library.creator.reading.finishSlider')"
            :aria-valuetext="percent(markAsFinishedPercentComplete)"
            @input="onFinishedInput"
          />
          <span class="reading-readout" :style="{ '--fraction': finishFraction }" aria-hidden="true">{{
            percent(markAsFinishedPercentComplete)
          }}</span>
        </div>
      </div>
    </div>

    <div class="grid gap-4 @lg:grid-cols-2">
      <div>
        <label for="reading-threshold" class="block text-[13px] font-medium text-foreground">{{
          t('library.creator.reading.readingStart.title')
        }}</label>
        <div class="relative mt-1.5 w-36">
          <input
            id="reading-threshold"
            type="number"
            inputmode="decimal"
            :value="readingThreshold"
            :min="START_MIN"
            :max="START_MAX"
            step="0.05"
            class="h-9 w-full rounded-md border border-input bg-background pe-8 ps-3 text-end text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-describedby="reading-threshold-help"
            @input="onReadingThresholdInput"
          />
          <span class="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">%</span>
        </div>
        <p id="reading-threshold-help" class="mt-1.5 text-xs text-muted-foreground">
          {{ t('library.creator.reading.readingStart.hint') }}
          {{ t('library.creator.reading.range', { min: percent(START_MIN), max: percent(START_MAX) }) }}
        </p>
      </div>
      <div>
        <label for="finished-threshold" class="block text-[13px] font-medium text-foreground">{{
          t('library.creator.reading.markAsFinished.title')
        }}</label>
        <div class="relative mt-1.5 w-36">
          <input
            id="finished-threshold"
            type="number"
            inputmode="decimal"
            :value="markAsFinishedPercentComplete"
            :min="FINISH_MIN"
            :max="FINISH_MAX"
            step="0.05"
            class="h-9 w-full rounded-md border border-input bg-background pe-8 ps-3 text-end text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-describedby="finished-threshold-help"
            @input="onFinishedInput"
          />
          <span class="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">%</span>
        </div>
        <p id="finished-threshold-help" class="mt-1.5 text-xs text-muted-foreground">
          {{ t('library.creator.reading.markAsFinished.hint') }}
          {{ t('library.creator.reading.range', { min: formatPercent(0.9), max: formatPercent(1) }) }}
        </p>
      </div>
    </div>
  </LibraryCreatorCard>
</template>

<style scoped>
/* The thumb centre travels from half a thumb in to half a thumb short of the end, so the fill and the
   readout track that span rather than the full width. */
.reading-range {
  --thumb: 18px;
  --stop: calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--fraction));
  appearance: none;
  display: block;
  height: 10px;
  border-radius: 999px;
  cursor: pointer;
  touch-action: none;
}

.reading-range--start {
  background: linear-gradient(to right, var(--surface-4) var(--stop), color-mix(in oklch, var(--primary) 45%, transparent) var(--stop));
}

.reading-range--finish {
  background: linear-gradient(to right, color-mix(in oklch, var(--primary) 45%, transparent) var(--stop), var(--success) var(--stop));
}

:dir(rtl) .reading-range--start {
  background: linear-gradient(to left, var(--surface-4) var(--stop), color-mix(in oklch, var(--primary) 45%, transparent) var(--stop));
}

:dir(rtl) .reading-range--finish {
  background: linear-gradient(to left, color-mix(in oklch, var(--primary) 45%, transparent) var(--stop), var(--success) var(--stop));
}

.reading-range:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 4px;
}

.reading-range::-webkit-slider-thumb {
  appearance: none;
  width: var(--thumb);
  height: var(--thumb);
  border: 2px solid var(--foreground);
  border-radius: 999px;
  background: var(--background);
  box-shadow: var(--elevation-sm);
}

.reading-range::-moz-range-thumb {
  width: var(--thumb);
  height: var(--thumb);
  border: 2px solid var(--foreground);
  border-radius: 999px;
  background: var(--background);
  box-shadow: var(--elevation-sm);
}

.reading-readout {
  position: absolute;
  top: 100%;
  inset-inline-start: calc(9px + (100% - 18px) * var(--fraction));
  margin-top: 6px;
  translate: calc(var(--fraction) * -100%) 0;
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--foreground);
}

:dir(rtl) .reading-readout {
  translate: calc(var(--fraction) * 100%) 0;
}
</style>
