<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'count' | 'progress' | 'dot'
    label?: string
  }>(),
  { variant: 'count' },
)
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
    class="ml-auto shrink-0 rounded-md bg-(--shell-accent-tint) px-1.5 py-0.5 text-[11px] font-semibold tabular-nums transition-colors duration-150 group-data-[collapsible=icon]:hidden"
    :class="variant === 'progress' ? 'text-primary' : 'text-muted-foreground group-data-[active=true]/item:text-primary'"
    :aria-label="label"
    :title="label"
  >
    <slot />
  </span>
</template>
