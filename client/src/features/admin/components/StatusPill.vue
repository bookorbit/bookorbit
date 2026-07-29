<script setup lang="ts">
import { computed } from 'vue'
import { statusPillClass, type StatusPillTone } from '../lib/status-pill-styles'

const props = withDefaults(defineProps<{ tone?: StatusPillTone }>(), { tone: 'neutral' })

const toneClass = computed(() => statusPillClass(props.tone))
</script>

<template>
  <span class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium" :class="toneClass">
    <slot />
  </span>
</template>
