<script setup lang="ts">
import { computed } from 'vue'
import type { ScanProgressEvent } from '@projectx/types'

const props = defineProps<{
  progress: ScanProgressEvent | undefined
}>()

const isActive = computed(() => props.progress?.status === 'running')
const pct = computed(() => {
  if (!props.progress || props.progress.total === 0) return 0
  return Math.min(100, Math.floor((props.progress.processed / props.progress.total) * 100))
})

const label = computed(() => {
  if (!props.progress) return ''
  const p = props.progress
  const parts = [`${p.processed.toLocaleString()}/${p.total.toLocaleString()} files`]
  if (p.added > 0) parts.push(`${p.added} ${p.added === 1 ? 'book' : 'books'} found`)
  return parts.join(' · ')
})
</script>

<template>
  <div v-if="isActive" class="flex items-center gap-3 px-4 py-2 rounded-lg bg-primary/5 border border-primary/15">
    <div class="relative h-1.5 flex-1 rounded-full bg-primary/10 overflow-hidden">
      <div
        class="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-300 ease-out animate-progress-stripes"
        :style="{ width: `${pct}%` }"
      />
    </div>
    <span class="text-xs text-muted-foreground whitespace-nowrap">{{ label }}</span>
  </div>
</template>
