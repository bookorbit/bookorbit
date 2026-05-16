<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const props = defineProps<{
  percent: number
  color: string
  size?: number
}>()

const ringSize = computed(() => props.size ?? 32)
const radius = computed(() => (ringSize.value - 5) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const dashoffset = computed(() => {
  const clamped = Math.min(100, Math.max(0, props.percent))
  return circumference.value * (1 - clamped / 100)
})

const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
</script>

<template>
  <svg :width="ringSize" :height="ringSize" :viewBox="`0 0 ${ringSize} ${ringSize}`" class="-rotate-90" aria-hidden="true">
    <circle :cx="ringSize / 2" :cy="ringSize / 2" :r="radius" fill="none" stroke="currentColor" stroke-width="2.5" class="text-muted-foreground/20" />
    <circle
      :cx="ringSize / 2"
      :cy="ringSize / 2"
      :r="radius"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      :stroke-dasharray="circumference"
      :stroke-dashoffset="mounted ? dashoffset : circumference"
      :class="['transition-[stroke-dashoffset] duration-700 ease-out', color]"
    />
  </svg>
</template>
