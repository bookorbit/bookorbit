<script setup lang="ts">
import { computed } from 'vue'
import { getActivePinia, storeToRefs } from 'pinia'
import { bookCoverPalette } from '../lib/book-cover'
import { useThemeStore } from '@/stores/theme'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  title: string | null
  authorLine: string | null
  isAudio: boolean
  seed: string
}>()

const activePinia = getActivePinia()
const themeRefs = activePinia ? storeToRefs(useThemeStore(activePinia)) : null

const p = computed(() =>
  bookCoverPalette(props.seed, {
    accent: themeRefs?.accent.value,
    isDark: themeRefs?.theme.value === 'dark',
  }),
)

// Portrait for ebook (200×300), square for audiobook (300×300).
// The container background uses the same palette, so any letterboxing from
// an aspect-ratio mismatch blends in invisibly.
const vb = computed(() => (props.isAudio ? { w: 300, h: 300, cx: 150, m: 10 } : { w: 200, h: 300, cx: 100, m: 10 }))

// Square canvas is 1.4× wider so we scale fonts proportionally.
const scale = computed(() => (props.isAudio ? 1.4 : 1))

const fsize = computed(() => {
  const len = (props.title ?? '').length
  let base: number
  if (len <= 6) base = 40
  else if (len <= 12) base = 32
  else if (len <= 22) base = 24
  else if (len <= 35) base = 17
  else base = 13
  return Math.round(base * scale.value)
})

const lh = computed(() => Math.round(fsize.value * 1.25))

const lines = computed(() => {
  const text = (props.title ?? t('book.untitled')).trim()
  // Use 0.60 factor (vs raw 0.55) to better account for bold/heavy font width.
  const cpl = Math.max(4, Math.floor((vb.value.w - 28) / (fsize.value * 0.6)))
  const words = text.split(/\s+/).filter(Boolean)
  const result: string[] = []
  let cur = ''
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w
    if (test.length <= cpl) {
      cur = test
    } else {
      if (cur) {
        result.push(cur)
        if (result.length >= 5) return result
      }
      // Chunk words longer than cpl instead of dropping the remainder.
      let rem = w
      while (rem.length > cpl) {
        result.push(`${rem.slice(0, cpl - 1)}-`)
        if (result.length >= 5) return result
        rem = rem.slice(cpl - 1)
      }
      cur = rem
    }
  }
  if (cur) result.push(cur)
  return result.slice(0, 5)
})

// Title is centered in the upper zone (y 18–220), leaving the lower portion
// for the divider and author.
const titleY = computed(() => {
  const mid = (18 + 220) / 2
  return mid + fsize.value / 2 - ((lines.value.length - 1) * lh.value) / 2
})

const authorFsize = computed(() => Math.round(11 * scale.value))

// Position author below the divider diamond with font-proportional spacing.
const authorY = computed(() => Math.round(236 + 3.5 + authorFsize.value * 1.8))

const authorDisplay = computed(() => {
  const a = props.authorLine ?? ''
  const max = props.isAudio ? 28 : 30
  return a.length > max ? `${a.slice(0, max - 1)}\u2026` : a
})

// Clip path to keep all text safely within the inner frame.
// Generated once per instance so each SVG on the page has a unique ID.
const clipId = Math.random().toString(36).slice(2, 8)
</script>

<template>
  <svg :viewBox="`0 0 ${vb.w} ${vb.h}`" xmlns="http://www.w3.org/2000/svg" class="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient :id="`grad-${clipId}`" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" :stop-color="p.from" />
        <stop offset="100%" :stop-color="p.to" />
      </linearGradient>
      <clipPath :id="clipId">
        <rect :x="vb.m + 15" :y="vb.m + 15" :width="vb.w - (vb.m + 15) * 2" :height="vb.h - (vb.m + 15) * 2" />
      </clipPath>
    </defs>

    <!-- Background -->
    <rect :width="vb.w" :height="vb.h" :fill="`url(#grad-${clipId})`" />

    <!-- Variation 9: Diamond Lattice -->
    <g :stroke="p.accent" fill="none" opacity="0.15" stroke-width="0.5">
      <path v-for="i in 10" :key="`d1-${i}`" :d="`M ${-50 + i * 40},0 L ${vb.w + 50 + i * 40},${vb.h}`" />
      <path v-for="i in 10" :key="`d2-${i}`" :d="`M ${vb.w + 50 - i * 40},0 L ${-50 - i * 40},${vb.h}`" />

      <!-- Small accent diamonds at intersections -->
      <g opacity="0.4" :fill="p.accent" stroke="none">
        <template v-for="x in 4" :key="`x-${x}`">
          <rect
            v-for="y in 6"
            :key="`y-${y}`"
            :x="(vb.w / 5) * x - 1.5"
            :y="(vb.h / 7) * y - 1.5"
            width="3"
            height="3"
            transform="rotate(45)"
            style="transform-origin: center"
          />
        </template>
      </g>
    </g>

    <!-- Decorative Internal Frame -->
    <g :stroke="p.accent" fill="none" opacity="0.6">
      <rect :x="vb.m + 5" :y="vb.m + 5" :width="vb.w - (vb.m + 5) * 2" :height="vb.h - (vb.m + 5) * 2" stroke-width="0.8" />
      <path :d="`M ${vb.m},${vb.m + 15} V ${vb.m} H ${vb.m + 15}`" stroke-width="2" />
      <path :d="`M ${vb.w - vb.m},${vb.m + 15} V ${vb.m} H ${vb.w - vb.m - 15}`" stroke-width="2" />
      <path :d="`M ${vb.w - vb.m},${vb.h - vb.m - 15} V ${vb.h - vb.m} H ${vb.w - vb.m - 15}`" stroke-width="2" />
      <path :d="`M ${vb.m},${vb.h - vb.m - 15} V ${vb.h - vb.m} H ${vb.m + 15}`" stroke-width="2" />
    </g>

    <!-- Text Layer -->
    <g :clip-path="`url(#${clipId})`">
      <!-- Title -->
      <text :x="vb.cx" :y="titleY" :font-size="fsize" font-weight="800" font-family="inherit" text-anchor="middle" :fill="p.color">
        <tspan v-for="(line, i) in lines" :key="i" :x="vb.cx" :dy="i === 0 ? 0 : lh">{{ line }}</tspan>
      </text>

      <!-- Lattice Divider -->
      <g :fill="p.accent" opacity="0.8">
        <circle :cx="vb.cx" :cy="236" r="3" />
        <line :x1="vb.cx - 35" :y1="236" :x2="vb.cx - 8" :y2="236" :stroke="p.accent" stroke-width="1" />
        <line :x1="vb.cx + 8" :y1="236" :x2="vb.cx + 35" :y2="236" :stroke="p.accent" stroke-width="1" />
      </g>

      <!-- Author -->
      <text
        v-if="authorDisplay"
        :x="vb.cx"
        :y="authorY"
        :font-size="authorFsize"
        font-weight="600"
        font-family="inherit"
        text-anchor="middle"
        :fill="p.textMuted"
        style="letter-spacing: 0.05em"
      >
        {{ authorDisplay }}
      </text>
    </g>
  </svg>
</template>
