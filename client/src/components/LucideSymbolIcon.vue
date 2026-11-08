<script setup lang="ts">
// Mirrors the <svg> a @lucide/vue component renders (attributes and `lucide-<name>` class), with
// the shapes referenced from a generated sprite file instead of bundled.
withDefaults(defineProps<{ file: string; href: string; size?: number }>(), { size: 24 })
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    :class="['lucide', `lucide-${file}`]"
    aria-hidden="true"
  >
    <use :href="href" />
  </svg>
</template>
