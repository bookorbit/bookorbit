<script setup lang="ts">
import { computed, type Component } from 'vue'

/** The tinted square an email row leads with. Sizes follow the row: 40 in the route band, 36 on a card, 28 in a list, 22 inline. */
const props = withDefaults(defineProps<{ icon: Component; color?: string; size?: 22 | 28 | 36 | 40; iconSize?: number }>(), {
  color: 'var(--primary)',
  size: 28,
})

const RADIUS = { 22: 6, 28: 7, 36: 9, 40: 10 } as const
const ICON = { 22: 13, 28: 15, 36: 18, 40: 19 } as const

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: `${RADIUS[props.size]}px`,
  color: props.color,
  backgroundColor: `color-mix(in oklch, ${props.color} 13%, transparent)`,
}))
</script>

<template>
  <span class="inline-flex shrink-0 items-center justify-center" :style="style" aria-hidden="true">
    <component :is="icon" :size="iconSize ?? ICON[size]" />
  </span>
</template>
