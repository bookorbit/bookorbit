<script setup lang="ts">
import { computed } from 'vue'

import { diffPathSegments } from '../utils/duplicate-diff'

const props = defineProps<{ path: string; others: string[] }>()

const segments = computed(() => diffPathSegments(props.path, props.others))
</script>

<template>
  <span class="font-mono text-[11.5px] leading-relaxed wrap-anywhere text-path-dim">
    <template v-for="(segment, index) in segments" :key="`${index}-${segment.text}`">
      <span v-if="index > 0" class="px-px text-path-fold" aria-hidden="true">/</span>
      <span
        v-if="segment.changed"
        class="rounded-[3px] bg-primary/15 px-0.5 font-medium text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_34%,transparent)]"
        >{{ segment.text }}</span
      >
      <span v-else>{{ segment.text }}</span>
    </template>
  </span>
</template>
