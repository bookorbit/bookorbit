<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AchievementRarity } from '@bookorbit/types'
import type { RarityTally } from '../lib/achievement-showcase'
import { MEDAL_RARITIES } from '../lib/medal-geometry'
import { RARITY_TEXT_CLASS } from '../lib/rarity-classes'

const props = defineProps<{
  tally: RarityTally
}>()

const { t } = useI18n()
const uid = useId()

const WIDTH = 92
const RX = 30
const RY = 8.5
const MAX_STACK = 116

// One coin per tier, earned ones struck in metal and the rest drawn as dashed ghosts above them. The step
// shrinks when a rarity holds many tiers so the tallest stack always fits.
const step = computed(() => Math.min(3.9, MAX_STACK / Math.max(1, ...MEDAL_RARITIES.map((rarity) => props.tally[rarity].total))))
const base = computed(() => Math.ceil(Math.max(...MEDAL_RARITIES.map((rarity) => props.tally[rarity].total)) * step.value) + RY + 6)
const height = computed(() => base.value + RY + 4)

function coins(rarity: AchievementRarity) {
  const { earned, total } = props.tally[rarity]
  return {
    earned: Array.from({ length: earned }, (_, index) => base.value - index * step.value),
    ghosts: Array.from({ length: Math.max(0, total - earned) }, (_, index) => base.value - (earned + index) * step.value),
    top: base.value - Math.max(0, earned - 1) * step.value,
  }
}

const stacks = computed(() => MEDAL_RARITIES.map((rarity) => ({ rarity, ...props.tally[rarity], ...coins(rarity) })))
</script>

<template>
  <div class="relative grid grid-cols-4 items-end">
    <span class="absolute inset-x-0 bottom-9 h-px bg-shelf-line" aria-hidden="true" />
    <div v-for="stack in stacks" :key="stack.rarity" class="flex min-w-0 flex-col items-center">
      <svg :width="WIDTH" :height="height" :viewBox="`0 0 ${WIDTH} ${height}`" class="h-auto max-w-full max-md:w-[72px]" aria-hidden="true">
        <defs>
          <linearGradient :id="`${uid}-edge-${stack.rarity}`" x1="0" x2="1">
            <stop offset="0" :style="{ stopColor: `var(--medal-${stack.rarity}-shadow)` }" />
            <stop offset="0.45" :style="{ stopColor: `var(--medal-${stack.rarity}-highlight)` }" />
            <stop offset="1" :style="{ stopColor: `var(--medal-${stack.rarity}-shadow)` }" />
          </linearGradient>
          <linearGradient :id="`${uid}-face-${stack.rarity}`" gradientUnits="userSpaceOnUse" x1="16" y1="0" x2="76" y2="0">
            <stop offset="0" :style="{ stopColor: `var(--medal-${stack.rarity}-shadow)` }" />
            <stop offset="0.47" :style="{ stopColor: `var(--medal-${stack.rarity}-highlight)` }" />
            <stop offset="1" :style="{ stopColor: `var(--medal-${stack.rarity}-body)` }" />
          </linearGradient>
        </defs>
        <ellipse
          v-for="(y, index) in stack.ghosts"
          :key="`g${index}`"
          :cx="WIDTH / 2"
          :cy="y"
          :rx="RX"
          :ry="RY"
          fill="none"
          style="stroke: var(--medal-blank-edge)"
          stroke-width="1"
          stroke-dasharray="2 2.4"
        />
        <g v-for="(y, index) in stack.earned" :key="`e${index}`">
          <path :d="`M${WIDTH / 2 - RX} ${y}v3a${RX} ${RY} 0 0 0 ${RX * 2} 0v-3`" :fill="`url(#${uid}-edge-${stack.rarity})`" />
          <ellipse
            :cx="WIDTH / 2"
            :cy="y"
            :rx="RX"
            :ry="RY"
            :fill="`url(#${uid}-face-${stack.rarity})`"
            :style="{ stroke: `var(--medal-${stack.rarity}-shadow)` }"
            stroke-width="0.6"
          />
        </g>
        <ellipse
          v-if="stack.earned.length"
          :cx="WIDTH / 2"
          :cy="stack.top"
          :rx="RX - 6"
          :ry="RY - 2.2"
          fill="none"
          :style="{ stroke: `var(--medal-${stack.rarity}-highlight)` }"
          stroke-width="0.8"
          opacity="0.7"
        />
      </svg>
      <span class="mt-1 text-xs font-bold" :class="RARITY_TEXT_CLASS[stack.rarity]">{{ t(`achievements.rarity.${stack.rarity}`) }}</span>
      <span class="text-xs text-muted-foreground tabular-nums">
        <span class="font-bold text-foreground">{{ stack.earned.length }}</span> / {{ stack.total }}
      </span>
    </div>
  </div>
</template>
