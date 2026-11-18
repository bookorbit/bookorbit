<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useElementSize } from '@vueuse/core'
import type { SetupBranch, SetupFlowId, SetupStep, SetupText } from '@bookorbit/types'

import { setupIcon } from '../lib/icons'
import { FLOW_HUE, LANDED_HUE, ringOpacity, wireOpacity, wireWidth } from '../lib/palette'
import { useSetupText } from '../lib/text'

const props = defineProps<{
  flow: SetupFlowId
  steps: SetupStep[]
  branch: SetupBranch | null
  label: string
}>()

const text = useSetupText()

/**
 * The track is laid out in real pixels rather than in a viewBox that scales to fit, because a
 * scaled drawing cannot keep its labels at a readable size or know whether one fits the gap it
 * sits in. Everything below is measured against the width the card actually has.
 */
const wrap = ref<HTMLElement | null>(null)
const { width: measured } = useElementSize(wrap)
const FALLBACK_WIDTH = 660
const width = computed(() => Math.round(measured.value || FALLBACK_WIDTH))

const fontFamily = ref('system-ui, sans-serif')
onMounted(() => {
  if (wrap.value) fontFamily.value = getComputedStyle(wrap.value).fontFamily || fontFamily.value
})

/** True text width, so a label is never drawn where it does not fit. */
let context: CanvasRenderingContext2D | null | undefined
function textWidth(value: string, size: number, weight: number): number {
  if (context === undefined) context = document.createElement('canvas').getContext('2d')
  if (!context) return value.length * size * 0.56
  context.font = `${weight} ${size}px ${fontFamily.value}`
  return context.measureText(value).width
}

const hue = computed(() => FLOW_HUE[props.flow])
const stroke = computed(() => wireWidth(hue.value))
const lineOpacity = computed(() => wireOpacity(hue.value))
const nodeOpacity = computed(() => ringOpacity(hue.value))
const hueOf = (step: SetupStep) => (step.terminal ? LANDED_HUE : hue.value)
const radiusOf = (step: SetupStep) => (step.terminal ? 30 : 26)

const PAD = 54
const CY = 44
const LABEL_Y = CY + 48
const LINE_Y = CY + 66
const LINE_STEP = 15
const EDGE_SIZE = 11
const EDGE_HEIGHT = 24

const maxLines = computed(() => Math.min(2, Math.max(0, ...props.steps.map((s) => s.lines.length))))

/** Half the widest thing drawn under a step, which is what decides how close to the edge it may sit. */
function halfLabel(step: SetupStep): number {
  const widths = [textWidth(text(step.label), 13, 600), ...step.lines.slice(0, 2).map((line) => textWidth(text(line), 11, 400))]
  return Math.max(radiusOf(step), ...widths.map((w) => w / 2))
}

/**
 * The end steps are inset by their own labels rather than by a fixed padding: a centred label on
 * the first step would otherwise be cut off by the edge of the drawing.
 */
const halves = computed(() => props.steps.map(halfLabel))
const padStart = computed(() => Math.max(PAD, (halves.value[0] ?? 0) + 4))
const padEnd = computed(() => Math.max(PAD, (halves.value.at(-1) ?? 0) + 4))

/**
 * The track runs across only while every pair of neighbouring labels has room between them. A
 * narrow card, or a translation that runs long, turns it down the page instead of overlapping.
 */
const LABEL_GAP = 14
const vertical = computed(() => {
  if (measured.value > 0 && measured.value < 420) return true
  const n = props.steps.length
  if (n < 2) return false
  const gap = (width.value - padStart.value - padEnd.value) / (n - 1)
  return halves.value.some((half, i) => i > 0 && (halves.value[i - 1] ?? 0) + half + LABEL_GAP > gap)
})

const nodes = computed(() => {
  const n = props.steps.length
  const usable = Math.max(120, width.value - padStart.value - padEnd.value)
  const gap = n > 1 ? usable / (n - 1) : 0
  return props.steps.map((step, i) => ({
    step,
    i,
    x: padStart.value + i * gap,
    hue: hueOf(step),
    r: radiusOf(step),
    lines: step.lines.slice(0, 2),
  }))
})

/** Each wire as a pair, so the drawing never has to reach for a neighbour that is not there. */
const wires = computed(() =>
  nodes.value.slice(0, -1).map((from, i) => {
    const to = nodes.value[i + 1]!
    return { key: from.step.id, d: `M ${from.x + from.r + 6} ${CY} L ${to.x - to.r - 9} ${CY}` }
  }),
)

/** A label is only drawn when the gap between its two nodes can hold it whole. */
const edges = computed(() =>
  nodes.value.slice(0, -1).flatMap((node, i) => {
    const next = nodes.value[i + 1]
    if (!node.step.edge || !next) return []
    const label = text(node.step.edge)
    if (!label) return []
    const strong = /\d/.test(label)
    const w = textWidth(label, EDGE_SIZE, strong ? 600 : 400) + 22
    const room = next.x - node.x - node.r - next.r - 24
    if (w > room) return []
    return [{ key: node.step.id, label, strong, x: (node.x + next.x) / 2, w }]
  }),
)

/** Below the label and lines of a step, which is where a branch line may start without crossing text. */
const underText = (node: { lines: SetupText[] }) => LINE_Y + node.lines.length * LINE_STEP - 6

const branchNodes = computed(() => {
  if (!props.branch) return null
  const at = nodes.value.find((n) => n.step.id === props.branch?.at)
  const back = nodes.value.find((n) => n.step.id === props.branch?.back)
  if (!at || !back) return null
  const label = text(props.branch.label)
  const sub = props.branch.sub ? text(props.branch.sub) : ''
  const w = Math.max(textWidth(label, 12, 600), textWidth(sub, 10.5, 400)) + 26
  const cx = (at.x + back.x) / 2
  const cy = LINE_Y + maxLines.value * LINE_STEP + 34
  const left = cx - w / 2
  const right = cx + w / 2
  const fromY = underText(at)
  const toY = underText(back)
  // A loop (`at` and `back` the same step) leaves and returns at the same place, so its two ends
  // are pulled apart to read as out and back rather than as one line.
  const loop = at === back
  const outX = loop ? at.x - 10 : at.x
  const backX = loop ? at.x + 10 : back.x
  return {
    label,
    sub,
    w,
    cx,
    cy,
    out: `M ${outX} ${fromY} C ${outX} ${cy} ${left - 24} ${cy} ${left - 5} ${cy}`,
    back: `M ${right + 5} ${cy} C ${right + 24} ${cy} ${backX} ${cy} ${backX} ${toY}`,
  }
})

const height = computed(() => {
  const base = LINE_Y + maxLines.value * LINE_STEP + 12
  return props.branch ? (branchNodes.value?.cy ?? base) + 30 : base
})

/* ---------- Narrow cards run the same track down the page ---------- */
const TALL_X = 32
const TALL_TOP = 30
const TALL_STEP = 88

const tallNodes = computed(() =>
  props.steps.map((step, i) => ({
    step,
    i,
    y: TALL_TOP + i * TALL_STEP,
    hue: hueOf(step),
    r: step.terminal ? 21 : 18,
    lines: step.lines.slice(0, 2),
  })),
)
const tallHeight = computed(() => TALL_TOP + (props.steps.length - 1) * TALL_STEP + 42)
const tallWires = computed(() =>
  tallNodes.value.slice(0, -1).map((from, i) => {
    const to = tallNodes.value[i + 1]!
    return { key: from.step.id, d: `M ${TALL_X} ${from.y + from.r + 3} L ${TALL_X} ${to.y - to.r - 3}` }
  }),
)

const tallEdges = computed(() =>
  tallNodes.value.map((node) => {
    const label = node.step.edge && node.i < tallNodes.value.length - 1 ? text(node.step.edge) : ''
    return { key: node.step.id, y: node.y + TALL_STEP / 2 + 18, label, weight: /\d/.test(label) ? 600 : 500 }
  }),
)

/** The hold pill sits right of its step, and only when the step's own text leaves room for it. */
const tallBranch = computed(() => {
  if (!props.branch) return null
  const node = tallNodes.value.find((n) => n.step.id === props.branch?.at)
  if (!node) return null
  const label = text(props.branch.label)
  const w = textWidth(label, 10, 600) + 18
  const textRight = TALL_X + 34 + Math.max(textWidth(text(node.step.label), 12.5, 600), ...node.lines.map((line) => textWidth(text(line), 11, 400)))
  const x = width.value - w - 4
  if (x < textRight + 10) return null
  return { x, y: node.y, w, label }
})
</script>

<template>
  <div ref="wrap" class="px-4 pt-1 pb-3">
    <svg
      v-if="!vertical"
      class="block w-full"
      :viewBox="`0 0 ${width} ${height}`"
      :width="width"
      :height="height"
      role="img"
      :aria-label="label"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient :id="`track-${flow}`" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" :stop-color="hue" :stop-opacity="lineOpacity * 0.5" />
          <stop offset="60%" :stop-color="hue" :stop-opacity="lineOpacity" />
          <stop offset="100%" :stop-color="hue" :stop-opacity="Math.min(1, lineOpacity + 0.3)" />
        </linearGradient>
        <radialGradient :id="`landed-${flow}`">
          <stop offset="0%" :stop-color="LANDED_HUE" stop-opacity="0.4" />
          <stop offset="70%" :stop-color="LANDED_HUE" stop-opacity="0.06" />
          <stop offset="100%" :stop-color="LANDED_HUE" stop-opacity="0" />
        </radialGradient>
        <marker :id="`arrow-${flow}`" viewBox="0 0 10 10" refX="7.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 1.4 L 8.5 5 L 0 8.6 z" :fill="hue" fill-opacity="0.85" />
        </marker>
      </defs>

      <g v-for="wire in wires" :key="`wire-${wire.key}`">
        <path :d="wire.d" :stroke="hue" stroke-opacity="0.09" :stroke-width="stroke + 4.5" fill="none" stroke-linecap="round" />
        <path
          :d="wire.d"
          :stroke="`url(#track-${flow})`"
          :stroke-width="stroke"
          fill="none"
          stroke-linecap="round"
          :marker-end="`url(#arrow-${flow})`"
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

      <g v-if="branchNodes">
        <path :d="branchNodes.out" stroke="var(--warning)" stroke-opacity="0.5" stroke-width="1.3" fill="none" stroke-dasharray="4 4" />
        <path :d="branchNodes.back" stroke="var(--warning)" stroke-opacity="0.5" stroke-width="1.3" fill="none" stroke-dasharray="4 4" />
        <rect
          :x="branchNodes.cx - branchNodes.w / 2"
          :y="branchNodes.cy - (branchNodes.sub ? 18 : 11)"
          :width="branchNodes.w"
          :height="branchNodes.sub ? 36 : 22"
          rx="11"
          fill="color-mix(in oklch, var(--warning) 11%, var(--card))"
          stroke="var(--warning)"
          stroke-opacity="0.42"
        />
        <text
          :x="branchNodes.cx"
          :y="branchNodes.sub ? branchNodes.cy - 2 : branchNodes.cy + 3.5"
          text-anchor="middle"
          font-size="11"
          font-weight="600"
          fill="var(--warning)"
        >
          {{ branchNodes.label }}
        </text>
        <text v-if="branchNodes.sub" :x="branchNodes.cx" :y="branchNodes.cy + 12" text-anchor="middle" font-size="10.5" fill="var(--foreground)">
          {{ branchNodes.sub }}
        </text>
      </g>

      <g v-for="edge in edges" :key="`edge-${edge.key}`">
        <rect
          :x="edge.x - edge.w / 2"
          :y="CY - EDGE_HEIGHT / 2"
          :width="edge.w"
          :height="EDGE_HEIGHT"
          :rx="EDGE_HEIGHT / 2"
          fill="var(--card)"
          :stroke="hue"
          :stroke-opacity="edge.strong ? 0.45 : 0.26"
        />
        <text :x="edge.x" :y="CY + 4" text-anchor="middle" :font-size="EDGE_SIZE" :font-weight="edge.strong ? 600 : 500" fill="var(--foreground)">
          {{ edge.label }}
        </text>
      </g>

      <g v-for="node in nodes" :key="node.step.id">
        <circle v-if="node.step.terminal" :cx="node.x" :cy="CY" :r="node.r * 2.2" :fill="`url(#landed-${flow})`" />
        <circle v-if="node.step.terminal" :cx="node.x" :cy="CY" :r="node.r + 8" fill="none" :stroke="node.hue" stroke-opacity="0.22" />
        <circle v-else :cx="node.x" :cy="CY" :r="node.r + 6" :fill="node.hue" fill-opacity="0.06" />
        <circle
          :cx="node.x"
          :cy="CY"
          :r="node.r"
          :fill="node.step.terminal ? `color-mix(in oklch, ${node.hue} 17%, var(--card))` : 'var(--card)'"
          :stroke="node.hue"
          :stroke-opacity="node.step.terminal ? 0.85 : nodeOpacity"
          :stroke-width="node.step.terminal ? 2 : 1.4"
        />
        <component
          :is="setupIcon(node.step.icon)"
          v-if="setupIcon(node.step.icon)"
          :x="node.x - 11"
          :y="CY - 11"
          width="22"
          height="22"
          :color="node.hue"
          :stroke-width="2"
          aria-hidden="true"
        />
        <text :x="node.x" :y="LABEL_Y" text-anchor="middle" font-size="13" font-weight="600" fill="var(--foreground)">
          {{ text(node.step.label) }}
        </text>
        <text
          v-for="(line, i) in node.lines"
          :key="i"
          :x="node.x"
          :y="LINE_Y + i * LINE_STEP"
          text-anchor="middle"
          font-size="11"
          fill="var(--foreground)"
        >
          {{ text(line) }}
        </text>
      </g>
    </svg>

    <svg v-else class="block w-full" :viewBox="`0 0 ${width} ${tallHeight}`" :width="width" :height="tallHeight" role="img" :aria-label="label">
      <defs>
        <radialGradient :id="`landed-tall-${flow}`">
          <stop offset="0%" :stop-color="LANDED_HUE" stop-opacity="0.4" />
          <stop offset="70%" :stop-color="LANDED_HUE" stop-opacity="0.06" />
          <stop offset="100%" :stop-color="LANDED_HUE" stop-opacity="0" />
        </radialGradient>
      </defs>
      <path
        v-for="wire in tallWires"
        :key="`tall-wire-${wire.key}`"
        :d="wire.d"
        :stroke="hue"
        :stroke-opacity="lineOpacity"
        :stroke-width="stroke"
        fill="none"
        stroke-linecap="round"
      />
      <g v-for="node in tallNodes" :key="node.step.id">
        <circle v-if="node.step.terminal" :cx="TALL_X" :cy="node.y" :r="node.r * 2.4" :fill="`url(#landed-tall-${flow})`" />
        <circle
          :cx="TALL_X"
          :cy="node.y"
          :r="node.r"
          :fill="node.step.terminal ? `color-mix(in oklch, ${node.hue} 17%, var(--card))` : 'var(--card)'"
          :stroke="node.hue"
          :stroke-opacity="node.step.terminal ? 0.85 : nodeOpacity"
          :stroke-width="node.step.terminal ? 1.6 : 1.2"
        />
        <component
          :is="setupIcon(node.step.icon)"
          v-if="setupIcon(node.step.icon)"
          :x="TALL_X - 9"
          :y="node.y - 9"
          width="18"
          height="18"
          :color="node.hue"
          :stroke-width="2"
          aria-hidden="true"
        />
        <text :x="TALL_X + 34" :y="node.y - 2" font-size="12.5" font-weight="600" fill="var(--foreground)">{{ text(node.step.label) }}</text>
        <text v-for="(line, i) in node.lines" :key="i" :x="TALL_X + 34" :y="node.y + 13 + i * 14" font-size="11" fill="var(--foreground)">
          {{ text(line) }}
        </text>
      </g>
      <template v-for="edge in tallEdges" :key="`tall-edge-${edge.key}`">
        <text v-if="edge.label" :x="TALL_X + 34" :y="edge.y" font-size="10.5" :font-weight="edge.weight" fill="var(--foreground)">
          {{ edge.label }}
        </text>
      </template>
      <g v-if="tallBranch">
        <rect
          :x="tallBranch.x"
          :y="tallBranch.y - 11"
          :width="tallBranch.w"
          height="22"
          rx="8"
          fill="color-mix(in oklch, var(--warning) 11%, var(--card))"
          stroke="var(--warning)"
          stroke-opacity="0.42"
        />
        <text
          :x="tallBranch.x + tallBranch.w / 2"
          :y="tallBranch.y + 3.4"
          text-anchor="middle"
          font-size="10"
          font-weight="600"
          fill="var(--warning)"
        >
          {{ tallBranch.label }}
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
