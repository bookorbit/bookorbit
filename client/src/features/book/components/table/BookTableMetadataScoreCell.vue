<script setup lang="ts">
import { computed } from 'vue'

import { metadataScoreColor } from '@/lib/metadata-score-color'

const props = defineProps<{
  value: number | null
}>()

const display = computed(() => (props.value == null ? null : Math.round(Math.min(100, Math.max(0, props.value)))))

const scoreColor = computed(() => (display.value == null ? null : metadataScoreColor(display.value)))
</script>

<template>
  <span
    v-if="display != null"
    class="block min-h-[20px] truncate rounded px-1 text-sm font-semibold tabular-nums"
    :style="{ color: scoreColor ?? undefined }"
    :title="String(display)"
  >
    {{ display }}
  </span>
  <span v-else class="text-xs text-muted-foreground">-</span>
</template>
