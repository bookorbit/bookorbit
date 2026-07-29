<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  value: number | null
}>()

type SpectrumStop = { at: number; rgb: [number, number, number] }
const SPECTRUM_STOPS: SpectrumStop[] = [
  { at: 0, rgb: [239, 68, 68] }, // red
  { at: 35, rgb: [249, 115, 22] }, // orange
  { at: 65, rgb: [234, 179, 8] }, // yellow
  { at: 100, rgb: [34, 197, 94] }, // green
]

const clamped = computed(() => (props.value == null ? null : Math.min(100, Math.max(0, props.value))))

const display = computed(() => {
  if (clamped.value == null) return null
  return Math.round(clamped.value)
})

const scoreColor = computed(() => {
  if (clamped.value == null) return null
  const value = clamped.value
  let lower = SPECTRUM_STOPS[0]!
  let upper = SPECTRUM_STOPS[SPECTRUM_STOPS.length - 1]!

  for (let i = 1; i < SPECTRUM_STOPS.length; i += 1) {
    const stop = SPECTRUM_STOPS[i]!
    if (value <= stop.at) {
      upper = stop
      lower = SPECTRUM_STOPS[i - 1]!
      break
    }
  }

  const span = Math.max(upper.at - lower.at, 1)
  const t = (value - lower.at) / span
  const r = Math.round(lower.rgb[0] + (upper.rgb[0] - lower.rgb[0]) * t)
  const g = Math.round(lower.rgb[1] + (upper.rgb[1] - lower.rgb[1]) * t)
  const b = Math.round(lower.rgb[2] + (upper.rgb[2] - lower.rgb[2]) * t)
  return `rgb(${r}, ${g}, ${b})`
})
</script>

<template>
  <span
    v-if="display != null"
    class="block min-h-[20px] truncate rounded px-1 text-sm font-semibold tabular-nums"
    :style="{ color: scoreColor ?? undefined }"
    :title="String(display)"
  >
    {{ display }}
  </span>
  <span v-else class="text-xs text-muted-foreground">-</span>
</template>
