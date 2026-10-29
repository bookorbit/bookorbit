<script setup lang="ts">
import { ExternalLink } from '@lucide/vue'

/** A text link that opens outside BookOrbit, marked as such. */
defineProps<{
  href: string
  label: string
  /** When the visible label alone does not say what it leads to, such as a bare "Docs". */
  ariaLabel?: string
}>()
</script>

<template>
  <a
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    :aria-label="ariaLabel"
    class="inline-flex items-center gap-1 rounded-sm text-xs text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
  >
    <span class="underline underline-offset-2">{{ label }}</span>
    <ExternalLink :size="12" class="shrink-0" aria-hidden="true" />
  </a>
</template>
