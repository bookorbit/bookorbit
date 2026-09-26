<script setup lang="ts">
/**
 * A horizontally scrollable row of `FilterChip`s, labelled as one group for assistive technology.
 *
 * `wrap` is for a group that shares its line with other controls: there the scrolling row is only
 * as wide as the space left over, and a pointer has neither a scrollbar nor a swipe to discover the
 * chips past its edge. Touch keeps the scrolling row, where swiping it is the expected gesture.
 */
withDefaults(defineProps<{ label: string; wrap?: boolean }>(), { wrap: false })
</script>

<template>
  <div
    class="no-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto"
    :class="wrap && 'md:flex-wrap md:overflow-x-visible'"
    role="group"
    :aria-label="label"
  >
    <slot />
  </div>
</template>
