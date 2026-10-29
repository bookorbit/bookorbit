<script setup lang="ts">
import { computed } from 'vue'
import { formatColorVar } from '@/features/book/lib/format-colors'
import FolderFormatLegend from './FolderFormatLegend.vue'

const props = withDefaults(defineProps<{ formats: Record<string, number>; limit?: number }>(), { limit: 6 })

const segments = computed(() => {
  const sorted = Object.entries(props.formats).sort((a, b) => b[1] - a[1])
  const total = sorted.reduce((sum, [, count]) => sum + count, 0) || 1
  return sorted.map(([format, count]) => ({ format, width: `${(count / total) * 100}%`, color: formatColorVar(format) }))
})
</script>

<template>
  <div>
    <div class="flex h-1 w-full gap-px overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <span
        v-for="segment in segments"
        :key="segment.format"
        class="h-full first:rounded-s-full last:rounded-e-full"
        :style="{ width: segment.width, backgroundColor: segment.color }"
      />
    </div>
    <div v-if="segments.length" class="mt-1.5"><FolderFormatLegend :formats="formats" :limit="limit" /></div>
  </div>
</template>
