<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue'
import { useElementSize } from '@vueuse/core'
import { CircleCheck, GitMerge, TriangleAlert } from '@lucide/vue'
import type { SetupMap, SetupMapNode } from '@bookorbit/types'
import { useI18n } from 'vue-i18n'

import { setupIcon } from '../lib/icons'
import {
  layoutStacked,
  layoutWide,
  MAX_SCALE,
  MIN_SCALE,
  wideNeededWidth,
  type MapDash,
  type MapHue,
  type MapLayout,
  type MapNodeText,
  type MapRect,
  type MapText,
  type MapText2D,
  type MapWire,
} from '../lib/map-layout'
import { FLOW_HUE, isFaint, LANDED_HUE, ringOpacity, wireWidth } from '../lib/palette'
import { useSetupText } from '../lib/text'

const props = defineProps<{ map: SetupMap; needYou: number }>()

const { t } = useI18n()
const text = useSetupText()
const uid = useId()

/**
 * The whole server in one picture, drawn from the approved mock. The geometry lives in
 * `map-layout.ts`; this component only measures text, picks the layout the card is wide enough for
 * and paints it.
 */
const wrap = ref<HTMLElement | null>(null)
const { width: measured } = useElementSize(wrap)
const containerWidth = computed(() => Math.round(measured.value || 960))

const fontFamily = ref('system-ui, sans-serif')
onMounted(() => {
  if (wrap.value) fontFamily.value = getComputedStyle(wrap.value).fontFamily || fontFamily.value
})

let context: CanvasRenderingContext2D | null | undefined
function measure(value: string, size: number, weight: number): number {
  if (context === undefined) context = document.createElement('canvas').getContext('2d')
  if (!context) return value.length * size * 0.56
  context.font = `${weight} ${size}px ${fontFamily.value}`
  return context.measureText(value).width
}

const node = (n: SetupMapNode): MapNodeText => ({ id: n.id, icon: n.icon, label: text(n.label), sub: text(n.sub) })

const mapText = computed<MapText>(() => ({
  lanes: props.map.lanes.map((lane) => ({
    id: lane.id,
    caption: text(lane.caption),
    entries: lane.entries.map(node),
    stations: lane.stations.map(node),
    into: lane.into,
    note: text(lane.note),
    branch: lane.branch ? { at: lane.branch.at, label: text(lane.branch.label) } : null,
  })),
  library: {
    label: props.map.library ? text(props.map.library.label) : t('setupOverview.ingest.map.library'),
    sub: text(props.map.library?.sub),
    foot: text(props.map.library?.foot),
  },
  out: props.map.out.map(node),
  services: props.map.services.map((s) => ({ ...node(s), asks: s.asks })),
  dockTab: t('setupOverview.map.dock'),
  outCaption: t('setupOverview.map.out'),
  servicesCaption: t('setupOverview.map.services'),
}))

const layout = computed<MapLayout>(() => {
  // Reading the font makes the layout follow it once the real one is known.
  void fontFamily.value
  const needed = wideNeededWidth(mapText.value, measure)
  const width = containerWidth.value
  if (width / needed < MIN_SCALE) return layoutStacked(mapText.value, measure, width)
  return layoutWide(mapText.value, measure, Math.max(needed, width / MAX_SCALE))
})

const svgHeight = computed(() => Math.round((containerWidth.value * layout.value.height) / layout.value.width))

/* ---------- Paint ---------- */
const HUES: MapHue[] = ['ingest', 'requests', 'metadata', 'ai', 'out', 'landed', 'warning']

function hueVar(hue: MapHue): string {
  if (hue === 'landed') return LANDED_HUE
  if (hue === 'warning') return 'var(--warning)'
  return FLOW_HUE[hue]
}

const lift = (hue: MapHue, opacity: number, step = 0.2) => (isFaint(hueVar(hue)) ? Math.min(1, opacity + step) : opacity)

const RECT_FILL: Record<MapRect['fill'], (hue: string) => string> = {
  card: () => 'var(--card)',
  tint: (hue) => `color-mix(in oklch, ${hue} 12%, transparent)`,
  band: (hue) => `color-mix(in oklch, ${hue} 5%, transparent)`,
  warning: () => 'color-mix(in oklch, var(--warning) 11%, var(--card))',
}

const rects = computed(() =>
  layout.value.rects.map((r, i) => ({
    ...r,
    key: i,
    fillValue: RECT_FILL[r.fill](hueVar(r.hue)),
    stroke: hueVar(r.hue),
    strokeOpacity: lift(r.hue, r.strokeOpacity, 0.15),
  })),
)
/** The dock band sits under the wires; every other box sits on top of them. */
const bandRects = computed(() => rects.value.filter((r) => r.fill === 'band'))
const boxRects = computed(() => rects.value.filter((r) => r.fill !== 'band'))

const wires = computed(() =>
  layout.value.wires.map((w: MapWire, i) => {
    const hue = hueVar(w.hue)
    return {
      key: i,
      d: w.d,
      hue,
      width: wireWidth(hue),
      opacity: lift(w.hue, w.opacity),
      still: w.still,
      marker: w.arrow ? `url(#${uid}-ar-${w.hue})` : undefined,
    }
  }),
)

const dashes = computed(() =>
  layout.value.dashes.map((d: MapDash, i) => ({
    key: i,
    d: d.d,
    stroke: hueVar(d.hue),
    opacity: d.hue === 'warning' ? 0.5 : lift(d.hue, 0.34),
    dasharray: d.hue === 'warning' ? '4 4' : '4 5',
  })),
)

const dots = computed(() =>
  layout.value.dots.map((d) => {
    const hue = hueVar(d.hue)
    const size = Math.round(d.r * 0.85)
    return {
      ...d,
      key: `${d.id}-${d.cx}-${d.cy}`,
      hue,
      ring: ringOpacity(hue) + 0.08,
      strokeWidth: isFaint(hue) ? 1.5 : 1.25,
      glyph: setupIcon(d.icon),
      size,
    }
  }),
)

const icons = computed(() => layout.value.icons.map((icon, i) => ({ ...icon, key: i, color: hueVar(icon.hue), glyph: setupIcon(icon.icon) })))

const TONE: Record<MapText2D['tone'], (t: MapText2D) => string> = {
  foreground: () => 'var(--foreground)',
  muted: () => 'var(--muted-foreground)',
  hue: (item) => hueVar(item.hue ?? 'ingest'),
}

const texts = computed(() =>
  layout.value.texts.map((item, i) => ({
    ...item,
    key: i,
    fill: TONE[item.tone](item),
    spacing: item.letterSpacing ? `${item.letterSpacing}em` : undefined,
  })),
)

const library = computed(() => layout.value.library)
const libraryGlyph = setupIcon('library')
/** On the wide map the label sits inside the circle under the glyph; stacked, it sits beside it. */
const libraryGlyphY = computed(() => (library.value ? library.value.cy - (layout.value.kind === 'wide' ? 21 : 12) : 0))

const state = computed(() =>
  props.needYou > 0
    ? { warn: true, label: t('setupOverview.needYou', { count: props.needYou }) }
    : { warn: false, label: t('setupOverview.allClear') },
)
</script>

<template>
  <section
    class="relative overflow-hidden rounded-xl border border-border bg-card"
    :style="{
      background: `radial-gradient(130% 110% at 62% 42%, color-mix(in oklch, ${LANDED_HUE} 8%, transparent), transparent 68%), var(--card)`,
    }"
  >
    <span
      class="pointer-events-none absolute inset-x-0 top-0 h-0.5"
      :style="{
        background: `linear-gradient(90deg, ${LANDED_HUE}, color-mix(in oklch, ${LANDED_HUE} 20%, transparent) 55%, transparent)`,
        opacity: 0.5,
      }"
      aria-hidden="true"
    />

    <div class="flex items-start gap-2.5 px-4 pt-3.5 pb-2.5">
      <span
        class="grid size-7 shrink-0 place-items-center rounded-lg"
        :style="{ background: `color-mix(in oklch, ${LANDED_HUE} 14%, transparent)`, color: LANDED_HUE }"
      >
        <GitMerge :size="15" aria-hidden="true" />
      </span>
      <div class="min-w-0 flex-1">
        <h3 class="text-[13.5px] font-semibold text-foreground">{{ t('setupOverview.map.title') }}</h3>
        <p class="mt-0.5 text-xs text-foreground">{{ t('setupOverview.map.lede') }}</p>
      </div>
      <span
        class="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap"
        :class="state.warn ? 'border-warning/40 bg-warning/10 text-warning' : 'border-success/40 bg-success/10 text-success'"
      >
        <TriangleAlert v-if="state.warn" :size="11" aria-hidden="true" />
        <CircleCheck v-else :size="11" aria-hidden="true" />
        {{ state.label }}
      </span>
    </div>

    <div ref="wrap" class="px-3 pt-0.5 pb-3">
      <svg
        class="system-map block w-full overflow-visible"
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        :width="containerWidth"
        :height="svgHeight"
        role="img"
        :aria-label="t('setupOverview.map.alt')"
      >
        <defs>
          <marker
            v-for="hue in HUES"
            :id="`${uid}-ar-${hue}`"
            :key="hue"
            viewBox="0 0 10 10"
            refX="7.5"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1.4 L 8.5 5 L 0 8.6 z" :fill="hueVar(hue)" fill-opacity="0.85" />
          </marker>
          <radialGradient :id="`${uid}-glow`">
            <stop offset="0%" :stop-color="LANDED_HUE" stop-opacity="0.42" />
            <stop offset="55%" :stop-color="LANDED_HUE" stop-opacity="0.1" />
            <stop offset="100%" :stop-color="LANDED_HUE" stop-opacity="0" />
          </radialGradient>
        </defs>

        <circle v-if="library" :cx="library.cx" :cy="library.cy" :r="library.r * 2.55" :fill="`url(#${uid}-glow)`" />

        <rect
          v-for="r in bandRects"
          :key="`band-${r.key}`"
          :x="r.x"
          :y="r.y"
          :width="r.w"
          :height="r.h"
          :rx="r.rx"
          :fill="r.fillValue"
          :stroke="r.stroke"
          :stroke-opacity="r.strokeOpacity"
        />

        <path
          v-for="d in dashes"
          :key="`dash-${d.key}`"
          :d="d.d"
          :stroke="d.stroke"
          :stroke-opacity="d.opacity"
          stroke-width="1.3"
          fill="none"
          :stroke-dasharray="d.dasharray"
        />

        <g v-for="w in wires" :key="`wire-${w.key}`">
          <path :d="w.d" :stroke="w.hue" stroke-opacity="0.09" :stroke-width="w.width + 4.5" fill="none" stroke-linecap="round" />
          <path
            :d="w.d"
            :stroke="w.hue"
            :stroke-opacity="w.opacity"
            :stroke-width="w.width"
            fill="none"
            stroke-linecap="round"
            :marker-end="w.marker"
          />
          <path
            v-if="!w.still"
            class="flow-dash"
            :d="w.d"
            :stroke="w.hue"
            stroke-opacity="0.95"
            :stroke-width="w.width"
            fill="none"
            stroke-dasharray="2 14"
            stroke-linecap="round"
          />
        </g>

        <rect
          v-for="r in boxRects"
          :key="`rect-${r.key}`"
          :x="r.x"
          :y="r.y"
          :width="r.w"
          :height="r.h"
          :rx="r.rx"
          :fill="r.fillValue"
          :stroke="r.strokeOpacity > 0 ? r.stroke : 'none'"
          :stroke-opacity="r.strokeOpacity"
        />

        <g v-if="library">
          <circle :cx="library.cx" :cy="library.cy" :r="library.r + 10" fill="none" :stroke="LANDED_HUE" stroke-opacity="0.18" />
          <circle
            :cx="library.cx"
            :cy="library.cy"
            :r="library.r"
            :fill="`color-mix(in oklch, ${LANDED_HUE} 15%, var(--card))`"
            :stroke="LANDED_HUE"
            stroke-opacity="0.75"
            stroke-width="2"
          />
          <component
            :is="libraryGlyph"
            v-if="libraryGlyph"
            :x="library.cx - 12"
            :y="libraryGlyphY"
            width="24"
            height="24"
            :color="LANDED_HUE"
            :stroke-width="2"
            aria-hidden="true"
          />
        </g>

        <g v-for="d in dots" :key="d.key">
          <circle :cx="d.cx" :cy="d.cy" :r="d.r + 4" :fill="d.hue" fill-opacity="0.07" />
          <circle :cx="d.cx" :cy="d.cy" :r="d.r" fill="var(--card)" :stroke="d.hue" :stroke-opacity="d.ring" :stroke-width="d.strokeWidth" />
          <component
            :is="d.glyph"
            v-if="d.glyph"
            :x="d.cx - d.size / 2"
            :y="d.cy - d.size / 2"
            :width="d.size"
            :height="d.size"
            :color="d.hue"
            :stroke-width="2"
            aria-hidden="true"
          />
        </g>

        <template v-for="icon in icons" :key="`icon-${icon.key}`">
          <component
            :is="icon.glyph"
            v-if="icon.glyph"
            :x="icon.x - icon.size / 2"
            :y="icon.y - icon.size / 2"
            :width="icon.size"
            :height="icon.size"
            :color="icon.color"
            :stroke-width="2"
            aria-hidden="true"
          />
        </template>

        <text
          v-for="item in texts"
          :key="`text-${item.key}`"
          :x="item.x"
          :y="item.y"
          :font-size="item.size"
          :font-weight="item.weight"
          :text-anchor="item.anchor"
          :fill="item.fill"
          :letter-spacing="item.spacing"
        >
          {{ item.text }}
        </text>
      </svg>
    </div>
  </section>
</template>

<style scoped>
.system-map text {
  font-family: inherit;
  font-variant-numeric: tabular-nums;
}

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
