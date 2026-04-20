<script setup lang="ts">
import { computed } from 'vue'
import { bookCoverPalette } from '../lib/book-cover'

const props = defineProps<{
  title: string | null
  authorLine: string | null
  isAudio: boolean
  seed: string
}>()

const p = computed(() => bookCoverPalette(props.seed))

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
  const text = (props.title ?? 'Untitled').trim()
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

// Precomputed corner diamond point strings for the outer frame.
const cornerDiamondPoints = computed(() => {
  const { w, h, m } = vb.value
  const r = 3
  const corners = [
    { cx: m, cy: m },
    { cx: w - m, cy: m },
    { cx: w - m, cy: h - m },
    { cx: m, cy: h - m },
  ]
  return corners.map(({ cx, cy }) => `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`)
})

// Divider: two lines flanking a center diamond at y=236.
const divider = computed(() => {
  const { cx, w, m } = vb.value
  const y = 236
  const gap = 6
  const r = 3.5
  const edgePad = props.isAudio ? m + 50 : m + 15
  return {
    lx1: edgePad,
    lx2: cx - gap,
    rx1: cx + gap,
    rx2: w - edgePad,
    pts: `${cx},${y - r} ${cx + r},${y} ${cx},${y + r} ${cx - r},${y}`,
    y,
  }
})

// Clip path to keep all text safely within the inner frame.
// Generated once per instance so each SVG on the page has a unique ID.
const clipId = Math.random().toString(36).slice(2, 8)
</script>

<template>
  <svg :viewBox="`0 0 ${vb.w} ${vb.h}`" xmlns="http://www.w3.org/2000/svg" class="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet">
    <defs>
      <clipPath :id="clipId">
        <rect :x="vb.m + 5" :y="vb.m + 5" :width="vb.w - (vb.m + 5) * 2" :height="vb.h - (vb.m + 5) * 2" />
      </clipPath>
    </defs>

    <!-- Background -->
    <rect :width="vb.w" :height="vb.h" :fill="p.from" />

    <!-- Outer decorative frame -->
    <rect :x="vb.m" :y="vb.m" :width="vb.w - vb.m * 2" :height="vb.h - vb.m * 2" fill="none" :stroke="p.accent" stroke-width="1" opacity="0.5" />

    <!-- Inner frame -->
    <rect
      :x="vb.m + 5"
      :y="vb.m + 5"
      :width="vb.w - (vb.m + 5) * 2"
      :height="vb.h - (vb.m + 5) * 2"
      fill="none"
      :stroke="p.accent"
      stroke-width="0.4"
      opacity="0.25"
    />

    <!-- Corner diamond ornaments -->
    <polygon v-for="(pts, i) in cornerDiamondPoints" :key="i" :points="pts" :fill="p.accent" opacity="0.65" />

    <!-- Text clipped to the inner frame area -->
    <g :clip-path="`url(#${clipId})`">
      <!-- Title -->
      <text :x="vb.cx" :y="titleY" :font-size="fsize" font-weight="900" font-family="inherit" text-anchor="middle" :fill="p.color">
        <tspan v-for="(line, i) in lines" :key="i" :x="vb.cx" :dy="i === 0 ? 0 : lh">{{ line }}</tspan>
      </text>

      <!-- Divider: line — diamond — line -->
      <line :x1="divider.lx1" :y1="divider.y" :x2="divider.lx2" :y2="divider.y" :stroke="p.accent" stroke-width="0.8" opacity="0.65" />
      <polygon :points="divider.pts" :fill="p.accent" opacity="0.65" />
      <line :x1="divider.rx1" :y1="divider.y" :x2="divider.rx2" :y2="divider.y" :stroke="p.accent" stroke-width="0.8" opacity="0.65" />

      <!-- Author -->
      <text
        v-if="authorDisplay"
        :x="vb.cx"
        :y="authorY"
        :font-size="authorFsize"
        font-weight="500"
        font-family="inherit"
        text-anchor="middle"
        :fill="p.textMuted"
      >
        {{ authorDisplay }}
      </text>
    </g>
  </svg>
</template>
