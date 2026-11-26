<script setup lang="ts">
import { computed } from 'vue'
import type { ComicNoteMarker } from '../composables/useComicNotes'

const props = defineProps<{
  markers: readonly ComicNoteMarker[]
  pageCount: number
}>()

// The range thumb is 16px wide, so its centre travels 8px in from either end of the track.
const dots = computed(() => {
  const last = props.pageCount - 1
  if (last <= 0) return []
  return props.markers
    .filter((marker) => marker.page >= 0 && marker.page <= last)
    .map((marker) => ({
      page: marker.page,
      style: { insetInlineStart: `calc(8px + (100% - 16px) * ${(marker.page / last).toFixed(5)})`, background: marker.color },
    }))
})
</script>

<template>
  <div v-if="dots.length > 0" aria-hidden="true" class="pointer-events-none absolute inset-x-0 top-0 h-full" data-testid="comic-note-markers">
    <span
      v-for="dot in dots"
      :key="dot.page"
      class="absolute top-0.5 size-1.5 -translate-x-1/2 rounded-full ring-1 ring-background rtl:translate-x-1/2"
      :style="dot.style"
    />
  </div>
</template>
