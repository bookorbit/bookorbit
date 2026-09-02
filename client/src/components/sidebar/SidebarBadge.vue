<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    variant?: 'count' | 'progress' | 'dot'
    /** `accent` marks a count that stands for outstanding work, not just a total. */
    tone?: 'default' | 'accent'
    label?: string
  }>(),
  { variant: 'count', tone: 'default', label: undefined },
)

const inkClass = computed(() => {
  if (props.tone === 'accent') return 'font-bold text-primary'
  if (props.variant === 'progress') return 'font-semibold text-primary'
  return 'font-semibold text-sidebar-count-foreground group-data-[active=true]/item:text-primary'
})
</script>

<template>
  <span
    v-if="variant === 'dot'"
    class="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-primary group-data-[collapsible=icon]:hidden"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
  />
  <span
    v-else
    class="ml-auto shrink-0 rounded-md bg-(--shell-accent-tint) px-1.5 py-0.5 text-[11px] tabular-nums transition-colors duration-150 group-data-[collapsible=icon]:hidden"
    :class="inkClass"
    :aria-label="label"
    :title="label"
  >
    <slot />
  </span>
</template>
