<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** Spent over the limit: 0 to 1, and beyond once it is passed. */
  used: number
  label: string
}>()

/** The same thresholds the server warns and stops at. */
const tone = computed(() => (props.used >= 1 ? 'bg-destructive' : props.used >= 0.8 ? 'bg-warning' : 'bg-primary'))
const percent = computed(() => Math.round(Math.max(0, props.used) * 100))
</script>

<template>
  <div
    class="h-1.5 min-w-[60px] overflow-hidden rounded-full bg-muted"
    role="meter"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="percent"
  >
    <span class="block h-full rounded-[inherit]" :class="tone" :style="{ width: `${Math.min(100, percent)}%` }" />
  </div>
</template>
