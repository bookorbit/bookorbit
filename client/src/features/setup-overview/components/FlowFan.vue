<script setup lang="ts">
import { computed, ref } from 'vue'
import { useElementSize } from '@vueuse/core'
import type { SetupFlowId, SetupStep } from '@bookorbit/types'

import { setupIcon } from '../lib/icons'
import { FLOW_HUE, LANDED_HUE, ringOpacity, wireWidth } from '../lib/palette'
import { useSetupText } from '../lib/text'

const props = defineProps<{
  flow: SetupFlowId
  steps: SetupStep[]
  label: string
}>()

const text = useSetupText()

/**
 * A fan, not a track: the first step is where books sit and the rest are places they go from it,
 * all at once rather than in turn. Laid out in real pixels for the same reason the track is.
 */
const wrap = ref<HTMLElement | null>(null)
const { width: measured } = useElementSize(wrap)
const width = computed(() => Math.round(measured.value || 660))
const narrow = computed(() => measured.value > 0 && measured.value < 460)

const hue = computed(() => FLOW_HUE[props.flow])
const stroke = computed(() => wireWidth(hue.value))
const nodeOpacity = computed(() => ringOpacity(hue.value))

const source = computed(() => props.steps[0] ?? null)
const sourceIcon = computed(() => setupIcon(source.value?.icon))
/** Shrinks a long or translated name rather than letting it run over the ring. */
const sourceLabelSize = computed(() => {
  const label = text(source.value?.label)
  return label ? Math.min(10.5, (10.5 * (SOURCE_R * 1.55)) / Math.max(1, textWidth(label, 10.5, 600))) : 10.5
})
const targets = computed(() => props.steps.slice(1))

const ROW = 58

/** True text width, so the columns sit where their labels fit. */
let context: CanvasRenderingContext2D | null | undefined
function textWidth(value: string, size: number, weight: number): number {
  if (context === undefined) context = document.createElement('canvas').getContext('2d')
  if (!context) return value.length * size * 0.56
  context.font = `${weight} ${size}px ${getComputedStyle(wrap.value ?? document.body).fontFamily}`
  return context.measureText(value).width
}

/* ---------- Wide: the library on the left, every place it reaches fanned out to the right ---------- */
/** The mock's size: big enough that the library's name sits inside the circle, under its glyph. */
const SOURCE_R = 40
const TARGET_R = 18

const targetText = computed(() =>
  Math.max(
    80,
    ...targets.value.map((step) =>
      Math.max(textWidth(text(step.label), 12.5, 600), ...step.lines.slice(0, 2).map((line) => textWidth(text(line), 11, 400))),
    ),
  ),
)
const height = computed(() => Math.max(targets.value.length * ROW + 24, SOURCE_R * 2 + 64))
const sourceX = computed(() => Math.max(SOURCE_R + 30, textWidth(text(source.value?.lines[0]), 10.5, 400) / 2 + 6))
const sourceY = computed(() => height.value / 2 - 10)
/** Where the mock puts it, two thirds across, unless the labels need the room. */
const targetX = computed(() => Math.max(sourceX.value + 160, Math.min(width.value * 0.62, width.value - targetText.value - TARGET_R - 20)))

const rows = computed(() =>
  targets.value.map((step, i) => ({
    step,
    y: narrow.value ? NARROW_TOP + i * NARROW_ROW : (height.value - targets.value.length * ROW) / 2 + ROW / 2 + i * ROW,
    lines: step.lines.slice(0, 2),
    icon: setupIcon(step.icon),
  })),
)

/* ---------- Narrow: the library at the top, its places listed under it ---------- */
const NARROW_R = 22
const NARROW_X = NARROW_R + 6
const NARROW_TOP = NARROW_R * 2 + 38
const NARROW_ROW = 52
const NARROW_TARGET_R = 15
const narrowTargetX = computed(() => NARROW_X + 30)

const tx = computed(() => (narrow.value ? narrowTargetX.value : targetX.value))
const tr = computed(() => (narrow.value ? NARROW_TARGET_R : TARGET_R))
const sx = computed(() => (narrow.value ? NARROW_X : sourceX.value))
const sy = computed(() => (narrow.value ? NARROW_R + 6 : sourceY.value))
const sr = computed(() => (narrow.value ? NARROW_R : SOURCE_R))

const wires = computed(() =>
  rows.value.map((row) => ({
    key: row.step.id,
    d: narrow.value
      ? `M ${sx.value} ${sy.value + sr.value + 4} C ${sx.value} ${row.y - 16} ${sx.value} ${row.y} ${tx.value - tr.value - 6} ${row.y}`
      : `M ${sx.value + sr.value + 6} ${sy.value} C ${sx.value + sr.value + 90} ${sy.value} ${tx.value - 110} ${row.y} ${tx.value - tr.value - 8} ${row.y}`,
  })),
)

const canvasHeight = computed(() => (narrow.value ? NARROW_TOP + (targets.value.length - 1) * NARROW_ROW + 34 : height.value))
</script>

<template>
  <div ref="wrap" class="px-4 pt-1 pb-3">
    <svg
      class="block w-full overflow-visible"
      :viewBox="`0 0 ${width} ${canvasHeight}`"
      :width="width"
      :height="canvasHeight"
      role="img"
      :aria-label="label"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient :id="`fan-landed-${flow}`">
          <stop offset="0%" :stop-color="LANDED_HUE" stop-opacity="0.4" />
          <stop offset="70%" :stop-color="LANDED_HUE" stop-opacity="0.06" />
          <stop offset="100%" :stop-color="LANDED_HUE" stop-opacity="0" />
        </radialGradient>
        <marker :id="`fan-arrow-${flow}`" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 1.4 L 8.5 5 L 0 8.6 z" :fill="hue" fill-opacity="0.85" />
        </marker>
      </defs>

      <g v-for="wire in wires" :key="`fan-wire-${wire.key}`">
        <path :d="wire.d" :stroke="hue" stroke-opacity="0.09" :stroke-width="stroke + 4" fill="none" stroke-linecap="round" />
        <path
          :d="wire.d"
          :stroke="hue"
          stroke-opacity="0.5"
          :stroke-width="stroke"
          fill="none"
          stroke-linecap="round"
          :marker-end="`url(#fan-arrow-${flow})`"
        />
        <path
          class="flow-dash"
          :d="wire.d"
          :stroke="hue"
          stroke-opacity="0.9"
          :stroke-width="stroke"
          fill="none"
          stroke-dasharray="2 14"
          stroke-linecap="round"
        />
      </g>

      <g v-if="source">
        <circle :cx="sx" :cy="sy" :r="sr * 2.2" :fill="`url(#fan-landed-${flow})`" />
        <circle :cx="sx" :cy="sy" :r="sr + 8" fill="none" :stroke="LANDED_HUE" stroke-opacity="0.2" />
        <circle
          :cx="sx"
          :cy="sy"
          :r="sr"
          :fill="`color-mix(in oklch, ${LANDED_HUE} 16%, var(--card))`"
          :stroke="LANDED_HUE"
          stroke-opacity="0.8"
          stroke-width="2"
        />
        <component
          :is="sourceIcon"
          v-if="sourceIcon"
          :x="sx - 11"
          :y="narrow ? sy - 11 : sy - 14"
          width="22"
          height="22"
          :color="LANDED_HUE"
          :stroke-width="2"
          aria-hidden="true"
        />
        <template v-if="narrow">
          <text :x="sx + sr + 14" :y="sy - 2" font-size="12.5" font-weight="600" fill="var(--foreground)">{{ text(source.label) }}</text>
          <text v-if="source.lines[0]" :x="sx + sr + 14" :y="sy + 13" font-size="11" fill="var(--foreground)">{{ text(source.lines[0]) }}</text>
        </template>
        <template v-else>
          <text :x="sx" :y="sy + 20" text-anchor="middle" :font-size="sourceLabelSize" font-weight="600" fill="var(--foreground)">
            {{ text(source.label) }}
          </text>
          <text v-if="source.lines[0]" :x="sx" :y="sy + sr + 22" text-anchor="middle" font-size="10.5" fill="var(--foreground)">
            {{ text(source.lines[0]) }}
          </text>
        </template>
      </g>

      <g v-for="row in rows" :key="row.step.id">
        <circle :cx="tx" :cy="row.y" :r="tr + 5" :fill="hue" fill-opacity="0.06" />
        <circle :cx="tx" :cy="row.y" :r="tr" fill="var(--card)" :stroke="hue" :stroke-opacity="nodeOpacity" stroke-width="1.3" />
        <component
          :is="row.icon"
          v-if="row.icon"
          :x="tx - tr * 0.45"
          :y="row.y - tr * 0.45"
          :width="tr * 0.9"
          :height="tr * 0.9"
          :color="hue"
          :stroke-width="2"
          aria-hidden="true"
        />
        <text :x="tx + tr + 12" :y="row.y - 2" font-size="12.5" font-weight="600" fill="var(--foreground)">{{ text(row.step.label) }}</text>
        <text v-for="(line, i) in row.lines" :key="i" :x="tx + tr + 12" :y="row.y + 12 + i * 13" font-size="11" fill="var(--foreground)">
          {{ text(line) }}
        </text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.flow-dash {
  animation: flow-dash 2.8s linear infinite;
}

@keyframes flow-dash {
  to {
    stroke-dashoffset: -32;
  }
}

@media (prefers-reduced-motion: reduce) {
  .flow-dash {
    animation: none;
    opacity: 0.35;
  }
}
</style>
