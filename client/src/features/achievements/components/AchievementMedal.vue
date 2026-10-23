<script setup lang="ts">
import { computed, useId } from 'vue'
import type { AchievementRarity } from '@bookorbit/types'
import type { MedalState } from '../lib/achievement-display'
import { BEAD_DASH, BEAD_RADIUS, MEDAL_SHAPES, PROGRESS_RING_RADIUS, pipPositions, progressDash } from '../lib/medal-geometry'
import { resolveLucideIcon } from '../utils/resolveLucideIcon'

const props = withDefaults(
  defineProps<{
    rarity: AchievementRarity
    icon: string
    state?: MedalState
    /** 0..1 toward unlocking; drawn as a ring on a medal not yet earned. */
    progress?: number | null
    size?: number
    pips?: Array<{ rarity: AchievementRarity; earned: boolean }>
    /**
     * `hover` sweeps a highlight across when a parent `.achievement-medal-trigger` is hovered or focused;
     * `intro` also plays it twice on mount. A sweep relayouts the SVG every frame it runs, so only the
     * one or two hero medals take it, and nothing loops: a page at rest renders no frames.
     */
    sheen?: 'none' | 'hover' | 'intro'
    /** A soft cast shadow. Filters are costly to rasterise, so only the one or two hero medals take it. */
    glow?: boolean
  }>(),
  { state: 'earned', progress: null, size: 64, pips: () => [], sheen: 'none', glow: false },
)

const uid = useId()
const id = (name: string) => `${uid}-${name}`
const url = (name: string) => `url(#${id(name)})`

const shape = computed(() => MEDAL_SHAPES[props.rarity])
const Icon = computed(() => resolveLucideIcon(props.icon))
const isEarned = computed(() => props.state === 'earned')
const pipPoints = computed(() => pipPositions(props.pips.length).map((point, index) => ({ point, pip: props.pips[index]! })))
const rimRarities = computed(() => [...new Set([props.rarity, ...props.pips.filter((pip) => pip.earned).map((pip) => pip.rarity)])])
const ring = computed(() => (props.progress != null && props.progress > 0 ? progressDash(props.progress) : null))

function metal(rarity: AchievementRarity, stop: 'shadow' | 'body' | 'highlight'): string {
  return `var(--medal-${rarity}-${stop})`
}
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="-4 -4 108 108"
    class="achievement-medal"
    :class="[`achievement-medal--${state}`, { 'achievement-medal--sheen-intro': sheen === 'intro', 'achievement-medal--glow': glow && isEarned }]"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient v-for="r in rimRarities" :id="id(`rim-${r}`)" :key="r" gradientUnits="userSpaceOnUse" x1="8" y1="6" x2="92" y2="94">
        <stop offset="0" :style="{ stopColor: metal(r, 'shadow') }" />
        <stop offset="0.3" :style="{ stopColor: metal(r, 'body') }" />
        <stop offset="0.47" :style="{ stopColor: metal(r, 'highlight') }" />
        <stop offset="0.64" :style="{ stopColor: metal(r, 'body') }" />
        <stop offset="1" :style="{ stopColor: metal(r, 'shadow') }" />
      </linearGradient>
      <radialGradient v-if="isEarned" :id="id('face')" gradientUnits="userSpaceOnUse" cx="40" cy="34" r="46">
        <stop offset="0" :style="{ stopColor: metal(rarity, 'highlight') }" />
        <stop offset="0.42" :style="{ stopColor: metal(rarity, 'body') }" />
        <stop offset="1" :style="{ stopColor: metal(rarity, 'shadow') }" />
      </radialGradient>
      <radialGradient v-else :id="id('blank')" gradientUnits="userSpaceOnUse" cx="50" cy="70" r="44">
        <stop offset="0" style="stop-color: var(--medal-blank-face-low)" />
        <stop offset="1" style="stop-color: var(--medal-blank-face-high)" />
      </radialGradient>
      <linearGradient v-if="isEarned && sheen !== 'none'" :id="id('sheen')" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0" />
        <stop offset="0.5" stop-color="#fff" stop-opacity="0.55" />
        <stop offset="1" stop-color="#fff" stop-opacity="0" />
      </linearGradient>
      <clipPath v-if="isEarned && sheen !== 'none'" :id="id('clip')"><path :d="shape" /></clipPath>
    </defs>

    <template v-if="isEarned">
      <path :d="shape" :fill="url(`rim-${rarity}`)" />
      <circle
        v-if="rarity === 'rare'"
        cx="50"
        cy="50"
        :r="BEAD_RADIUS"
        fill="none"
        :style="{ stroke: metal('rare', 'highlight') }"
        stroke-width="2.5"
        stroke-linecap="round"
        :stroke-dasharray="BEAD_DASH"
        opacity="0.55"
      />
      <circle cx="50" cy="50" r="35.5" :fill="url('face')" />
      <circle cx="50" cy="50" r="35.5" fill="none" :style="{ stroke: metal(rarity, 'shadow') }" stroke-width="1.4" opacity="0.9" />
      <circle cx="50" cy="50" r="32.4" fill="none" :style="{ stroke: metal(rarity, 'highlight') }" stroke-width="0.7" opacity="0.5" />
      <g transform="translate(0 0.55)" :style="{ color: metal(rarity, 'highlight') }" opacity="0.75">
        <component :is="Icon" x="31" y="31" :size="38" :stroke-width="2.1" />
      </g>
      <g :style="{ color: metal(rarity, 'shadow') }">
        <component :is="Icon" x="31" y="31" :size="38" :stroke-width="2.1" />
      </g>
      <g v-if="sheen !== 'none'" :clip-path="url('clip')">
        <rect class="achievement-medal__sheen" x="-40" y="-20" width="26" height="140" :fill="url('sheen')" />
      </g>
    </template>

    <template v-else>
      <path :d="shape" style="fill: var(--medal-blank); stroke: var(--medal-blank-edge)" stroke-width="1.2" />
      <circle
        v-if="rarity === 'rare'"
        cx="50"
        cy="50"
        :r="BEAD_RADIUS"
        fill="none"
        style="stroke: var(--medal-blank-edge)"
        stroke-width="2.5"
        stroke-linecap="round"
        :stroke-dasharray="BEAD_DASH"
      />
      <circle cx="50" cy="50" r="35.5" :fill="url('blank')" style="stroke: var(--medal-blank-edge)" stroke-width="1" />
      <template v-if="state === 'secret'">
        <circle cx="50" cy="50" r="31" fill="none" style="stroke: var(--medal-blank-edge)" stroke-width="1.2" stroke-dasharray="2.4 3.2" />
        <text x="50" y="61.5" text-anchor="middle" font-size="31" font-weight="700" class="achievement-medal__glyph">?</text>
      </template>
      <g v-else style="color: var(--medal-blank-glyph)">
        <component :is="Icon" x="32" y="32" :size="36" :stroke-width="1.9" />
      </g>
      <template v-if="ring">
        <circle cx="50" cy="50" :r="PROGRESS_RING_RADIUS" fill="none" style="stroke: var(--medal-blank-edge)" stroke-width="3.2" />
        <circle
          cx="50"
          cy="50"
          :r="PROGRESS_RING_RADIUS"
          fill="none"
          :style="{ stroke: `var(--rarity-${rarity}-fill)` }"
          stroke-width="3.2"
          stroke-linecap="round"
          :stroke-dasharray="`${ring.dash.toFixed(2)} ${ring.length.toFixed(2)}`"
          transform="rotate(-90 50 50)"
        />
      </template>
    </template>

    <template v-for="({ point: [x, y], pip }, index) in pipPoints" :key="`pip-${index}`">
      <circle v-if="pip.earned" :cx="x" :cy="y" r="3.6" :fill="url(`rim-${pip.rarity}`)" style="stroke: var(--card)" stroke-width="1.4" />
      <circle v-else :cx="x" :cy="y" r="3.2" style="fill: var(--medal-blank); stroke: var(--medal-blank-edge)" stroke-width="1.2" />
    </template>
  </svg>
</template>

<style>
.achievement-medal {
  display: block;
  flex: none;
  overflow: visible;
  transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.achievement-medal--glow {
  filter: drop-shadow(0 6px 10px color-mix(in oklch, var(--medal-shadow) 80%, transparent));
}

.achievement-medal__glyph {
  fill: var(--medal-blank-glyph);
  font-family: var(--app-font-serif);
}

.achievement-medal__sheen {
  opacity: 0;
  transform-box: view-box;
  transform-origin: 50px 50px;
  transform: rotate(22deg);
}

.achievement-medal-trigger:hover .achievement-medal__sheen,
.achievement-medal-trigger:focus-visible .achievement-medal__sheen {
  animation: achievement-medal-sheen 1.15s ease-out 1;
}

.achievement-medal--sheen-intro .achievement-medal__sheen {
  animation: achievement-medal-sheen 1.6s ease-in-out 0.4s 2;
}

@keyframes achievement-medal-sheen {
  0% {
    opacity: 0.9;
    transform: translateX(0) rotate(22deg);
  }
  100% {
    opacity: 0.9;
    transform: translateX(150px) rotate(22deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .achievement-medal__sheen {
    animation: none !important;
  }
}
</style>
